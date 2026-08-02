import React from "react"

import { RELAY_URL } from "@/chat"
import { InvitePeople } from "@/chat/invite-people"
import { SignInPrompt } from "@/chat/sign-in-prompt"
import { useAuth } from "@/store/auth"

/**
 * Create an invite to the community chat.
 *
 * Self-gating rather than listed in `GATED_ROUTES`: minting needs a chat key,
 * which is derived from the session, so the honest failure without one is the
 * same "sign in first" this screen already knows how to render.
 */
export default function NewInviteScreen() {
  const { session } = useAuth()

  if (!session) {
    return (
      <SignInPrompt body="Invites are signed with a key derived from your account, so you'll need to be signed in to create one." />
    )
  }

  return <InvitePeople relayUrl={RELAY_URL} />
}
