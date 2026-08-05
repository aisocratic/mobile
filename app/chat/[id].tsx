import { Ionicons } from "@expo/vector-icons"
import { Stack, useLocalSearchParams } from "expo-router"
import React, { useCallback, useMemo, useState } from "react"
import {
  FlatList,
  KeyboardAvoidingView,
  Platform,
  StyleSheet,
  TextInput,
  View,
} from "react-native"
import { useSafeAreaInsets } from "react-native-safe-area-context"

import {
  useChannel,
  useChatStatus,
  useMessages,
  useRelayCapabilities,
  useProfile,
  useSendMessage,
  type ChatChannel,
  type ChatMessage,
} from "@/chat"
import { SignInPrompt } from "@/chat/sign-in-prompt"
import { Avatar, EmptyState, ErrorState, Loading, Muted, Txt } from "@/components/ui"
import { timeAgo } from "@/lib/format"
import { useAuth } from "@/store/auth"
import { Touchable } from "@/components/touchable"
import { layout, space, useIsDark, usePalette } from "@/theme"

function fromEpoch(seconds: number): string {
  return timeAgo(new Date(seconds * 1000).toISOString())
}

/** A message plus the grouping decisions made once, in ascending order. */
type Row = { message: ChatMessage; showAuthor: boolean; showMeta: boolean }

/* --------------------------------------------------------------- bubble */

function Bubble({ row }: { row: Row }) {
  const p = usePalette()
  const isDark = useIsDark()
  const { message, showAuthor, showMeta } = row

  // Names arrive asynchronously via kind-0 metadata; until then, fall back to a
  // truncated public key rather than showing nothing.
  const profile = useProfile(message.mine ? null : message.authorId)
  const authorName = profile?.name ?? `${message.authorId.slice(0, 8)}…`

  // The accent is amber in both themes, so pick the readable ink for each.
  const ownInk = isDark ? "#0A0A0A" : "#FFFFFF"

  if (message.mine) {
    return (
      <View style={{ alignItems: "flex-end", paddingHorizontal: layout.gutter, marginTop: space.hair }}>
        <View
          style={{
            maxWidth: "82%",
            backgroundColor: p.accent,
            borderRadius: layout.radius,
            borderBottomRightRadius: showMeta ? space.xs + space.hair : layout.radius,
            paddingHorizontal: space.md + space.hair,
            paddingVertical: space.sm + 1,
            opacity: message.pending ? 0.65 : 1,
          }}
        >
          <Txt variant="body" color={ownInk}>
            {message.body}
          </Txt>
        </View>
        {message.failed ? (
          <Txt variant="caption" color={p.danger} style={{ marginTop: space.xs - 1, marginRight: space.xs }}>
            Not delivered
          </Txt>
        ) : showMeta ? (
          <Muted style={{ marginTop: space.xs - 1, marginRight: space.xs }}>
            {message.pending ? "Sending…" : fromEpoch(message.createdAt)}
          </Muted>
        ) : null}
      </View>
    )
  }

  return (
    <View
      style={{
        flexDirection: "row",
        alignItems: "flex-end",
        gap: space.sm,
        paddingHorizontal: layout.gutter,
        marginTop: showAuthor ? space.md : space.hair,
      }}
    >
      <View style={{ width: 28 }}>
        {showMeta ? (
          <Avatar uri={profile?.avatarUrl ?? null} name={authorName} size={28} />
        ) : null}
      </View>
      <View style={{ flex: 1, alignItems: "flex-start" }}>
        {showAuthor ? (
          <Txt variant="caption" color={p.muted} style={{ marginBottom: space.xs - 1, marginLeft: space.xs }}>
            {authorName}
          </Txt>
        ) : null}
        <View
          style={{
            maxWidth: "88%",
            backgroundColor: p.input,
            borderWidth: StyleSheet.hairlineWidth,
            borderColor: p.border,
            borderRadius: layout.radius,
            borderBottomLeftRadius: showMeta ? space.xs + space.hair : layout.radius,
            paddingHorizontal: space.md + space.hair,
            paddingVertical: space.sm + 1,
          }}
        >
          <Txt variant="body">
            {message.body}
          </Txt>
        </View>
        {showMeta ? <Muted style={{ marginTop: space.xs - 1, marginLeft: space.xs }}>{fromEpoch(message.createdAt)}</Muted> : null}
      </View>
    </View>
  )
}

/* ------------------------------------------------------------- composer */

function Composer({
  channel,
  disabled,
}: {
  channel: ChatChannel
  disabled: boolean
}) {
  const p = usePalette()
  const [draft, setDraft] = useState("")
  const { send, error } = useSendMessage(channel)

  const submit = useCallback(() => {
    const text = draft.trim()
    if (!text) return
    // Clear immediately: the message is appended optimistically, and a failure
    // is flagged on the bubble rather than by resurrecting the input.
    setDraft("")
    void send(text)
  }, [draft, send])

  const canSend = draft.trim().length > 0 && !disabled

  return (
    <View
      style={{
        borderTopWidth: StyleSheet.hairlineWidth,
        borderTopColor: p.border,
        backgroundColor: p.background,
        paddingHorizontal: layout.gutter,
        paddingTop: space.sm + space.hair,
        gap: space.xs + space.hair,
      }}
    >
      {error ? (
        <Txt variant="caption" color={p.danger}>
          {error}
        </Txt>
      ) : null}
      <View style={{ flexDirection: "row", alignItems: "flex-end", gap: space.sm }}>
        <TextInput
          value={draft}
          onChangeText={setDraft}
          placeholder={disabled ? "Reconnecting…" : `Message ${channel.name}`}
          placeholderTextColor={p.muted}
          multiline
          style={{
            flex: 1,
            maxHeight: 120,
            minHeight: 42,
            backgroundColor: p.input,
            borderRadius: layout.radius,
            borderWidth: StyleSheet.hairlineWidth,
            borderColor: p.border,
            paddingHorizontal: space.md + space.hair,
            paddingTop: space.md - 1,
            paddingBottom: space.md - 1,
            fontSize: 16,
            color: p.text,
          }}
        />
        <Touchable
          accessibilityRole="button"
          accessibilityLabel="Send message"
          accessibilityState={{ disabled: !canSend }}
          onPress={canSend ? submit : undefined}
          disabled={!canSend}
          haptic="light"
          scale={0.9}
          style={{
            width: 42,
            height: 42,
            borderRadius: 21,
            alignItems: "center",
            justifyContent: "center",
            backgroundColor: canSend ? p.accent : p.input,
          }}
        >
          <Ionicons name="arrow-up" size={20} color={canSend ? "#0A0A0A" : p.muted} />
        </Touchable>
      </View>
    </View>
  )
}

/* --------------------------------------------------------------- screen */

export default function ConversationScreen() {
  const p = usePalette()
  const insets = useSafeAreaInsets()
  const { id } = useLocalSearchParams<{ id: string }>()
  const { session } = useAuth()

  const { channel, loading: resolving, error: resolveError, reload } = useChannel(id)
  const { messages, loading, error } = useMessages(channel)
  const status = useChatStatus()
  const caps = useRelayCapabilities()

  /**
   * The list is inverted so it pins to the bottom and grows upward without any
   * scroll-to-end plumbing. Grouping is decided in ascending order first, then
   * reversed for rendering.
   */
  const rows = useMemo<Row[]>(() => {
    const ascending: Row[] = messages.map((message, i) => {
      const previous = messages[i - 1]
      const next = messages[i + 1]
      const sameAsPrevious = previous?.authorId === message.authorId
      const sameAsNext = next?.authorId === message.authorId
      return {
        message,
        showAuthor: !message.mine && !sameAsPrevious,
        // Timestamp and avatar go on the last bubble of each run.
        showMeta: !sameAsNext,
      }
    })
    return ascending.reverse()
  }, [messages])

  const renderItem = useCallback(({ item }: { item: Row }) => <Bubble row={item} />, [])

  // Signed out there is no key to decrypt a DM with and no way to resolve the
  // person, so `useChannel` would land on "Conversation not found" — which
  // blames the link rather than the missing session.
  if (!session) {
    return (
      <>
        <Stack.Screen options={{ title: "Chat" }} />
        <SignInPrompt body="This conversation is end-to-end encrypted with a key derived from your account. Sign in to open it." />
      </>
    )
  }

  // Closed relay, not a member: nothing here can load, and the invite flow
  // lives on the Chat tab. Say so rather than showing an empty thread.
  if (status === "not-a-member") {
    return (
      <>
        <Stack.Screen options={{ title: "Chat" }} />
        <EmptyState
          icon="mail-unread-outline"
          title="Join the community first"
          body="This is a private Buzz community. Open the Chat tab and redeem an invite code to see messages."
        />
      </>
    )
  }

  if (resolveError) {
    return (
      <>
        <Stack.Screen options={{ title: "Chat" }} />
        <ErrorState error={resolveError} onRetry={reload} />
      </>
    )
  }

  if (resolving && !channel) {
    return (
      <>
        <Stack.Screen options={{ title: "Chat" }} />
        <Loading label="Opening conversation…" />
      </>
    )
  }

  if (!channel) {
    return (
      <>
        <Stack.Screen options={{ title: "Chat" }} />
        <EmptyState
          icon="help-circle-outline"
          title="Conversation not found"
          body="This room or person isn't available. Head back to Chat and pick another."
        />
      </>
    )
  }

  return (
    <>
      <Stack.Screen options={{ title: channel.name }} />
      <KeyboardAvoidingView
        style={{ flex: 1, backgroundColor: p.background }}
        behavior={Platform.OS === "ios" ? "padding" : undefined}
        keyboardVerticalOffset={Platform.OS === "ios" ? insets.top + 44 : 0}
      >
        {status === "connecting" || status === "offline" || status === "authenticating" ? (
          <View
            style={{
              paddingHorizontal: layout.gutter,
              paddingVertical: 6,
              backgroundColor: p.surface,
            }}
          >
            <Txt variant="caption" color={p.muted}>
              {status === "connecting"
                ? "Connecting to the relay…"
                : status === "authenticating"
                  ? "Signing in to the relay…"
                  : "Offline — messages will send once the relay is back."}
            </Txt>
          </View>
        ) : null}

        {channel.kind === "dm" ? (
          <View style={{ paddingHorizontal: layout.gutter, paddingTop: 8 }}>
            <Muted>
              {caps?.dms === "nip17"
                ? "Private message — gift-wrapped, so the relay sees neither sender nor content."
                : "Encrypted direct message."}
            </Muted>
          </View>
        ) : channel.topic ? (
          <View style={{ paddingHorizontal: layout.gutter, paddingTop: 8 }}>
            <Muted numberOfLines={1}>{channel.topic}</Muted>
          </View>
        ) : null}

        {loading ? (
          <Loading label="Loading messages…" />
        ) : (
          <FlatList
            inverted
            data={rows}
            keyExtractor={(row) => row.message.id}
            renderItem={renderItem}
            contentContainerStyle={{ paddingVertical: 12, flexGrow: 1 }}
            keyboardShouldPersistTaps="handled"
            keyboardDismissMode="interactive"
            ListEmptyComponent={
              // Inverted lists render the empty component upside down.
              <View style={{ flex: 1, transform: [{ scaleY: -1 }] }}>
                <EmptyState
                  icon="chatbubble-ellipses-outline"
                  title={
                    error ? "Can't reach the relay" : `Nothing in ${channel.name} yet`
                  }
                  body={
                    error ??
                    "Be the first to say something — your message is signed with your key and stored on the relay."
                  }
                />
              </View>
            }
          />
        )}

        <View style={{ paddingBottom: Math.max(insets.bottom, 10) }}>
          <Composer channel={channel} disabled={status === "offline"} />
        </View>
      </KeyboardAvoidingView>
    </>
  )
}
