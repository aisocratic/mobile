import { Ionicons } from "@expo/vector-icons"
import { useRouter } from "expo-router"
import React from "react"
import { Pressable } from "react-native"

import { layout, usePalette } from "@/theme"

import { useChatStatus, useRelayCapabilities } from "./index"

/**
 * "Invite" action for the Chat tab header.
 *
 * Hidden in exactly two cases, both of which mean the action would be a lie:
 * an open relay has no membership to grant, and a key the relay has already
 * refused can't mint for anyone else. Notably it is *not* hidden from
 * non-admins — the app can't read its own role, and guessing wrong either way
 * is worse than letting the relay answer.
 */
export function InviteButton() {
  const p = usePalette()
  const router = useRouter()
  const status = useChatStatus()
  const caps = useRelayCapabilities()

  if (!caps?.supportsInvites) return null
  if (status === "unavailable" || status === "not-a-member") return null

  return (
    <Pressable
      accessibilityRole="button"
      accessibilityLabel="Invite someone to the community"
      onPress={() => router.push("/invite/new")}
      hitSlop={10}
      style={({ pressed }) => ({
        paddingHorizontal: layout.gutter - 8,
        opacity: pressed ? 0.6 : 1,
      })}
    >
      <Ionicons name="person-add-outline" size={22} color={p.text} />
    </Pressable>
  )
}
