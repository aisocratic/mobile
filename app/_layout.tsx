import { QueryClientProvider } from "@tanstack/react-query"
import { Stack, useRouter, useSegments } from "expo-router"
import { StatusBar } from "expo-status-bar"
import React, { useEffect } from "react"
import { GestureHandlerRootView } from "react-native-gesture-handler"
import { SafeAreaProvider } from "react-native-safe-area-context"

import { Loading } from "@/components/ui"
import { queryClient } from "@/lib/query"
import { AuthProvider, useAuth } from "@/store/auth"
import { usePalette, useIsDark } from "@/theme"

/**
 * Events, news and the blog are public on aisocratic.org, so they stay
 * browsable without an account. Only the surfaces that are about *you* need a
 * session; hitting one signed-out bounces to the welcome screen.
 */
const GATED_ROUTES = new Set(["connections", "chat", "profile", "member"])

function AuthGate({ children }: { children: React.ReactNode }) {
  const { session, loading } = useAuth()
  const segments = useSegments()
  const router = useRouter()

  useEffect(() => {
    if (loading) return

    const inAuthGroup = segments[0] === "(auth)"
    // segments looks like ["(tabs)", "connections"] or ["chat", "[id]"].
    const needsSession = segments.some((s) => GATED_ROUTES.has(s))

    if (!session && needsSession) {
      router.replace("/(auth)/welcome")
    } else if (session && inAuthGroup) {
      router.replace("/(tabs)/events")
    }
  }, [session, loading, segments, router])

  if (loading) return <Loading label="Restoring your session…" />
  return <>{children}</>
}

function RootNavigator() {
  const p = usePalette()

  return (
    <Stack
      screenOptions={{
        headerStyle: { backgroundColor: p.background },
        headerTintColor: p.text,
        headerTitleStyle: { fontWeight: "600" },
        headerShadowVisible: false,
        // Without this the back button inherits the previous route's title and
        // renders the group name, e.g. "(tabs)".
        headerBackButtonDisplayMode: "minimal",
        contentStyle: { backgroundColor: p.background },
      }}
    >
      <Stack.Screen name="index" options={{ headerShown: false }} />
      <Stack.Screen name="(auth)" options={{ headerShown: false }} />
      <Stack.Screen name="(tabs)" options={{ headerShown: false }} />
      <Stack.Screen name="event/[id]" options={{ title: "Event" }} />
      <Stack.Screen name="article/[slug]" options={{ title: "" }} />
      <Stack.Screen name="news/[id]" options={{ title: "" }} />
      <Stack.Screen name="member/[id]" options={{ title: "Member" }} />
      <Stack.Screen
        name="chat/[id]"
        options={{ title: "Chat", headerBackButtonDisplayMode: "minimal" }}
      />
    </Stack>
  )
}

export default function RootLayout() {
  const isDark = useIsDark()

  return (
    <GestureHandlerRootView style={{ flex: 1 }}>
      <SafeAreaProvider>
        <QueryClientProvider client={queryClient}>
          <AuthProvider>
            <StatusBar style={isDark ? "light" : "dark"} />
            <AuthGate>
              <RootNavigator />
            </AuthGate>
          </AuthProvider>
        </QueryClientProvider>
      </SafeAreaProvider>
    </GestureHandlerRootView>
  )
}
