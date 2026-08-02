import { useLocalSearchParams, useRouter } from "expo-router"
import React, { useEffect } from "react"

import { Loading } from "@/components/ui"
import { rememberPendingInvite } from "@/chat/pending-invite"
import { homeRoute, isEnabled } from "@/features"

/**
 * Landing route for `aisocratic://invite/<code>`.
 *
 * Mirrors the path the relay itself serves (`https://<host>/invite/<code>`),
 * so one shared link addresses both the web client and this app.
 *
 * The claim can't happen here: it has to be signed by a chat key, and that key
 * is derived from the session. So the code is parked and the user is sent to
 * Chat — which is gated, so a signed-out recipient lands on the welcome screen
 * and finds the code waiting in the join form once they have an account.
 *
 * `replace`, not `push`: an invite link is a one-shot entry point, and leaving
 * it on the back stack would let a stray back-swipe re-park a code the user
 * has already redeemed.
 */
export default function InviteLinkScreen() {
  const { code } = useLocalSearchParams<{ code: string }>()
  const router = useRouter()

  useEffect(() => {
    // Chat off: don't park a code there is no screen to redeem it on. Storing
    // it would leave a join capability sitting on the device indefinitely, and
    // it would silently activate the day chat is switched back on.
    if (!isEnabled("chat")) {
      router.replace(homeRoute())
      return
    }

    void rememberPendingInvite(code ?? "").finally(() => {
      router.replace("/(tabs)/chat")
    })
  }, [code, router])

  return <Loading label="Opening your invite…" />
}
