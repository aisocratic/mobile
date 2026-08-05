import { Ionicons } from "@expo/vector-icons"
import * as WebBrowser from "expo-web-browser"
import React, { useEffect, useState } from "react"
import { ActivityIndicator, Pressable, ScrollView, StyleSheet, View } from "react-native"

import { Button, Field, Muted, Txt } from "@/components/ui"
import { layout, usePalette } from "@/theme"

import { policyDocumentUrls, useCommunityOnboarding } from "./index"

/**
 * The "you're not a member yet" screen for a closed Buzz community.
 *
 * The relay answers NIP-42 AUTH from a non-member with
 * `restricted: not a relay member`, so there is nothing to show and nothing to
 * retry until an invite is redeemed.
 *
 * There are two ways to get one, and the screen leads with whichever is
 * available:
 *
 *  - **Automatic.** The app asks aisocratic.org to mint a single-use, 5-minute
 *    invite for this signed-in account and redeems it on the spot. The key
 *    that can mint invites belongs to the community owner and lives on that
 *    server; it is never in this bundle and never on the device.
 *  - **A pasted code**, which is the fallback whenever the automatic path is
 *    not configured or fails, and the way it has always worked.
 *
 * Two things are deliberately not automated:
 *
 *  - **The invite code is never shipped.** An `EXPO_PUBLIC_` invite would be
 *    extractable from the bundle and, since invites can have unlimited uses,
 *    would quietly make a private community joinable by anyone. A code that
 *    arrived by link is prefilled, because the user chose to open that link —
 *    that is still their code, not the build's.
 *  - **Age attestation is a real checkbox.** The community sets
 *    `age_attestation_required: true`, and auto-sending `age_confirmed: true`
 *    would be forging a consent step rather than collecting one. Automating
 *    the clerical work does not extend to automating the agreement, so the
 *    one-tap path is one tap *after* the box is ticked.
 */
export function JoinCommunity({ relayUrl }: { relayUrl: string }) {
  const p = usePalette()
  const [code, setCode] = useState("")
  const [ageConfirmed, setAgeConfirmed] = useState(false)

  const {
    canAutoJoin,
    preparing,
    requiresAgeAttestation,
    linkedCode,
    joining,
    error,
    needsCode,
    autoJoin,
    joinWithCode,
  } = useCommunityOnboarding()

  // Only ever fills an untouched field: a code the user is mid-way through
  // typing outranks one that arrived by link.
  useEffect(() => {
    if (linkedCode) setCode((current) => current || linkedCode)
  }, [linkedCode])

  const docs = policyDocumentUrls(relayUrl)
  const host = relayUrl.replace(/^wss?:\/\//, "")

  // A community with no policy asks for no attestation, so requiring the tick
  // there would be inventing a consent step rather than honouring one.
  const consentGiven = ageConfirmed || !requiresAgeAttestation

  // Show the code field when the automatic path is unavailable or has failed,
  // and also whenever a code arrived by link — the user opened that link
  // expecting it to be used, and hiding it behind a fallback would be strange.
  const showCodeField = needsCode || !!linkedCode
  const canSubmitCode = code.trim().length > 0 && consentGiven && !joining
  const canSubmitAuto = consentGiven && !joining && !preparing

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
        <Ionicons
          name={canAutoJoin && !needsCode ? "sparkles-outline" : "mail-unread-outline"}
          size={34}
          color={p.accent}
        />
        <Txt variant="title" style={{ textAlign: "center" }}>
          Join the community
        </Txt>
        <Txt variant="body" color={p.muted} style={{ textAlign: "center" }}>
          {canAutoJoin && !needsCode
            ? `${host} is a private Buzz community. We'll create your chat account and get you in — no invite code needed.`
            : `${host} is a private Buzz community. You need an invite code from the community owner before you can see or send messages.`}
        </Txt>
      </View>

      {showCodeField ? (
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
      ) : error ? (
        <Txt variant="body" color={p.danger} >
          {error}
        </Txt>
      ) : null}

      {/* Explicit, affirmative consent — not a default, and not skipped just
          because the rest of the flow is automatic. */}
      {requiresAgeAttestation ? (
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
          <Txt variant="body" color={p.muted} style={{ flex: 1 }}>
            I confirm I meet the minimum age requirement and accept the community terms and privacy
            notice.
          </Txt>
        </Pressable>
      ) : null}

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

      {preparing ? (
        <View style={{ flexDirection: "row", gap: 10, alignItems: "center" }}>
          <ActivityIndicator color={p.accent} />
          <Muted>Checking the community's terms…</Muted>
        </View>
      ) : null}

      {showCodeField ? (
        <Button
          label={joining ? "Joining…" : "Join with code"}
          icon="log-in-outline"
          loading={joining}
          disabled={!canSubmitCode}
          onPress={() => void joinWithCode(code, ageConfirmed)}
        />
      ) : (
        <Button
          label={joining ? "Setting up your account…" : "Create my account & join"}
          icon="sparkles-outline"
          loading={joining}
          disabled={!canSubmitAuto}
          onPress={() => void autoJoin(ageConfirmed)}
        />
      )}

      <Muted>
        {showCodeField
          ? "Your invite is redeemed over HTTPS and signed with your chat key (NIP-98). The code is used once and never stored on this device."
          : "A chat key is generated on this device and stays in its secure storage — only the public half is published so members can message you. The invite is single-use and expires in five minutes."}
      </Muted>
    </ScrollView>
  )
}
