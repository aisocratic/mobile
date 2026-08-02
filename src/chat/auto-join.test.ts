import { base64 } from "@scure/base"

import { deriveSecretKey, getPublicKey, verifyEvent, type NostrEvent } from "./protocol"

/**
 * Auto-join replaces "paste this code" with "we'll get you in", and the risk in
 * that trade is doing it by cutting a corner the relay is actually asking about.
 *
 * So these assert the boundaries as much as the happy path:
 *
 *   - the request that fetches an invite carries the user's Supabase JWT, which
 *     is the only thing making it an authenticated mint rather than a public one;
 *   - `age_confirmed` is FORWARDED, never hardcoded — the relay asks a person a
 *     question, and a hardcoded `true` is a forged answer, not a satisfied one;
 *   - a build with no join endpoint fails cleanly so the pasted-code path can
 *     take over, rather than throwing something the UI has to guess at.
 */

const JOIN_URL = "https://aisocratic.org/api/buzz/join"
const RELAY = "wss://community.example"
const SK = deriveSecretKey("aisocratic:test:autojoin")
const PUBKEY = getPublicKey(SK)
const TOKEN = "eyJhbGciOiJIUzI1NiJ9.test-session-jwt.signature"
const CODE = "v2.abcdefghijklmnopqrstuvwxyz012345"

type Captured = { url: string; init: RequestInit }

/**
 * Load ./buzz with a chosen `EXPO_PUBLIC_BUZZ_JOIN_URL`. The module reads it at
 * import time (Metro inlines these), so configured and unconfigured builds are
 * genuinely different modules rather than a runtime flag.
 */
function loadBuzz(joinUrl: string | null): typeof import("./buzz") {
  jest.resetModules()
  if (joinUrl) process.env.EXPO_PUBLIC_BUZZ_JOIN_URL = joinUrl
  else delete process.env.EXPO_PUBLIC_BUZZ_JOIN_URL
  // eslint-disable-next-line @typescript-eslint/no-require-imports
  return require("./buzz") as typeof import("./buzz")
}

/** Route by URL so a whole join sequence can be exercised in one test. */
function routeFetch(routes: Record<string, { ok?: boolean; status?: number; body: unknown }>): {
  calls: Captured[]
} {
  const calls: Captured[] = []
  global.fetch = jest.fn(async (url: string, init: RequestInit = {}) => {
    calls.push({ url, init })
    const match = Object.keys(routes).find((key) => url.includes(key))
    if (!match) throw new Error(`unexpected request to ${url}`)
    const route = routes[match]
    return {
      ok: route.ok ?? true,
      status: route.status ?? 200,
      text: async () => JSON.stringify(route.body),
    }
  }) as unknown as typeof fetch
  return { calls }
}

const FULL_JOIN_ROUTES = {
  "/api/buzz/join": { body: { code: CODE, expires_at: 1_800_000_000 } },
  "/api/join-policy": {
    body: { policy: { version: "2026-01", age_attestation_required: true } },
  },
  "/api/invites/accept-policy": { body: { receipt: "receipt-abc" } },
  "/api/invites/claim": {
    body: { status: "joined", community_id: "community-1", role: "member" },
  },
}

function find(calls: Captured[], fragment: string): Captured | undefined {
  return calls.find((c) => c.url.includes(fragment))
}

function authEvent(captured: Captured): NostrEvent {
  const header = (captured.init.headers as Record<string, string>).authorization
  return JSON.parse(new TextDecoder().decode(base64.decode(header.slice(6)))) as NostrEvent
}

afterEach(() => {
  jest.restoreAllMocks()
})

describe("requestAutoInvite", () => {
  it("authenticates the mint with the user's Supabase session", async () => {
    const buzz = loadBuzz(JOIN_URL)
    const { calls } = routeFetch(FULL_JOIN_ROUTES)

    const code = await buzz.requestAutoInvite(TOKEN, PUBKEY)

    expect(code).toBe(CODE)
    const request = find(calls, "/api/buzz/join")!
    const headers = request.init.headers as Record<string, string>
    // Without this the endpoint is a public invite dispenser.
    expect(headers.authorization).toBe(`Bearer ${TOKEN}`)
    expect(JSON.parse(request.init.body as string)).toEqual({ nostr_pubkey: PUBKEY })
  })

  it("reports auto-join as unconfigured when no endpoint is set", async () => {
    const buzz = loadBuzz(null)
    global.fetch = jest.fn() as unknown as typeof fetch

    expect(buzz.autoJoinConfigured()).toBe(false)
    await expect(buzz.requestAutoInvite(TOKEN, PUBKEY)).rejects.toMatchObject({
      code: "auto_join_unavailable",
    })
    // Nothing was attempted — the UI falls straight through to asking for a code.
    expect(global.fetch).not.toHaveBeenCalled()
  })

  it("surfaces the server's own error code", async () => {
    const buzz = loadBuzz(JOIN_URL)
    routeFetch({
      "/api/buzz/join": { ok: false, status: 403, body: { error: "email_unconfirmed" } },
    })

    await expect(buzz.requestAutoInvite(TOKEN, PUBKEY)).rejects.toMatchObject({
      code: "email_unconfirmed",
      message: "Confirm your email address before joining the community.",
    })
  })

  it("distinguishes an unreachable server from a refused request", async () => {
    const buzz = loadBuzz(JOIN_URL)
    global.fetch = jest.fn(async () => {
      throw new TypeError("Network request failed")
    }) as unknown as typeof fetch

    await expect(buzz.requestAutoInvite(TOKEN, PUBKEY)).rejects.toMatchObject({
      code: "auto_join_unreachable",
    })
  })
})

describe("joinCommunityAutomatically", () => {
  it("mints a code and redeems it in one pass", async () => {
    const buzz = loadBuzz(JOIN_URL)
    const { calls } = routeFetch(FULL_JOIN_ROUTES)

    const result = await buzz.joinCommunityAutomatically(RELAY, SK, TOKEN, PUBKEY, true)

    expect(result).toMatchObject({ status: "joined", communityId: "community-1", role: "member" })
    expect(find(calls, "/api/buzz/join")).toBeDefined()
    expect(find(calls, "/api/invites/accept-policy")).toBeDefined()
    expect(find(calls, "/api/invites/claim")).toBeDefined()
  })

  it("claims with the joining key, not the server's", async () => {
    const buzz = loadBuzz(JOIN_URL)
    const { calls } = routeFetch(FULL_JOIN_ROUTES)

    await buzz.joinCommunityAutomatically(RELAY, SK, TOKEN, PUBKEY, true)

    // The whole point of minting server-side and claiming client-side: the key
    // that gets admitted is the one on this device, and it proves that itself.
    const claim = find(calls, "/api/invites/claim")!
    const event = authEvent(claim)
    expect(event.pubkey).toBe(PUBKEY)
    expect(verifyEvent(event)).toBe(true)
  })

  it("forwards the user's attestation instead of asserting one", async () => {
    const buzz = loadBuzz(JOIN_URL)
    const { calls } = routeFetch(FULL_JOIN_ROUTES)

    await buzz.joinCommunityAutomatically(RELAY, SK, TOKEN, PUBKEY, true)

    const accept = find(calls, "/api/invites/accept-policy")!
    expect(JSON.parse(accept.init.body as string)).toEqual({
      code: CODE,
      policy_version: "2026-01",
      age_confirmed: true,
    })
  })

  it("refuses to join unattested, without spending the invite", async () => {
    const buzz = loadBuzz(JOIN_URL)
    const { calls } = routeFetch(FULL_JOIN_ROUTES)

    // The community requires an age attestation and the user has not given one.
    // Automating the code must not automate the answer.
    await expect(
      buzz.joinCommunityAutomatically(RELAY, SK, TOKEN, PUBKEY, false),
    ).rejects.toMatchObject({ code: "join_policy_not_accepted" })

    expect(find(calls, "/api/invites/accept-policy")).toBeUndefined()
    expect(find(calls, "/api/invites/claim")).toBeUndefined()
  })
})
