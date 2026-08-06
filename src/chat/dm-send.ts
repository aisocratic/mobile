/**
 * Publishing a NIP-17 DM against a relay that polices `created_at`.
 *
 * The Buzz relay validates every event's timestamp against its own clock and
 * answers `OK false "invalid: event timestamp too far from server time"` when
 * it disagrees. Two things can trip that check:
 *
 *   - the privacy jitter on the seal/wrap timestamps (now bounded in ./nip17,
 *     but the relay's window is not published, so it can still lose), and
 *   - a device clock that is simply wrong.
 *
 * Neither is the user's fault, so neither should surface as "Not delivered"
 * without a fight: on a timestamp rejection we estimate the relay's clock from
 * the `Date` header of its NIP-11 HTTP endpoint (the one piece of server time
 * the relay exposes; nothing in its NIP-11 JSON or AUTH flow carries one),
 * re-wrap the same rumor with jitter off and the skew applied, and publish
 * once more. Only a second failure is an error. The rumor — the timestamp the
 * recipient sees — is never altered by any of this.
 */

import { wrapForBoth, type Rumor } from "./nip17"
import type { NostrEvent } from "./protocol"

/** The publish surface of RelayClient that sending a DM needs. */
export type DmPublisher = {
  publish: (event: NostrEvent) => Promise<void>
  publishQuietly: (event: NostrEvent) => void
}

/**
 * Does this OK/NOTICE wording mean "your created_at is outside my window"?
 * Matched loosely: Buzz says "event timestamp too far from server time",
 * strfry says "created_at too far off", others vary.
 */
export function isTimestampRejection(message: string): boolean {
  return /timestamp|created[_-]?at/i.test(message)
}

/**
 * Estimate the relay clock minus the device clock, in whole seconds.
 *
 * The relay's NIP-11 endpoint is plain HTTPS, and HTTP responses carry a
 * `Date` header stamped by the server. Comparing it against the midpoint of
 * the request is crude (the header has one-second resolution) but plenty for
 * a check whose window is minutes wide. Unknowable skew is reported as 0 so
 * the caller's fallback is "retry with the current time, unjittered".
 */
export async function estimateClockSkew(relayUrl: string): Promise<number> {
  const trimmed = relayUrl.trim()
  const origin = trimmed.startsWith("wss://")
    ? `https://${trimmed.slice(6)}`
    : trimmed.startsWith("ws://")
      ? `http://${trimmed.slice(5)}`
      : trimmed
  try {
    const before = Date.now()
    const response = await fetch(origin, { headers: { accept: "application/nostr+json" } })
    const after = Date.now()
    const header = response.headers?.get?.("date")
    if (!header) return 0
    const serverMs = Date.parse(header)
    if (Number.isNaN(serverMs)) return 0
    return Math.round((serverMs - (before + after) / 2) / 1000)
  } catch {
    return 0
  }
}

/**
 * Publish both wraps of a DM, retrying exactly once with corrected timestamps
 * if the relay rejects the first attempt for its `created_at`.
 *
 * The copy addressed to the recipient is the one awaited — it is the message.
 * Our own copy exists only so the thread reads back later, so it goes out
 * fire-and-forget after the recipient's copy is accepted, wrapped with the
 * same timestamp policy that just succeeded.
 */
export async function publishWrappedDm(options: {
  relay: DmPublisher
  rumor: Rumor
  sk: Uint8Array
  recipient: string
  estimateSkew?: () => Promise<number>
}): Promise<void> {
  const { relay, rumor, sk, recipient, estimateSkew } = options

  const attempt = async (timestamps?: { skewSeconds: number; jitterSeconds: number }) => {
    const wraps = wrapForBoth(rumor, sk, recipient, timestamps)
    await relay.publish(wraps[0])
    for (const extra of wraps.slice(1)) relay.publishQuietly(extra)
  }

  try {
    await attempt()
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error)
    if (!isTimestampRejection(message)) throw error

    // The relay disliked our clock. Ask it what time it is, then send the
    // same rumor re-wrapped at (corrected) now, with the jitter disabled so
    // the only remaining variable is the skew estimate itself.
    const skewSeconds = estimateSkew ? await estimateSkew().catch(() => 0) : 0
    await attempt({ skewSeconds, jitterSeconds: 0 })
  }
}
