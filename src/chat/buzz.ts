/**
 * Buzz community HTTP API — join policy, invite minting and redemption.
 *
 * The Buzz relay is a *closed* relay: `limitation.auth_required` and
 * `restricted_writes` are both true, and a key that isn't a member cannot even
 * complete NIP-42 AUTH — the relay answers
 * `["OK", <id>, false, "restricted: not a relay member"]`. Membership is
 * therefore a precondition for everything, and it is granted out-of-band over
 * HTTP rather than over the Nostr socket.
 *
 * The join sequence (all three verified live against the deployed relay,
 * except the final redemption which needs a real code):
 *
 *   GET  /api/join-policy            public; returns terms, privacy, version,
 *                                    and whether age attestation is required.
 *   POST /api/invites/accept-policy  {code, policy_version, age_confirmed}
 *                                    -> {receipt}. No NIP-98: the Rust handler
 *                                    takes only State + body.
 *   POST /api/invites/claim          {code, policy_receipt} + NIP-98 header,
 *                                    signed by the joining key. Deliberately
 *                                    exempt from the membership gate.
 *
 * The other half of the loop is minting:
 *
 *   POST /api/invites                {ttl_secs, max_uses} + NIP-98 header.
 *                                    Authorization mirrors kind:9030 — the
 *                                    signing key must hold `owner` or `admin`
 *                                    in the community, and everyone else gets
 *                                    403. Returns the code, its expiry, and a
 *                                    relay-hosted landing page URL.
 *
 * Minting is a *user* action here, not a build-time one: the app never ships a
 * code, it asks the relay to mint one on behalf of whoever is signed in, and
 * the relay decides whether that key is allowed to.
 */

import { nip98AuthHeader } from "./protocol"

/** Buzz error bodies are uniformly `{"error": "..."}` (api_error in mod.rs). */
type BuzzError = { error?: string }

export type JoinPolicy = {
  version: string
  ageAttestationRequired: boolean
  termsMarkdown: string | null
  privacyMarkdown: string | null
}

export type ClaimResult = {
  status: "joined" | "already_member"
  communityId: string | null
  host: string | null
  role: string | null
}

/**
 * Bounds the relay enforces on a minted invite, mirrored from
 * `buzz_core::invite` so the UI can offer only choices the server will accept
 * and reject the rest without spending a signed request.
 */
export const INVITE_LIMITS = {
  minTtlSecs: 60,
  defaultTtlSecs: 72 * 60 * 60,
  maxTtlSecs: 30 * 24 * 60 * 60,
  maxUses: 10_000,
} as const

export type InviteOptions = {
  /** Lifetime in seconds, within `INVITE_LIMITS`. */
  ttlSecs: number
  /** `null` mints an unlimited-use code — Buzz's default, and a real footgun. */
  maxUses: number | null
}

export type MintedInvite = {
  /** The secret itself, `v2.…`. Returned once, at mint time, and never again. */
  code: string
  /** Epoch seconds, as the relay computed it. */
  expiresAt: number
  maxUses: number | null
  usesRemaining: number | null
  /** Relay-hosted landing page for the code — the thing you actually send. */
  url: string
}

/** Thrown for a relay-reported failure; `code` is Buzz's own error string. */
export class BuzzApiError extends Error {
  readonly code: string
  readonly httpStatus: number

  constructor(code: string, httpStatus: number, message?: string) {
    super(message ?? describeBuzzError(code))
    this.name = "BuzzApiError"
    this.code = code
    this.httpStatus = httpStatus
  }
}

/**
 * Turn Buzz's deliberately terse error codes into something a person can act
 * on. The relay keeps these coarse on purpose so the endpoint is a poor oracle
 * for brute-forcing codes, so we can't be more specific than it is.
 */
function describeBuzzError(code: string): string {
  switch (code) {
    case "invite_invalid":
      return "That invite code isn't valid. Check for typos, or ask for a fresh one."
    case "invite_expired":
      return "That invite code has expired. Ask the community owner for a new one."
    case "invite_exhausted":
      return "That invite code has already been used up. Ask for a new one."
    case "join_policy_required":
      return "The community terms need to be accepted before joining."
    case "join_policy_not_accepted":
      return "The terms weren't accepted, or the policy changed. Try again."
    case "join_policy_not_configured":
      return "This community has no join policy configured."
    case "too many invite claim attempts, slow down":
      return "Too many attempts. Wait a minute and try again."

    /* Minting. The relay's own strings are already sentences, so these exist
       to add the bit it can't know: what the person should do next. */
    case "only relay owners and admins can create invites":
      return "Only the community's owners and admins can create invites. Ask one of them for a code."
    case "missing Nostr auth":
    case "invalid Nostr auth":
      return "This device couldn't prove which key it holds. Sign out and back in, then try again."
    case "invite_ttl_out_of_range":
      return "Pick an expiry between 1 minute and 30 days."
    case "invite_max_uses_out_of_range":
      return `Pick a use limit between 1 and ${INVITE_LIMITS.maxUses}.`
    case "invite_mint_failed":
      return "The community accepted the request but didn't return a code."

    default:
      return code || "The community rejected the request."
  }
}

/** `wss://host` -> `https://host`, which is what NIP-98's `u` tag must match. */
export function relayHttpOrigin(relayUrl: string): string {
  const trimmed = relayUrl.trim()
  if (trimmed.startsWith("wss://")) return `https://${trimmed.slice(6)}`
  if (trimmed.startsWith("ws://")) return `http://${trimmed.slice(5)}`
  return trimmed.replace(/\/+$/, "")
}

async function readJson(response: Response): Promise<unknown> {
  const text = await response.text()
  if (!text) return {}
  try {
    return JSON.parse(text) as unknown
  } catch {
    return { error: text.slice(0, 200) }
  }
}

async function failFrom(response: Response): Promise<BuzzApiError> {
  const body = (await readJson(response)) as BuzzError
  return new BuzzApiError(body.error ?? `HTTP ${response.status}`, response.status)
}

/** Public, unauthenticated. Returns null when the relay has no join policy. */
export async function fetchJoinPolicy(relayUrl: string): Promise<JoinPolicy | null> {
  const response = await fetch(`${relayHttpOrigin(relayUrl)}/api/join-policy`, {
    headers: { accept: "application/json" },
  })
  if (!response.ok) throw await failFrom(response)

  const body = (await readJson(response)) as {
    policy?: {
      version?: string
      age_attestation_required?: boolean
      terms_markdown?: string | null
      privacy_markdown?: string | null
    }
  }
  const policy = body.policy
  // `{}` is the documented response when no policy is configured.
  if (!policy || typeof policy.version !== "string") return null

  return {
    version: policy.version,
    ageAttestationRequired: policy.age_attestation_required === true,
    termsMarkdown: policy.terms_markdown ?? null,
    privacyMarkdown: policy.privacy_markdown ?? null,
  }
}

/** Hosted, human-readable renderings of the policy documents. */
export function policyDocumentUrls(relayUrl: string) {
  const origin = relayHttpOrigin(relayUrl)
  return {
    terms: `${origin}/api/join-policy/terms`,
    privacy: `${origin}/api/join-policy/privacy`,
  }
}

/**
 * Exchange explicit acceptance for a relay-issued receipt bound to this code.
 *
 * `ageConfirmed` must reflect a real affirmative action by the user. This
 * community sets `age_attestation_required: true`, and the relay rejects the
 * request with `join_policy_not_accepted` when the flag is false — so passing
 * a hardcoded `true` would be forging a consent step, not satisfying one.
 */
export async function acceptJoinPolicy(
  relayUrl: string,
  code: string,
  policyVersion: string,
  ageConfirmed: boolean,
): Promise<string> {
  const body = JSON.stringify({
    code,
    policy_version: policyVersion,
    age_confirmed: ageConfirmed,
  })

  const response = await fetch(`${relayHttpOrigin(relayUrl)}/api/invites/accept-policy`, {
    method: "POST",
    headers: { "content-type": "application/json", accept: "application/json" },
    body,
  })
  if (!response.ok) throw await failFrom(response)

  const parsed = (await readJson(response)) as { receipt?: string }
  if (!parsed.receipt) throw new BuzzApiError("join_policy_required", response.status)
  return parsed.receipt
}

/**
 * Mint an invite code, proving control of `sk` via NIP-98.
 *
 * The relay authorizes this by *role*, not by endpoint secrecy: it looks the
 * signing key up in the community and refuses anything that isn't `owner` or
 * `admin` with 403. So this is safe to offer to every signed-in member — the
 * server is the one deciding, and a member who isn't an admin gets a clear
 * answer instead of a hidden button.
 *
 * The code comes back exactly once. There is no endpoint that reads it again,
 * so a caller that drops it has to mint another.
 */
export async function mintInvite(
  relayUrl: string,
  sk: Uint8Array,
  options: InviteOptions,
): Promise<MintedInvite> {
  const ttlSecs = Math.round(options.ttlSecs)
  const maxUses = options.maxUses

  // Check the relay's own bounds before signing. Every NIP-98 event we send is
  // one its replay guard has to remember, so burning one on a request the
  // server will certainly reject is pure waste.
  if (
    !Number.isFinite(ttlSecs) ||
    ttlSecs < INVITE_LIMITS.minTtlSecs ||
    ttlSecs > INVITE_LIMITS.maxTtlSecs
  ) {
    throw new BuzzApiError("invite_ttl_out_of_range", 400)
  }
  if (
    maxUses !== null &&
    (!Number.isInteger(maxUses) || maxUses < 1 || maxUses > INVITE_LIMITS.maxUses)
  ) {
    throw new BuzzApiError("invite_max_uses_out_of_range", 400)
  }

  const url = `${relayHttpOrigin(relayUrl)}/api/invites`
  // `max_uses: null` is how Buzz spells "unlimited". Sending the key
  // explicitly keeps that an expressed choice rather than an omission.
  // Serialised once and reused — NIP-98's `payload` tag hashes these bytes.
  const body = JSON.stringify({ ttl_secs: ttlSecs, max_uses: maxUses })

  const response = await fetch(url, {
    method: "POST",
    headers: {
      "content-type": "application/json",
      accept: "application/json",
      authorization: nip98AuthHeader(sk, url, "POST", body),
    },
    body,
  })
  if (!response.ok) throw await failFrom(response)

  const parsed = (await readJson(response)) as {
    code?: string
    expires_at?: number
    max_uses?: number | null
    uses_remaining?: number | null
    url?: string
  }
  if (!parsed.code) throw new BuzzApiError("invite_mint_failed", response.status)

  return {
    code: parsed.code,
    expiresAt:
      typeof parsed.expires_at === "number"
        ? parsed.expires_at
        : Math.floor(Date.now() / 1000) + ttlSecs,
    // `max_uses` is null for an unlimited code, so the absence of a number is
    // meaningful here rather than a parse failure.
    maxUses: typeof parsed.max_uses === "number" ? parsed.max_uses : null,
    usesRemaining: typeof parsed.uses_remaining === "number" ? parsed.uses_remaining : null,
    url: parsed.url ?? `${relayHttpOrigin(relayUrl)}/invite/${parsed.code}`,
  }
}

/**
 * Redeem an invite code for relay membership, proving control of `sk` via
 * NIP-98. Idempotent: re-claiming returns `already_member`.
 */
export async function claimInvite(
  relayUrl: string,
  sk: Uint8Array,
  code: string,
  policyReceipt: string | null,
): Promise<ClaimResult> {
  const url = `${relayHttpOrigin(relayUrl)}/api/invites/claim`
  // The body must be serialised once and reused: NIP-98's `payload` tag is a
  // hash of these exact bytes, so re-stringifying could invalidate the header.
  const body = JSON.stringify(
    policyReceipt ? { code, policy_receipt: policyReceipt } : { code },
  )

  const response = await fetch(url, {
    method: "POST",
    headers: {
      "content-type": "application/json",
      accept: "application/json",
      authorization: nip98AuthHeader(sk, url, "POST", body),
    },
    body,
  })
  if (!response.ok) throw await failFrom(response)

  const parsed = (await readJson(response)) as {
    status?: string
    community_id?: string
    host?: string
    role?: string
  }
  return {
    status: parsed.status === "already_member" ? "already_member" : "joined",
    communityId: parsed.community_id ?? null,
    host: parsed.host ?? null,
    role: parsed.role ?? null,
  }
}

/**
 * Full join: accept the policy if the relay requires one, then claim.
 * Returns the claim result so callers can distinguish a fresh join.
 */
export async function joinCommunity(
  relayUrl: string,
  sk: Uint8Array,
  code: string,
  ageConfirmed: boolean,
): Promise<ClaimResult> {
  const trimmed = code.trim()
  if (!trimmed) throw new BuzzApiError("invite_invalid", 400)

  const policy = await fetchJoinPolicy(relayUrl)

  let receipt: string | null = null
  if (policy) {
    if (policy.ageAttestationRequired && !ageConfirmed) {
      throw new BuzzApiError("join_policy_not_accepted", 400)
    }
    receipt = await acceptJoinPolicy(relayUrl, trimmed, policy.version, ageConfirmed)
  }

  return claimInvite(relayUrl, sk, trimmed, receipt)
}
