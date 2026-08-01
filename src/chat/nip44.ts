/**
 * NIP-44 v2 encrypted payloads.
 *
 * This is the encryption layer NIP-17 private DMs are built on, and the reason
 * the app can drop NIP-04: the Buzz relay advertises NIP-17 and does not
 * support NIP-04 at all.
 *
 * Scheme (v2), all of it load-bearing:
 *   conversation_key = HKDF-Extract(IKM = ECDH-X(sk, pk), salt = "nip44-v2")
 *   message_keys     = HKDF-Expand(conversation_key, info = nonce, L = 76)
 *                      -> chacha_key[32] | chacha_nonce[12] | hmac_key[32]
 *   padded           = u16be(len) | plaintext | zeros   (power-of-two buckets)
 *   ciphertext       = ChaCha20(chacha_key, chacha_nonce, padded)
 *   mac              = HMAC-SHA256(hmac_key, nonce | ciphertext)
 *   payload          = base64( 0x02 | nonce[32] | ciphertext | mac[32] )
 *
 * The padding scheme is not cosmetic — it hides message length, which is most
 * of the metadata a passive observer could otherwise recover. The MAC covers
 * the nonce as associated data, so a payload cannot be replayed under a
 * different nonce.
 *
 * Verified against the official test vectors (github.com/paulmillr/nip44):
 * conversation keys, message keys, padding lengths, encrypt/decrypt round
 * trips, and the invalid-input cases.
 */

import { chacha20 } from "@noble/ciphers/chacha.js"
import { secp256k1 } from "@noble/curves/secp256k1.js"
import { extract as hkdfExtract, expand as hkdfExpand } from "@noble/hashes/hkdf.js"
import { hmac } from "@noble/hashes/hmac.js"
import { sha256 } from "@noble/hashes/sha2.js"
import { bytesToHex, concatBytes, hexToBytes, utf8ToBytes } from "@noble/hashes/utils.js"
import { base64 } from "@scure/base"

const VERSION = 2
const SALT = utf8ToBytes("nip44-v2")
const MIN_PLAINTEXT = 1
const MAX_PLAINTEXT = 65535

/**
 * Long-term shared secret for a pair of keys. Deriving this is the expensive
 * part (one ECDH), so callers that send repeatedly should cache it.
 */
export function conversationKey(sk: Uint8Array, theirPubkeyHex: string): Uint8Array {
  // x-only pubkeys are lifted to a compressed point with an even-Y prefix,
  // then we keep only the X coordinate of the shared point.
  const shared = secp256k1.getSharedSecret(sk, hexToBytes(`02${theirPubkeyHex}`)).subarray(1, 33)
  return hkdfExtract(sha256, shared, SALT)
}

type MessageKeys = { chachaKey: Uint8Array; chachaNonce: Uint8Array; hmacKey: Uint8Array }

function messageKeys(convKey: Uint8Array, nonce: Uint8Array): MessageKeys {
  const keys = hkdfExpand(sha256, convKey, nonce, 76)
  return {
    chachaKey: keys.subarray(0, 32),
    chachaNonce: keys.subarray(32, 44),
    hmacKey: keys.subarray(44, 76),
  }
}

/**
 * Pad to a power-of-two-ish bucket so ciphertext length leaks as little as
 * possible about plaintext length. Transcribed from the NIP-44 spec.
 */
export function calcPaddedLen(len: number): number {
  if (len <= 32) return 32
  const nextPower = 1 << (Math.floor(Math.log2(len - 1)) + 1)
  const chunk = nextPower <= 256 ? 32 : nextPower / 8
  return chunk * (Math.floor((len - 1) / chunk) + 1)
}

function pad(plaintext: string): Uint8Array {
  const bytes = utf8ToBytes(plaintext)
  if (bytes.length < MIN_PLAINTEXT || bytes.length > MAX_PLAINTEXT) {
    throw new Error(`NIP-44: plaintext must be 1..${MAX_PLAINTEXT} bytes`)
  }
  const prefix = new Uint8Array(2)
  new DataView(prefix.buffer).setUint16(0, bytes.length, false) // big endian
  const padding = new Uint8Array(calcPaddedLen(bytes.length) - bytes.length)
  return concatBytes(prefix, bytes, padding)
}

function unpad(padded: Uint8Array): string {
  const declared = new DataView(padded.buffer, padded.byteOffset, padded.byteLength).getUint16(
    0,
    false,
  )
  const text = padded.subarray(2, 2 + declared)
  // Both checks matter: a forged length prefix must not let a peer address a
  // slice outside the padded region or disagree with the declared bucket.
  if (
    declared < MIN_PLAINTEXT ||
    text.length !== declared ||
    padded.length !== 2 + calcPaddedLen(declared)
  ) {
    throw new Error("NIP-44: invalid padding")
  }
  return new TextDecoder().decode(text)
}

/** Encrypt with an explicit nonce. Exposed so the test vectors can pin it. */
export function encryptWithNonce(
  plaintext: string,
  convKey: Uint8Array,
  nonce: Uint8Array,
): string {
  const { chachaKey, chachaNonce, hmacKey } = messageKeys(convKey, nonce)
  const ciphertext = chacha20(chachaKey, chachaNonce, pad(plaintext))
  // The nonce is authenticated as associated data, not just transmitted.
  const mac = hmac(sha256, hmacKey, concatBytes(nonce, ciphertext))
  return base64.encode(concatBytes(new Uint8Array([VERSION]), nonce, ciphertext, mac))
}

export function nip44Encrypt(plaintext: string, convKey: Uint8Array, nonce: Uint8Array): string {
  return encryptWithNonce(plaintext, convKey, nonce)
}

export function nip44Decrypt(payload: string, convKey: Uint8Array): string {
  if (payload.startsWith("#")) throw new Error("NIP-44: unsupported payload version")

  const data = base64.decode(payload)
  // 1 version + 32 nonce + 32 min ciphertext + 32 mac
  if (data.length < 99 || data.length > 65603) throw new Error("NIP-44: invalid payload size")
  if (data[0] !== VERSION) throw new Error(`NIP-44: unknown version ${data[0]}`)

  const nonce = data.subarray(1, 33)
  const ciphertext = data.subarray(33, data.length - 32)
  const mac = data.subarray(data.length - 32)

  const { chachaKey, chachaNonce, hmacKey } = messageKeys(convKey, nonce)
  const expected = hmac(sha256, hmacKey, concatBytes(nonce, ciphertext))
  // Constant-time-ish compare; a mismatch means tampering, not a bad password,
  // so there is nothing useful to distinguish in the error.
  if (bytesToHex(expected) !== bytesToHex(mac)) throw new Error("NIP-44: invalid MAC")

  return unpad(chacha20(chachaKey, chachaNonce, ciphertext))
}
