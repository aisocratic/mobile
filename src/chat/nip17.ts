/**
 * NIP-17 private direct messages, built on NIP-59 gift wrapping.
 *
 * This replaces the NIP-04 DMs the app originally shipped. It is not a
 * preference — the Buzz relay advertises NIP-17 and does not support NIP-04, so
 * a kind-4 event has nowhere to go on this relay.
 *
 * Three nested layers, each doing a distinct job:
 *
 *   rumor (kind 14)   the actual message. Unsigned on purpose: a signature
 *                     would be a transferable proof of authorship that the
 *                     recipient could show to anyone. Deniability is the point.
 *   seal  (kind 13)   the rumor, NIP-44 encrypted to the recipient and *signed
 *                     by the sender*. This is what proves authorship, and only
 *                     the recipient can open it.
 *   wrap  (kind 1059) the seal, NIP-44 encrypted to the recipient under a
 *                     throwaway key that is used once and discarded. The wrap
 *                     is what the relay sees, so the relay learns only "someone
 *                     sent something to this pubkey".
 *
 * Timestamps on the seal and wrap are randomised a few minutes into the past
 * so the relay cannot correlate a conversation by arrival time. NIP-59
 * suggests up to two days, but the Buzz relay enforces a tight created_at
 * window against its own clock and rejects heavily backdated events with
 * "invalid: event timestamp too far from server time" — and on a members-only
 * relay, deliverability beats that last sliver of metadata privacy. The
 * *rumor's* timestamp is never fuzzed: it is the time recipients display.
 *
 * A message is wrapped twice — once to the recipient, once to ourselves —
 * because the relay is the only storage and we could not otherwise read back
 * what we sent.
 */

import * as Crypto from "expo-crypto"

import { conversationKey, nip44Decrypt, nip44Encrypt } from "./nip44"
import {
  eventId,
  finalizeEvent,
  getPublicKey,
  isNostrEvent,
  KIND_DM_RUMOR,
  KIND_GIFT_WRAP,
  KIND_SEAL,
  randomSecretKey,
  type NostrEvent,
  type NostrTag,
  type UnsignedEvent,
} from "./protocol"

/**
 * How far into the past a seal/wrap timestamp may be fuzzed. Small enough that
 * a strict relay's created_at window (Buzz rejects events "too far from server
 * time") still accepts every value in the range.
 */
export const MAX_TIME_JITTER_SECONDS = 15 * 60

/**
 * Knobs for the outer (seal + wrap) timestamps only; the rumor is never
 * touched. `skewSeconds` shifts "now" by an estimated device-clock error, and
 * `jitterSeconds` bounds the backdating fuzz (0 disables it) — both exist so a
 * timestamp-rejected send can be re-wrapped with corrected times and retried.
 */
export type WrapTimestampOptions = {
  skewSeconds?: number
  jitterSeconds?: number
}

function jitteredTimestamp(options: WrapTimestampOptions = {}): number {
  const { skewSeconds = 0, jitterSeconds = MAX_TIME_JITTER_SECONDS } = options
  const now = Math.floor(Date.now() / 1000) + skewSeconds
  if (jitterSeconds <= 0) return now
  const offset = Crypto.getRandomBytes(4)
  const value = new DataView(offset.buffer, offset.byteOffset, 4).getUint32(0, false)
  return now - (value % jitterSeconds)
}

function randomNonce(): Uint8Array {
  return Crypto.getRandomBytes(32)
}

/** An unsigned kind-14 message. Carries an id but deliberately no signature. */
export type Rumor = UnsignedEvent & { id: string }

export function buildRumor(
  senderPubkey: string,
  recipientPubkey: string,
  body: string,
  extraTags: NostrTag[] = [],
): Rumor {
  const unsigned: UnsignedEvent = {
    pubkey: senderPubkey,
    created_at: Math.floor(Date.now() / 1000),
    kind: KIND_DM_RUMOR,
    tags: [["p", recipientPubkey], ...extraTags],
    content: body,
  }
  return { ...unsigned, id: eventId(unsigned) }
}

/**
 * Wrap a rumor for one recipient. Call once per recipient — including yourself,
 * or you lose your own sent messages.
 */
export function giftWrap(
  rumor: Rumor,
  senderSk: Uint8Array,
  recipientPubkey: string,
  timestamps: WrapTimestampOptions = {},
): NostrEvent {
  // Seal: signed by the real sender, readable only by the recipient.
  const seal = finalizeEvent(
    {
      created_at: jitteredTimestamp(timestamps),
      kind: KIND_SEAL,
      tags: [],
      content: nip44Encrypt(
        JSON.stringify(rumor),
        conversationKey(senderSk, recipientPubkey),
        randomNonce(),
      ),
    },
    senderSk,
  )

  // Wrap: signed by a single-use key so the sender's identity never appears
  // in plaintext on the relay.
  const ephemeralSk = randomSecretKey()
  return finalizeEvent(
    {
      created_at: jitteredTimestamp(timestamps),
      kind: KIND_GIFT_WRAP,
      tags: [["p", recipientPubkey]],
      content: nip44Encrypt(
        JSON.stringify(seal),
        conversationKey(ephemeralSk, recipientPubkey),
        randomNonce(),
      ),
    },
    ephemeralSk,
  )
}

/** Both wraps for a message: one to them, one to us. */
export function wrapForBoth(
  rumor: Rumor,
  senderSk: Uint8Array,
  recipientPubkey: string,
  timestamps: WrapTimestampOptions = {},
): NostrEvent[] {
  const self = getPublicKey(senderSk)
  const wraps = [giftWrap(rumor, senderSk, recipientPubkey, timestamps)]
  // Skip the duplicate when messaging yourself.
  if (recipientPubkey !== self) wraps.push(giftWrap(rumor, senderSk, self, timestamps))
  return wraps
}

/**
 * Unwrap a kind-1059 addressed to us. Returns null for anything we can't or
 * shouldn't read — this runs on untrusted relay input, so every failure mode
 * is a normal return, never a throw.
 */
export function unwrapGift(wrap: NostrEvent, sk: Uint8Array): Rumor | null {
  if (wrap.kind !== KIND_GIFT_WRAP) return null

  try {
    const sealJson = nip44Decrypt(wrap.content, conversationKey(sk, wrap.pubkey))
    const seal: unknown = JSON.parse(sealJson)
    if (!isNostrEvent(seal) || seal.kind !== KIND_SEAL) return null

    const rumorJson = nip44Decrypt(seal.content, conversationKey(sk, seal.pubkey))
    const rumor: unknown = JSON.parse(rumorJson)
    if (!rumor || typeof rumor !== "object") return null

    const candidate = rumor as Partial<Rumor>
    if (
      typeof candidate.pubkey !== "string" ||
      typeof candidate.content !== "string" ||
      typeof candidate.created_at !== "number" ||
      typeof candidate.kind !== "number" ||
      !Array.isArray(candidate.tags)
    ) {
      return null
    }

    // CRITICAL: the seal is the only signed layer, so the rumor's claimed
    // author must be the key that signed the seal. Without this check anyone
    // could seal a rumor attributed to someone else and we would render it
    // under that person's name.
    if (candidate.pubkey !== seal.pubkey) return null
    if (candidate.kind !== KIND_DM_RUMOR) return null

    const complete = candidate as Rumor
    // Recompute rather than trust the transmitted id.
    return { ...complete, id: eventId(complete) }
  } catch {
    // Not addressed to us, or malformed. Both are routine.
    return null
  }
}

/** The counterparty of a rumor, from our point of view. */
export function rumorPeer(rumor: Rumor, me: string): string | null {
  if (rumor.pubkey !== me) return rumor.pubkey
  const recipient = rumor.tags.find((t) => t[0] === "p")?.[1]
  return recipient ?? null
}
