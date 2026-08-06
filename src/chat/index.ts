/**
 * Adapter selection plus the React surface for chat.
 *
 * Screens import only from here. The transport (`./nostr`) is chosen once, so
 * moving the app onto a Buzz relay — or onto something else entirely — is a
 * change to this file and nothing else.
 */

import { useQuery } from "@tanstack/react-query"
import { useCallback, useEffect, useMemo, useRef, useState, useSyncExternalStore } from "react"

import { useAuth } from "@/store/auth"

import { BUZZ_RELAY_URL, getNostrAdapter, PUBLIC_RELAY_URL, RELAY_URL } from "./nostr"
import { INVITE_LIMITS, policyDocumentUrls } from "./buzz"
import { clearDirectoryCache } from "./directory"
import { takePendingInvite } from "./pending-invite"
import {
  clearProfileCache,
  displayChannel,
  fallbackDisplayName,
  fetchProfilesForPubkeys,
  profileDisplayName,
} from "./profiles"
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
  ChatInvite,
  ChatInviteOptions,
  ChatJoinPolicy,
  ChatMessage,
  ChatProfile,
  RelayCapabilities,
} from "./types"

export {
  BUZZ_RELAY_URL,
  fallbackDisplayName,
  INVITE_LIMITS,
  policyDocumentUrls,
  profileDisplayName,
  PUBLIC_RELAY_URL,
  RELAY_URL,
  shortNpub,
}
export type {
  ChatChannel,
  ChatConnectionStatus,
  ChatIdentity,
  ChatInvite,
  ChatInviteOptions,
  ChatJoinPolicy,
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
    if (previousUser.current && previousUser.current !== userId) {
      clearStore()
      // The directory maps member uuids to pubkeys and is readable only by the
      // signed-in account, so it is per-session state like everything else here.
      clearDirectoryCache()
      // Same for the reverse map (pubkey -> person) behind name resolution,
      // and the once-per-session kind-0 request log: the store the answers
      // lived in was just cleared, so the questions must be askable again.
      clearProfileCache()
      requestedProfiles.clear()
    }
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
 * Resolve pubkeys into people, so the UI shows names, never hex.
 *
 * Two sources feed the store, and precedence between them lives in
 * `mergeProfiles` (see ./profiles):
 *
 *   1. the community directory — `chat_identities` joined to `public.users`,
 *      fetched in one batch and cached by react-query (plus a per-session
 *      cache inside ./profiles, so a growing author set only ever queries the
 *      keys it hasn't seen);
 *   2. kind-0 relay metadata, as a live subscription, for keys the directory
 *      doesn't know — guests on derived keys, members of other communities.
 *
 * Components then read the merged result with `useProfile`, and fall back to
 * a short npub via `profileDisplayName` when neither source answered.
 */
const requestedProfiles = new Set<string>()

function useProfileResolution(pubkeys: string[]) {
  const adapter = useChatAdapter()
  // Order-insensitive: the same authors discovered in a different order must
  // not look like a new query.
  // eslint-disable-next-line react-hooks/exhaustive-deps
  const signature = useMemo(() => [...new Set(pubkeys)].sort().join(","), [pubkeys.join(",")])

  const { data: directoryProfiles } = useQuery({
    queryKey: ["chat-profiles", signature],
    queryFn: () => fetchProfilesForPubkeys(signature.split(",")),
    enabled: !!adapter && signature.length > 0,
    staleTime: 5 * 60_000,
  })

  useEffect(() => {
    if (directoryProfiles?.length) ingestProfiles(directoryProfiles)
  }, [directoryProfiles])

  // Kind-0 is requested for every key (not just directory misses): it is the
  // only source of avatars for members whose users row has none, and each key
  // is asked about at most once per session.
  useEffect(() => {
    if (!adapter || !signature) return
    const wanted = signature.split(",").filter((pk) => !requestedProfiles.has(pk))
    if (!wanted.length) return
    for (const pk of wanted) requestedProfiles.add(pk)

    const subscription = adapter.subscribeProfiles(wanted, ingestProfiles)
    return () => subscription.close()
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

  // Resolve every DM counterparty in one batch, so rows show the person's
  // current name rather than whatever was persisted when the thread opened.
  const dmPeers = useMemo(
    () => channels.filter((c) => c.kind === "dm").map((c) => c.address),
    [channels],
  )
  useProfileResolution(dmPeers)

  const summaries = useMemo(
    () =>
      channels.map((channel) => {
        const lastMessage = getLastMessage(channel.id)
        return {
          // Presentation-ready: DM titles and avatars come from the resolved
          // profile, falling back to the stored name, never to a raw key.
          channel: displayChannel(channel, getProfile(channel.address)),
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
 * The whole "get me into this community" flow, in one hook.
 *
 * There are three ways in, and which ones exist depends on the relay and the
 * build rather than on anything the user did:
 *
 *   auto      our server mints a single-use invite for this account and the
 *             app redeems it. No code ever reaches the user's hands.
 *   link      a code arrived via `aisocratic://invite/<code>`; the user chose
 *             to open that link, so it is theirs to spend.
 *   paste     the original path, and the fallback whenever the first two are
 *             unavailable or fail.
 *
 * What is deliberately NOT automated is the age attestation. The community
 * sets `age_attestation_required: true`, and the relay rejects
 * `age_confirmed: false` — so sending a hardcoded `true` would not be
 * satisfying the requirement, it would be forging an answer to a question that
 * was asked of a person. When the policy requires it there is a checkbox, and
 * auto-join waits for it.
 */
export type CommunityOnboarding = {
  /** True when this build can fetch an invite on the user's behalf. */
  canAutoJoin: boolean
  /** True until the join policy is known — the checkbox depends on it. */
  preparing: boolean
  /** True when the community demands an explicit age attestation. */
  requiresAgeAttestation: boolean
  /** A code that arrived by deep link; `undefined` while still looking. */
  linkedCode: string | null | undefined
  joining: boolean
  joined: boolean
  error: string | null
  /**
   * True once the automatic path has been ruled out — either this build has no
   * join endpoint, or an attempt failed — so the UI should ask for a code.
   */
  needsCode: boolean
  /** Mint-and-redeem. Resolves false on failure, having set `error`. */
  autoJoin: (ageConfirmed: boolean) => Promise<boolean>
  /** Redeem a code the user pasted, or one that arrived by link. */
  joinWithCode: (code: string, ageConfirmed: boolean) => Promise<boolean>
  reset: () => void
}

export function useCommunityOnboarding(): CommunityOnboarding {
  const adapter = useChatAdapter()
  const linkedCode = usePendingInvite()

  const [policyLoaded, setPolicyLoaded] = useState(false)
  const [requiresAgeAttestation, setRequiresAgeAttestation] = useState(false)
  const [joining, setJoining] = useState(false)
  const [joined, setJoined] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const [autoFailed, setAutoFailed] = useState(false)

  const canAutoJoin = adapter?.canAutoJoin ?? false

  useEffect(() => {
    if (!adapter) return
    let active = true
    setPolicyLoaded(false)

    adapter
      .joinPolicy()
      .then((policy) => {
        if (!active) return
        setRequiresAgeAttestation(policy?.ageAttestationRequired ?? false)
        setPolicyLoaded(true)
      })
      .catch(() => {
        if (!active) return
        // Unknown policy: assume the attestation IS required. Guessing "not
        // required" would hide the checkbox and send a join the relay refuses,
        // which reads to the user as a broken app rather than a missing tick.
        setRequiresAgeAttestation(true)
        setPolicyLoaded(true)
      })

    return () => {
      active = false
    }
  }, [adapter])

  const run = useCallback(
    async (attempt: () => Promise<{ status: string }>, isAuto: boolean) => {
      setJoining(true)
      setError(null)
      try {
        await attempt()
        setJoined(true)
        return true
      } catch (e: unknown) {
        setError(e instanceof Error ? e.message : "Could not join the community.")
        // A failed auto-join is not a dead end — it just means the user has to
        // do it the manual way, so surface the code field rather than leaving
        // them on a button that already didn't work.
        if (isAuto) setAutoFailed(true)
        return false
      } finally {
        setJoining(false)
      }
    },
    [],
  )

  const autoJoin = useCallback(
    async (ageConfirmed: boolean) => {
      if (!adapter) return false
      return run(() => adapter.autoJoin(ageConfirmed), true)
    },
    [adapter, run],
  )

  const joinWithCode = useCallback(
    async (code: string, ageConfirmed: boolean) => {
      if (!adapter) return false
      return run(() => adapter.joinWithInvite(code, ageConfirmed), false)
    },
    [adapter, run],
  )

  const reset = useCallback(() => {
    setError(null)
    setJoined(false)
  }, [])

  return {
    canAutoJoin,
    preparing: !!adapter && !policyLoaded,
    requiresAgeAttestation,
    linkedCode,
    joining,
    joined,
    error,
    needsCode: !canAutoJoin || autoFailed,
    autoJoin,
    joinWithCode,
    reset,
  }
}

/**
 * A code that arrived by link, consumed once so a join form can prefill it.
 *
 * Returns `undefined` while the lookup is in flight and `null` once it's known
 * there is nothing parked — the difference matters to a field that would
 * otherwise render empty and then jump.
 */
export function usePendingInvite(): string | null | undefined {
  const [code, setCode] = useState<string | null | undefined>(undefined)

  useEffect(() => {
    let active = true
    void takePendingInvite().then((next) => {
      if (active) setCode(next)
    })
    return () => {
      active = false
    }
  }, [])

  return code
}

/**
 * Mint an invite for someone else.
 *
 * Kept deliberately un-persisted: the relay returns the code once and has no
 * endpoint to read it back, so this holds it in component state for as long as
 * the screen is open and no longer. Writing it to storage would leave a
 * standing join capability on the device for the sake of a convenience nobody
 * asked for.
 */
export function useCreateInvite(): {
  create: (options: ChatInviteOptions) => Promise<ChatInvite | null>
  invite: ChatInvite | null
  creating: boolean
  error: string | null
  reset: () => void
} {
  const adapter = useChatAdapter()
  const [invite, setInvite] = useState<ChatInvite | null>(null)
  const [creating, setCreating] = useState(false)
  const [error, setError] = useState<string | null>(null)

  const create = useCallback(
    async (options: ChatInviteOptions) => {
      if (!adapter) return null
      setCreating(true)
      setError(null)
      try {
        const next = await adapter.createInvite(options)
        setInvite(next)
        return next
      } catch (e: unknown) {
        setError(e instanceof Error ? e.message : "Could not create an invite.")
        return null
      } finally {
        setCreating(false)
      }
    },
    [adapter],
  )

  const reset = useCallback(() => {
    setInvite(null)
    setError(null)
  }, [])

  return { create, invite, creating, error, reset }
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

  // The header must show a person, not a hash: resolve the DM counterparty and
  // overlay whatever the directory or the relay knows onto the channel.
  const peerKeys = useMemo(() => (channel?.kind === "dm" ? [channel.address] : []), [channel])
  useProfileResolution(peerKeys)

  const version = useStoreVersion()
  const resolved = useMemo(
    () => (channel ? displayChannel(channel, getProfile(channel.address)) : null),
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [channel, version],
  )

  const reload = useCallback(() => setNonce((n) => n + 1), [])
  return { channel: resolved, loading, error, reload }
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
  useProfileResolution(authors)

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
