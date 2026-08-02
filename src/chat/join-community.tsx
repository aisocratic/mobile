import { Ionicons } from "@expo/vector-icons"
import * as WebBrowser from "expo-web-browser"
import React, { useEffect, useState } from "react"
import { Pressable, ScrollView, StyleSheet, View } from "react-native"

import { Button, Field, Muted, Txt } from "@/components/ui"
import { layout, usePalette } from "@/theme"

import { policyDocumentUrls, useJoinCommunity, usePendingInvite } from "./index"

/**
 * The "you're not a member yet" screen for a closed Buzz community.
 *
 * The relay answers NIP-42 AUTH from a non-member with
 * `restricted: not a relay member`, so there is nothing to show and nothing to
 * retry until an invite is redeemed. The only way in is an invite code minted
 * by the community owner via `POST /api/invites`.
 *
 * Two deliberate choices:
 *
 *  - The code is *pasted*, never shipped. An `EXPO_PUBLIC_` invite would be
 *    extractable from the bundle and, since invites can have unlimited uses,
 *    would quietly make a private community joinable by anyone. A code that
 *    arrived by link is prefilled, because the user chose to open that link —
 *    that is still their code, not the build's.
 *  - Age attestation is a real checkbox. The community sets
 *    `age_attestation_required: true`, and auto-sending `age_confirmed: true`
 *    would be forging a consent step rather than collecting one. Prefilling
 *    the code deliberately does *not* extend to prefilling this.
 */
export function JoinCommunity({ relayUrl }: { relayUrl: string }) {
  const p = usePalette()
  const [code, setCode] = useState("")
  const [ageConfirmed, setAgeConfirmed] = useState(false)
  const { join, joining, error } = useJoinCommunity()
  const pendingCode = usePendingInvite()

  // Only ever fills an untouched field: a code the user is mid-way through
  // typing outranks one that arrived by link.
  useEffect(() => {
    if (pendingCode) setCode((current) => current || pendingCode)
  }, [pendingCode])

  const docs = policyDocumentUrls(relayUrl)
  const host = relayUrl.replace(/^wss?:\/\//, "")
  const canSubmit = code.trim().length > 0 && ageConfirmed && !joining

  const openDoc = (url: string) => {
    void WebBrowser.openBrowserAsync(url).catch(() => {
      /* no browser available; the code entry still works */
    })
  }

  return (
    <ScrollView
      contentContainerStyle={{ padding: layout.gutter, gap: 18, paddingBottom: 48 }}
      keyboardShouldPersistTaps="handled"
    >
      <View style={{ alignItems: "center", gap: 10, paddingTop: 12 }}>
        <Ionicons name="mail-unread-outline" size={34} color={p.accent} />
        <Txt variant="title" style={{ textAlign: "center" }}>
          Join the community
        </Txt>
        <Txt variant="body" color={p.muted} style={{ textAlign: "center", lineHeight: 21 }}>
          {host} is a private Buzz community. You need an invite code from the community owner
          before you can see or send messages.
        </Txt>
      </View>

      <Field
        label="Invite code"
        value={code}
        onChangeText={setCode}
        placeholder="v2.…"
        autoCapitalize="none"
        autoCorrect={false}
        autoComplete="off"
        editable={!joining}
        error={error}
      />

      {/* Explicit, affirmative consent — not a default. */}
      <Pressable
        accessibilityRole="checkbox"
        accessibilityState={{ checked: ageConfirmed }}
        onPress={() => setAgeConfirmed((v) => !v)}
        style={{ flexDirection: "row", gap: 10, alignItems: "flex-start" }}
      >
        <View
          style={{
            width: 22,
            height: 22,
            borderRadius: 6,
            borderWidth: StyleSheet.hairlineWidth * 2,
            borderColor: ageConfirmed ? p.accent : p.border,
            backgroundColor: ageConfirmed ? p.accent : "transparent",
            alignItems: "center",
            justifyContent: "center",
            marginTop: 1,
          }}
        >
          {ageConfirmed ? <Ionicons name="checkmark" size={15} color="#0A0A0A" /> : null}
        </View>
        <Txt variant="body" color={p.muted} style={{ flex: 1, lineHeight: 20 }}>
          I confirm I meet the minimum age requirement and accept the community terms and privacy
          notice.
        </Txt>
      </Pressable>

      <View style={{ flexDirection: "row", gap: 16 }}>
        <Pressable onPress={() => openDoc(docs.terms)}>
          <Txt variant="label" color={p.accent}>
            Read terms
          </Txt>
        </Pressable>
        <Pressable onPress={() => openDoc(docs.privacy)}>
          <Txt variant="label" color={p.accent}>
            Privacy notice
          </Txt>
        </Pressable>
      </View>

      <Button
        label={joining ? "Joining…" : "Join community"}
        icon="log-in-outline"
        loading={joining}
        disabled={!canSubmit}
        onPress={() => void join(code, ageConfirmed)}
      />

      <Muted style={{ lineHeight: 18 }}>
        Your invite is redeemed over HTTPS and signed with your chat key (NIP-98). The code is used
        once and never stored on this device.
      </Muted>
    </ScrollView>
  )
}
