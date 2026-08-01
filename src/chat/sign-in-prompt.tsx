import { useRouter } from "expo-router"
import React from "react"
import { View } from "react-native"

import { Button, EmptyState } from "@/components/ui"

/**
 * Shown whenever chat is reached without a session.
 *
 * `AuthGate` in app/_layout.tsx should make this unreachable, but chat has a
 * hard dependency on the session that other screens don't: the user's Nostr
 * keypair is derived from their auth uuid, so with no session there is no
 * identity, no relay connection and nothing to subscribe with. Rendering an
 * explanation here means a future change to the gating degrades into a clear
 * message instead of a blank screen.
 */
export function SignInPrompt({ body }: { body?: string }) {
  const router = useRouter()

  return (
    <View style={{ flex: 1, justifyContent: "center" }}>
      <EmptyState
        icon="lock-closed-outline"
        title="Sign in to chat"
        body={
          body ??
          "Chat signs every message with a key derived from your account, so you'll need to be signed in to join the conversation."
        }
        action={<Button label="Sign in" onPress={() => router.replace("/(auth)/welcome")} />}
      />
    </View>
  )
}
