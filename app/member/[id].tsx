import { Ionicons } from "@expo/vector-icons"
import { Stack, useLocalSearchParams, useRouter } from "expo-router"
import * as WebBrowser from "expo-web-browser"
import React, { useCallback, useMemo } from "react"
import { Pressable, RefreshControl, ScrollView, StyleSheet, View } from "react-native"

import { useConnections, useMemberProfile, type MemberProfile } from "@/api/connections"
import {
  Avatar,
  Button,
  Card,
  Chip,
  Divider,
  EmptyState,
  ErrorState,
  Loading,
  Screen,
  Txt,
} from "@/components/ui"
import { isEnabled } from "@/features"
import { formatDay, linkedinUrl as toLinkedin } from "@/lib/format"
import { layout, usePalette } from "@/theme"
import type { ConnectionRole, SharedEvent } from "@/types"

/** event_users stores full URLs for most people, bare handles for a few. */
function socialUrl(value: string | null, host: string): string | null {
  if (!value) return null
  const trimmed = value.trim()
  if (!trimmed) return null
  if (/^https?:\/\//i.test(trimmed)) return trimmed
  return `https://${host}/${trimmed.replace(/^@/, "")}`
}

function roleLabel(role: ConnectionRole): string {
  return role === "host" ? "Host" : "Guest"
}

/* ------------------------------------------------------------------ pieces */

function SharedEventRow({
  event,
  onPress,
}: {
  event: SharedEvent
  onPress: (eventId: string) => void
}) {
  const p = usePalette()

  return (
    <Pressable
      accessibilityRole="button"
      accessibilityLabel={event.title ?? "Event"}
      onPress={() => onPress(event.eventId)}
      style={({ pressed }) => [styles.eventRow, { opacity: pressed ? 0.6 : 1 }]}
    >
      <View style={{ flex: 1, gap: 6 }}>
        <Txt variant="heading" numberOfLines={2}>
          {event.title ?? "Untitled event"}
        </Txt>

        <Txt variant="caption" color={p.muted}>
          {[formatDay(event.startAt) || "Date TBA", event.city].filter(Boolean).join(" · ")}
        </Txt>

        <View style={styles.roleRow}>
          <Chip
            label={`You · ${roleLabel(event.myRole)}`}
            tone={event.myRole === "host" ? "accent" : "muted"}
          />
          <Chip
            label={`Them · ${roleLabel(event.theirRole)}`}
            tone={event.theirRole === "host" ? "accent" : "muted"}
          />
        </View>
      </View>

      <Ionicons name="chevron-forward" size={16} color={p.border} style={{ marginTop: 4 }} />
    </Pressable>
  )
}

/* ----------------------------------------------------------------- screen */

export default function MemberScreen() {
  const p = usePalette()
  const router = useRouter()
  const { id } = useLocalSearchParams<{ id: string }>()

  const profileQuery = useMemberProfile(id)
  const connectionsQuery = useConnections()

  const connection = useMemo(
    () => connectionsQuery.data?.connections.find((c) => c.id === id) ?? null,
    [connectionsQuery.data, id],
  )

  // The profile read can come back empty (the row is RLS-scoped) while the list
  // still holds a usable snapshot of this person — fall back to it rather than
  // showing an error for someone the user just tapped.
  const profile: MemberProfile | null = useMemo(() => {
    if (profileQuery.data) return profileQuery.data
    if (!connection) return null
    return {
      id: connection.id,
      name: connection.name,
      email: connection.email,
      avatarUrl: connection.avatarUrl,
      company: connection.company,
      title: connection.title,
      location: connection.location,
      bio: null,
      headline: null,
      expertise: [],
      linkedinUrl: connection.linkedinUrl,
      twitterUrl: null,
      githubUrl: null,
      eventCount: connection.sharedEvents.length,
    }
  }, [profileQuery.data, connection])

  const openLink = useCallback(async (url: string) => {
    try {
      await WebBrowser.openBrowserAsync(url)
    } catch {
      // A missing browser shouldn't take the screen down with it.
    }
  }, [])

  const openEvent = useCallback(
    (eventId: string) => router.push({ pathname: "/event/[id]", params: { id: eventId } }),
    [router],
  )

  const openChat = useCallback(() => {
    if (!id) return
    // `/chat/[id]` is registered in app/_layout.tsx but its screen file is owned
    // by the chat feature, so expo-router hasn't generated a typed route for it
    // yet. Assert rather than block the build — the path itself is correct.
    router.push({ pathname: "/chat/[id]", params: { id } } as never)
  }, [router, id])

  const refreshing =
    (profileQuery.isFetching && !profileQuery.isPending) ||
    (connectionsQuery.isFetching && !connectionsQuery.isPending)

  const refresh = useCallback(() => {
    void profileQuery.refetch()
    void connectionsQuery.refetch()
  }, [profileQuery, connectionsQuery])

  if (profileQuery.isPending && !connection) {
    return (
      <Screen>
        <Stack.Screen options={{ title: "Member" }} />
        <Loading label="Loading profile…" />
      </Screen>
    )
  }

  if (profileQuery.error && !profile) {
    return (
      <Screen>
        <Stack.Screen options={{ title: "Member" }} />
        <ErrorState error={profileQuery.error} onRetry={() => void profileQuery.refetch()} />
      </Screen>
    )
  }

  if (!profile) {
    return (
      <Screen>
        <Stack.Screen options={{ title: "Member" }} />
        <EmptyState
          icon="person-outline"
          title="Profile not available"
          body="We can't see this person's record from your account. Profiles are only visible for people you've shared an event with."
        />
      </Screen>
    )
  }

  const linkedin = toLinkedin(profile.linkedinUrl)
  const twitter = socialUrl(profile.twitterUrl, "x.com")
  const github = socialUrl(profile.githubUrl, "github.com")
  const affiliation = [profile.title, profile.company].filter(Boolean).join(" @ ")
  const sharedEvents = connection?.sharedEvents ?? []

  return (
    <Screen>
      <Stack.Screen options={{ title: profile.name ?? "Member" }} />

      <ScrollView
        contentContainerStyle={styles.content}
        refreshControl={
          <RefreshControl
            refreshing={refreshing}
            onRefresh={refresh}
            tintColor={p.muted}
            colors={[p.accent]}
          />
        }
      >
        <View style={styles.hero}>
          <Avatar uri={profile.avatarUrl} name={profile.name} size={96} />

          <View style={styles.heroText}>
            <Txt variant="display" style={{ textAlign: "center" }}>
              {profile.name ?? "Unnamed"}
            </Txt>

            {affiliation ? (
              <Txt variant="body" color={p.muted} style={{ textAlign: "center" }}>
                {affiliation}
              </Txt>
            ) : null}

            {profile.location ? (
              <View style={styles.locationRow}>
                <Ionicons name="location-outline" size={13} color={p.muted} />
                <Txt variant="caption" color={p.muted}>
                  {profile.location}
                </Txt>
              </View>
            ) : null}
          </View>
        </View>

        {/* Chat is off in the first release, and a Message button that opens a
            screen the build doesn't ship is worse than no button. */}
        {isEnabled("chat") ? (
          <View style={styles.actions}>
            <Button
              label="Message"
              icon="chatbubble-outline"
              onPress={openChat}
              style={{ flex: 1 }}
            />
          </View>
        ) : null}

        {linkedin || twitter || github ? (
          <View style={styles.socials}>
            {linkedin ? (
              <Button
                label="LinkedIn"
                icon="logo-linkedin"
                variant="secondary"
                onPress={() => void openLink(linkedin)}
                style={{ flexGrow: 1 }}
              />
            ) : null}
            {twitter ? (
              <Button
                label="X"
                icon="logo-twitter"
                variant="secondary"
                onPress={() => void openLink(twitter)}
                style={{ flexGrow: 1 }}
              />
            ) : null}
            {github ? (
              <Button
                label="GitHub"
                icon="logo-github"
                variant="secondary"
                onPress={() => void openLink(github)}
                style={{ flexGrow: 1 }}
              />
            ) : null}
          </View>
        ) : null}

        {profile.headline && profile.headline !== affiliation ? (
          <View style={styles.block}>
            <Txt variant="body" color={p.muted} style={{ lineHeight: 22 }}>
              {profile.headline}
            </Txt>
          </View>
        ) : null}

        {profile.bio ? (
          <View style={styles.block}>
            <Txt variant="label" color={p.muted}>
              ABOUT
            </Txt>
            <Txt variant="body" style={{ lineHeight: 22 }}>
              {profile.bio}
            </Txt>
          </View>
        ) : null}

        {profile.expertise.length ? (
          <View style={styles.block}>
            <Txt variant="label" color={p.muted}>
              EXPERTISE
            </Txt>
            <View style={styles.chips}>
              {profile.expertise.slice(0, 14).map((tag) => (
                <Chip key={tag} label={tag} />
              ))}
            </View>
          </View>
        ) : null}

        <View style={styles.block}>
          <Txt variant="label" color={p.muted}>
            SHARED EVENTS
          </Txt>

          {sharedEvents.length ? (
            <Card style={{ padding: 0, overflow: "hidden" }}>
              {sharedEvents.map((event, i) => (
                <View key={event.eventId}>
                  {i > 0 ? <Divider /> : null}
                  <SharedEventRow event={event} onPress={openEvent} />
                </View>
              ))}
            </Card>
          ) : connectionsQuery.isPending ? (
            <Loading />
          ) : (
            <Card>
              <Txt variant="body" color={p.muted} style={{ lineHeight: 21 }}>
                We couldn&apos;t match any events you both attended. Shared events show up once your
                account is linked to the email you registered with.
              </Txt>
            </Card>
          )}
        </View>
      </ScrollView>
    </Screen>
  )
}

const styles = StyleSheet.create({
  content: {
    paddingBottom: 48,
    gap: 20,
  },
  hero: {
    alignItems: "center",
    gap: 14,
    paddingTop: 20,
    paddingHorizontal: layout.gutter,
  },
  heroText: {
    alignItems: "center",
    gap: 5,
  },
  locationRow: {
    flexDirection: "row",
    alignItems: "center",
    gap: 4,
    marginTop: 2,
  },
  actions: {
    flexDirection: "row",
    gap: 10,
    paddingHorizontal: layout.gutter,
  },
  socials: {
    flexDirection: "row",
    flexWrap: "wrap",
    gap: 10,
    paddingHorizontal: layout.gutter,
  },
  block: {
    paddingHorizontal: layout.gutter,
    gap: 8,
  },
  chips: {
    flexDirection: "row",
    flexWrap: "wrap",
    gap: 8,
  },
  eventRow: {
    flexDirection: "row",
    alignItems: "flex-start",
    gap: 12,
    padding: 16,
  },
  roleRow: {
    flexDirection: "row",
    flexWrap: "wrap",
    gap: 8,
    marginTop: 2,
  },
})
