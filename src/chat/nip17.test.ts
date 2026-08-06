import {
  buildRumor,
  giftWrap,
  MAX_TIME_JITTER_SECONDS,
  unwrapGift,
  wrapForBoth,
} from "./nip17"
import { conversationKey, nip44Decrypt } from "./nip44"
import { deriveSecretKey, getPublicKey, type NostrEvent } from "./protocol"

/**
 * The timestamp rules that keep DMs deliverable on a strict relay:
 *
 *   - the rumor (what the recipient displays) carries the true current time;
 *   - the seal and wrap are jittered into the past for privacy, but only
 *     within a window a relay that polices created_at still accepts;
 *   - a retry after a timestamp rejection can re-wrap with a clock-skew
 *     offset and no jitter, without the rumor moving at all.
 */

const SENDER_SK = deriveSecretKey("aisocratic:test:nip17:sender")
const RECIPIENT_SK = deriveSecretKey("aisocratic:test:nip17:recipient")
const SENDER = getPublicKey(SENDER_SK)
const RECIPIENT = getPublicKey(RECIPIENT_SK)

const NOW_MS = 1_754_000_000_000
const NOW = Math.floor(NOW_MS / 1000)

/** The seal is NIP-44 ciphertext inside the wrap; open it to read its clock. */
function sealOf(wrap: NostrEvent): NostrEvent {
  return JSON.parse(
    nip44Decrypt(wrap.content, conversationKey(RECIPIENT_SK, wrap.pubkey)),
  ) as NostrEvent
}

beforeEach(() => {
  jest.spyOn(Date, "now").mockReturnValue(NOW_MS)
})

afterEach(() => {
  jest.restoreAllMocks()
})

describe("buildRumor", () => {
  it("stamps the rumor with the real current time, never jittered", () => {
    const rumor = buildRumor(SENDER, RECIPIENT, "hello")
    expect(rumor.created_at).toBe(NOW)
  })
})

describe("giftWrap timestamps", () => {
  it("keeps the jitter window small enough for a strict relay", () => {
    // 15 minutes: far inside any plausible created_at window, still wide
    // enough that arrival time doesn't pinpoint the send.
    expect(MAX_TIME_JITTER_SECONDS).toBeLessThanOrEqual(15 * 60)
  })

  it("backdates seal and wrap only within the bounded window", () => {
    const rumor = buildRumor(SENDER, RECIPIENT, "hello")
    // The jitter is random per event, so sample it.
    for (let i = 0; i < 25; i++) {
      const wrap = giftWrap(rumor, SENDER_SK, RECIPIENT)
      const seal = sealOf(wrap)
      for (const createdAt of [wrap.created_at, seal.created_at]) {
        expect(createdAt).toBeLessThanOrEqual(NOW)
        expect(createdAt).toBeGreaterThan(NOW - MAX_TIME_JITTER_SECONDS)
      }
    }
  })

  it("never touches the rumor's timestamp while jittering the layers around it", () => {
    const rumor = buildRumor(SENDER, RECIPIENT, "hello")
    const wrap = giftWrap(rumor, SENDER_SK, RECIPIENT)
    const unwrapped = unwrapGift(wrap, RECIPIENT_SK)
    expect(unwrapped?.created_at).toBe(NOW)
    expect(unwrapped?.content).toBe("hello")
  })

  it("applies a clock-skew offset exactly when jitter is disabled", () => {
    const rumor = buildRumor(SENDER, RECIPIENT, "hello")
    const wrap = giftWrap(rumor, SENDER_SK, RECIPIENT, { skewSeconds: 120, jitterSeconds: 0 })
    const seal = sealOf(wrap)
    // Deterministic: this is the "retry with the relay's clock" shape.
    expect(wrap.created_at).toBe(NOW + 120)
    expect(seal.created_at).toBe(NOW + 120)
    // The recipient still sees the true send time.
    expect(unwrapGift(wrap, RECIPIENT_SK)?.created_at).toBe(NOW)
  })

  it("jitters within the window even when the clock is skewed backwards", () => {
    const rumor = buildRumor(SENDER, RECIPIENT, "hello")
    const wrap = giftWrap(rumor, SENDER_SK, RECIPIENT, { skewSeconds: -60 })
    expect(wrap.created_at).toBeLessThanOrEqual(NOW - 60)
    expect(wrap.created_at).toBeGreaterThan(NOW - 60 - MAX_TIME_JITTER_SECONDS)
  })
})

describe("wrapForBoth", () => {
  it("passes the timestamp policy to both copies", () => {
    const rumor = buildRumor(SENDER, RECIPIENT, "hello")
    const wraps = wrapForBoth(rumor, SENDER_SK, RECIPIENT, {
      skewSeconds: 45,
      jitterSeconds: 0,
    })
    expect(wraps).toHaveLength(2)
    for (const wrap of wraps) expect(wrap.created_at).toBe(NOW + 45)
  })
})
