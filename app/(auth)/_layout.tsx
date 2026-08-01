import { Stack } from "expo-router"
import React from "react"

import { usePalette } from "@/theme"

export default function AuthLayout() {
  const p = usePalette()

  return (
    <Stack
      screenOptions={{
        headerStyle: { backgroundColor: p.background },
        headerTintColor: p.text,
        headerShadowVisible: false,
        headerTitle: "",
        headerBackButtonDisplayMode: "minimal",
        contentStyle: { backgroundColor: p.background },
      }}
    >
      <Stack.Screen name="welcome" options={{ headerShown: false }} />
      <Stack.Screen name="sign-in" />
      <Stack.Screen name="sign-up" />
    </Stack>
  )
}
