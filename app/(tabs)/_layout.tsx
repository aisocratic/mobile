import { Ionicons } from "@expo/vector-icons"
import { Tabs } from "expo-router"
import React from "react"
import { StyleSheet } from "react-native"

import { InviteButton } from "@/chat/invite-button"
import { isEnabled } from "@/features"
import { usePalette } from "@/theme"

/**
 * Every screen file in this directory becomes a tab whether it is listed here
 * or not, so hiding one means rendering it with `href: null` rather than
 * omitting the `<Tabs.Screen>`. Omitting it would put the tab back with default
 * options — the opposite of what a disabled flag should do.
 *
 * Declaration order is tab order. See `src/features.ts`.
 */
export default function TabsLayout() {
  const p = usePalette()
  const chat = isEnabled("chat")

  /** `null` removes the tab from the bar and makes the route unreachable. */
  const href = (enabled: boolean) => (enabled ? undefined : null)

  return (
    <Tabs
      screenOptions={{
        tabBarActiveTintColor: p.accent,
        tabBarInactiveTintColor: p.muted,
        tabBarStyle: {
          backgroundColor: p.tab,
          borderTopColor: p.border,
          borderTopWidth: StyleSheet.hairlineWidth,
        },
        tabBarLabelStyle: { fontSize: 11, fontWeight: "600" },
        headerStyle: { backgroundColor: p.background },
        headerTintColor: p.text,
        headerTitleStyle: { fontWeight: "700", fontSize: 20 },
        headerShadowVisible: false,
        sceneStyle: { backgroundColor: p.background },
      }}
    >
      <Tabs.Screen
        name="feed"
        options={{
          title: "Feed",
          href: href(isEnabled("feed")),
          tabBarIcon: ({ color, size }) => <Ionicons name="newspaper" size={size} color={color} />,
        }}
      />
      <Tabs.Screen
        name="events"
        options={{
          title: "Events",
          href: href(isEnabled("events")),
          tabBarIcon: ({ color, size }) => <Ionicons name="calendar" size={size} color={color} />,
        }}
      />
      <Tabs.Screen
        name="connections"
        options={{
          title: "Connections",
          // "Connections" truncates in the tab bar; the screen header keeps the
          // full word.
          tabBarLabel: "People",
          href: href(isEnabled("connections")),
          tabBarIcon: ({ color, size }) => <Ionicons name="people" size={size} color={color} />,
        }}
      />
      <Tabs.Screen
        name="chat"
        options={{
          title: "Chat",
          href: href(chat),
          tabBarIcon: ({ color, size }) => <Ionicons name="chatbubbles" size={size} color={color} />,
          // Renders nothing on an open relay or before this key is a member.
          headerRight: chat ? () => <InviteButton /> : undefined,
        }}
      />
      <Tabs.Screen
        name="profile"
        options={{
          title: "Profile",
          href: href(isEnabled("profile")),
          tabBarIcon: ({ color, size }) => (
            <Ionicons name="person-circle" size={size} color={color} />
          ),
        }}
      />
    </Tabs>
  )
}
