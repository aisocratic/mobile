import React from "react"
import { KeyboardAvoidingView, Platform, ScrollView } from "react-native"

import { AuthForm } from "@/components/auth-form"
import { Screen } from "@/components/ui"
import { layout } from "@/theme"

export default function SignUp() {
  return (
    <Screen>
      <KeyboardAvoidingView
        style={{ flex: 1 }}
        behavior={Platform.OS === "ios" ? "padding" : undefined}
      >
        <ScrollView
          contentContainerStyle={{ padding: layout.gutter, paddingTop: 12 }}
          keyboardShouldPersistTaps="handled"
        >
          <AuthForm mode="sign-up" />
        </ScrollView>
      </KeyboardAvoidingView>
    </Screen>
  )
}
