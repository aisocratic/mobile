import { sha256 } from "@noble/hashes/sha2.js"
import { bytesToHex, utf8ToBytes } from "@noble/hashes/utils.js"
import { base64 } from "@scure/base"

import { BuzzApiError, INVITE_LIMITS, mintInvite } from "./buzz"
import { deriveSecretKey, getPublicKey, verifyEvent, type NostrEvent } from "./protocol"

/**
 * Minting is the one call in this app that a server authorizes by *role*, and
 * the only thing standing between the request and a 401 is a NIP-98 event whose
 * `u`, `method` and `payload` tags all bind to the exact request being made.
 * Buzz verifies with `require_payload = true`, so a body that is re-serialised
 * after signing — the obvious refactor — fails with "payload tag SHA-256
 * mismatch". These assert the binding rather than just the happy-path shape.
 */

const RELAY = "wss://community.example"
const SK = deriveSecretKey("aisocratic:test:mint")

type Captured = { url: string; init: RequestInit }

function mockFetch(response: { ok: boolean; status: number; body: unknown }): {
  calls: Captured[]
} {
  const calls: Captured[] = []
  global.fetch = jest.fn(async (url: string, init: RequestInit) => {
    calls.push({ url, init })
    return {
      ok: response.ok,
      status: response.status,
      text: async () => JSON.stringify(response.body),
    }
  }) as unknown as typeof fetch
  return { calls }
}

const MINTED = {
  code: "v2.abcdefghijklmnopqrstuvwxyz012345",
  expires_at: 1_800_000_000,
  max_uses: 10,
  uses_remaining: 10,
  url: "https://community.example/invite/v2.abcdefghijklmnopqrstuvwxyz012345",
}

function ok(body: unknown = MINTED) {
  return mockFetch({ ok: true, status: 200, body })
}

/** Pull the signed kind-27235 event back out of the Authorization header. */
function authEvent(captured: Captured): NostrEvent {
  const header = (captured.init.headers as Record<string, string>).authorization
  expect(header.startsWith("Nostr ")).toBe(true)
  return JSON.parse(new TextDecoder().decode(base64.decode(header.slice(6)))) as NostrEvent
}

function tag(event: NostrEvent, name: string): string | undefined {
  return event.tags.find((t) => t[0] === name)?.[1]
}

describe("mintInvite", () => {
  afterEach(() => {
    jest.restoreAllMocks()
  })

  it("posts to the relay's HTTPS origin, not its socket URL", async () => {
    const { calls } = ok()
    await mintInvite(RELAY, SK, { ttlSecs: 3600, maxUses: 10 })
    expect(calls[0].url).toBe("https://community.example/api/invites")
    expect(calls[0].init.method).toBe("POST")
  })

  it("signs a NIP-98 event bound to this URL, method and body", async () => {
    const { calls } = ok()
    await mintInvite(RELAY, SK, { ttlSecs: 3600, maxUses: 10 })

    const event = authEvent(calls[0])
    expect(verifyEvent(event)).toBe(true)
    expect(event.kind).toBe(27235)
    expect(event.pubkey).toBe(getPublicKey(SK))
    expect(tag(event, "u")).toBe("https://community.example/api/invites")
    expect(tag(event, "method")).toBe("POST")

    // The payload tag must hash the bytes actually sent — not an equivalent
    // re-serialisation of them.
    const sent = calls[0].init.body as string
    expect(tag(event, "payload")).toBe(bytesToHex(sha256(utf8ToBytes(sent))))
  })

  it("sends the chosen lifetime and use limit", async () => {
    const { calls } = ok()
    await mintInvite(RELAY, SK, { ttlSecs: 7 * 24 * 3600, maxUses: 50 })
    expect(JSON.parse(calls[0].init.body as string)).toEqual({
      ttl_secs: 604800,
      max_uses: 50,
    })
  })

  it("spells unlimited uses as an explicit null", async () => {
    const { calls } = ok({ ...MINTED, max_uses: null, uses_remaining: null })
    const invite = await mintInvite(RELAY, SK, { ttlSecs: 3600, maxUses: null })

    // Buzz treats an omitted key and a null the same way, but sending the key
    // keeps "unlimited" a choice the caller made rather than one they forgot.
    expect(JSON.parse(calls[0].init.body as string)).toHaveProperty("max_uses", null)
    expect(invite.maxUses).toBeNull()
  })

  it("returns the code, expiry and shareable link", async () => {
    ok()
    const invite = await mintInvite(RELAY, SK, { ttlSecs: 3600, maxUses: 10 })
    expect(invite).toEqual({
      code: MINTED.code,
      expiresAt: MINTED.expires_at,
      maxUses: 10,
      usesRemaining: 10,
      url: MINTED.url,
    })
  })

  it("builds the landing URL itself if the relay omits one", async () => {
    ok({ code: MINTED.code, expires_at: MINTED.expires_at, max_uses: 1, uses_remaining: 1 })
    const invite = await mintInvite(RELAY, SK, { ttlSecs: 3600, maxUses: 1 })
    expect(invite.url).toBe(`https://community.example/invite/${MINTED.code}`)
  })

  it.each([
    ["a lifetime under the relay's floor", { ttlSecs: 30, maxUses: 1 }],
    ["a lifetime over the relay's ceiling", { ttlSecs: INVITE_LIMITS.maxTtlSecs + 1, maxUses: 1 }],
    ["zero uses", { ttlSecs: 3600, maxUses: 0 }],
    ["more uses than the relay allows", { ttlSecs: 3600, maxUses: INVITE_LIMITS.maxUses + 1 }],
  ])("rejects %s without spending a signed request", async (_label, options) => {
    const { calls } = ok()
    await expect(mintInvite(RELAY, SK, options)).rejects.toBeInstanceOf(BuzzApiError)
    expect(calls).toHaveLength(0)
  })

  it("turns the relay's 403 into something the person can act on", async () => {
    mockFetch({
      ok: false,
      status: 403,
      body: { error: "only relay owners and admins can create invites" },
    })
    await expect(mintInvite(RELAY, SK, { ttlSecs: 3600, maxUses: 1 })).rejects.toThrow(
      /owners and admins/i,
    )
  })

  it("fails loudly when the relay returns no code", async () => {
    ok({ expires_at: MINTED.expires_at })
    await expect(mintInvite(RELAY, SK, { ttlSecs: 3600, maxUses: 1 })).rejects.toThrow(
      /didn't return a code/i,
    )
  })
})
