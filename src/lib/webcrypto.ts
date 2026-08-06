import "react-native-get-random-values"

import { sha256 } from "@noble/hashes/sha2.js"

/**
 * Minimal `crypto.subtle.digest` for Hermes.
 *
 * Hermes ships no WebCrypto, and `src/lib/gotrue.ts` needs
 * `crypto.subtle.digest("SHA-256", …)` to build the PKCE S256 code challenge.
 * Without it the only alternative would be the `plain` challenge method —
 * which sends the verifier itself as the challenge, throws away most of what
 * PKCE is for, and is rejected by some authorization servers outright.
 * (@supabase/auth-js, which this shim originally served, silently fell back
 * to `plain`; our client has no such fallback — S256 or nothing.)
 *
 * SHA-256 is the only algorithm the PKCE flow asks for, so that is all we
 * implement: a narrow shim is easier to reason about than a full WebCrypto
 * polyfill. `react-native-get-random-values` (imported above) supplies
 * `crypto.getRandomValues`, the other half the flow needs.
 */

type Digestible = ArrayBuffer | ArrayBufferView

function toBytes(data: Digestible): Uint8Array {
  if (data instanceof ArrayBuffer) return new Uint8Array(data)
  return new Uint8Array(data.buffer, data.byteOffset, data.byteLength)
}

/**
 * Exported so it can be tested directly. Testing through `globalThis.crypto`
 * is misleading: any environment that already has WebCrypto (Node under jest,
 * for instance) skips the install below, and the assertions then exercise the
 * platform rather than this code.
 */
export async function digest(
  algorithm: AlgorithmIdentifier,
  data: Digestible,
): Promise<ArrayBuffer> {
  const name = typeof algorithm === "string" ? algorithm : algorithm.name
  if (name.toUpperCase() !== "SHA-256") {
    throw new Error(`webcrypto shim: unsupported digest algorithm "${name}"`)
  }

  const hash = sha256(toBytes(data))
  // Return a standalone ArrayBuffer — callers expect to own the result.
  return hash.buffer.slice(hash.byteOffset, hash.byteOffset + hash.byteLength) as ArrayBuffer
}

/** True when this module supplied `crypto.subtle` rather than the platform. */
export const installed = (() => {
  const globalRef = globalThis as typeof globalThis & { crypto?: Crypto }

  if (typeof globalRef.crypto === "undefined") {
    Object.defineProperty(globalRef, "crypto", { value: {}, configurable: true, writable: true })
  }

  if (typeof globalRef.crypto.subtle !== "undefined") return false

  Object.defineProperty(globalRef.crypto, "subtle", {
    value: { digest },
    configurable: true,
    writable: true,
  })
  return true
})()
