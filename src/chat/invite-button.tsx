import { useRouter } from "expo-router"
import React from "react"

import { IconButton } from "@/components/ui"

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
  const router = useRouter()
  const status = useChatStatus()
  const caps = useRelayCapabilities()

  if (!caps?.supportsInvites) return null
  if (status === "unavailable" || status === "not-a-member") return null

  return (
    <IconButton
      icon="person-add-outline"
      label="Invite someone to the community"
      onPress={() => router.push("/invite/new")}
    />
  )
}
