import { Ionicons } from "@expo/vector-icons"
import * as Haptics from "expo-haptics"
import React, { useCallback, useRef, useState } from "react"
import { Pressable, View } from "react-native"

import { Button, Field, Txt } from "@/components/ui"
import { useAuth } from "@/store/auth"
import { layout, usePalette } from "@/theme"

/**
 * The shared two-step passwordless form used by both sign-in and sign-up.
 * Step 1 collects the email (plus a name when registering); step 2 takes the
 * 6-digit code GoTrue emails back.
 */
export function AuthForm({ mode }: { mode: "sign-in" | "sign-up" }) {
  const p = usePalette()
  const { sendCode, verifyCode, signInWithGoogle } = useAuth()

  const [step, setStep] = useState<"email" | "code">("email")
  const [name, setName] = useState("")
  const [email, setEmail] = useState("")
  const [code, setCode] = useState("")
  const [busy, setBusy] = useState(false)
  const [googleBusy, setGoogleBusy] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const [resentAt, setResentAt] = useState<number | null>(null)

  const isSignUp = mode === "sign-up"
  const emailValid = /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email.trim())
  const lastSend = useRef(0)

  const submitEmail = useCallback(async () => {
    if (!emailValid) {
      setError("Enter a valid email address.")
      return
    }
    if (isSignUp && !name.trim()) {
      setError("Tell us your name so members can recognise you.")
      return
    }

    setBusy(true)
    setError(null)
    try {
      await sendCode(email, isSignUp ? name : undefined)
      lastSend.current = Date.now()
      setStep("code")
      void Haptics.notificationAsync(Haptics.NotificationFeedbackType.Success)
    } catch (e) {
      setError(e instanceof Error ? e.message : "Could not send the code.")
    } finally {
      setBusy(false)
    }
  }, [email, name, emailValid, isSignUp, sendCode])

  const submitCode = useCallback(async () => {
    if (!/^\d{6}$/.test(code.trim())) {
      setError("The code is 6 digits.")
      return
    }

    setBusy(true)
    setError(null)
    try {
      await verifyCode(email, code)
      void Haptics.notificationAsync(Haptics.NotificationFeedbackType.Success)
      // The auth listener in AuthProvider flips the session and the root
      // layout's AuthGate handles the redirect — nothing to navigate here.
    } catch (e) {
      void Haptics.notificationAsync(Haptics.NotificationFeedbackType.Error)
      setError(e instanceof Error ? e.message : "That code didn't work.")
    } finally {
      setBusy(false)
    }
  }, [code, email, verifyCode])

  const resend = useCallback(async () => {
    // GoTrue rate-limits resends to one per minute and 429s past that.
    if (Date.now() - lastSend.current < 60_000) {
      setError("Hold on a moment before requesting another code.")
      return
    }
    setBusy(true)
    setError(null)
    try {
      await sendCode(email, isSignUp ? name : undefined)
      lastSend.current = Date.now()
      setResentAt(Date.now())
    } catch (e) {
      setError(e instanceof Error ? e.message : "Could not resend the code.")
    } finally {
      setBusy(false)
    }
  }, [email, name, isSignUp, sendCode])

  const google = useCallback(async () => {
    setGoogleBusy(true)
    setError(null)
    try {
      await signInWithGoogle()
    } catch (e) {
      setError(e instanceof Error ? e.message : "Google sign-in failed.")
    } finally {
      setGoogleBusy(false)
    }
  }, [signInWithGoogle])

  if (step === "code") {
    return (
      <View style={{ gap: 20 }}>
        <View style={{ gap: 6 }}>
          <Txt variant="title">Check your email</Txt>
          <Txt variant="body" color={p.muted} style={{ lineHeight: 21 }}>
            We sent a 6-digit code to {email.trim().toLowerCase()}.
          </Txt>
        </View>

        <Field
          label="Verification code"
          value={code}
          onChangeText={(t) => setCode(t.replace(/\D/g, "").slice(0, 6))}
          placeholder="123456"
          keyboardType="number-pad"
          textContentType="oneTimeCode"
          autoComplete="one-time-code"
          autoFocus
          maxLength={6}
          error={error}
          style={{ fontSize: 24, letterSpacing: 8, textAlign: "center", fontWeight: "600" }}
        />

        <Button
          label={isSignUp ? "Create my account" : "Sign in"}
          onPress={submitCode}
          loading={busy}
          disabled={code.length !== 6}
        />

        <View style={{ flexDirection: "row", justifyContent: "center", gap: 6 }}>
          <Txt variant="caption" color={p.muted}>
            {resentAt ? "Code resent." : "Didn't get it?"}
          </Txt>
          <Pressable onPress={resend} accessibilityRole="button">
            <Txt variant="caption" color={p.accent}>
              Send another
            </Txt>
          </Pressable>
        </View>

        <Pressable
          onPress={() => {
            setStep("email")
            setCode("")
            setError(null)
          }}
          accessibilityRole="button"
          style={{ flexDirection: "row", alignItems: "center", justifyContent: "center", gap: 6 }}
        >
          <Ionicons name="chevron-back" size={14} color={p.muted} />
          <Txt variant="caption" color={p.muted}>
            Use a different email
          </Txt>
        </Pressable>
      </View>
    )
  }

  return (
    <View style={{ gap: 20 }}>
      <View style={{ gap: 6 }}>
        <Txt variant="title">{isSignUp ? "Join AI Socratic" : "Welcome back"}</Txt>
        <Txt variant="body" color={p.muted} style={{ lineHeight: 21 }}>
          {isSignUp
            ? "No passwords — we'll email you a code to get started."
            : "We'll email you a code. No password needed."}
        </Txt>
      </View>

      <View style={{ gap: 14 }}>
        {isSignUp ? (
          <Field
            label="Full name"
            value={name}
            onChangeText={setName}
            placeholder="Ada Lovelace"
            autoCapitalize="words"
            textContentType="name"
            autoComplete="name"
          />
        ) : null}

        <Field
          label="Email"
          value={email}
          onChangeText={setEmail}
          placeholder="you@example.com"
          keyboardType="email-address"
          autoCapitalize="none"
          autoCorrect={false}
          textContentType="emailAddress"
          autoComplete="email"
          error={error}
          onSubmitEditing={submitEmail}
          returnKeyType="go"
        />
      </View>

      <Button label="Continue with email" onPress={submitEmail} loading={busy} icon="mail-outline" />

      <View style={{ flexDirection: "row", alignItems: "center", gap: 12 }}>
        <View style={{ flex: 1, height: 1, backgroundColor: p.border }} />
        <Txt variant="caption" color={p.muted}>
          or
        </Txt>
        <View style={{ flex: 1, height: 1, backgroundColor: p.border }} />
      </View>

      <Button
        label="Continue with Google"
        variant="secondary"
        icon="logo-google"
        onPress={google}
        loading={googleBusy}
      />

      <Txt
        variant="caption"
        color={p.muted}
        style={{ textAlign: "center", lineHeight: 18, marginTop: 4, paddingHorizontal: layout.gutter }}
      >
        By continuing you agree to the AI Socratic community guidelines.
      </Txt>
    </View>
  )
}
