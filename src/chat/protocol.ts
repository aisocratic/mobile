/**
 * The slice of the Nostr protocol this app needs, implemented directly on
 * @noble/@scure primitives.
 *
 * Why not `nostr-tools`? It is an ESM-only package whose subpaths are reachable
 * only through its `exports` map, and this repo has to keep Metro's
 * `unstable_enablePackageExports` off for @supabase/supabase-js. Rather than
 * flip a global resolver flag and risk a bundle that won't load, we implement
 * NIP-01/04/19/28 here — it is about 150 lines and has no resolution surprises.
 * @noble/curves and @noble/hashes ship flat files at their package root, so they
 * resolve identically with or without package exports.
 *
 * Specs used:
 *   NIP-01 event format, ids and signatures  (kinds 0, 1)
 *   NIP-04 encrypted direct messages         (kind 4)
 *   NIP-19 bech32 `npub` encoding
 *   NIP-28 public chat                       (kinds 40, 42)
 *   NIP-42 relay authentication              (kind 22242)
 */

// Side-effect import: installs global.crypto.getRandomValues, which
// @noble/curves uses for BIP-340 auxiliary randomness when signing.
import "react-native-get-random-values"

import { cbc } from "@noble/ciphers/aes.js"
import { bytesToUtf8 } from "@noble/ciphers/utils.js"
import { schnorr, secp256k1 } from "@noble/curves/secp256k1.js"
import { sha256 } from "@noble/hashes/sha2.js"
import { bytesToHex, hexToBytes, utf8ToBytes } from "@noble/hashes/utils.js"
import { base64, bech32 } from "@scure/base"
import * as Crypto from "expo-crypto"

export const KIND_METADATA = 0

/** NIP-29 relay-based groups — what the Buzz relay actually speaks. */
export const KIND_GROUP_CHAT = 9
export const KIND_GROUP_METADATA = 39000
export const KIND_GROUP_ADMINS = 39001
export const KIND_GROUP_MEMBERS = 39002

/** NIP-17 / NIP-59 private DMs. */
export const KIND_SEAL = 13
export const KIND_DM_RUMOR = 14
export const KIND_GIFT_WRAP = 1059

/**
 * NIP-28 public chat and NIP-04 DMs. Retained only for the generic-relay
 * fallback: the Buzz relay supports neither (its NIP-11 lists 29 and 17, not
 * 28 and 4), but a plain public relay supports these and not the Buzz set.
 */
export const KIND_DM = 4
export const KIND_CHANNEL_CREATE = 40
export const KIND_CHANNEL_MESSAGE = 42

export const KIND_AUTH = 22242
export const KIND_HTTP_AUTH = 27235

export type NostrTag = string[]

export type UnsignedEvent = {
  pubkey: string
  created_at: number
  kind: number
  tags: NostrTag[]
  content: string
}

export type NostrEvent = UnsignedEvent & { id: string; sig: string }

export type NostrFilter = {
  ids?: string[]
  authors?: string[]
  kinds?: number[]
  since?: number
  until?: number
  limit?: number
  /** Tag filters, e.g. `"#e"` / `"#p"`. */
  [tag: `#${string}`]: string[] | undefined
}

/* ------------------------------------------------------------- event core */

/**
 * NIP-01 canonical serialisation. The id is the sha256 of this exact array —
 * field order is normative, and JS `JSON.stringify` already produces the
 * escaping the spec requires.
 */
function serializeEvent(e: UnsignedEvent): string {
  return JSON.stringify([0, e.pubkey, e.created_at, e.kind, e.tags, e.content])
}

export function eventId(e: UnsignedEvent): string {
  return bytesToHex(sha256(utf8ToBytes(serializeEvent(e))))
}

/** Compute the id and BIP-340 signature, producing a publishable event. */
export function finalizeEvent(draft: Omit<UnsignedEvent, "pubkey">, sk: Uint8Array): NostrEvent {
  const unsigned: UnsignedEvent = { ...draft, pubkey: getPublicKey(sk) }
  const id = eventId(unsigned)
  const sig = bytesToHex(schnorr.sign(hexToBytes(id), sk))
  return { ...unsigned, id, sig }
}

/** Verify both the id binding and the signature. Cheap enough to run on read. */
export function verifyEvent(e: NostrEvent): boolean {
  try {
    if (eventId(e) !== e.id) return false
    return schnorr.verify(hexToBytes(e.sig), hexToBytes(e.id), hexToBytes(e.pubkey))
  } catch {
    return false
  }
}

/** Narrowing guard for whatever JSON a relay hands us. */
export function isNostrEvent(value: unknown): value is NostrEvent {
  if (!value || typeof value !== "object") return false
  const e = value as Partial<NostrEvent>
  return (
    typeof e.id === "string" &&
    typeof e.pubkey === "string" &&
    typeof e.sig === "string" &&
    typeof e.content === "string" &&
    typeof e.kind === "number" &&
    typeof e.created_at === "number" &&
    Array.isArray(e.tags)
  )
}

export function firstTag(e: { tags: NostrTag[] }, name: string): string | undefined {
  return e.tags.find((t) => t[0] === name)?.[1]
}

/* -------------------------------------------------------------------- keys */

export function getPublicKey(sk: Uint8Array): string {
  return bytesToHex(schnorr.getPublicKey(sk))
}

/**
 * Derive a secp256k1 secret key from a stable string.
 *
 * A raw sha256 digest is a valid scalar with overwhelming probability but not
 * certainty, so rehash until the curve accepts it.
 */
export function deriveSecretKey(seed: string): Uint8Array {
  let candidate = sha256(utf8ToBytes(seed))
  for (let i = 0; i < 8; i++) {
    try {
      schnorr.getPublicKey(candidate)
      return candidate
    } catch {
      candidate = sha256(candidate)
    }
  }
  throw new Error("Could not derive a valid chat key.")
}

export function randomSecretKey(): Uint8Array {
  for (let i = 0; i < 8; i++) {
    const candidate = Crypto.getRandomBytes(32)
    try {
      schnorr.getPublicKey(candidate)
      return candidate
    } catch {
      /* astronomically unlikely; draw again */
    }
  }
  throw new Error("Could not generate a chat key.")
}

/** NIP-19: the user-facing `npub1…` form of an x-only public key. */
export function npubEncode(pubkeyHex: string): string {
  // bech32's default 90-char limit is for Bitcoin addresses; NIP-19 has none.
  return bech32.encode("npub", bech32.toWords(hexToBytes(pubkeyHex)), 1000)
}

/** Short, recognisable form for dense UI: `npub1abcd…wxyz`. */
export function shortNpub(npub: string): string {
  return npub.length > 20 ? `${npub.slice(0, 10)}…${npub.slice(-6)}` : npub
}

export { bytesToHex, hexToBytes, utf8ToBytes }

/* ------------------------------------------------------------------ NIP-98 */

/**
 * Build the `Authorization` header for NIP-98 HTTP auth.
 *
 * A kind-27235 event signed by the caller, base64'd into the header. The `u`
 * and `method` tags bind the signature to one endpoint and verb; the `payload`
 * tag binds it to this exact request body, which Buzz's invite API *requires*
 * for POSTs (`verify_bridge_auth_with_options(..., require_payload = true)`).
 * Without it the relay answers 401 "payload tag SHA-256 mismatch".
 */
export function nip98AuthHeader(
  sk: Uint8Array,
  url: string,
  method: string,
  body?: string,
): string {
  const tags: NostrTag[] = [
    ["u", url],
    ["method", method],
  ]
  if (body !== undefined) tags.push(["payload", bytesToHex(sha256(utf8ToBytes(body)))])

  const event = finalizeEvent(
    { created_at: Math.floor(Date.now() / 1000), kind: KIND_HTTP_AUTH, tags, content: "" },
    sk,
  )
  return `Nostr ${base64.encode(utf8ToBytes(JSON.stringify(event)))}`
}

/* ------------------------------------------------------------------ NIP-04 */

/**
 * NIP-04 shared secret: ECDH between our secret key and their x-only key
 * (lifted to a compressed point with an even-Y `02` prefix), keeping only the
 * 32-byte X coordinate.
 *
 * NOTE: NIP-04 is deprecated in favour of NIP-17 gift-wrapped DMs, which hide
 * metadata (who talks to whom, and when) that NIP-04 leaks in plaintext tags.
 * NIP-04 is used here because every relay and client understands it and it
 * needs no extra event plumbing; NIP-17 is the upgrade path.
 */
function dmSharedSecret(sk: Uint8Array, theirPubkeyHex: string): Uint8Array {
  return secp256k1.getSharedSecret(sk, hexToBytes(`02${theirPubkeyHex}`)).subarray(1, 33)
}

export function nip04Encrypt(sk: Uint8Array, theirPubkey: string, text: string): string {
  const iv = Crypto.getRandomBytes(16)
  const ciphertext = cbc(dmSharedSecret(sk, theirPubkey), iv).encrypt(utf8ToBytes(text))
  return `${base64.encode(ciphertext)}?iv=${base64.encode(iv)}`
}

export function nip04Decrypt(sk: Uint8Array, theirPubkey: string, payload: string): string {
  const [ciphertext, iv] = payload.split("?iv=")
  if (!ciphertext || !iv) throw new Error("Malformed NIP-04 payload")
  const plaintext = cbc(dmSharedSecret(sk, theirPubkey), base64.decode(iv)).decrypt(
    base64.decode(ciphertext),
  )
  return bytesToUtf8(plaintext)
}

/* ------------------------------------------------------------------ NIP-28 */

/**
 * Deterministic room identity.
 *
 * A NIP-28 room is addressed by the *event id* of its kind-40 creation event.
 * We want every install of this app to land in the same rooms without a server
 * handing out ids, so we freeze every field of that kind-40 event — namespace
 * pubkey, timestamp, tags, content — which freezes its id. Any client can
 * recompute the id offline, and publishing the (identically-id'd) creation
 * event is idempotent because relays deduplicate by id.
 *
 * The namespace key below is deliberately public: it names the AI Socratic
 * community, it is not anybody's identity, and it signs nothing but these four
 * room-creation events.
 */
export const NAMESPACE_SECRET_KEY = deriveSecretKey("aisocratic:chat:namespace:v1")
export const NAMESPACE_PUBLIC_KEY = getPublicKey(NAMESPACE_SECRET_KEY)

/** Frozen so the derived room ids never move. Do not change. */
const CHANNEL_EPOCH = 1750000000

export function channelCreateEvent(slug: string, name: string, about: string): UnsignedEvent {
  return {
    pubkey: NAMESPACE_PUBLIC_KEY,
    created_at: CHANNEL_EPOCH,
    kind: KIND_CHANNEL_CREATE,
    tags: [["d", `aisocratic:${slug}`]],
    content: JSON.stringify({ name, about, picture: "" }),
  }
}

export function channelAddress(slug: string, name: string, about: string): string {
  return eventId(channelCreateEvent(slug, name, about))
}
