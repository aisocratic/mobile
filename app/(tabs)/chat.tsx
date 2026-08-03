import { Ionicons } from "@expo/vector-icons"
import { useRouter } from "expo-router"
import React, { useCallback, useState } from "react"
import { FlatList, Pressable, StyleSheet, View } from "react-native"

import { Avatar, Divider, EmptyState, ErrorState, Loading, Muted, SegmentedControl, Txt } from "@/components/ui"
import {
  RELAY_URL,
  shortNpub,
  useChannels,
  useChatIdentity,
  type ChannelSummary,
  type ChatConnectionStatus,
} from "@/chat"
import { JoinCommunity } from "@/chat/join-community"
import { PeopleList } from "@/chat/people-list"
import { SignInPrompt } from "@/chat/sign-in-prompt"
import { excerpt, timeAgo } from "@/lib/format"
import { useAuth } from "@/store/auth"
import { layout, usePalette } from "@/theme"

/** Relative time from a Nostr `created_at` (epoch seconds). */
function fromEpoch(seconds: number): string {
  return timeAgo(new Date(seconds * 1000).toISOString())
}

/* --------------------------------------------------------------- header */

const STATUS_COPY: Record<ChatConnectionStatus, string> = {
  unavailable: "Not connected",
  connecting: "Connecting…",
  authenticating: "Authenticating…",
  "not-a-member": "Not a member",
  live: "Live",
  offline: "Offline — retrying",
}

/**
 * Shows the relay we're attached to and the user's Nostr public key. The npub
 * is surfaced deliberately: every message in this app is signed by that key, and
 * hiding it would make the identity feel like magic.
 */
function IdentityBar({ status }: { status: ChatConnectionStatus }) {
  const p = usePalette()
  const identity = useChatIdentity()

  const dot =
    status === "live"
      ? p.success
      : status === "connecting" || status === "authenticating"
        ? p.accent
        : p.danger
  const host = RELAY_URL.replace(/^wss?:\/\//, "")

  return (
    <View style={{ paddingHorizontal: layout.gutter, paddingTop: 8, paddingBottom: 14, gap: 6 }}>
      <View style={{ flexDirection: "row", alignItems: "center", gap: 8 }}>
        <View style={{ width: 8, height: 8, borderRadius: 4, backgroundColor: dot }} />
        <Txt variant="label" color={p.muted}>
          {STATUS_COPY[status]}
        </Txt>
        <Txt variant="caption" color={p.muted} numberOfLines={1} style={{ flex: 1 }}>
          {host}
        </Txt>
      </View>
      {identity ? (
        <View style={{ flexDirection: "row", alignItems: "center", gap: 6 }}>
          <Ionicons name="key-outline" size={12} color={p.muted} />
          <Muted numberOfLines={1}>{shortNpub(identity.npub)}</Muted>
        </View>
      ) : null}
      {/* A derived key means secure storage was unusable, so the key was
          computed from the account id by a constant in this bundle — it works,
          but anyone with the source can recompute it. Say so rather than
          letting it pass for a generated one. */}
      {identity?.source === "derived" ? (
        <View style={{ flexDirection: "row", alignItems: "center", gap: 6 }}>
          <Ionicons name="warning-outline" size={12} color={p.danger} />
          <Muted numberOfLines={2} style={{ flex: 1 }}>
            This device couldn&apos;t store a private key, so chat is using a fallback identity.
          </Muted>
        </View>
      ) : null}
    </View>
  )
}

/* ---------------------------------------------------------- channel row */

function ChannelRow({ summary, onPress }: { summary: ChannelSummary; onPress: () => void }) {
  const p = usePalette()
  const { channel, lastMessage, unread } = summary

  const preview = lastMessage
    ? `${lastMessage.mine ? "You: " : ""}${excerpt(lastMessage.body, 80)}`
    : (channel.topic ?? "No messages yet")

  return (
    <Pressable
      accessibilityRole="button"
      onPress={onPress}
      style={({ pressed }) => ({
        flexDirection: "row",
        alignItems: "center",
        gap: 12,
        paddingHorizontal: layout.gutter,
        paddingVertical: 14,
        backgroundColor: pressed ? p.surface : "transparent",
      })}
    >
      {channel.kind === "dm" ? (
        <Avatar uri={channel.avatarUrl} name={channel.name} size={44} />
      ) : (
        <View
          style={{
            width: 44,
            height: 44,
            borderRadius: 22,
            alignItems: "center",
            justifyContent: "center",
            backgroundColor: p.input,
            borderWidth: StyleSheet.hairlineWidth,
            borderColor: p.border,
          }}
        >
          <Ionicons
            name={(channel.icon ?? "chatbubbles-outline") as keyof typeof Ionicons.glyphMap}
            size={20}
            color={p.accent}
          />
        </View>
      )}

      <View style={{ flex: 1, gap: 3 }}>
        <View style={{ flexDirection: "row", alignItems: "center", gap: 8 }}>
          <Txt variant="heading" numberOfLines={1} style={{ flex: 1 }}>
            {channel.name}
          </Txt>
          {lastMessage ? <Muted>{fromEpoch(lastMessage.createdAt)}</Muted> : null}
        </View>
        <Txt
          variant="body"
          color={unread ? p.text : p.muted}
          numberOfLines={1}
          style={unread ? { fontWeight: "600" } : undefined}
        >
          {preview}
        </Txt>
      </View>

      {unread ? (
        <View style={{ width: 9, height: 9, borderRadius: 5, backgroundColor: p.accent }} />
      ) : (
        <Ionicons name="chevron-forward" size={16} color={p.border} />
      )}
    </Pressable>
  )
}

/**
 * The channel list, as its own segment.
 *
 * `not-a-member` used to replace the whole chat tab with the invite flow.
 * Now it only replaces this segment: DMs and the People directory don't need
 * relay membership at all (see `PeopleList` in `src/chat/people-list.tsx`),
 * so someone browsing the community shouldn't be forced through an invite
 * gate just because they haven't touched the channel list yet.
 */
function ChannelsSegment({
  summaries,
  loading,
  error,
  status,
  onOpen,
}: {
  summaries: ChannelSummary[]
  loading: boolean
  error: string | null
  status: ChatConnectionStatus
  onOpen: (id: string) => void
}) {
  const renderItem = useCallback(
    ({ item }: { item: ChannelSummary }) => (
      <ChannelRow summary={item} onPress={() => onOpen(item.channel.id)} />
    ),
    [onOpen],
  )

  // Closed relay, and this key isn't a member yet. Nothing will ever load
  // until an invite is redeemed, so show the way in rather than an empty list
  // or a misleading "offline".
  if (status === "not-a-member") return <JoinCommunity relayUrl={RELAY_URL} />

  // A relay error is not fatal — the rooms still exist and the socket keeps
  // retrying — so only show the error state when we have nothing to list.
  if (error && !summaries.length) return <ErrorState error={new Error(error)} />

  if (loading && !summaries.length) return <Loading label="Opening chat…" />

  return (
    <FlatList
      data={summaries}
      keyExtractor={(item) => item.channel.id}
      renderItem={renderItem}
      // Defensive: with a session the built-in rooms always populate this list,
      // so an empty render means something upstream failed. Never leave the
      // screen blank under the status bar.
      ListEmptyComponent={
        loading ? (
          <Loading label="Opening chat…" />
        ) : (
          <EmptyState
            icon={error ? "cloud-offline-outline" : "chatbubbles-outline"}
            title={error ? "No channels available" : "No channels yet"}
            body={
              error ??
              // On a NIP-29 relay the rooms are created server-side, so an
              // empty list means the community genuinely has none — not that
              // the app failed to invent any.
              "This community hasn't created any channels yet. An owner or admin can add one from the Buzz app."
            }
          />
        )
      }
      ItemSeparatorComponent={Divider}
      contentContainerStyle={{ paddingBottom: 24 }}
      keyboardShouldPersistTaps="handled"
    />
  )
}

/* --------------------------------------------------------------- screen */

type ChatTab = "channels" | "people"

const SEGMENTS: { value: ChatTab; label: string }[] = [
  { value: "channels", label: "Channels" },
  { value: "people", label: "People" },
]

export default function ChatScreen() {
  const router = useRouter()
  const { session } = useAuth()
  const { summaries, loading, error, status } = useChannels()
  const [tab, setTab] = useState<ChatTab>("channels")

  const openChannel = useCallback(
    (id: string) => router.push({ pathname: "/chat/[id]", params: { id } }),
    [router],
  )
  // A person's `users.id` resolves to the same route: `resolveChannel` in
  // src/chat/nostr.ts falls through to the users table when the id isn't a
  // known channel or an event_users row, and turns it into a DM.
  const openPerson = openChannel

  // Without a session there is no keypair, so there is nothing to connect with
  // and no rooms to list. Explain that instead of rendering an empty list.
  if (!session) return <SignInPrompt />

  return (
    <View style={{ flex: 1 }}>
      <IdentityBar status={status} />
      <View style={{ paddingBottom: 10 }}>
        <SegmentedControl options={SEGMENTS} value={tab} onChange={setTab} />
      </View>
      {tab === "people" ? (
        <PeopleList onOpen={openPerson} />
      ) : (
        <ChannelsSegment
          summaries={summaries}
          loading={loading}
          error={error}
          status={status}
          onOpen={openChannel}
        />
      )}
    </View>
  )
}
