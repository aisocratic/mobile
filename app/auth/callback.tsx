import { useLocalSearchParams, useRouter } from "expo-router"
import React, { useEffect, useRef, useState } from "react"
import { View } from "react-native"

import { Button, Loading, Screen, Txt } from "@/components/ui"
import { supabase } from "@/lib/supabase"
import { layout, usePalette } from "@/theme"

/**
 * Landing route for `aisocratic://auth/callback`.
 *
 * The happy path never gets here: `WebBrowser.openAuthSessionAsync` intercepts
 * the redirect inside the auth sheet and hands the URL straight back to
 * `signInWithGoogle`, so no navigation happens. This screen exists for the
 * out-of-band deliveries — the auth sheet being dismissed early, a magic link
 * opened from a mail client, a cold start from the OS — which otherwise land on
 * expo-router's "Unmatched Route" dead end.
 */
export default function AuthCallback() {
  const p = usePalette()
  const router = useRouter()
  const params = useLocalSearchParams<{
    code?: string
    access_token?: string
    refresh_token?: string
    error?: string
    error_description?: string
  }>()

  const [error, setError] = useState<string | null>(null)
  // Deep links can re-render this route with the same params; only ever
  // redeem them once.
  const redeemed = useRef(false)

  useEffect(() => {
    if (redeemed.current) return
    redeemed.current = true

    const finish = () => router.replace("/(tabs)/events")

    const run = async () => {
      const described = params.error_description ?? params.error
      if (described) {
        setError(described.replace(/\+/g, " "))
        return
      }

      try {
        if (params.code) {
          const { error: err } = await supabase.auth.exchangeCodeForSession(params.code)
          if (err) throw err
        } else if (params.access_token && params.refresh_token) {
          const { error: err } = await supabase.auth.setSession({
            access_token: params.access_token,
            refresh_token: params.refresh_token,
          })
          if (err) throw err
        }
        // No credentials in the link is not an error — the session may already
        // have been established by the auth sheet. Just get out of the way.
        finish()
      } catch (e) {
        setError(e instanceof Error ? e.message : "Could not complete sign-in.")
      }
    }

    void run()
  }, [params, router])

  if (!error) return <Loading label="Finishing sign-in…" />

  return (
    <Screen>
      <View style={{ flex: 1, justifyContent: "center", gap: 14, padding: layout.gutter + 8 }}>
        <Txt variant="title">Sign-in didn't complete</Txt>
        <Txt variant="body" color={p.muted} >
          {error}
        </Txt>
        <Button label="Back to sign in" onPress={() => router.replace("/(auth)/welcome")} />
        <Button
          label="Keep browsing"
          variant="ghost"
          onPress={() => router.replace("/(tabs)/events")}
        />
      </View>
    </Screen>
  )
}
