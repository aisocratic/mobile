import { Ionicons } from "@expo/vector-icons"
import { useRouter } from "expo-router"
import * as WebBrowser from "expo-web-browser"
import React, { useCallback, useState } from "react"
import { Alert, Linking, ScrollView, StyleSheet, View } from "react-native"

import { FadeIn } from "@/components/fade-in"
import { Touchable } from "@/components/touchable"
import { Avatar, Button, Card, Divider, Muted, Screen, Txt } from "@/components/ui"
import { SITE_URL } from "@/lib/supabase"
import { useAuth } from "@/store/auth"
import { layout, motion, space, usePalette } from "@/theme"

/** Icon width + the row's gap, so a divider starts at the label. */
const ROW_INSET = 20 + space.md + space.hair

function Row({
  icon,
  label,
  value,
  onPress,
}: {
  icon: keyof typeof Ionicons.glyphMap
  label: string
  value?: string | null
  onPress?: () => void
}) {
  const p = usePalette()

  return (
    <Touchable
      accessibilityRole={onPress ? "button" : undefined}
      onPress={onPress}
      disabled={!onPress}
      // A static info row isn't tappable, so it must not shrink under a finger
      // resting on it — only the ones that go somewhere respond.
      scale={onPress ? motion.pressScale : 1}
      activeOpacity={onPress ? 0.6 : 1}
      style={{
        flexDirection: "row",
        alignItems: "center",
        gap: space.md + space.hair,
        paddingVertical: space.md + space.hair,
      }}
    >
      <Ionicons name={icon} size={20} color={p.muted} />
      <View style={{ flex: 1 }}>
        <Txt variant="body">{label}</Txt>
        {value ? <Muted style={{ marginTop: space.hair }}>{value}</Muted> : null}
      </View>
      {onPress ? <Ionicons name="chevron-forward" size={17} color={p.muted} /> : null}
    </Touchable>
  )
}

export default function ProfileTab() {
  const p = usePalette()
  const router = useRouter()
  const { user, profile, signOut } = useAuth()
  const [signingOut, setSigningOut] = useState(false)

  const name =
    profile?.full_name ??
    (user?.user_metadata?.full_name as string | undefined) ??
    user?.email?.split("@")[0] ??
    "Member"

  const avatar =
    profile?.avatar_url ?? (user?.user_metadata?.avatar_url as string | undefined) ?? null

  const confirmSignOut = useCallback(() => {
    Alert.alert("Sign out?", "You'll need to enter a new email code to get back in.", [
      { text: "Cancel", style: "cancel" },
      {
        text: "Sign out",
        style: "destructive",
        onPress: () => {
          setSigningOut(true)
          void signOut().finally(() => setSigningOut(false))
        },
      },
    ])
  }, [signOut])

  const open = useCallback((url: string) => {
    void WebBrowser.openBrowserAsync(url)
  }, [])

  const editProfile = useCallback(() => router.push("/profile/edit"), [router])

  return (
    <Screen>
      <ScrollView
        contentContainerStyle={{
          padding: layout.gutter,
          gap: space.xl,
          paddingBottom: space.xxxl,
        }}
      >
        <FadeIn style={{ alignItems: "center", gap: space.md, paddingTop: space.sm }}>
          <Avatar uri={avatar} name={name} size={88} />
          <View style={{ alignItems: "center", gap: space.hair }}>
            <Txt variant="title">{name}</Txt>
            <Muted>{user?.email}</Muted>
          </View>
          {profile?.is_member ? (
            <View
              style={{
                paddingHorizontal: space.md,
                paddingVertical: space.xs + 1,
                borderRadius: layout.radiusPill,
                backgroundColor: `${p.accent}22`,
                borderWidth: StyleSheet.hairlineWidth,
                borderColor: `${p.accent}55`,
              }}
            >
              <Txt variant="caption" color={p.accent}>
                Community member
              </Txt>
            </View>
          ) : null}
        </FadeIn>

        {profile?.bio ? (
          <Card>
            <Txt variant="body">{profile.bio}</Txt>
          </Card>
        ) : null}

        {profile?.organization || profile?.job_title || profile?.location ? (
          // Hairlines between rows: without them a stack of icon rows inside a
          // single card reads as one undifferentiated block. Inset past the
          // icon column so they line up with the labels.
          <Card style={{ paddingVertical: space.xs }}>
            {profile.job_title ? (
              <Row icon="briefcase-outline" label="Role" value={profile.job_title} />
            ) : null}
            {profile.organization ? (
              <Row icon="business-outline" label="Organization" value={profile.organization} />
            ) : null}
            {profile.location ? (
              <Row icon="location-outline" label="Location" value={profile.location} />
            ) : null}
          </Card>
        ) : null}

        {!profile ? (
          <Card style={{ gap: space.sm + space.hair }}>
            <Txt variant="heading">Finish your profile</Txt>
            <Txt variant="body" color={p.muted}>
              We couldn't find a community profile linked to this account yet. Add your details and
              other members will see them across AI Socratic.
            </Txt>
            <Button
              label="Complete my profile"
              variant="secondary"
              icon="create-outline"
              onPress={editProfile}
            />
          </Card>
        ) : null}

        <Card style={{ paddingVertical: space.xs }}>
          <Row icon="person-circle-outline" label="Edit profile" onPress={editProfile} />
          <Divider inset={ROW_INSET} />
          <Row
            icon="mail-outline"
            label="Contact the team"
            onPress={() => open(`${SITE_URL}/contact`)}
          />
          <Divider inset={ROW_INSET} />
          <Row
            icon="document-text-outline"
            label="Privacy policy"
            onPress={() => open(`${SITE_URL}/privacy-policy`)}
          />
          <Divider inset={ROW_INSET} />
          <Row
            icon="settings-outline"
            label="System settings"
            onPress={() => void Linking.openSettings()}
          />
        </Card>

        <Button
          label="Sign out"
          variant="ghost"
          icon="log-out-outline"
          loading={signingOut}
          onPress={confirmSignOut}
        />

        <Muted style={{ textAlign: "center" }}>AI Socratic for iOS & Android · v0.1.0</Muted>
      </ScrollView>
    </Screen>
  )
}
