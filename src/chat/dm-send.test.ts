import { estimateClockSkew, isTimestampRejection, publishWrappedDm } from "./dm-send"
import { buildRumor, unwrapGift } from "./nip17"
import { deriveSecretKey, getPublicKey, type NostrEvent } from "./protocol"

/**
 * The Buzz relay rejects events whose created_at falls outside its window
 * ("invalid: event timestamp too far from server time"), which a jittered
 * wrap or a wrong device clock can both trigger. These pin the recovery
 * contract: exactly one transparent retry with corrected timestamps, and a
 * real error only after that retry also fails.
 */

const SENDER_SK = deriveSecretKey("aisocratic:test:dmsend:sender")
const RECIPIENT_SK = deriveSecretKey("aisocratic:test:dmsend:recipient")
const SENDER = getPublicKey(SENDER_SK)
const RECIPIENT = getPublicKey(RECIPIENT_SK)

const NOW_MS = 1_754_000_000_000
const NOW = Math.floor(NOW_MS / 1000)

const TIMESTAMP_REJECTION = new Error("invalid: event timestamp too far from server time")

type FakeRelay = {
  publish: jest.Mock<Promise<void>, [NostrEvent]>
  publishQuietly: jest.Mock<void, [NostrEvent]>
}

function fakeRelay(...outcomes: (Error | null)[]): FakeRelay {
  const publish = jest.fn<Promise<void>, [NostrEvent]>(() => {
    const outcome = outcomes.shift() ?? null
    return outcome ? Promise.reject(outcome) : Promise.resolve()
  })
  return { publish, publishQuietly: jest.fn() }
}

beforeEach(() => {
  jest.spyOn(Date, "now").mockReturnValue(NOW_MS)
})

afterEach(() => {
  jest.restoreAllMocks()
})

describe("isTimestampRejection", () => {
  it.each([
    "invalid: event timestamp too far from server time",
    "invalid: created_at too far off",
    "created-at outside window",
  ])("recognises %j", (message) => {
    expect(isTimestampRejection(message)).toBe(true)
  })

  it.each(["restricted: not a relay member", "rate-limited: slow down", "error: too big"])(
    "does not misread %j",
    (message) => {
      expect(isTimestampRejection(message)).toBe(false)
    },
  )
})

describe("publishWrappedDm", () => {
  it("publishes the recipient's wrap and fires the self copy quietly", async () => {
    const relay = fakeRelay()
    const rumor = buildRumor(SENDER, RECIPIENT, "hi")

    await publishWrappedDm({ relay, rumor, sk: SENDER_SK, recipient: RECIPIENT })

    expect(relay.publish).toHaveBeenCalledTimes(1)
    expect(relay.publishQuietly).toHaveBeenCalledTimes(1)
    // The awaited copy is the one addressed to the recipient.
    const sent = relay.publish.mock.calls[0][0]
    expect(sent.tags).toContainEqual(["p", RECIPIENT])
    expect(unwrapGift(sent, RECIPIENT_SK)?.content).toBe("hi")
  })

  it("retries exactly once with skewed, unjittered timestamps after a timestamp rejection", async () => {
    const relay = fakeRelay(TIMESTAMP_REJECTION, null)
    const rumor = buildRumor(SENDER, RECIPIENT, "hi")
    const estimateSkew = jest.fn(async () => 300)

    await publishWrappedDm({ relay, rumor, sk: SENDER_SK, recipient: RECIPIENT, estimateSkew })

    expect(relay.publish).toHaveBeenCalledTimes(2)
    expect(estimateSkew).toHaveBeenCalledTimes(1)

    // The retry is stamped at the relay's clock, with the jitter disabled.
    const retried = relay.publish.mock.calls[1][0]
    expect(retried.created_at).toBe(NOW + 300)

    // Same message underneath: the rumor's id and true send time survive.
    const unwrapped = unwrapGift(retried, RECIPIENT_SK)
    expect(unwrapped?.id).toBe(rumor.id)
    expect(unwrapped?.created_at).toBe(NOW)

    // The self copy is only sent for an attempt that landed.
    expect(relay.publishQuietly).toHaveBeenCalledTimes(1)
  })

  it("falls back to plain current time when no skew estimate is available", async () => {
    const relay = fakeRelay(TIMESTAMP_REJECTION, null)
    const rumor = buildRumor(SENDER, RECIPIENT, "hi")

    await publishWrappedDm({ relay, rumor, sk: SENDER_SK, recipient: RECIPIENT })

    expect(relay.publish).toHaveBeenCalledTimes(2)
    expect(relay.publish.mock.calls[1][0].created_at).toBe(NOW)
  })

  it("retries even when the skew estimator itself blows up", async () => {
    const relay = fakeRelay(TIMESTAMP_REJECTION, null)
    const rumor = buildRumor(SENDER, RECIPIENT, "hi")
    const estimateSkew = jest.fn(async (): Promise<number> => {
      throw new Error("offline")
    })

    await publishWrappedDm({ relay, rumor, sk: SENDER_SK, recipient: RECIPIENT, estimateSkew })

    expect(relay.publish).toHaveBeenCalledTimes(2)
    expect(relay.publish.mock.calls[1][0].created_at).toBe(NOW)
  })

  it("surfaces the error when the corrected retry also fails, and stops there", async () => {
    const relay = fakeRelay(TIMESTAMP_REJECTION, TIMESTAMP_REJECTION, null)
    const rumor = buildRumor(SENDER, RECIPIENT, "hi")

    await expect(
      publishWrappedDm({
        relay,
        rumor,
        sk: SENDER_SK,
        recipient: RECIPIENT,
        estimateSkew: async () => 0,
      }),
    ).rejects.toThrow(/timestamp/)

    // One retry, never a second — a relay that still says no means it.
    expect(relay.publish).toHaveBeenCalledTimes(2)
    expect(relay.publishQuietly).not.toHaveBeenCalled()
  })

  it("does not retry rejections that are not about time", async () => {
    const denial = new Error("restricted: not a relay member")
    const relay = fakeRelay(denial)
    const rumor = buildRumor(SENDER, RECIPIENT, "hi")
    const estimateSkew = jest.fn(async () => 0)

    await expect(
      publishWrappedDm({ relay, rumor, sk: SENDER_SK, recipient: RECIPIENT, estimateSkew }),
    ).rejects.toThrow(/not a relay member/)

    expect(relay.publish).toHaveBeenCalledTimes(1)
    expect(estimateSkew).not.toHaveBeenCalled()
  })
})

describe("estimateClockSkew", () => {
  afterEach(() => {
    jest.restoreAllMocks()
  })

  function mockNip11(headers: Record<string, string>) {
    global.fetch = jest.fn(async () => ({
      ok: true,
      headers: { get: (name: string) => headers[name.toLowerCase()] ?? null },
      json: async () => ({}),
    })) as unknown as typeof fetch
    return global.fetch as jest.Mock
  }

  it("reads the relay's clock from the NIP-11 endpoint's Date header", async () => {
    // Server clock five minutes ahead of the (mocked) device clock.
    const fetchMock = mockNip11({ date: new Date(NOW_MS + 300_000).toUTCString() })

    await expect(estimateClockSkew("wss://relay.example")).resolves.toBe(300)
    expect(fetchMock).toHaveBeenCalledWith("https://relay.example", {
      headers: { accept: "application/nostr+json" },
    })
  })

  it("reports zero when the server sends no Date header", async () => {
    mockNip11({})
    await expect(estimateClockSkew("wss://relay.example")).resolves.toBe(0)
  })

  it("reports zero when the relay is unreachable", async () => {
    global.fetch = jest.fn(async () => {
      throw new Error("network down")
    }) as unknown as typeof fetch
    await expect(estimateClockSkew("wss://relay.example")).resolves.toBe(0)
  })
})
