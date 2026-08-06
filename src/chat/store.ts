/**
 * Module-level chat state, shared by every screen through `useSyncExternalStore`.
 *
 * The relay is the source of truth for message *content* — this store is only a
 * live cache so that (a) an optimistic send and the subscription that later
 * echoes it agree on one list, (b) the channel list can show previews without a
 * second round trip, and (c) navigating into a room shows what the list already
 * knew instead of an empty screen.
 *
 * Nothing here is persisted: on a cold start the adapter re-subscribes and the
 * relay backfills recent history, which is what makes messages survive restarts.
 * Read receipts and the list of DM threads you've opened *are* persisted, since
 * neither exists on the relay.
 */

import AsyncStorage from "@react-native-async-storage/async-storage"

import { mergeProfiles } from "./profiles"
import type { ChatChannel, ChatMessage, ChatProfile } from "./types"

const EMPTY_MESSAGES: ChatMessage[] = []

const messages = new Map<string, ChatMessage[]>()
const profiles = new Map<string, ChatProfile>()
const listeners = new Set<() => void>()

/**
 * Bumped on every mutation. Components subscribe to this number rather than to
 * derived objects, because `useSyncExternalStore` requires a snapshot that is
 * referentially stable between changes — a freshly-built array or object would
 * loop forever.
 */
let version = 0

export function getStoreVersion(): number {
  return version
}

function notify() {
  version += 1
  for (const listener of listeners) listener()
}

export function subscribeToStore(listener: () => void): () => void {
  listeners.add(listener)
  return () => {
    listeners.delete(listener)
  }
}

/* ------------------------------------------------------------- messages */

export function getChannelMessages(channelId: string): ChatMessage[] {
  return messages.get(channelId) ?? EMPTY_MESSAGES
}

function byTime(a: ChatMessage, b: ChatMessage) {
  if (a.createdAt !== b.createdAt) return a.createdAt - b.createdAt
  return a.id < b.id ? -1 : a.id > b.id ? 1 : 0
}

/**
 * Merge relay events into a channel. Deduplicated by event id, which is also
 * how an optimistic row gets replaced by the confirmed copy: we know the id
 * before publishing, so the echo collides with the local row rather than
 * duplicating it.
 */
export function ingestMessages(incoming: ChatMessage[]) {
  if (!incoming.length) return
  const touched = new Set<string>()

  for (const message of incoming) {
    const existing = messages.get(message.channelId) ?? []
    const index = existing.findIndex((m) => m.id === message.id)

    if (index >= 0) {
      const previous = existing[index]
      // A confirmed copy always wins over a pending/failed local one.
      if (!previous.pending && !previous.failed) continue
      const next = existing.slice()
      next[index] = message
      messages.set(message.channelId, next)
    } else {
      messages.set(message.channelId, [...existing, message].sort(byTime))
    }
    touched.add(message.channelId)
  }

  if (touched.size) notify()
}

/** Append (or update) a locally-authored message — optimistic send. */
export function putLocalMessage(message: ChatMessage) {
  const existing = messages.get(message.channelId) ?? []
  const index = existing.findIndex((m) => m.id === message.id)
  const next = existing.slice()
  if (index >= 0) next[index] = message
  else next.push(message)
  messages.set(message.channelId, next.sort(byTime))
  notify()
}

export function markMessageFailed(channelId: string, id: string) {
  const existing = messages.get(channelId)
  if (!existing) return
  const index = existing.findIndex((m) => m.id === id)
  if (index < 0) return
  const next = existing.slice()
  next[index] = { ...next[index], pending: false, failed: true }
  messages.set(channelId, next)
  notify()
}

export function removeMessage(channelId: string, id: string) {
  const existing = messages.get(channelId)
  if (!existing) return
  messages.set(
    channelId,
    existing.filter((m) => m.id !== id),
  )
  notify()
}

export function getLastMessage(channelId: string): ChatMessage | null {
  const list = messages.get(channelId)
  return list && list.length ? list[list.length - 1] : null
}

/* ------------------------------------------------------------- profiles */

export function getProfile(pubkey: string): ChatProfile | undefined {
  return profiles.get(pubkey)
}

/**
 * Profiles arrive from two sources — the community directory and kind-0 relay
 * metadata — in no particular order, so each arrival is merged rather than
 * stored: the directory's name must survive a later kind-0, and a kind-0
 * avatar must survive a directory row that has none. See ./profiles.
 */
export function ingestProfiles(incoming: ChatProfile[]) {
  let changed = false
  for (const profile of incoming) {
    const previous = profiles.get(profile.pubkey)
    const merged = mergeProfiles(previous, profile)
    if (
      previous &&
      previous.name === merged.name &&
      previous.avatarUrl === merged.avatarUrl &&
      previous.source === merged.source
    ) {
      continue
    }
    profiles.set(profile.pubkey, merged)
    changed = true
  }
  if (changed) notify()
}

/** Reset on sign-out so a second account never sees the first one's cache. */
export function clearStore() {
  messages.clear()
  profiles.clear()
  notify()
}

/* -------------------------------------------------- persisted: read state */

const READ_KEY = "aisocratic.chat.read.v1"

let readState: Record<string, number> = {}
let readLoaded = false

export async function loadReadState() {
  if (readLoaded) return readState
  readLoaded = true
  try {
    const raw = await AsyncStorage.getItem(READ_KEY)
    if (raw) readState = JSON.parse(raw) as Record<string, number>
  } catch {
    readState = {}
  }
  notify()
  return readState
}

export function getLastReadAt(channelId: string): number {
  return readState[channelId] ?? 0
}

export function markChannelRead(channelId: string, at: number = Math.floor(Date.now() / 1000)) {
  if ((readState[channelId] ?? 0) >= at) return
  readState = { ...readState, [channelId]: at }
  notify()
  void AsyncStorage.setItem(READ_KEY, JSON.stringify(readState)).catch(() => {
    /* read receipts are a nicety */
  })
}

/* ----------------------------------------------------- persisted: threads */

/**
 * DM threads you've opened. Nostr has no "conversation list" — you can only ask
 * a relay for messages involving keys you already know — so the app remembers
 * which people you've talked to.
 */
const threadsKey = (userId: string) => `aisocratic.chat.threads.v1.${userId}`

let threads: ChatChannel[] = []
let threadsUserId: string | null = null

export function getThreads(): ChatChannel[] {
  return threads
}

export async function loadThreads(userId: string): Promise<ChatChannel[]> {
  if (threadsUserId === userId) return threads
  threadsUserId = userId
  try {
    const raw = await AsyncStorage.getItem(threadsKey(userId))
    threads = raw ? (JSON.parse(raw) as ChatChannel[]) : []
  } catch {
    threads = []
  }
  notify()
  return threads
}

export function rememberThread(userId: string, channel: ChatChannel) {
  if (channel.kind !== "dm") return
  const existing = threads.find((t) => t.id === channel.id)
  if (existing && existing.name === channel.name && existing.avatarUrl === channel.avatarUrl) return

  threads = [channel, ...threads.filter((t) => t.id !== channel.id)]
  threadsUserId = userId
  notify()
  void AsyncStorage.setItem(threadsKey(userId), JSON.stringify(threads)).catch(() => {
    /* the thread will simply not be listed next launch */
  })
}
