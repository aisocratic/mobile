/**
 * The Nostr adapter, speaking whichever dialect the connected relay supports.
 *
 * ## Two relays, two dialects
 *
 * `buzz.xyz` is Block, Inc.'s open-source Slack alternative, built on Nostr.
 * There is no hosted Buzz API product, no npm SDK and no React Native SDK — a
 * Buzz community *is* a Nostr relay, so the integration is to be a real Nostr
 * client. But a Buzz relay is a **closed** relay speaking a different subset of
 * NIPs than a public one:
 *
 *                    Buzz community          plain public relay
 *   rooms            NIP-29 (kind 9 + `h`)   NIP-28 (kind 42 + `e`)
 *   direct messages  NIP-17 gift wraps       NIP-04
 *   access           NIP-42 AUTH + members   open
 *
 * Rather than hardcode either, the adapter reads the relay's NIP-11 document
 * and picks. That keeps the public-relay path — the only configuration provable
 * end to end without an invite code — working unchanged.
 *
 * ## Rooms are discovered, not invented
 *
 * On NIP-29 the rooms already exist server-side and are addressed by a
 * relay-assigned id (Buzz declares `h_grammar: "uuid-v4-lowercase"`). The app
 * subscribes to kind-39000 metadata to learn them. The deterministic NIP-28
 * room ids this app used to compute are meaningless on a Buzz relay, so they
 * are now used only on public relays.
 */

import AsyncStorage from "@react-native-async-storage/async-storage"
import * as SecureStore from "expo-secure-store"

import { supabase } from "@/lib/supabase"

import { joinCommunity } from "./buzz"
import { buildRumor, rumorPeer, unwrapGift, wrapForBoth } from "./nip17"
import {
  bytesToHex,
  channelAddress,
  channelCreateEvent,
  deriveSecretKey,
  eventId,
  finalizeEvent,
  firstTag,
  getPublicKey,
  hexToBytes,
  KIND_CHANNEL_MESSAGE,
  KIND_DM,
  KIND_GIFT_WRAP,
  KIND_GROUP_CHAT,
  KIND_GROUP_METADATA,
  KIND_METADATA,
  NAMESPACE_SECRET_KEY,
  nip04Decrypt,
  nip04Encrypt,
  npubEncode,
  type NostrEvent,
  type NostrFilter,
  verifyEvent,
} from "./protocol"
import { RelayClient } from "./relay"
import type {
  ChatAdapter,
  ChatChannel,
  ChatConnectionStatus,
  ChatIdentity,
  ChatJoinResult,
  ChatMessage,
  ChatProfile,
  ChatSubscription,
  RelayCapabilities,
} from "./types"

/**
 * The AI Socratic Buzz community.
 *
 * Verified live: NIP-11 reports `software: github.com/block/buzz`, version
 * 0.2.0, `supported_nips` including 17, 29 and 42, and
 * `limitation.auth_required` / `restricted_writes` both true.
 */
export const BUZZ_RELAY_URL = "wss://aisocratic.communities.buzz.xyz"

/**
 * A public relay verified end to end (publish, then cold-read from a second
 * connection). Kept as the documented fallback because it is the only
 * configuration provable without an invite code.
 */
export const PUBLIC_RELAY_URL = "wss://relay.primal.net"

export const RELAY_URL = process.env.EXPO_PUBLIC_NOSTR_RELAY?.trim() || BUZZ_RELAY_URL

/**
 * Deliberately NOT reading an invite code from the environment.
 *
 * `EXPO_PUBLIC_*` values are inlined into the JS bundle and trivially
 * extractable from a shipped app, and Buzz invites can be minted with unlimited
 * uses. Shipping one would turn a relay that describes itself as "private team
 * communication" into a community anybody who downloads the app can join. The
 * code is pasted by the user at runtime. If you are tempted to add
 * `EXPO_PUBLIC_BUZZ_INVITE`, don't.
 */

/* ---------------------------------------------------------- capabilities */

const capsCacheKey = (relayUrl: string) => `aisocratic.chat.caps.v1.${relayUrl}`
const roomsAnnouncedKey = (relayUrl: string) => `aisocratic.chat.rooms.v1.${relayUrl}`

function httpOrigin(relayUrl: string): string {
  const t = relayUrl.trim()
  if (t.startsWith("wss://")) return `https://${t.slice(6)}`
  if (t.startsWith("ws://")) return `http://${t.slice(5)}`
  return t
}

/** Conservative defaults for a relay whose NIP-11 we couldn't read. */
function defaultCapabilities(): RelayCapabilities {
  return {
    groups: "nip28",
    dms: "nip04",
    authRequired: false,
    maxFilters: 10,
    maxLimit: 500,
    maxContentLength: 65536,
    maxTagValuesPerFilter: 50,
    supportsInvites: false,
    relayName: null,
  }
}

type Nip11 = {
  name?: string
  supported_nips?: number[]
  limitation?: {
    auth_required?: boolean
    restricted_writes?: boolean
    max_filters?: number
    max_limit?: number
    max_message_length?: number
  }
  push?: { limitation?: { max_h?: number; max_content_len?: number } }
}

function capabilitiesFromNip11(doc: Nip11): RelayCapabilities {
  const nips = new Set(doc.supported_nips ?? [])
  const limitation = doc.limitation ?? {}
  const push = doc.push?.limitation ?? {}

  return {
    // Prefer the richer dialect whenever the relay offers it.
    groups: nips.has(29) ? "nip29" : "nip28",
    dms: nips.has(17) ? "nip17" : "nip04",
    authRequired: limitation.auth_required === true,
    maxFilters: limitation.max_filters ?? 10,
    maxLimit: limitation.max_limit ?? 500,
    // Buzz reports the useful per-message ceiling under `push.limitation`;
    // `max_message_length` is the whole-frame budget and is much larger.
    maxContentLength: push.max_content_len ?? limitation.max_message_length ?? 65536,
    maxTagValuesPerFilter: push.max_h ?? 50,
    // Only a closed relay has anything to invite you to.
    supportsInvites: limitation.auth_required === true || limitation.restricted_writes === true,
    relayName: doc.name ?? null,
  }
}

async function loadCapabilities(relayUrl: string): Promise<RelayCapabilities> {
  try {
    const response = await fetch(httpOrigin(relayUrl), {
      headers: { accept: "application/nostr+json" },
    })
    if (response.ok) {
      const caps = capabilitiesFromNip11((await response.json()) as Nip11)
      void AsyncStorage.setItem(capsCacheKey(relayUrl), JSON.stringify(caps)).catch(() => {})
      return caps
    }
  } catch {
    /* offline or blocked; fall through to the cache */
  }

  // A cached document beats guessing: guessing "public relay" against a Buzz
  // host would send kind-42 events Buzz will never serve back.
  try {
    const cached = await AsyncStorage.getItem(capsCacheKey(relayUrl))
    if (cached) return JSON.parse(cached) as RelayCapabilities
  } catch {
    /* ignore */
  }
  return defaultCapabilities()
}

/* ------------------------------------------------- public-relay fallback */

type BuiltinChannel = { slug: string; name: string; about: string; icon: string }

/**
 * Code-defined rooms, used only on public relays.
 *
 * These are NOT used as a NIP-29 fallback: a NIP-28 room id is a 32-byte event
 * hash, and Buzz requires `h` to be a lowercase UUID v4, so messages tagged
 * with one would be rejected. Showing rooms that cannot receive messages would
 * be worse than showing none.
 */
const BUILTIN: BuiltinChannel[] = [
  {
    slug: "general",
    name: "general",
    about: "Everything AI Socratic — say hello, ask anything.",
    icon: "chatbubbles-outline",
  },
  {
    slug: "events",
    name: "events",
    about: "Meetups, talks and who's going to what.",
    icon: "calendar-outline",
  },
  {
    slug: "introductions",
    name: "introductions",
    about: "New here? Introduce yourself.",
    icon: "hand-left-outline",
  },
  {
    slug: "projects",
    name: "projects",
    about: "What you're building, and what you need help with.",
    icon: "construct-outline",
  },
]

const BUILTIN_CHANNELS: ChatChannel[] = BUILTIN.map((c) => ({
  id: c.slug,
  kind: "public",
  name: `#${c.name}`,
  topic: c.about,
  icon: c.icon,
  avatarUrl: null,
  address: channelAddress(c.slug, c.name, c.about),
}))

/* ------------------------------------------------------------- identity */

/**
 * Chat keys are derived from the signed-in user's auth uuid rather than random,
 * because there is nowhere to publish a key directory: the app reads Supabase
 * but cannot write a `nostr_pubkey` column, so the only way one member can
 * address another is if both sides compute the same public key from an id they
 * already share.
 *
 * Stated plainly: this derivation lives in the client bundle, so it is not a
 * secrecy boundary against someone holding this source. NIP-17 gift wrapping
 * still buys a great deal against the *relay* — it sees neither sender nor
 * content, only that someone messaged a pubkey — but a determined reader of
 * this repo could derive a member's key. The fix is random keys plus a
 * published directory; the key is already stored per-user below so that
 * migration needs no data-model change.
 */
const KEY_DERIVATION_PREFIX = "aisocratic:nostr:v1:"

const secretKeyStorageKey = (userId: string) => `aisocratic.chat.sk.${userId}`

export function pubkeyForPerson(personId: string): string {
  return getPublicKey(deriveSecretKey(KEY_DERIVATION_PREFIX + personId))
}

async function loadSecretKey(userId: string): Promise<Uint8Array> {
  try {
    const stored = await SecureStore.getItemAsync(secretKeyStorageKey(userId))
    if (stored && stored.length === 64) return hexToBytes(stored)
  } catch {
    /* a locked keychain must not break chat; the derivation is the same */
  }

  const sk = deriveSecretKey(KEY_DERIVATION_PREFIX + userId)
  try {
    await SecureStore.setItemAsync(secretKeyStorageKey(userId), bytesToHex(sk))
  } catch {
    /* best effort */
  }
  return sk
}

/* -------------------------------------------------------- NIP-29 helpers */

/**
 * Build a channel from a kind-39000 group metadata event.
 *
 * NIP-29 puts the group id in the `d` tag; name/about/picture are optional
 * single-value tags. The relay is authoritative for all of it.
 */
function groupFromMetadata(event: NostrEvent): ChatChannel | null {
  if (event.kind !== KIND_GROUP_METADATA) return null
  const groupId = firstTag(event, "d")
  if (!groupId) return null

  const name = firstTag(event, "name") ?? groupId
  return {
    // Route by group id so a deep link survives a rename.
    id: groupId,
    kind: "public",
    name: name.startsWith("#") ? name : `#${name}`,
    topic: firstTag(event, "about") ?? null,
    icon: "chatbubbles-outline",
    avatarUrl: firstTag(event, "picture") ?? null,
    address: groupId,
  }
}

/* -------------------------------------------------------------- adapter */

type EventUserRow = {
  id: string
  name: string | null
  email: string | null
  avatar_url: string | null
  company: string | null
  title: string | null
  user_id: string | null
}

class NostrChatAdapter implements ChatAdapter {
  readonly id = "nostr"
  readonly relayUrl = RELAY_URL

  private relay = new RelayClient(RELAY_URL)
  private userId: string
  private skPromise: Promise<Uint8Array> | null = null
  private capsPromise: Promise<RelayCapabilities> | null = null
  private announcedRooms = false
  private announcedProfile: string | null = null
  /** address -> channel, so a message can be routed back to its room. */
  private knownChannels = new Map<string, ChatChannel>()

  constructor(userId: string) {
    this.userId = userId
    // Closed relays (Buzz) challenge on connect; open ones never do.
    this.relay.setAuthSigner(async () => {
      try {
        return await this.secretKey()
      } catch {
        return null
      }
    })
    this.relay.connect()
  }

  /** Cached so the SecureStore round trip happens once per session. */
  private secretKey(): Promise<Uint8Array> {
    if (!this.skPromise) this.skPromise = loadSecretKey(this.userId)
    return this.skPromise
  }

  capabilities(): Promise<RelayCapabilities> {
    if (!this.capsPromise) this.capsPromise = loadCapabilities(this.relayUrl)
    return this.capsPromise
  }

  async identity(): Promise<ChatIdentity> {
    const sk = await this.secretKey()
    const pubkey = getPublicKey(sk)
    return { pubkey, npub: npubEncode(pubkey) }
  }

  status(): ChatConnectionStatus {
    return this.relay.status()
  }

  onStatus(listener: (status: ChatConnectionStatus) => void): () => void {
    return this.relay.onStatus(listener)
  }

  destroy() {
    this.relay.destroy()
  }

  /* ----------------------------------------------------------- joining */

  async joinWithInvite(code: string, ageConfirmed: boolean): Promise<ChatJoinResult> {
    const sk = await this.secretKey()
    const result = await joinCommunity(this.relayUrl, sk, code, ageConfirmed)
    // The key the relay just refused is now a member — reconnect immediately
    // rather than leaving the user on "not a member" until the backoff expires.
    this.relay.reconnectNow()
    return { status: result.status }
  }

  /* ---------------------------------------------------------- channels */

  subscribeChannels(onChannels: (channels: ChatChannel[]) => void): ChatSubscription {
    let closed = false
    let inner: ChatSubscription | null = null

    void this.capabilities()
      .then((caps) => {
        if (closed) return

        if (caps.groups === "nip28") {
          // Public relay: rooms are defined in code and never change.
          this.ensureRoomsAnnounced()
          for (const c of BUILTIN_CHANNELS) this.knownChannels.set(c.address, c)
          onChannels(BUILTIN_CHANNELS)
          return
        }

        // NIP-29: the relay owns the room list, so discover it.
        const discovered = new Map<string, ChatChannel>()
        const emit = () => {
          if (closed) return
          const list = [...discovered.values()].sort((a, b) => a.name.localeCompare(b.name))
          for (const c of list) this.knownChannels.set(c.address, c)
          onChannels(list)
        }

        inner = this.relay.subscribe(
          [{ kinds: [KIND_GROUP_METADATA], limit: Math.min(200, caps.maxLimit) }],
          {
            onEvent: (event) => {
              const channel = groupFromMetadata(event)
              if (!channel) return
              discovered.set(channel.id, channel)
              emit()
            },
            // Emit even when empty, so the UI can tell "no rooms here" apart
            // from "still loading".
            onEose: emit,
          },
        )
      })
      .catch(() => {
        if (!closed) onChannels([])
      })

    return {
      close: () => {
        closed = true
        inner?.close()
      },
    }
  }

  /**
   * Publish the NIP-28 room-create events. Public-relay path only — on a
   * NIP-29 relay rooms are created server-side by admins.
   */
  private ensureRoomsAnnounced() {
    if (this.announcedRooms) return
    this.announcedRooms = true

    void AsyncStorage.getItem(roomsAnnouncedKey(this.relayUrl))
      .then((done) => {
        if (done) return
        BUILTIN.forEach((c, index) => {
          const draft = channelCreateEvent(c.slug, c.name, c.about)
          const signed = finalizeEvent(
            {
              created_at: draft.created_at,
              kind: draft.kind,
              tags: draft.tags,
              content: draft.content,
            },
            NAMESPACE_SECRET_KEY,
          )
          if (signed.id !== eventId(draft)) return
          // Spaced out: relays rate-limit bursts.
          setTimeout(() => this.relay.publishQuietly(signed), 2000 + index * 1500)
        })
        void AsyncStorage.setItem(roomsAnnouncedKey(this.relayUrl), "1").catch(() => {})
      })
      .catch(() => {})
  }

  announce(profile: { name: string | null; avatarUrl: string | null }) {
    // The chat tab mounts this on every visit; only publish on a real change.
    const fingerprint = `${profile.name ?? ""}|${profile.avatarUrl ?? ""}`
    if (this.announcedProfile === fingerprint) return
    this.announcedProfile = fingerprint

    void this.secretKey()
      .then((sk) => {
        const event = finalizeEvent(
          {
            created_at: Math.floor(Date.now() / 1000),
            kind: KIND_METADATA,
            tags: [],
            content: JSON.stringify({
              name: profile.name ?? "",
              display_name: profile.name ?? "",
              picture: profile.avatarUrl ?? "",
            }),
          },
          sk,
        )
        this.relay.publishQuietly(event)
      })
      .catch(() => {
        /* metadata is cosmetic */
      })
  }

  /* -------------------------------------------------------- resolution */

  async resolveChannel(routeId: string): Promise<ChatChannel | null> {
    // Discovered NIP-29 groups win: they are the live, relay-owned truth.
    const known = [...this.knownChannels.values()].find((c) => c.id === routeId)
    if (known) return known

    const caps = await this.capabilities()
    if (caps.groups === "nip28") {
      const builtin = BUILTIN_CHANNELS.find((c) => c.id === routeId)
      if (builtin) return builtin
    }

    // Otherwise it's a person: the Connections feature routes here with an
    // `event_users.id`. Prefer their claimed account id so the derived key
    // matches the one they use when signed in.
    const { data, error } = await supabase
      .from("event_users")
      .select("id,name,email,avatar_url,company,title,user_id")
      .eq("id", routeId)
      .maybeSingle()

    if (error) throw new Error(error.message)

    const row = (data as EventUserRow | null) ?? null
    if (row) {
      const identityId = row.user_id ?? row.id
      return {
        id: routeId,
        kind: "dm",
        name: row.name?.trim() || row.email?.split("@")[0] || "Member",
        topic: [row.title, row.company].filter(Boolean).join(" · ") || null,
        icon: null,
        avatarUrl: row.avatar_url,
        address: pubkeyForPerson(identityId),
      }
    }

    const { data: userRow } = await supabase
      .from("users")
      .select("id,full_name,email,avatar_url,job_title,organization")
      .eq("id", routeId)
      .maybeSingle()

    if (!userRow) return null
    const u = userRow as {
      id: string
      full_name: string | null
      email: string | null
      avatar_url: string | null
      job_title: string | null
      organization: string | null
    }
    return {
      id: routeId,
      kind: "dm",
      name: u.full_name?.trim() || u.email?.split("@")[0] || "Member",
      topic: [u.job_title, u.organization].filter(Boolean).join(" · ") || null,
      icon: null,
      avatarUrl: u.avatar_url,
      address: pubkeyForPerson(u.id),
    }
  }

  /* ------------------------------------------------------ subscriptions */

  subscribeMessages(
    channels: ChatChannel[],
    handlers: {
      onMessages: (messages: ChatMessage[]) => void
      onReady?: () => void
      onError?: (message: string) => void
    },
    limitPerChannel = 50,
  ): ChatSubscription {
    let closed = false
    let inner: ChatSubscription | null = null

    void Promise.all([this.secretKey(), this.capabilities()])
      .then(([sk, caps]) => {
        if (closed) return
        const me = getPublicKey(sk)

        const publicChannels = channels.filter((c) => c.kind === "public")
        const dmChannels = channels.filter((c) => c.kind === "dm")
        const roomByAddress = new Map(publicChannels.map((c) => [c.address, c.id]))
        const dmByPeer = new Map(dmChannels.map((c) => [c.address, c.id]))

        const limit = Math.min(limitPerChannel, caps.maxLimit)
        const filters: NostrFilter[] = []

        if (publicChannels.length) {
          const isGroups = caps.groups === "nip29"
          const kind = isGroups ? KIND_GROUP_CHAT : KIND_CHANNEL_MESSAGE
          const addresses = publicChannels.map((c) => c.address)

          // One filter per room gives each its own `limit`, but the relay caps
          // total filters (Buzz: 10). Past that, batch rooms into filters of
          // at most `maxTagValuesPerFilter` values that share a limit.
          // Built field-by-field rather than with a computed key, so the tag
          // stays typed as NostrFilter's `#…` index signature.
          const roomFilter = (values: string[], roomLimit: number): NostrFilter => {
            const filter: NostrFilter = { kinds: [kind], limit: roomLimit }
            if (isGroups) filter["#h"] = values
            else filter["#e"] = values
            return filter
          }

          const budget = Math.max(1, caps.maxFilters - 2)
          if (addresses.length <= budget) {
            for (const address of addresses) filters.push(roomFilter([address], limit))
          } else {
            for (let i = 0; i < addresses.length; i += caps.maxTagValuesPerFilter) {
              const batch = addresses.slice(i, i + caps.maxTagValuesPerFilter)
              filters.push(roomFilter(batch, Math.min(limit * batch.length, caps.maxLimit)))
            }
          }
        }

        if (caps.dms === "nip17") {
          // Gift wraps are addressed only to us and name no sender in the
          // clear, so a single filter covers every conversation at once.
          filters.push({
            kinds: [KIND_GIFT_WRAP],
            "#p": [me],
            limit: Math.min(Math.max(limit, 100), caps.maxLimit),
          })
        } else if (dmChannels.length) {
          const peers = dmChannels.map((c) => c.address)
          const dmLimit = Math.min(limit * peers.length, caps.maxLimit)
          filters.push({ kinds: [KIND_DM], authors: [me], "#p": peers, limit: dmLimit })
          filters.push({ kinds: [KIND_DM], authors: peers, "#p": [me], limit: dmLimit })
        }

        if (!filters.length) {
          handlers.onReady?.()
          return
        }

        // Never exceed the relay's declared filter ceiling.
        const capped = filters.slice(0, caps.maxFilters)

        // Relays stream history one event at a time; batching into a timer
        // keeps React from re-rendering once per event during backfill.
        let batch: ChatMessage[] = []
        let flushing = false
        const flush = () => {
          flushing = false
          if (!batch.length || closed) return
          const out = batch
          batch = []
          handlers.onMessages(out)
        }
        const push = (m: ChatMessage) => {
          batch.push(m)
          if (flushing) return
          flushing = true
          setTimeout(flush, 30)
        }

        inner = this.relay.subscribe(capped, {
          onEvent: (event) => {
            const message = this.toMessage(event, sk, me, caps, roomByAddress, dmByPeer)
            if (message) push(message)
          },
          onEose: () => {
            flush()
            handlers.onReady?.()
          },
          onError: handlers.onError,
        })
      })
      .catch((e: unknown) => {
        handlers.onError?.(e instanceof Error ? e.message : "Could not open chat.")
      })

    return {
      close: () => {
        closed = true
        inner?.close()
      },
    }
  }

  /**
   * Convert a relay event into a UI message, or null if it isn't ours to show.
   *
   * Every signed event is signature-checked: relays are untrusted, and without
   * this a relay could put words in another member's mouth. Gift wraps are
   * verified inside `unwrapGift`, which additionally enforces that the rumor's
   * claimed author is the key that signed the seal.
   */
  private toMessage(
    event: NostrEvent,
    sk: Uint8Array,
    me: string,
    caps: RelayCapabilities,
    roomByAddress: Map<string, string>,
    dmByPeer: Map<string, string>,
  ): ChatMessage | null {
    if (!verifyEvent(event)) return null

    // NIP-29 group message.
    if (event.kind === KIND_GROUP_CHAT) {
      const group = firstTag(event, "h")
      if (!group) return null
      const channelId = roomByAddress.get(group) ?? this.knownChannels.get(group)?.id
      if (!channelId) return null
      return {
        id: event.id,
        channelId,
        authorId: event.pubkey,
        body: event.content,
        createdAt: event.created_at,
        mine: event.pubkey === me,
      }
    }

    // NIP-17 gift-wrapped DM.
    if (event.kind === KIND_GIFT_WRAP) {
      const rumor = unwrapGift(event, sk)
      if (!rumor) return null
      const peer = rumorPeer(rumor, me)
      const channelId = peer ? dmByPeer.get(peer) : undefined
      if (!channelId) return null
      return {
        id: rumor.id,
        channelId,
        authorId: rumor.pubkey,
        body: rumor.content,
        // The rumor's timestamp is the real one; the wrap's is deliberately
        // randomised into the past and must never be used for ordering.
        createdAt: rumor.created_at,
        mine: rumor.pubkey === me,
      }
    }

    // NIP-28 public-relay room message.
    if (event.kind === KIND_CHANNEL_MESSAGE) {
      const root =
        event.tags.find((t) => t[0] === "e" && t[3] === "root")?.[1] ?? firstTag(event, "e")
      const channelId = root ? roomByAddress.get(root) : undefined
      if (!channelId) return null
      return {
        id: event.id,
        channelId,
        authorId: event.pubkey,
        body: event.content,
        createdAt: event.created_at,
        mine: event.pubkey === me,
      }
    }

    // NIP-04 public-relay DM.
    if (event.kind === KIND_DM && caps.dms === "nip04") {
      const mine = event.pubkey === me
      const peer = mine ? firstTag(event, "p") : event.pubkey
      const channelId = peer ? dmByPeer.get(peer) : undefined
      if (!channelId || !peer) return null
      try {
        return {
          id: event.id,
          channelId,
          authorId: event.pubkey,
          body: nip04Decrypt(sk, peer, event.content),
          createdAt: event.created_at,
          mine,
        }
      } catch {
        return null
      }
    }

    return null
  }

  subscribeProfiles(pubkeys: string[], onProfiles: (p: ChatProfile[]) => void): ChatSubscription {
    if (!pubkeys.length) return { close: () => {} }

    return this.relay.subscribe([{ kinds: [KIND_METADATA], authors: pubkeys }], {
      onEvent: (event) => {
        try {
          const meta = JSON.parse(event.content) as {
            name?: string
            display_name?: string
            picture?: string
          }
          onProfiles([
            {
              pubkey: event.pubkey,
              name: meta.display_name?.trim() || meta.name?.trim() || null,
              avatarUrl: meta.picture?.trim() || null,
            },
          ])
        } catch {
          /* malformed kind-0 content is common in the wild */
        }
      },
    })
  }

  /* ---------------------------------------------------------- publish */

  async send(
    channel: ChatChannel,
    body: string,
    onPending?: (message: ChatMessage) => void,
  ): Promise<ChatMessage> {
    const text = body.trim()
    if (!text) throw new Error("Nothing to send.")

    const [sk, caps] = await Promise.all([this.secretKey(), this.capabilities()])
    if (text.length > caps.maxContentLength) {
      throw new Error(`Message is too long (limit ${caps.maxContentLength} characters).`)
    }

    const me = getPublicKey(sk)
    const createdAt = Math.floor(Date.now() / 1000)

    /* --- NIP-17 private DM: one rumor, wrapped once per side --- */
    if (channel.kind === "dm" && caps.dms === "nip17") {
      const rumor = buildRumor(me, channel.address, text)
      const message: ChatMessage = {
        id: rumor.id,
        channelId: channel.id,
        authorId: me,
        body: text,
        createdAt: rumor.created_at,
        mine: true,
      }
      onPending?.({ ...message, pending: true })

      const wraps = wrapForBoth(rumor, sk, channel.address)
      // The copy addressed to them is the one that must land; our own copy
      // only exists so we can read the thread back later.
      await this.relay.publish(wraps[0])
      for (const extra of wraps.slice(1)) this.relay.publishQuietly(extra)
      return message
    }

    const event =
      channel.kind === "public"
        ? caps.groups === "nip29"
          ? finalizeEvent(
              {
                created_at: createdAt,
                kind: KIND_GROUP_CHAT,
                // NIP-29 addresses a room with a single `h` tag.
                tags: [["h", channel.address]],
                content: text,
              },
              sk,
            )
          : finalizeEvent(
              {
                created_at: createdAt,
                kind: KIND_CHANNEL_MESSAGE,
                // NIP-28: root e-tag points at the kind-40 channel event.
                tags: [["e", channel.address, this.relayUrl, "root"]],
                content: text,
              },
              sk,
            )
        : finalizeEvent(
            {
              created_at: createdAt,
              kind: KIND_DM,
              tags: [["p", channel.address]],
              content: nip04Encrypt(sk, channel.address, text),
            },
            sk,
          )

    // The id is known before publishing, so the optimistic row we render now
    // has the same identity as the copy the relay will echo back.
    const message: ChatMessage = {
      id: event.id,
      channelId: channel.id,
      authorId: me,
      body: text,
      createdAt,
      mine: true,
    }

    onPending?.({ ...message, pending: true })
    await this.relay.publish(event)
    return message
  }
}

/* --------------------------------------------------------- lifecycle */

let cached: { userId: string; adapter: NostrChatAdapter } | null = null

/**
 * One adapter (and therefore one relay socket) per signed-in user, reused
 * across screens. Switching accounts tears the old one down.
 */
export function getNostrAdapter(userId: string): ChatAdapter {
  if (cached && cached.userId === userId) return cached.adapter
  cached?.adapter.destroy()
  cached = { userId, adapter: new NostrChatAdapter(userId) }
  return cached.adapter
}
