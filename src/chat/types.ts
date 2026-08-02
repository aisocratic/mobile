/**
 * Transport-agnostic chat types.
 *
 * The app talks to chat exclusively through `ChatAdapter`. The shipped
 * implementation (`./nostr`) speaks Nostr NIP-01 over a relay WebSocket, which
 * is the same wire protocol Buzz (github.com/block/buzz) speaks — so pointing
 * `EXPO_PUBLIC_NOSTR_RELAY` at a Buzz relay is all it takes to run this against
 * Buzz. Swapping in a different backend later means writing one new adapter.
 */

/**
 * Honest view of the relay socket.
 *
 * `unavailable` is distinct from `offline` on purpose: offline means we have an
 * identity and a socket that is down and retrying, whereas unavailable means
 * there is no signed-in user, so no keypair was derived and no socket was ever
 * opened. Collapsing the two makes the UI claim it is "retrying" when nothing
 * is happening at all.
 *
 * `authenticating` and `not-a-member` exist for closed relays like Buzz, which
 * require NIP-42 AUTH before any subscription and reject non-members outright
 * with `restricted: not a relay member`. That is a membership problem, not a
 * connectivity problem, and telling the user "offline" would send them chasing
 * their network instead of an invite code.
 */
export type ChatConnectionStatus =
  | "unavailable"
  | "connecting"
  | "authenticating"
  | "not-a-member"
  | "live"
  | "offline"

export type ChatChannelKind = "public" | "dm"

export type ChatChannel = {
  /** The value that appears in the `/chat/[id]` route. */
  id: string
  kind: ChatChannelKind
  name: string
  topic: string | null
  /** Ionicons glyph used for public rooms; DMs render an Avatar instead. */
  icon: string | null
  avatarUrl: string | null
  /**
   * Nostr-level addressing, filled in by the adapter.
   * - public rooms: the NIP-28 kind-40 event id the room's messages tag.
   * - DMs: the counterparty's 32-byte x-only public key, hex encoded.
   */
  address: string
}

export type ChatMessage = {
  /** The Nostr event id — stable, so optimistic sends dedupe against the echo. */
  id: string
  channelId: string
  /** Author's x-only public key, hex. */
  authorId: string
  body: string
  /** Epoch seconds, as Nostr stores it. */
  createdAt: number
  mine: boolean
  /** True between local append and the relay's OK. */
  pending?: boolean
  /** True when the relay rejected it or the socket never came up. */
  failed?: boolean
}

/** NIP-01 kind-0 metadata, the closest thing Nostr has to a profile. */
export type ChatProfile = {
  pubkey: string
  name: string | null
  avatarUrl: string | null
}

export type ChatIdentity = {
  /** x-only public key, hex. */
  pubkey: string
  /** NIP-19 bech32 encoding of the same key — what users see and share. */
  npub: string
  /**
   * How this key came to exist. `derived` means secure storage was unusable
   * and the key was computed from the account id by a constant in this bundle
   * — usable, but not private from anyone holding the source. The UI surfaces
   * it rather than letting a weaker key masquerade as a generated one.
   */
  source: "created" | "stored" | "derived"
  /** True once the public key is published to the directory for others to find. */
  registered: boolean
}

export type ChatSubscription = { close: () => void }

/**
 * Which dialects the connected relay speaks, read from its NIP-11 document
 * rather than assumed. The Buzz relay advertises NIP-29 groups and NIP-17
 * DMs; a typical public relay advertises neither and wants NIP-28 and NIP-04.
 * Detecting instead of hardcoding is what lets one adapter serve both.
 */
export type RelayCapabilities = {
  groups: "nip29" | "nip28"
  dms: "nip17" | "nip04"
  authRequired: boolean
  /** Relay-declared ceilings; we stay under them rather than get truncated. */
  maxFilters: number
  maxLimit: number
  maxContentLength: number
  maxTagValuesPerFilter: number
  /** True when the relay exposes the Buzz invite/join HTTP API. */
  supportsInvites: boolean
  relayName: string | null
}

export type ChatJoinResult = { status: "joined" | "already_member" }

/**
 * What a closed community requires before it will admit a key.
 *
 * Only the parts the UI has to act on. `ageAttestationRequired` is the one
 * that shapes the flow: when it is true there must be a checkbox, because the
 * relay is asking a person a question and the app is not entitled to answer
 * it for them.
 */
export type ChatJoinPolicy = {
  version: string
  ageAttestationRequired: boolean
}

/**
 * A freshly minted invite. `code` is a secret the relay hands back exactly
 * once — there is no endpoint that reads it again — so the UI has to treat
 * losing it as losing the invite.
 */
export type ChatInvite = {
  code: string
  /** Epoch seconds. */
  expiresAt: number
  /** `null` means unlimited uses. */
  maxUses: number | null
  usesRemaining: number | null
  /** Shareable landing page hosted by the relay. */
  url: string
}

export type ChatInviteOptions = { ttlSecs: number; maxUses: number | null }

export type ChatAdapter = {
  readonly id: string
  readonly relayUrl: string

  /** Resolves (creating on first use) the signed-in user's chat keypair. */
  identity(): Promise<ChatIdentity>

  status(): ChatConnectionStatus
  onStatus(listener: (status: ChatConnectionStatus) => void): () => void

  /**
   * The channel list, as a live subscription.
   *
   * Not a plain getter, because on a NIP-29 relay the rooms exist server-side
   * and must be *discovered* (kind 39000 metadata) rather than invented by the
   * client. On a plain public relay this emits the code-defined NIP-28 rooms
   * immediately and never changes.
   */
  subscribeChannels(onChannels: (channels: ChatChannel[]) => void): ChatSubscription

  /** What the relay actually supports, from its NIP-11 document. */
  capabilities(): Promise<RelayCapabilities>

  /**
   * Redeem an invite code for membership of a closed relay. `ageConfirmed`
   * must come from a real affirmative user action, not a default.
   */
  joinWithInvite(code: string, ageConfirmed: boolean): Promise<ChatJoinResult>

  /**
   * Join with no invite code in the user's hands: the app asks our server to
   * mint a single-use one and redeems it in the same breath.
   *
   * `ageConfirmed` is still a real checkbox. Automating the *code* is a
   * convenience; automating the *attestation* would be forging it, and the
   * relay would be right to treat a hardcoded `true` as a lie.
   *
   * Rejects when the build has no join endpoint configured, so callers can
   * fall back to asking for a pasted code.
   */
  autoJoin(ageConfirmed: boolean): Promise<ChatJoinResult>

  /** True when this build is configured to fetch invites on the user's behalf. */
  readonly canAutoJoin: boolean

  /**
   * The community's join policy, or null when it has none. Callers need this
   * to know whether an age attestation must be collected before joining.
   */
  joinPolicy(): Promise<ChatJoinPolicy | null>

  /**
   * Mint an invite code to hand to someone else.
   *
   * Offered to every member and authorized server-side by role: a key that
   * isn't an owner or admin is refused with a 403 the UI can explain. Rejects
   * on a relay that has no invite API at all.
   */
  createInvite(options: ChatInviteOptions): Promise<ChatInvite>

  /** Turn a `/chat/[id]` param into a channel, hitting Supabase for DMs. */
  resolveChannel(routeId: string): Promise<ChatChannel | null>

  /**
   * Live subscription across one or more channels: backfills recent history,
   * then streams new messages. One relay REQ covers the whole set.
   */
  subscribeMessages(
    channels: ChatChannel[],
    handlers: {
      onMessages: (messages: ChatMessage[]) => void
      onReady?: () => void
      onError?: (message: string) => void
    },
    limitPerChannel?: number,
  ): ChatSubscription

  /** Fetch kind-0 metadata for the given authors. */
  subscribeProfiles(
    pubkeys: string[],
    onProfiles: (profiles: ChatProfile[]) => void,
  ): ChatSubscription

  /**
   * Sign and publish a message.
   *
   * `onPending` fires as soon as the event is signed — before it reaches the
   * relay — carrying the final event id, so the UI can append the message
   * immediately and have the relay's echo deduplicate against it. The promise
   * resolves with the confirmed message, or rejects if the relay refused it.
   */
  send(
    channel: ChatChannel,
    body: string,
    onPending?: (message: ChatMessage) => void,
  ): Promise<ChatMessage>

  /**
   * Publish our own kind-0 metadata so peers render a name and avatar instead
   * of a hex key. Fire-and-forget; failures are not worth surfacing.
   */
  announce(profile: { name: string | null; avatarUrl: string | null }): void
}
