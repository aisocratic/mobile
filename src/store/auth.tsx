import type { Session, User } from "@supabase/supabase-js"
import * as Linking from "expo-linking"
import * as WebBrowser from "expo-web-browser"
import React, { createContext, useCallback, useContext, useEffect, useMemo, useState } from "react"

import { supabase } from "@/lib/supabase"

WebBrowser.maybeCompleteAuthSession()

/**
 * aisocratic.org has no passwords. GoTrue is configured for passwordless
 * 6-digit email OTP plus Google OAuth, and the website's /login page uses the
 * same two flows with `shouldCreateUser: true` — so "sign up" and "sign in" are
 * the same call, distinguished only by what we ask for in the UI.
 */

export type Profile = {
  id: string
  email: string | null
  full_name: string | null
  avatar_url: string | null
  bio: string | null
  organization: string | null
  job_title: string | null
  location: string | null
  linkedin_url: string | null
  is_member: boolean | null
}

/** The fields the in-app editor writes back to `public.users`. */
export type ProfileInput = Pick<
  Profile,
  "full_name" | "bio" | "organization" | "job_title" | "location" | "linkedin_url"
>

type AuthState = {
  session: Session | null
  user: User | null
  profile: Profile | null
  /** True until the persisted session has been restored from secure storage. */
  loading: boolean
  /** Emails a 6-digit code. Creates the account if it doesn't exist. */
  sendCode: (email: string, fullName?: string) => Promise<void>
  /** Exchanges the 6-digit code for a session. */
  verifyCode: (email: string, code: string) => Promise<void>
  signInWithGoogle: () => Promise<void>
  signOut: () => Promise<void>
  refreshProfile: () => Promise<void>
  /** Saves the profile edits made in-app. Throws with a message on failure. */
  updateProfile: (patch: ProfileInput) => Promise<void>
}

const AuthContext = createContext<AuthState | null>(null)

const PROFILE_COLUMNS =
  "id,email,full_name,avatar_url,bio,organization,job_title,location,linkedin_url,is_member"

export function AuthProvider({ children }: { children: React.ReactNode }) {
  const [session, setSession] = useState<Session | null>(null)
  const [profile, setProfile] = useState<Profile | null>(null)
  const [loading, setLoading] = useState(true)

  const loadProfile = useCallback(async (userId: string) => {
    const { data, error } = await supabase
      .from("users")
      .select(PROFILE_COLUMNS)
      .eq("id", userId)
      .maybeSingle()

    // A missing row is expected: the website provisions `public.users` from its
    // own /api/auth/complete route, which is cookie-authenticated and therefore
    // unreachable from a native client. The app falls back to auth metadata.
    if (error) return
    setProfile((data as Profile | null) ?? null)
  }, [])

  useEffect(() => {
    let active = true

    supabase.auth.getSession().then(({ data }) => {
      if (!active) return
      setSession(data.session)
      setLoading(false)
      if (data.session?.user) void loadProfile(data.session.user.id)
    })

    const { data: sub } = supabase.auth.onAuthStateChange((_event, next) => {
      setSession(next)
      if (next?.user) void loadProfile(next.user.id)
      else setProfile(null)
    })

    return () => {
      active = false
      sub.subscription.unsubscribe()
    }
  }, [loadProfile])

  const sendCode = useCallback(async (email: string, fullName?: string) => {
    const { error } = await supabase.auth.signInWithOtp({
      email: email.trim().toLowerCase(),
      options: {
        shouldCreateUser: true,
        data: fullName?.trim() ? { full_name: fullName.trim() } : undefined,
        // Deliberately no `emailRedirectTo`. Sign-in completes with the 6-digit
        // code inside the app, so the magic link in the email is only a
        // same-browser fallback and pointing it at a deep link the user's mail
        // client can't open would make it worse, not better.
        // (This server tolerates an unknown redirect here — it 200s and falls
        // back to SITE_URL — so this is hygiene, not a bug fix. The OAuth
        // redirect below is the one that must be allow-listed.)
      },
    })
    if (error) throw error
  }, [])

  const verifyCode = useCallback(async (email: string, code: string) => {
    const { error } = await supabase.auth.verifyOtp({
      email: email.trim().toLowerCase(),
      token: code.trim(),
      type: "email",
    })
    if (error) throw error
  }, [])

  const signInWithGoogle = useCallback(async () => {
    // In a dev/standalone build this is `aisocratic://auth/callback` (the
    // scheme declared in app.json). Under Expo Go it is
    // `exp://<lan-ip>:8081/--/auth/callback`. Both must appear in GoTrue's
    // GOTRUE_URI_ALLOW_LIST or it silently discards the redirect and sends the
    // browser to SITE_URL instead — the user ends up signed in on the website
    // while the app waits forever. See the auth notes in README.md.
    const redirectTo = Linking.createURL("auth/callback")

    const { data, error } = await supabase.auth.signInWithOAuth({
      provider: "google",
      options: { redirectTo, skipBrowserRedirect: true },
    })
    if (error) throw error
    if (!data.url) throw new Error("Could not start Google sign-in.")

    const result = await WebBrowser.openAuthSessionAsync(data.url, redirectTo)

    // `dismiss` means the user closed the sheet; `cancel` means they backed
    // out. Neither is an error worth showing.
    if (result.type !== "success") return

    const url = new URL(result.url)
    const query = new URLSearchParams(url.search.replace(/^\?/, ""))
    const fragment = new URLSearchParams(url.hash.replace(/^#/, ""))
    const param = (key: string) => query.get(key) ?? fragment.get(key)

    const errorDescription = param("error_description") ?? param("error")
    if (errorDescription) throw new Error(errorDescription.replace(/\+/g, " "))

    // PKCE (our configured flow) comes back as ?code=. Exchange it for a
    // session using the verifier we stored when the flow started.
    const code = param("code")
    if (code) {
      const { error: exchangeErr } = await supabase.auth.exchangeCodeForSession(code)
      if (exchangeErr) throw exchangeErr
      return
    }

    // Implicit-flow fallback, in case the server is configured that way.
    const access_token = param("access_token")
    const refresh_token = param("refresh_token")
    if (access_token && refresh_token) {
      const { error: setErr } = await supabase.auth.setSession({ access_token, refresh_token })
      if (setErr) throw setErr
      return
    }

    throw new Error(
      "Google returned no session. The redirect URL is probably missing from the server's allow list.",
    )
  }, [])

  const signOut = useCallback(async () => {
    await supabase.auth.signOut()
    setProfile(null)
  }, [])

  const refreshProfile = useCallback(async () => {
    if (session?.user) await loadProfile(session.user.id)
  }, [session, loadProfile])

  const updateProfile = useCallback(
    async (patch: ProfileInput) => {
      const current = session?.user
      if (!current) throw new Error("Sign in again to edit your profile.")

      // Auth metadata first: it is the fallback the app reads when there is no
      // `public.users` row (see loadProfile), so the name still sticks even if
      // the row write below is refused. `updateUser` fires USER_UPDATED, which
      // the listener above turns into fresh session state.
      const { error: metaError } = await supabase.auth.updateUser({
        data: { full_name: patch.full_name ?? "" },
      })

      // upsert rather than update: signing up in the app leaves you with a
      // GoTrue user and no profile row until the website provisions one.
      const { data, error } = await supabase
        .from("users")
        .upsert({ id: current.id, email: current.email ?? null, ...patch }, { onConflict: "id" })
        .select(PROFILE_COLUMNS)
        .maybeSingle()

      if (error) throw new Error(error.message)
      if (metaError) throw new Error(metaError.message)

      if (data) setProfile(data as Profile)
      else await loadProfile(current.id)
    },
    [session, loadProfile],
  )

  const value = useMemo<AuthState>(
    () => ({
      session,
      user: session?.user ?? null,
      profile,
      loading,
      sendCode,
      verifyCode,
      signInWithGoogle,
      signOut,
      refreshProfile,
      updateProfile,
    }),
    [
      session,
      profile,
      loading,
      sendCode,
      verifyCode,
      signInWithGoogle,
      signOut,
      refreshProfile,
      updateProfile,
    ],
  )

  return <AuthContext.Provider value={value}>{children}</AuthContext.Provider>
}

export function useAuth(): AuthState {
  const ctx = useContext(AuthContext)
  if (!ctx) throw new Error("useAuth must be used inside <AuthProvider>")
  return ctx
}

/** Best-effort display name: profile row first, then auth metadata, then email. */
export function useDisplayName(): string {
  const { profile, user } = useAuth()
  return (
    profile?.full_name ??
    (user?.user_metadata?.full_name as string | undefined) ??
    user?.email?.split("@")[0] ??
    "there"
  )
}
