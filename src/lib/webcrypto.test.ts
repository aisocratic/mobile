import { digest } from "./webcrypto"

/**
 * These call `digest` directly rather than `globalThis.crypto.subtle.digest`.
 * Node (and therefore jest) already ships WebCrypto, so the shim doesn't
 * install there — asserting through the global would silently test the
 * platform's implementation instead of this one.
 */

const VECTORS: [string, string][] = [
  ["", "e3b0c44298fc1c149afbf4c8996fb92427ae41e4649b934ca495991b7852b855"],
  ["abc", "ba7816bf8f01cfea414140de5dae2223b00361a396177a9cb410ff61f20015ad"],
  [
    "The quick brown fox jumps over the lazy dog",
    "d7a8fbb307d7809469ca9abcb0082e4f8d5651e46d3cdb762d02d0bf37c9e592",
  ],
]

function hex(buffer: ArrayBuffer): string {
  return Array.from(new Uint8Array(buffer))
    .map((b) => b.toString(16).padStart(2, "0"))
    .join("")
}

describe("webcrypto digest shim", () => {
  it.each(VECTORS)("matches the SHA-256 vector for %p", async (input, expected) => {
    expect(hex(await digest("SHA-256", new TextEncoder().encode(input)))).toBe(expected)
  })

  it("accepts a lowercase name and the object form", async () => {
    const data = new TextEncoder().encode("abc")
    expect(hex(await digest("sha-256", data))).toBe(VECTORS[1][1])
    expect(hex(await digest({ name: "SHA-256" }, data))).toBe(VECTORS[1][1])
  })

  it("accepts a raw ArrayBuffer as well as a view", async () => {
    const view = new TextEncoder().encode("abc")
    const buffer = view.buffer.slice(view.byteOffset, view.byteOffset + view.byteLength)
    expect(hex(await digest("SHA-256", buffer as ArrayBuffer))).toBe(VECTORS[1][1])
  })

  it("hashes only the view's slice, not its whole backing buffer", async () => {
    // sha256() over the wrong byte range would still return a plausible digest,
    // so this is the failure mode most likely to go unnoticed.
    const backing = new TextEncoder().encode("XXXabcXXX")
    const view = new Uint8Array(backing.buffer, 3, 3)
    expect(hex(await digest("SHA-256", view))).toBe(VECTORS[1][1])
  })

  it("rejects algorithms it cannot honour instead of returning a wrong digest", async () => {
    await expect(digest("SHA-1", new TextEncoder().encode("abc"))).rejects.toThrow(/unsupported/i)
  })
})
