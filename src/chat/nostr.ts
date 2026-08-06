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

import { api } from "@/lib/api"

import { loadOrCreateAccount, type ChatAccount } from "./account"
import {
  autoJoinConfigured,
  fetchJoinPolicy,
  joinCommunity,
  joinCommunityAutomatically,
  mintInvite,
  BuzzApiError,
} from "./buzz"
import { forgetPeer, lookupPubkey, registerChatIdentity } from "./directory"
import { discoveredDmChannel, isHexPubkey } from "./dm-discovery"
import { estimateClockSkew, publishWrappedDm } from "./dm-send"
import { buildRumor, rumorPeer, unwrapGift } from "./nip17"
import {
  channelAddress,
  channelCreateEvent,
  eventId,
  finalizeEvent,
  firstTag,
  getPublicKey,
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
  ChatInvite,
  ChatInviteOptions,
  ChatJoinPolicy,
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
 * Chat accounts are real: a random secp256k1 keypair generated on the device,
 * with the secret half in the Keychain (see ./account) and the public half
 * published to `public.chat_identities` (see ./directory).
 *
 * They used to be derived from the signed-in user's auth uuid by a constant in
 * this bundle, because without a directory that was the only way two devices
 * could agree on a key — and it meant anyone who read this source could
 * compute any member's secret key. The directory removed that constraint, so
 * the derivation survives only as a fallback for members the directory does
 * not know about yet, applied inside `lookupPubkey`.
 */

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
  private accountPromise: Promise<ChatAccount> | null = null
  private registration: Promise<boolean> | null = null
  private capsPromise: Promise<RelayCapabilities> | null = null
  private policyPromise: Promise<ChatJoinPolicy | null> | null = null
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

  /**
   * The account, created on first use. Cached so the Keychain round trip and
   * the directory write happen once per session rather than once per caller.
   */
  private account(): Promise<ChatAccount> {
    if (!this.accountPromise) {
      this.accountPromise = loadOrCreateAccount(this.userId).then((account) => {
        // Publishing the public key is what makes this account reachable, so
        // it starts as soon as the key exists rather than waiting for someone
        // to open a conversation. It is fire-and-forget: a directory that is
        // briefly unreachable must not stop the user from reading messages.
        this.registration = registerChatIdentity({
          userId: this.userId,
          pubkey: account.pubkey,
          relayUrl: this.relayUrl,
        })
          .then(() => true)
          .catch(() => false)
        return account
      })
    }
    return this.accountPromise
  }

  private async secretKey(): Promise<Uint8Array> {
    return (await this.account()).sk
  }

  capabilities(): Promise<RelayCapabilities> {
    if (!this.capsPromise) this.capsPromise = loadCapabilities(this.relayUrl)
    return this.capsPromise
  }

  async identity(): Promise<ChatIdentity> {
    const account = await this.account()
    return {
      pubkey: account.pubkey,
      npub: npubEncode(account.pubkey),
      source: account.source,
      registered: (await this.registration) ?? false,
    }
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

  readonly canAutoJoin = autoJoinConfigured()

  /** Cached: the policy changes at the community's pace, not the app's. */
  joinPolicy(): Promise<ChatJoinPolicy | null> {
    if (!this.policyPromise) {
      this.policyPromise = fetchJoinPolicy(this.relayUrl).catch(() => null)
    }
    return this.policyPromise
  }

  async joinWithInvite(code: string, ageConfirmed: boolean): Promise<ChatJoinResult> {
    const sk = await this.secretKey()
    const result = await joinCommunity(this.relayUrl, sk, code, ageConfirmed)
    await this.afterJoin(result)
    return { status: result.status }
  }

  /**
   * Join without the user handling a code at all: our server mints a
   * single-use invite for this session, and this key redeems it immediately.
   *
   * The owner key that does the minting is not in this bundle and never
   * reaches the device — see `./buzz`. What arrives here is a code that is
   * spent on the next line and worthless five minutes later.
   */
  async autoJoin(ageConfirmed: boolean): Promise<ChatJoinResult> {
    if (!this.canAutoJoin) throw new BuzzApiError("auto_join_unavailable", 501)

    const { data } = await api.auth.getSession()
    const accessToken = data.session?.access_token
    if (!accessToken) throw new BuzzApiError("invalid_session", 401)

    const account = await this.account()
    const result = await joinCommunityAutomatically(
      this.relayUrl,
      account.sk,
      accessToken,
      account.pubkey,
      ageConfirmed,
    )
    await this.afterJoin(result)
    return { status: result.status }
  }

  /**
   * Shared tail of both join paths: record the membership, then reconnect.
   *
   * The reconnect is the point — the key the relay refused a moment ago is now
   * a member, and without it the user sits on "not a member" until the backoff
   * expires. Recording the membership is best-effort: it is a convenience for
   * the next launch, and failing to write it must not undo a real join.
   */
  private async afterJoin(result: { communityId: string | null; role: string | null }) {
    try {
      // An upsert rather than an update: the registration kicked off in
      // `account()` is fire-and-forget, so it may have failed or still be in
      // flight. Updating would then match zero rows and lose the membership
      // silently — and leave the user unregistered, which is worse, because
      // nobody could address them.
      const account = await this.account()
      await registerChatIdentity({
        userId: this.userId,
        pubkey: account.pubkey,
        relayUrl: this.relayUrl,
        membership: { communityId: result.communityId, role: result.role },
      })
    } catch {
      /* the relay is the authority on membership; this row is a cache */
    }
    // The key the relay refused a moment ago is now a member, so reconnect
    // instead of leaving the user on "not a member" until the backoff expires.
    this.relay.reconnectNow()
  }

  async createInvite(options: ChatInviteOptions): Promise<ChatInvite> {
    // A public relay has no invite API; minting against it would 404 with an
    // HTML body. Say what's actually true instead.
    const caps = await this.capabilities()
    if (!caps.supportsInvites) {
      const host = this.relayUrl.replace(/^wss?:\/\//, "")
      throw new Error(
        `${host} is an open relay — anyone can join it, so there is nothing to invite them to.`,
      )
    }
    return mintInvite(this.relayUrl, await this.secretKey(), options)
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

    // A thread discovered from an incoming gift wrap routes by the sender's
    // pubkey itself — there may be no users row behind it to look up, and
    // querying PostgREST's uuid columns with 64 hex chars would only error.
    if (isHexPubkey(routeId)) return discoveredDmChannel(routeId)

    const caps = await this.capabilities()
    if (caps.groups === "nip28") {
      const builtin = BUILTIN_CHANNELS.find((c) => c.id === routeId)
      if (builtin) return builtin
    }

    // Otherwise it's a person: the Connections feature routes here with an
    // `event_users.id`. Prefer their claimed account id, since that is the id
    // their chat account is registered under.
    const { data, error } = await api
      .from("event_users")
      .select("id,name,email,avatar_url,company,title,user_id")
      .eq("id", routeId)
      .maybeSingle()

    if (error) throw new Error(error.message)

    const row = (data as EventUserRow | null) ?? null
    if (row) {
      const identityId = row.user_id ?? row.id
      // Opening a conversation is rare and addressing it at a stale key is
      // fatal (the relay accepts wraps to any key, so nothing ever bounces).
      // Drop the session cache and ask the directory again every time.
      forgetPeer(identityId)
      return {
        id: routeId,
        kind: "dm",
        name: row.name?.trim() || row.email?.split("@")[0] || "Member",
        topic: [row.title, row.company].filter(Boolean).join(" · ") || null,
        icon: null,
        avatarUrl: row.avatar_url,
        // The directory is authoritative; it falls back to the legacy derived
        // key for anyone who has not registered one. An event guest with no
        // account (`user_id` null) never registers, so they stay derived.
        address: await lookupPubkey(identityId),
      }
    }

    const { data: userRow } = await api
      .from("users")
      .select("id,full_name,email,avatar_url,job_title,organization")
      .eq("id", routeId)
      .maybeSingle()

    if (!userRow) return null
    forgetPeer(routeId)
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
      address: await lookupPubkey(u.id),
    }
  }

  /* ------------------------------------------------------ subscriptions */

  subscribeMessages(
    channels: ChatChannel[],
    handlers: {
      onMessages: (messages: ChatMessage[]) => void
      onReady?: () => void
      onError?: (message: string) => void
      onDiscovered?: (channel: ChatChannel) => void
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

        // Peers whose first message arrived before any thread existed for
        // them, announced at most once per subscription.
        const discovered = new Set<string>()
        const onNewPeer = (peer: string) => {
          if (discovered.has(peer)) return
          discovered.add(peer)
          handlers.onDiscovered?.(discoveredDmChannel(peer))
        }

        inner = this.relay.subscribe(capped, {
          onEvent: (event) => {
            const message = this.toMessage(event, sk, me, caps, roomByAddress, dmByPeer, onNewPeer)
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
    onNewPeer?: (peer: string) => void,
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
      if (!peer) return null
      let channelId = dmByPeer.get(peer)
      if (!channelId) {
        // First contact: no thread exists for this peer. Route the message by
        // the peer's key and announce the thread, instead of dropping the one
        // message that would have started the conversation. (This was how the
        // first DM anyone ever sent you silently vanished.)
        channelId = peer
        onNewPeer?.(peer)
      }
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
              // Self-published: it never outranks the community directory.
              source: "relay",
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

      // Publishes the recipient's wrap (awaited) and our own read-back copy
      // (fire-and-forget). If the relay rejects the timestamps — jitter fell
      // outside its window, or this device's clock is skewed — it re-wraps at
      // corrected time and retries once before letting the error surface.
      await publishWrappedDm({
        relay: this.relay,
        rumor,
        sk,
        recipient: channel.address,
        estimateSkew: () => estimateClockSkew(this.relayUrl),
      })
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
