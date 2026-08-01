import { Ionicons } from "@expo/vector-icons"
import * as WebBrowser from "expo-web-browser"
import React, { useCallback, useState } from "react"
import { Alert, Linking, Pressable, ScrollView, StyleSheet, View } from "react-native"

import { Avatar, Button, Card, Muted, Screen, Txt } from "@/components/ui"
import { SITE_URL } from "@/lib/supabase"
import { useAuth } from "@/store/auth"
import { layout, usePalette } from "@/theme"

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
    <Pressable
      accessibilityRole={onPress ? "button" : undefined}
      onPress={onPress}
      style={({ pressed }) => ({
        flexDirection: "row",
        alignItems: "center",
        gap: 14,
        paddingVertical: 14,
        opacity: pressed && onPress ? 0.6 : 1,
      })}
    >
      <Ionicons name={icon} size={20} color={p.muted} />
      <View style={{ flex: 1 }}>
        <Txt variant="body">{label}</Txt>
        {value ? <Muted style={{ marginTop: 2 }}>{value}</Muted> : null}
      </View>
      {onPress ? <Ionicons name="chevron-forward" size={17} color={p.muted} /> : null}
    </Pressable>
  )
}

export default function ProfileTab() {
  const p = usePalette()
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

  return (
    <Screen>
      <ScrollView contentContainerStyle={{ padding: layout.gutter, gap: 20, paddingBottom: 40 }}>
        <View style={{ alignItems: "center", gap: 12, paddingTop: 8 }}>
          <Avatar uri={avatar} name={name} size={88} />
          <View style={{ alignItems: "center", gap: 3 }}>
            <Txt variant="title">{name}</Txt>
            <Muted>{user?.email}</Muted>
          </View>
          {profile?.is_member ? (
            <View
              style={{
                paddingHorizontal: 12,
                paddingVertical: 5,
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
        </View>

        {profile?.bio ? (
          <Card>
            <Txt variant="body" style={{ lineHeight: 22 }}>
              {profile.bio}
            </Txt>
          </Card>
        ) : null}

        {profile?.organization || profile?.job_title || profile?.location ? (
          <Card style={{ paddingVertical: 4 }}>
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
          <Card style={{ gap: 10 }}>
            <Txt variant="heading">Finish your profile on the web</Txt>
            <Txt variant="body" color={p.muted} style={{ lineHeight: 21 }}>
              We couldn't find a community profile linked to this account yet. Complete it on
              aisocratic.org and it'll show up here.
            </Txt>
            <Button
              label="Open my profile"
              variant="secondary"
              icon="open-outline"
              onPress={() => open(`${SITE_URL}/profile`)}
            />
          </Card>
        ) : null}

        <Card style={{ paddingVertical: 4 }}>
          <Row
            icon="person-circle-outline"
            label="Edit profile"
            onPress={() => open(`${SITE_URL}/profile`)}
          />
          <Row
            icon="globe-outline"
            label="Open aisocratic.org"
            onPress={() => open(SITE_URL)}
          />
          <Row
            icon="mail-outline"
            label="Contact the team"
            onPress={() => open(`${SITE_URL}/contact`)}
          />
          <Row
            icon="shield-checkmark-outline"
            label="Community guidelines"
            onPress={() => open(`${SITE_URL}/about/guidelines`)}
          />
          <Row
            icon="document-text-outline"
            label="Privacy policy"
            onPress={() => open(`${SITE_URL}/privacy-policy`)}
          />
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
