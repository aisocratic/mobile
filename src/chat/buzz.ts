/**
 * Buzz community HTTP API — join policy and invite redemption.
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
 * `POST /api/invites` (minting) is owner/admin-only and is not something this
 * app ever calls — a code has to come from the community owner.
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
