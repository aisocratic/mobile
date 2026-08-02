import { QueryClientProvider } from "@tanstack/react-query"
import { Stack, useRouter, useSegments } from "expo-router"
import { StatusBar } from "expo-status-bar"
import React, { useEffect } from "react"
import { GestureHandlerRootView } from "react-native-gesture-handler"
import { SafeAreaProvider } from "react-native-safe-area-context"

import { Loading } from "@/components/ui"
import { homeRoute, isEnabled } from "@/features"
import { queryClient } from "@/lib/query"
import { AuthProvider, useAuth } from "@/store/auth"
import { usePalette, useIsDark } from "@/theme"

/**
 * Events, news and the blog are public on aisocratic.org, so they stay
 * browsable without an account. Only the surfaces that are about *you* need a
 * session; hitting one signed-out bounces to the welcome screen.
 */
const GATED_ROUTES = new Set(["connections", "chat", "profile", "member"])

/**
 * Route segments that only exist when a feature is on.
 *
 * `href: null` removes a tab from the bar, but a deep link — `aisocratic://`,
 * a push notification, a shared invite URL — addresses the route directly and
 * would otherwise render a screen the build is meant not to have. This is the
 * backstop for everything that doesn't come through the tab bar.
 */
const FEATURE_ROUTES: Record<string, Parameters<typeof isEnabled>[0]> = {
  chat: "chat",
  invite: "chat",
  connections: "connections",
  member: "connections",
  feed: "feed",
  events: "events",
  event: "events",
  profile: "profile",
}

function AuthGate({ children }: { children: React.ReactNode }) {
  const { session, loading } = useAuth()
  const segments = useSegments()
  const router = useRouter()

  useEffect(() => {
    if (loading) return

    const inAuthGroup = segments[0] === "(auth)"
    // segments looks like ["(tabs)", "connections"] or ["chat", "[id]"].
    const needsSession = segments.some((s) => GATED_ROUTES.has(s))

    const disabled = segments.some((s) => {
      const feature = FEATURE_ROUTES[s]
      return feature !== undefined && !isEnabled(feature)
    })

    if (disabled) {
      // Send them somewhere real rather than leaving a half-rendered screen
      // from a section this build doesn't ship.
      router.replace(homeRoute())
    } else if (!session && needsSession) {
      router.replace("/(auth)/welcome")
    } else if (session && inAuthGroup) {
      router.replace(homeRoute())
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
      <Stack.Screen name="auth/callback" options={{ headerShown: false }} />
      <Stack.Screen name="(auth)" options={{ headerShown: false }} />
      <Stack.Screen name="(tabs)" options={{ headerShown: false }} />
      <Stack.Screen name="event/[id]" options={{ title: "Event" }} />
      <Stack.Screen name="article/[slug]" options={{ title: "" }} />
      <Stack.Screen name="news/[id]" options={{ title: "" }} />
      <Stack.Screen name="member/[id]" options={{ title: "Member" }} />
      <Stack.Screen name="profile/edit" options={{ title: "Edit profile" }} />
      <Stack.Screen
        name="chat/[id]"
        options={{ title: "Chat", headerBackButtonDisplayMode: "minimal" }}
      />
      <Stack.Screen name="invite/new" options={{ title: "Invite" }} />
      {/* Landing route for a shared invite link; it redirects on mount. */}
      <Stack.Screen name="invite/[code]" options={{ headerShown: false }} />
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
