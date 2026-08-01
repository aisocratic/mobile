/**
 * Adapter selection plus the React surface for chat.
 *
 * Screens import only from here. The transport (`./nostr`) is chosen once, so
 * moving the app onto a Buzz relay — or onto something else entirely — is a
 * change to this file and nothing else.
 */

import { useCallback, useEffect, useMemo, useRef, useState, useSyncExternalStore } from "react"

import { useAuth } from "@/store/auth"

import { BUZZ_RELAY_URL, getNostrAdapter, PUBLIC_RELAY_URL, RELAY_URL } from "./nostr"
import { policyDocumentUrls } from "./buzz"
import { shortNpub } from "./protocol"
import {
  clearStore,
  getChannelMessages,
  getLastMessage,
  getLastReadAt,
  getProfile,
  getStoreVersion,
  getThreads,
  ingestMessages,
  ingestProfiles,
  loadReadState,
  loadThreads,
  markChannelRead,
  markMessageFailed,
  putLocalMessage,
  rememberThread,
  subscribeToStore,
} from "./store"
import type {
  ChatAdapter,
  ChatChannel,
  ChatConnectionStatus,
  ChatIdentity,
  ChatMessage,
  ChatProfile,
  RelayCapabilities,
} from "./types"

export { BUZZ_RELAY_URL, policyDocumentUrls, PUBLIC_RELAY_URL, RELAY_URL, shortNpub }
export type {
  ChatChannel,
  ChatConnectionStatus,
  ChatMessage,
  ChatProfile,
  RelayCapabilities,
}

const EMPTY_MESSAGES: ChatMessage[] = []

/**
 * The active transport. Today there is exactly one: a Nostr client speaking the
 * protocol Buzz speaks. Adding a second means implementing `ChatAdapter` and
 * branching here on an env flag.
 */
function selectAdapter(userId: string): ChatAdapter {
  return getNostrAdapter(userId)
}

/* --------------------------------------------------------------- adapter */

export function useChatAdapter(): ChatAdapter | null {
  const { user } = useAuth()
  const userId = user?.id ?? null
  const previousUser = useRef<string | null>(null)

  useEffect(() => {
    if (previousUser.current && previousUser.current !== userId) clearStore()
    previousUser.current = userId
  }, [userId])

  return useMemo(() => (userId ? selectAdapter(userId) : null), [userId])
}

export function useChatStatus(): ChatConnectionStatus {
  const adapter = useChatAdapter()
  const [status, setStatus] = useState<ChatConnectionStatus>(() => adapter?.status() ?? "unavailable")

  useEffect(() => {
    // No adapter means no session, hence no key and no socket — say so rather
    // than reporting "offline", which would imply a connection is being retried.
    if (!adapter) {
      setStatus("unavailable")
      return
    }
    setStatus(adapter.status())
    return adapter.onStatus(setStatus)
  }, [adapter])

  return status
}

/** The user's Nostr identity. Also publishes their kind-0 profile once. */
export function useChatIdentity(): ChatIdentity | null {
  const adapter = useChatAdapter()
  const { profile } = useAuth()
  const [identity, setIdentity] = useState<ChatIdentity | null>(null)

  const name = profile?.full_name ?? null
  const avatarUrl = profile?.avatar_url ?? null

  useEffect(() => {
    if (!adapter) {
      setIdentity(null)
      return
    }
    let active = true
    adapter
      .identity()
      .then((next) => {
        if (!active) return
        setIdentity(next)
        adapter.announce({ name, avatarUrl })
      })
      .catch(() => {
        if (active) setIdentity(null)
      })
    return () => {
      active = false
    }
  }, [adapter, name, avatarUrl])

  return identity
}

/* ---------------------------------------------------------- store access */

/**
 * Subscribe to the chat store. Returns a version number rather than derived
 * data: `useSyncExternalStore` demands a snapshot that stays referentially
 * equal between changes, so callers pair this with `useMemo` and read whatever
 * shape they need.
 */
function useStoreVersion(): number {
  return useSyncExternalStore(subscribeToStore, getStoreVersion, getStoreVersion)
}

/* --------------------------------------------------------------- feeds */

/**
 * Opens one relay subscription covering `channels` and pipes it into the store.
 * Used both by the channel list (shallow backfill for previews) and by a single
 * conversation (deeper backfill). Tears the subscription down on unmount, and
 * reopens it whenever the channel set changes.
 */
function useMessageFeed(
  channels: ChatChannel[],
  limitPerChannel: number,
): { ready: boolean; error: string | null } {
  const adapter = useChatAdapter()
  const [ready, setReady] = useState(false)
  const [error, setError] = useState<string | null>(null)

  // Channel arrays are rebuilt every render; key the effect on their identity.
  const signature = channels.map((c) => `${c.kind}:${c.id}:${c.address}`).join("|")

  useEffect(() => {
    if (!adapter || !channels.length) {
      setReady(true)
      return
    }
    setReady(false)
    setError(null)

    const subscription = adapter.subscribeMessages(
      channels,
      {
        onMessages: ingestMessages,
        onReady: () => setReady(true),
        onError: (message) => {
          setError(message)
          setReady(true)
        },
      },
      limitPerChannel,
    )

    return () => subscription.close()
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [adapter, signature, limitPerChannel])

  return { ready, error }
}

/**
 * Resolve kind-0 metadata for message authors so the UI shows names, not hex.
 * Each pubkey is requested at most once per session.
 */
const requestedProfiles = new Set<string>()

function useAuthorProfiles(pubkeys: string[]) {
  const adapter = useChatAdapter()
  const signature = pubkeys.join(",")

  useEffect(() => {
    if (!adapter) return
    const wanted = pubkeys.filter((pk) => !requestedProfiles.has(pk))
    if (!wanted.length) return
    for (const pk of wanted) requestedProfiles.add(pk)

    const subscription = adapter.subscribeProfiles(wanted, ingestProfiles)
    return () => subscription.close()
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [adapter, signature])
}

export function useProfile(pubkey: string | null): ChatProfile | undefined {
  const version = useStoreVersion()
  return useMemo(
    () => (pubkey ? getProfile(pubkey) : undefined),
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [pubkey, version],
  )
}

/* ------------------------------------------------------------ channels */

export type ChannelSummary = {
  channel: ChatChannel
  lastMessage: ChatMessage | null
  unread: boolean
}

/**
 * The channel list: the built-in community rooms, plus any DM threads this user
 * has opened before. Subscribes shallowly so each row can show a preview.
 */
export function useChannels(): {
  summaries: ChannelSummary[]
  loading: boolean
  error: string | null
  status: ChatConnectionStatus
} {
  const adapter = useChatAdapter()
  const { user } = useAuth()
  const userId = user?.id ?? null
  const status = useChatStatus()
  const [threadsLoaded, setThreadsLoaded] = useState(false)

  useEffect(() => {
    if (!userId) return
    let active = true
    void Promise.all([loadThreads(userId), loadReadState()]).then(() => {
      if (active) setThreadsLoaded(true)
    })
    return () => {
      active = false
    }
  }, [userId])

  const version = useStoreVersion()
  // eslint-disable-next-line react-hooks/exhaustive-deps
  const dmThreads = useMemo(() => getThreads(), [version])

  // On a NIP-29 relay the rooms live server-side, so the list arrives via a
  // subscription rather than being known up front.
  const [rooms, setRooms] = useState<ChatChannel[]>([])
  const [roomsLoaded, setRoomsLoaded] = useState(false)

  useEffect(() => {
    if (!adapter) {
      setRooms([])
      setRoomsLoaded(false)
      return
    }
    setRoomsLoaded(false)
    const subscription = adapter.subscribeChannels((next) => {
      setRooms(next)
      setRoomsLoaded(true)
    })
    return () => subscription.close()
  }, [adapter])

  const channels = useMemo(() => [...rooms, ...dmThreads], [rooms, dmThreads])

  const { ready, error } = useMessageFeed(channels, 8)

  const summaries = useMemo(
    () =>
      channels.map((channel) => {
        const lastMessage = getLastMessage(channel.id)
        return {
          channel,
          lastMessage,
          unread:
            !!lastMessage && !lastMessage.mine && lastMessage.createdAt > getLastReadAt(channel.id),
        }
      }),
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [channels, version],
  )

  return {
    summaries,
    loading: !!adapter && (!ready || !threadsLoaded || !roomsLoaded),
    error,
    status,
  }
}

/* ---------------------------------------------------------- membership */

/**
 * Relay capabilities, so the UI can explain the *right* thing: a closed Buzz
 * community needs an invite, a public relay needs nothing.
 */
export function useRelayCapabilities(): RelayCapabilities | null {
  const adapter = useChatAdapter()
  const [caps, setCaps] = useState<RelayCapabilities | null>(null)

  useEffect(() => {
    if (!adapter) {
      setCaps(null)
      return
    }
    let active = true
    adapter
      .capabilities()
      .then((next) => {
        if (active) setCaps(next)
      })
      .catch(() => {
        if (active) setCaps(null)
      })
    return () => {
      active = false
    }
  }, [adapter])

  return caps
}

/**
 * Redeem an invite code for membership of a closed relay.
 *
 * `ageConfirmed` is passed through from an explicit checkbox — the relay
 * rejects the request when it's false and age attestation is required, so
 * defaulting it to true would be forging a consent step rather than
 * satisfying one.
 */
export function useJoinCommunity(): {
  join: (code: string, ageConfirmed: boolean) => Promise<boolean>
  joining: boolean
  error: string | null
  joined: boolean
  reset: () => void
} {
  const adapter = useChatAdapter()
  const [joining, setJoining] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const [joined, setJoined] = useState(false)

  const join = useCallback(
    async (code: string, ageConfirmed: boolean) => {
      if (!adapter) return false
      setJoining(true)
      setError(null)
      try {
        await adapter.joinWithInvite(code, ageConfirmed)
        setJoined(true)
        return true
      } catch (e: unknown) {
        setError(e instanceof Error ? e.message : "Could not join the community.")
        return false
      } finally {
        setJoining(false)
      }
    },
    [adapter],
  )

  const reset = useCallback(() => {
    setError(null)
    setJoined(false)
  }, [])

  return { join, joining, error, joined, reset }
}

/** Resolve a `/chat/[id]` route param into a channel. */
export function useChannel(routeId: string | undefined): {
  channel: ChatChannel | null
  loading: boolean
  error: Error | null
  reload: () => void
} {
  const adapter = useChatAdapter()
  const { user } = useAuth()
  const [channel, setChannel] = useState<ChatChannel | null>(null)
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState<Error | null>(null)
  const [nonce, setNonce] = useState(0)

  useEffect(() => {
    if (!adapter || !routeId) {
      setLoading(false)
      return
    }
    let active = true
    setLoading(true)
    setError(null)

    adapter
      .resolveChannel(routeId)
      .then((next) => {
        if (!active) return
        setChannel(next)
        setLoading(false)
        // Remember DM threads so they appear in the channel list next time.
        if (next && user?.id) rememberThread(user.id, next)
      })
      .catch((e: unknown) => {
        if (!active) return
        setError(e instanceof Error ? e : new Error("Could not open this conversation."))
        setLoading(false)
      })

    return () => {
      active = false
    }
  }, [adapter, routeId, user?.id, nonce])

  const reload = useCallback(() => setNonce((n) => n + 1), [])
  return { channel, loading, error, reload }
}

/* ------------------------------------------------------------ messages */

/**
 * Live messages for one channel. Backfills recent history through a NIP-01 REQ
 * with a `limit`, then streams. Because the relay holds the history, this is
 * what makes conversations survive an app restart.
 */
export function useMessages(channel: ChatChannel | null): {
  messages: ChatMessage[]
  loading: boolean
  error: string | null
} {
  const channels = useMemo(() => (channel ? [channel] : []), [channel])
  // 60 is a deep enough scrollback to feel continuous without making the
  // signature check on backfill noticeable.
  const { ready, error } = useMessageFeed(channels, 60)

  const version = useStoreVersion()
  const messages = useMemo(
    () => (channel ? getChannelMessages(channel.id) : EMPTY_MESSAGES),
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [channel, version],
  )

  // Ask for the display names of everyone who has spoken here.
  const authors = useMemo(() => {
    const seen = new Set<string>()
    for (const m of messages) if (!m.mine) seen.add(m.authorId)
    return [...seen]
  }, [messages])
  useAuthorProfiles(authors)

  // Opening a channel clears its unread badge.
  useEffect(() => {
    if (!channel || !messages.length) return
    markChannelRead(channel.id, messages[messages.length - 1].createdAt)
  }, [channel, messages])

  return { messages, loading: !ready && messages.length === 0, error }
}

/* ---------------------------------------------------------------- send */

export function useSendMessage(channel: ChatChannel | null): {
  send: (body: string) => Promise<boolean>
  sending: boolean
  error: string | null
} {
  const adapter = useChatAdapter()
  const [sending, setSending] = useState(false)
  const [error, setError] = useState<string | null>(null)

  const send = useCallback(
    async (body: string) => {
      const text = body.trim()
      if (!adapter || !channel || !text) return false

      setSending(true)
      setError(null)

      let optimisticId: string | null = null
      try {
        // The adapter signs before it publishes and hands us the event id, so
        // the bubble appears instantly; the relay's echo dedupes against it.
        const confirmed = await adapter.send(channel, text, (pending) => {
          optimisticId = pending.id
          putLocalMessage(pending)
        })
        putLocalMessage(confirmed)
        return true
      } catch (e: unknown) {
        // Keep the message on screen but flag it, rather than losing what the
        // user typed because the relay was down.
        if (optimisticId) markMessageFailed(channel.id, optimisticId)
        setError(e instanceof Error ? e.message : "Could not send that.")
        return false
      } finally {
        setSending(false)
      }
    },
    [adapter, channel],
  )

  return { send, sending, error }
}

export { markMessageFailed }
