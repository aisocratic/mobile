import { createGotrue } from "@/lib/gotrue"
import { createPostgrest } from "@/lib/postgrest"
import { sessionStorage } from "@/lib/session-storage"

/**
 * The app's one client for the self-hosted backend (Postgres + PostgREST +
 * GoTrue behind Kong at EXPO_PUBLIC_API_URL). `api.from(...)` speaks
 * PostgREST, `api.auth` speaks GoTrue — both are thin in-repo clients (see
 * ./postgrest and ./gotrue) rather than supabase-js, talking the same open
 * protocols to the same unchanged server.
 *
 * The session persists under the storage key supabase-js used
 * ("aisocratic-auth", chunked in SecureStore — see ./session-storage), so
 * upgrading to this client keeps everyone signed in.
 */

const API_URL = process.env.EXPO_PUBLIC_API_URL
const API_KEY = process.env.EXPO_PUBLIC_API_KEY

if (!API_URL || !API_KEY) {
  throw new Error(
    "Missing EXPO_PUBLIC_API_URL / EXPO_PUBLIC_API_KEY. Copy .env.example to .env and fill them in.",
  )
}

export const SITE_URL = process.env.EXPO_PUBLIC_SITE_URL ?? "https://aisocratic.org"

const auth = createGotrue({
  url: API_URL,
  anonKey: API_KEY,
  storage: sessionStorage,
  storageKey: "aisocratic-auth",
})

const rest = createPostgrest({
  url: API_URL,
  anonKey: API_KEY,
  // RLS sees the signed-in user when there is a session, anon otherwise.
  getAccessToken: () => auth.getAccessToken(),
})

export const api = {
  auth,
  from: rest.from,
}

export type { AuthChangeEvent, AuthError, Session, User } from "@/lib/gotrue"
export type { PostgrestError } from "@/lib/postgrest"
