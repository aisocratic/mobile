import { discoveredDmChannel, isHexPubkey } from "./dm-discovery"
import { looksLikeRawKey } from "./profiles"
import { getPublicKey, randomSecretKey } from "./protocol"

describe("isHexPubkey", () => {
  it("accepts a real x-only pubkey", () => {
    expect(isHexPubkey(getPublicKey(randomSecretKey()))).toBe(true)
  })

  it("rejects uuids, uppercase hex and wrong lengths", () => {
    expect(isHexPubkey("54cc941c-66eb-4dae-baa0-a95bb4bc6282")).toBe(false)
    expect(isHexPubkey("A".repeat(64))).toBe(false)
    expect(isHexPubkey("ab".repeat(31))).toBe(false)
    expect(isHexPubkey("")).toBe(false)
  })
})

describe("discoveredDmChannel", () => {
  const peer = getPublicKey(randomSecretKey())

  it("routes and addresses the thread by the peer's own key", () => {
    const channel = discoveredDmChannel(peer)
    expect(channel.kind).toBe("dm")
    expect(channel.id).toBe(peer)
    expect(channel.address).toBe(peer)
  })

  it("names the thread with a short npub, never the raw hex", () => {
    const channel = discoveredDmChannel(peer)
    expect(channel.name).not.toContain(peer)
    expect(channel.name.startsWith("npub1")).toBe(true)
    // The display pipeline treats a raw key as unshowable; the fallback name
    // must not be mistaken for one, or displayChannel would re-derive it on
    // every render instead of treating it as a usable stored name.
    expect(looksLikeRawKey(peer)).toBe(true)
  })
})
