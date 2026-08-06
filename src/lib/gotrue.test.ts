import { createGotrue, parseStoredSession, type AuthChangeEvent, type Session } from "./gotrue"
import type { StorageAdapter } from "./session-storage"

/**
 * What these tests pin down, in order of how much it would hurt to break:
 *
 *   - session migration: a blob written by @supabase/supabase-js (the exact
 *     key and shape the previous client persisted) restores without a
 *     network call — nobody is logged out by the upgrade;
 *   - refresh with rotation: the rotated refresh token is persisted, refresh
 *     is deduplicated, and a rejected grant signs the user out cleanly;
 *   - the PKCE pieces: the authorize URL carries a real S256 challenge for
 *     the stored verifier, and the exchange redeems and clears it.
 */

const URL_BASE = "https://api.example.test"
const ANON = "anon-key"
const KEY = "aisocratic-auth"

function b64url(value: string): string {
  return Buffer.from(value).toString("base64url")
}

/** Structurally valid JWT with the claims GoTrue puts in access tokens. */
function makeJwt(claims: Record<string, unknown>): string {
  return `${b64url(JSON.stringify({ alg: "HS256", typ: "JWT" }))}.${b64url(
    JSON.stringify(claims),
  )}.signature`
}

function memoryStorage(): StorageAdapter & { map: Map<string, string> } {
  const map = new Map<string, string>()
  return {
    map,
    getItem: async (key) => map.get(key) ?? null,
    setItem: async (key, value) => {
      map.set(key, value)
    },
    removeItem: async (key) => {
      map.delete(key)
    },
  }
}

const nowS = () => Math.floor(Date.now() / 1000)

/** A session blob byte-for-byte shaped like what supabase-js persisted. */
function supabaseJsBlob(overrides: Partial<Record<string, unknown>> = {}): string {
  const expires_at = nowS() + 3600
  return JSON.stringify({
    access_token: makeJwt({ sub: "user-1", email: "fed@example.org", exp: expires_at }),
    token_type: "bearer",
    expires_in: 3600,
    expires_at,
    refresh_token: "rt-original",
    provider_token: null,
    provider_refresh_token: null,
    user: {
      id: "user-1",
      aud: "authenticated",
      email: "fed@example.org",
      user_metadata: { full_name: "Fed" },
      app_metadata: { provider: "email" },
    },
    ...overrides,
  })
}

let fetchMock: jest.Mock

function jsonResponse(body: unknown, status = 200): Response {
  return {
    ok: status >= 200 && status < 300,
    status,
    text: async () => JSON.stringify(body),
  } as unknown as Response
}

beforeEach(() => {
  fetchMock = jest.fn(async () => jsonResponse({}))
  global.fetch = fetchMock as unknown as typeof fetch
})

function makeClient(storage: StorageAdapter) {
  return createGotrue({ url: URL_BASE, anonKey: ANON, storage, storageKey: KEY })
}

describe("session migration from the supabase-js storage format", () => {
  it("restores the persisted session without any network traffic", async () => {
    const storage = memoryStorage()
    storage.map.set(KEY, supabaseJsBlob())

    const client = makeClient(storage)
    const { data, error } = await client.getSession()
    client.stopAutoRefresh()
    expect(error).toBeNull()
    expect(data.session?.user.id).toBe("user-1")
    expect(data.session?.user.email).toBe("fed@example.org")
    expect(data.session?.user.user_metadata.full_name).toBe("Fed")
    expect(data.session?.refresh_token).toBe("rt-original")
    expect(fetchMock).not.toHaveBeenCalled()
  })

  it("derives expiry from the JWT when the blob carries none", () => {
    const exp = nowS() + 1234
    const session = parseStoredSession(
      JSON.stringify({
        access_token: makeJwt({ sub: "user-1", exp }),
        refresh_token: "rt",
        user: { id: "user-1" },
      }),
    )
    expect(session?.expires_at).toBe(exp)
    expect(session?.user.user_metadata).toEqual({})
  })

  it("rejects garbage rather than resurrecting it", async () => {
    const storage = memoryStorage()
    storage.map.set(KEY, "not json at all")

    const { data } = await makeClient(storage).getSession()
    expect(data.session).toBeNull()
    // The unusable blob is dropped so it can't shadow a future sign-in.
    expect(storage.map.has(KEY)).toBe(false)
  })
})

describe("refresh with rotation", () => {
  function expiredBlob(): string {
    const expires_at = nowS() - 10
    return supabaseJsBlob({
      access_token: makeJwt({ sub: "user-1", email: "fed@example.org", exp: expires_at }),
      expires_at,
    })
  }

  function refreshResponse(): unknown {
    return {
      access_token: makeJwt({ sub: "user-1", email: "fed@example.org", exp: nowS() + 3600 }),
      token_type: "bearer",
      expires_in: 3600,
      refresh_token: "rt-rotated",
      user: { id: "user-1", email: "fed@example.org", user_metadata: { full_name: "Fed" } },
    }
  }

  it("redeems the stored token and persists the rotated one", async () => {
    const storage = memoryStorage()
    storage.map.set(KEY, expiredBlob())
    fetchMock.mockResolvedValueOnce(jsonResponse(refreshResponse()))

    const client = makeClient(storage)
    const events: AuthChangeEvent[] = []
    client.onAuthStateChange((event) => events.push(event))

    const { data, error } = await client.getSession()
    client.stopAutoRefresh()

    expect(error).toBeNull()
    expect(data.session?.refresh_token).toBe("rt-rotated")
    expect(events).toEqual(["TOKEN_REFRESHED"])

    expect(fetchMock).toHaveBeenCalledTimes(1)
    expect(String(fetchMock.mock.calls[0][0])).toBe(
      `${URL_BASE}/auth/v1/token?grant_type=refresh_token`,
    )
    expect(fetchMock.mock.calls[0][1].body).toBe(JSON.stringify({ refresh_token: "rt-original" }))

    // Rotation is durable: what is on disk now redeems with the new token.
    const persisted = JSON.parse(storage.map.get(KEY)!) as Session
    expect(persisted.refresh_token).toBe("rt-rotated")
  })

  it("deduplicates concurrent refreshes into one grant", async () => {
    const storage = memoryStorage()
    storage.map.set(KEY, expiredBlob())
    fetchMock.mockResolvedValue(jsonResponse(refreshResponse()))

    const client = makeClient(storage)
    const [a, b] = await Promise.all([client.getSession(), client.getSession()])
    client.stopAutoRefresh()

    expect(a.data.session?.refresh_token).toBe("rt-rotated")
    expect(b.data.session?.refresh_token).toBe("rt-rotated")
    expect(fetchMock).toHaveBeenCalledTimes(1)
  })

  it("signs out for good when the grant is rejected", async () => {
    const storage = memoryStorage()
    storage.map.set(KEY, expiredBlob())
    fetchMock.mockResolvedValueOnce(
      jsonResponse({ error: "invalid_grant", error_description: "Invalid Refresh Token" }, 400),
    )

    const client = makeClient(storage)
    const events: AuthChangeEvent[] = []
    client.onAuthStateChange((event) => events.push(event))

    const { data, error } = await client.getSession()
    expect(data.session).toBeNull()
    expect(error?.message).toBe("Invalid Refresh Token")
    expect(events).toEqual(["SIGNED_OUT"])
    expect(storage.map.has(KEY)).toBe(false)
  })
})

describe("OTP", () => {
  it("verifyOtp persists the returned session and announces SIGNED_IN", async () => {
    const storage = memoryStorage()
    const client = makeClient(storage)
    const events: AuthChangeEvent[] = []
    client.onAuthStateChange((event) => events.push(event))

    fetchMock.mockResolvedValueOnce(
      jsonResponse({
        access_token: makeJwt({ sub: "user-9", email: "new@example.org", exp: nowS() + 3600 }),
        token_type: "bearer",
        expires_in: 3600,
        refresh_token: "rt-new",
        user: { id: "user-9", email: "new@example.org", user_metadata: {} },
      }),
    )

    const { data, error } = await client.verifyOtp({
      email: "new@example.org",
      token: "123456",
      type: "email",
    })
    client.stopAutoRefresh()

    expect(error).toBeNull()
    expect(data.session?.user.id).toBe("user-9")
    expect(events).toEqual(["SIGNED_IN"])
    expect(String(fetchMock.mock.calls[0][0])).toBe(`${URL_BASE}/auth/v1/verify`)
    expect(storage.map.has(KEY)).toBe(true)
  })

  it("signInWithOtp surfaces the server's message on failure", async () => {
    fetchMock.mockResolvedValueOnce(
      jsonResponse({ code: 429, msg: "For security purposes, you can only request this once every 60 seconds" }, 429),
    )
    const { error } = await makeClient(memoryStorage()).signInWithOtp({
      email: "fed@example.org",
      options: { shouldCreateUser: true },
    })
    expect(error?.message).toMatch(/60 seconds/)
  })
})

describe("PKCE", () => {
  it("builds an authorize URL whose challenge is S256 of the stored verifier", async () => {
    const storage = memoryStorage()
    const { data, error } = await makeClient(storage).signInWithOAuth({
      provider: "google",
      options: { redirectTo: "aisocratic://auth/callback" },
    })

    expect(error).toBeNull()
    expect(data.url).toContain(`${URL_BASE}/auth/v1/authorize?provider=google`)
    expect(data.url).toContain(`redirect_to=${encodeURIComponent("aisocratic://auth/callback")}`)
    expect(data.url).toContain("code_challenge_method=s256")

    const verifier = storage.map.get(`${KEY}-code-verifier`)!
    const digest = await crypto.subtle.digest("SHA-256", new TextEncoder().encode(verifier))
    const expected = Buffer.from(digest).toString("base64url")
    expect(data.url).toContain(`code_challenge=${expected}`)
  })

  it("exchanges the code with the verifier, then burns it", async () => {
    const storage = memoryStorage()
    // The supabase-js on-disk format ("<verifier>/<redirect-type>") must also
    // redeem, for a flow that straddled the upgrade.
    storage.map.set(`${KEY}-code-verifier`, "the-verifier/s256")

    fetchMock.mockResolvedValueOnce(
      jsonResponse({
        access_token: makeJwt({ sub: "user-1", exp: nowS() + 3600 }),
        token_type: "bearer",
        expires_in: 3600,
        refresh_token: "rt-pkce",
        user: { id: "user-1", user_metadata: {} },
      }),
    )

    const client = makeClient(storage)
    const { data, error } = await client.exchangeCodeForSession("auth-code-1")
    client.stopAutoRefresh()

    expect(error).toBeNull()
    expect(data.session?.refresh_token).toBe("rt-pkce")
    expect(String(fetchMock.mock.calls[0][0])).toBe(`${URL_BASE}/auth/v1/token?grant_type=pkce`)
    expect(fetchMock.mock.calls[0][1].body).toBe(
      JSON.stringify({ auth_code: "auth-code-1", code_verifier: "the-verifier" }),
    )
    expect(storage.map.has(`${KEY}-code-verifier`)).toBe(false)
  })
})

describe("sign out", () => {
  it("clears local state even when the server call fails", async () => {
    const storage = memoryStorage()
    storage.map.set(KEY, supabaseJsBlob())
    fetchMock.mockRejectedValue(new Error("offline"))

    const client = makeClient(storage)
    const events: AuthChangeEvent[] = []
    client.onAuthStateChange((event) => events.push(event))

    const { error } = await client.signOut()
    expect(error).toBeNull()
    expect(events).toEqual(["SIGNED_OUT"])
    expect(storage.map.has(KEY)).toBe(false)
    expect((await client.getSession()).data.session).toBeNull()
  })
})
