// Must come first: the PKCE challenge below needs crypto.subtle.digest, and
// Hermes has no WebCrypto — src/lib/webcrypto.ts installs the one primitive.
import "@/lib/webcrypto"

import { bytesToUtf8 } from "@noble/ciphers/utils.js"
import { utf8ToBytes } from "@noble/hashes/utils.js"
import { base64urlnopad } from "@scure/base"

import type { StorageAdapter } from "@/lib/session-storage"

/**
 * A minimal GoTrue (auth) client over fetch.
 *
 * This replaces @supabase/auth-js with only the flows this app uses:
 *
 *   - passwordless email OTP (`signInWithOtp` -> `verifyOtp`)
 *   - Google OAuth with PKCE S256 (`signInWithOAuth` builds the authorize URL
 *     and stores the verifier; `exchangeCodeForSession` redeems `?code=`)
 *   - `setSession` from explicit tokens (implicit-flow fallback, live tests)
 *   - refresh with rotation (`getSession` refreshes near expiry; the rotated
 *     refresh token is persisted before anything else can run)
 *   - `signOut`, `updateUser`, and an `onAuthStateChange` subscription
 *
 * Session continuity: the session persists under the same storage key
 * supabase-js used (`aisocratic-auth`) and in a compatible JSON shape — the
 * session object itself. `parseStoredSession` accepts what supabase-js wrote
 * (which carries extras like `expires_in` / `provider_token`), so an existing
 * signed-in user upgrades without being logged out.
 */

export type User = {
  id: string
  aud?: string
  email?: string | null
  phone?: string | null
  created_at?: string
  last_sign_in_at?: string | null
  role?: string | null
  user_metadata: Record<string, unknown>
  app_metadata?: Record<string, unknown>
}

export type Session = {
  access_token: string
  refresh_token: string
  token_type: string
  /** Unix seconds. */
  expires_at: number
  user: User
}

export type AuthChangeEvent = "SIGNED_IN" | "SIGNED_OUT" | "TOKEN_REFRESHED" | "USER_UPDATED"

export type AuthError = { message: string; status?: number }

export type GotrueConfig = {
  /** Backend origin, e.g. https://api.aisocratic.org — /auth/v1 is appended. */
  url: string
  anonKey: string
  storage: StorageAdapter
  storageKey: string
}

/** Refresh this long before the access token actually expires. */
const EXPIRY_MARGIN_S = 60

/** Auto-refresh tick — how often a live session is checked for expiry. */
const AUTO_REFRESH_TICK_MS = 30_000

function jwtPayload(token: string): Record<string, unknown> | null {
  const part = token.split(".")[1]
  if (!part) return null
  try {
    return JSON.parse(bytesToUtf8(base64urlnopad.decode(part))) as Record<string, unknown>
  } catch {
    return null
  }
}

function jwtExp(token: string): number | null {
  const exp = jwtPayload(token)?.exp
  return typeof exp === "number" ? exp : null
}

/**
 * Normalise a persisted session — ours, or the one @supabase/auth-js wrote
 * before this client existed. Returns null for anything unusable, in which
 * case the entry is treated as absent.
 */
export function parseStoredSession(raw: string): Session | null {
  let value: unknown
  try {
    value = JSON.parse(raw)
  } catch {
    return null
  }
  if (!value || typeof value !== "object") return null
  const record = value as Record<string, unknown>

  const access_token = record.access_token
  const refresh_token = record.refresh_token
  if (typeof access_token !== "string" || !access_token) return null
  if (typeof refresh_token !== "string" || !refresh_token) return null

  // supabase-js always stored expires_at, but tolerate its absence: derive it
  // from the JWT, else treat the token as already expired so the first
  // getSession() refreshes rather than trusting an unknown expiry.
  const expires_at =
    typeof record.expires_at === "number" ? record.expires_at : (jwtExp(access_token) ?? 0)

  const claims = jwtPayload(access_token)
  const storedUser =
    record.user && typeof record.user === "object" ? (record.user as Record<string, unknown>) : null
  const id = storedUser?.id ?? claims?.sub
  if (typeof id !== "string" || !id) return null

  const user: User = {
    ...(storedUser as Partial<User> | null),
    id,
    email:
      typeof storedUser?.email === "string"
        ? storedUser.email
        : typeof claims?.email === "string"
          ? claims.email
          : null,
    user_metadata:
      storedUser?.user_metadata && typeof storedUser.user_metadata === "object"
        ? (storedUser.user_metadata as Record<string, unknown>)
        : {},
  }

  return {
    access_token,
    refresh_token,
    token_type: typeof record.token_type === "string" ? record.token_type : "bearer",
    expires_at,
    user,
  }
}

function randomPkceVerifier(): string {
  const bytes = new Uint8Array(32)
  crypto.getRandomValues(bytes)
  return base64urlnopad.encode(bytes)
}

async function pkceS256Challenge(verifier: string): Promise<string> {
  const digest = await crypto.subtle.digest("SHA-256", utf8ToBytes(verifier))
  return base64urlnopad.encode(new Uint8Array(digest))
}

function errorMessage(status: number, body: unknown): string {
  const record = (body ?? {}) as Record<string, unknown>
  for (const key of ["msg", "message", "error_description", "error"]) {
    const value = record[key]
    if (typeof value === "string" && value) return value
  }
  return `Auth request failed (HTTP ${status})`
}

export class GotrueClient {
  private session: Session | null = null
  private loadPromise: Promise<void> | null = null
  private refreshPromise: Promise<AuthError | null> | null = null
  private listeners = new Set<(event: AuthChangeEvent, session: Session | null) => void>()
  private refreshTimer: ReturnType<typeof setInterval> | null = null

  constructor(private config: GotrueConfig) {}

  /* ------------------------------------------------------------- plumbing */

  private async request(
    path: string,
    init: { method: string; body?: unknown; token?: string },
  ): Promise<{ ok: boolean; status: number; json: unknown }> {
    const response = await fetch(`${this.config.url}/auth/v1${path}`, {
      method: init.method,
      headers: {
        apikey: this.config.anonKey,
        authorization: `Bearer ${init.token ?? this.config.anonKey}`,
        "content-type": "application/json",
      },
      body: init.body === undefined ? undefined : JSON.stringify(init.body),
    })
    const text = await response.text()
    let json: unknown = null
    try {
      json = text ? JSON.parse(text) : null
    } catch {
      json = null
    }
    return { ok: response.ok, status: response.status, json }
  }

  /** Build a Session from a GoTrue token/verify response body. */
  private sessionFromResponse(body: Record<string, unknown>): Session | null {
    const raw = JSON.stringify(body)
    const parsed = parseStoredSession(raw)
    if (!parsed) return null
    if (typeof body.expires_at !== "number" && typeof body.expires_in === "number") {
      parsed.expires_at = Math.floor(Date.now() / 1000) + body.expires_in
    }
    return parsed
  }

  private emit(event: AuthChangeEvent): void {
    for (const listener of [...this.listeners]) listener(event, this.session)
  }

  private async persist(session: Session): Promise<void> {
    this.session = session
    await this.config.storage.setItem(this.config.storageKey, JSON.stringify(session))
    this.startAutoRefresh()
  }

  private async clear(): Promise<void> {
    this.session = null
    this.stopAutoRefresh()
    await this.config.storage.removeItem(this.config.storageKey)
  }

  /** Restore the persisted session once; later calls are a no-op. */
  private load(): Promise<void> {
    this.loadPromise ??= (async () => {
      const raw = await this.config.storage.getItem(this.config.storageKey)
      if (raw === null) return
      const session = parseStoredSession(raw)
      if (session) {
        this.session = session
        this.startAutoRefresh()
      } else {
        // Unusable blob: drop it so it can't shadow a future sign-in.
        await this.config.storage.removeItem(this.config.storageKey)
      }
    })()
    return this.loadPromise
  }

  /* -------------------------------------------------------------- refresh */

  /**
   * Redeem a refresh token. GoTrue rotates: the response carries a new
   * refresh token and the old one becomes invalid, so the rotated session is
   * persisted before the result is returned.
   */
  private async refreshWith(refreshToken: string): Promise<AuthError | null> {
    const { ok, status, json } = await this.request("/token?grant_type=refresh_token", {
      method: "POST",
      body: { refresh_token: refreshToken },
    })

    if (!ok) {
      const error = { message: errorMessage(status, json), status }
      // 4xx means the grant itself was rejected (revoked, already rotated):
      // the session is gone for good. Anything else is a transient failure
      // and the stored session must survive it.
      if (status >= 400 && status < 500) {
        await this.clear()
        this.emit("SIGNED_OUT")
      }
      return error
    }

    const session = this.sessionFromResponse((json ?? {}) as Record<string, unknown>)
    if (!session) return { message: "Refresh returned no usable session" }
    await this.persist(session)
    this.emit("TOKEN_REFRESHED")
    return null
  }

  /** Deduplicated refresh of the current session. */
  private refresh(): Promise<AuthError | null> {
    if (this.refreshPromise) return this.refreshPromise
    const token = this.session?.refresh_token
    if (!token) return Promise.resolve({ message: "No session to refresh" })
    this.refreshPromise = this.refreshWith(token).finally(() => {
      this.refreshPromise = null
    })
    return this.refreshPromise
  }

  startAutoRefresh(): void {
    if (this.refreshTimer) return
    this.refreshTimer = setInterval(() => {
      const session = this.session
      if (!session) return
      if (session.expires_at - Date.now() / 1000 < EXPIRY_MARGIN_S * 2) void this.refresh()
    }, AUTO_REFRESH_TICK_MS)
  }

  stopAutoRefresh(): void {
    if (this.refreshTimer) clearInterval(this.refreshTimer)
    this.refreshTimer = null
  }

  /* ------------------------------------------------------------- sessions */

  async getSession(): Promise<{ data: { session: Session | null }; error: AuthError | null }> {
    await this.load()
    const current = this.session
    if (current && current.expires_at - Date.now() / 1000 < EXPIRY_MARGIN_S) {
      const error = await this.refresh()
      // A transient refresh failure with a still-valid token: hand back the
      // session we have rather than logging the user out over a network blip.
      if (error && this.session && this.session.expires_at > Date.now() / 1000) {
        return { data: { session: this.session }, error: null }
      }
      if (error) return { data: { session: this.session }, error }
    }
    return { data: { session: this.session }, error: null }
  }

  /** Valid access token for API calls, or null when signed out. */
  async getAccessToken(): Promise<string | null> {
    const { data } = await this.getSession()
    return data.session?.access_token ?? null
  }

  async setSession(tokens: {
    access_token: string
    refresh_token: string
  }): Promise<{ data: { session: Session | null }; error: AuthError | null }> {
    await this.load()

    const exp = jwtExp(tokens.access_token)
    if (!exp || exp <= Date.now() / 1000) {
      const error = await this.refreshWith(tokens.refresh_token)
      if (error) return { data: { session: null }, error }
      this.emit("SIGNED_IN")
      return { data: { session: this.session }, error: null }
    }

    const { ok, status, json } = await this.request("/user", {
      method: "GET",
      token: tokens.access_token,
    })
    if (!ok) return { data: { session: null }, error: { message: errorMessage(status, json), status } }

    const claims = jwtPayload(tokens.access_token)
    const session = parseStoredSession(
      JSON.stringify({ ...tokens, expires_at: exp, token_type: "bearer", user: json }),
    )
    if (!session) {
      return { data: { session: null }, error: { message: "Could not build a session" } }
    }
    if (!session.user.email && typeof claims?.email === "string") session.user.email = claims.email

    await this.persist(session)
    this.emit("SIGNED_IN")
    return { data: { session }, error: null }
  }

  /* ---------------------------------------------------------------- flows */

  async signInWithOtp(params: {
    email: string
    options?: { shouldCreateUser?: boolean; data?: Record<string, unknown> }
  }): Promise<{ error: AuthError | null }> {
    const { ok, status, json } = await this.request("/otp", {
      method: "POST",
      body: {
        email: params.email,
        create_user: params.options?.shouldCreateUser ?? true,
        ...(params.options?.data ? { data: params.options.data } : {}),
      },
    })
    return { error: ok ? null : { message: errorMessage(status, json), status } }
  }

  async verifyOtp(params: {
    email: string
    token: string
    type: "email"
  }): Promise<{ data: { session: Session | null }; error: AuthError | null }> {
    const { ok, status, json } = await this.request("/verify", {
      method: "POST",
      body: { email: params.email, token: params.token, type: params.type },
    })
    if (!ok) return { data: { session: null }, error: { message: errorMessage(status, json), status } }

    const session = this.sessionFromResponse((json ?? {}) as Record<string, unknown>)
    if (!session) {
      return { data: { session: null }, error: { message: "Verification returned no session" } }
    }
    await this.persist(session)
    this.emit("SIGNED_IN")
    return { data: { session }, error: null }
  }

  /**
   * Start an OAuth flow: store a fresh PKCE verifier and hand back the
   * authorize URL for expo-web-browser to open. The browser is never
   * redirected by this client (the old `skipBrowserRedirect: true`).
   */
  async signInWithOAuth(params: {
    provider: string
    options: { redirectTo: string }
  }): Promise<{ data: { url: string | null }; error: AuthError | null }> {
    try {
      const verifier = randomPkceVerifier()
      await this.config.storage.setItem(`${this.config.storageKey}-code-verifier`, verifier)
      const challenge = await pkceS256Challenge(verifier)

      const query = [
        ["provider", params.provider],
        ["redirect_to", params.options.redirectTo],
        ["code_challenge", challenge],
        ["code_challenge_method", "s256"],
      ]
        .map(([k, v]) => `${k}=${encodeURIComponent(v)}`)
        .join("&")

      return { data: { url: `${this.config.url}/auth/v1/authorize?${query}` }, error: null }
    } catch (e) {
      return {
        data: { url: null },
        error: { message: e instanceof Error ? e.message : String(e) },
      }
    }
  }

  async exchangeCodeForSession(
    code: string,
  ): Promise<{ data: { session: Session | null }; error: AuthError | null }> {
    const verifierKey = `${this.config.storageKey}-code-verifier`
    const stored = await this.config.storage.getItem(verifierKey)
    // supabase-js persisted its verifier as "<verifier>/<redirect-type>"; be
    // tolerant so a flow started before the upgrade can still complete.
    const verifier = stored?.split("/")[0] ?? null
    if (!verifier) {
      return {
        data: { session: null },
        error: { message: "No PKCE verifier found — the sign-in flow was not started here." },
      }
    }

    const { ok, status, json } = await this.request("/token?grant_type=pkce", {
      method: "POST",
      body: { auth_code: code, code_verifier: verifier },
    })
    await this.config.storage.removeItem(verifierKey)
    if (!ok) return { data: { session: null }, error: { message: errorMessage(status, json), status } }

    const session = this.sessionFromResponse((json ?? {}) as Record<string, unknown>)
    if (!session) {
      return { data: { session: null }, error: { message: "Code exchange returned no session" } }
    }
    await this.persist(session)
    this.emit("SIGNED_IN")
    return { data: { session }, error: null }
  }

  async updateUser(attributes: {
    data?: Record<string, unknown>
  }): Promise<{ data: { user: User | null }; error: AuthError | null }> {
    const token = await this.getAccessToken()
    if (!token) return { data: { user: null }, error: { message: "Not signed in" } }

    const { ok, status, json } = await this.request("/user", {
      method: "PUT",
      body: attributes,
      token,
    })
    if (!ok) return { data: { user: null }, error: { message: errorMessage(status, json), status } }

    if (this.session) {
      const merged = parseStoredSession(JSON.stringify({ ...this.session, user: json }))
      if (merged) {
        await this.persist(merged)
        this.emit("USER_UPDATED")
        return { data: { user: merged.user }, error: null }
      }
    }
    return { data: { user: (json as User | null) ?? null }, error: null }
  }

  async signOut(): Promise<{ error: AuthError | null }> {
    await this.load()
    const token = this.session?.access_token
    if (token) {
      // Best-effort server-side revocation; local sign-out must never fail on
      // a network error or an already-expired token.
      try {
        await this.request("/logout?scope=global", { method: "POST", token })
      } catch {
        /* ignored */
      }
    }
    await this.clear()
    this.emit("SIGNED_OUT")
    return { error: null }
  }

  onAuthStateChange(callback: (event: AuthChangeEvent, session: Session | null) => void): {
    data: { subscription: { unsubscribe: () => void } }
  } {
    this.listeners.add(callback)
    return {
      data: { subscription: { unsubscribe: () => this.listeners.delete(callback) } },
    }
  }
}

export function createGotrue(config: GotrueConfig): GotrueClient {
  return new GotrueClient(config)
}
