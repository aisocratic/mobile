import { Ionicons } from "@expo/vector-icons"
import { Image } from "expo-image"
import { useLocalSearchParams, useRouter } from "expo-router"
import * as WebBrowser from "expo-web-browser"
import React from "react"
import { Platform, ScrollView, Share, StyleSheet, View } from "react-native"

import {
  authorLine,
  coverUri,
  coverVideo,
  readableContent,
  readingTime,
  reactionsOf,
  useBlogPost,
  webUrl,
  type Reaction,
} from "@/api/blog"
import { InlineVideo } from "@/components/inline-video"
import { Markdown } from "@/components/markdown"
import {
  Avatar,
  Button,
  Chip,
  Divider,
  EmptyState,
  ErrorState,
  Loading,
  Muted,
  Screen,
  Txt,
} from "@/components/ui"
import { formatDay } from "@/lib/format"
import { Touchable } from "@/components/touchable"
import { layout, space, usePalette } from "@/theme"

const REACTION_ICONS: Record<string, keyof typeof Ionicons.glyphMap> = {
  like: "heart",
  insightful: "bulb",
  helpful: "hand-left",
  celebrate: "sparkles",
}

function AuthorStack({ authors }: { authors: string[] | null }) {
  const p = usePalette()
  const names = (authors ?? []).filter((a) => a?.trim()).slice(0, 3)
  if (!names.length) return <Avatar name={null} size={38} />

  return (
    <View style={{ flexDirection: "row" }}>
      {names.map((name, i) => (
        <View
          key={`${name}-${i}`}
          style={{
            marginLeft: i === 0 ? 0 : -12,
            borderRadius: 999,
            borderWidth: 2,
            borderColor: p.background,
            zIndex: names.length - i,
          }}
        >
          <Avatar name={name} size={38} />
        </View>
      ))}
    </View>
  )
}

/** Read-only: the anon key has no write access to reaction counters. */
function Reactions({ reactions }: { reactions: Reaction[] }) {
  const p = usePalette()

  return (
    <View style={{ flexDirection: "row", flexWrap: "wrap", gap: 10 }}>
      {reactions.map((r) => (
        <View
          key={r.key}
          style={{
            flexDirection: "row",
            alignItems: "center",
            gap: 6,
            paddingHorizontal: 12,
            paddingVertical: 7,
            borderRadius: layout.radiusPill,
            backgroundColor: p.input,
            borderWidth: StyleSheet.hairlineWidth,
            borderColor: p.border,
          }}
        >
          <Ionicons name={REACTION_ICONS[r.key] ?? "star"} size={14} color={p.accent} />
          <Txt variant="label">{r.count}</Txt>
          <Txt variant="caption" color={p.muted}>
            {r.label}
          </Txt>
        </View>
      ))}
    </View>
  )
}

export default function ArticleScreen() {
  const p = usePalette()
  const router = useRouter()
  const { slug } = useLocalSearchParams<{ slug: string }>()
  const { data: post, isLoading, error, refetch } = useBlogPost(slug)

  if (isLoading) {
    return (
      <Screen>
        <Loading label="Opening story…" />
      </Screen>
    )
  }

  if (error) {
    return (
      <Screen>
        <ErrorState error={error} onRetry={() => void refetch()} />
      </Screen>
    )
  }

  if (!post) {
    return (
      <Screen>
        <EmptyState
          icon="document-outline"
          title="Story not found"
          body="This post may have been unpublished or moved."
          action={<Button label="Back to the blog" variant="secondary" onPress={() => router.back()} />}
        />
      </Screen>
    )
  }

  const url = webUrl(post)
  const cover = coverUri(post, "full")
  const clip = coverVideo(post)
  const body = readableContent(post.content)
  const by = authorLine(post.authors, 3)
  const minutes = readingTime(post.reading_time_minutes)
  const standfirst = (post.summary || post.teaser || "").trim()
  const views = post.view_count ?? 0
  const reactions = reactionsOf(post)

  const onShare = () => {
    const title = post.title ?? "AI Socratic"
    void Share.share(
      Platform.OS === "ios" ? { message: title, url } : { message: `${title}\n${url}` },
    )
  }

  const openWeb = () => void WebBrowser.openBrowserAsync(url)

  return (
    <Screen>
      <ScrollView contentContainerStyle={{ paddingBottom: 56 }} showsVerticalScrollIndicator={false}>
        {clip ? (
          // The article cover runs full-bleed, so the player drops its radius.
          <InlineVideo uri={clip} poster={cover} label={post.title} style={{ borderRadius: 0 }} />
        ) : cover ? (
          <Image
            source={{ uri: cover }}
            style={{ width: "100%", aspectRatio: 16 / 9, backgroundColor: p.input }}
            contentFit="cover"
            transition={200}
          />
        ) : null}

        <View style={{ paddingHorizontal: layout.gutter, paddingTop: 22, gap: 16 }}>
          {post.categories?.length ? (
            <View style={{ flexDirection: "row", flexWrap: "wrap", gap: 8 }}>
              {post.categories
                .filter((c) => c?.trim())
                .map((c) => (
                  <Chip key={c} label={c} tone="accent" />
                ))}
            </View>
          ) : null}

          <Txt variant="display">
            {post.title ?? "Untitled"}
          </Txt>

          {standfirst ? (
            <Txt variant="body" color={p.muted} style={{ fontSize: 17, lineHeight: 27 }}>
              {standfirst}
            </Txt>
          ) : null}

          <Divider />

          <View style={{ flexDirection: "row", alignItems: "center", gap: 12 }}>
            <AuthorStack authors={post.authors} />
            <View style={{ flex: 1, gap: 3 }}>
              {by ? (
                <Txt variant="label" numberOfLines={2}>
                  {by}
                </Txt>
              ) : null}
              <Muted numberOfLines={1}>
                {[formatDay(post.published_at), minutes, views ? `${views} views` : null]
                  .filter(Boolean)
                  .join("  ·  ")}
              </Muted>
            </View>
          </View>

          <View style={{ flexDirection: "row", gap: 10 }}>
            <Button
              label="Share"
              variant="secondary"
              icon="share-outline"
              onPress={onShare}
              style={{ flex: 1 }}
            />
            <Button
              label="Open on the web"
              variant="ghost"
              icon="open-outline"
              onPress={openWeb}
              style={{ flex: 1 }}
            />
          </View>

          <Divider />
        </View>

        {body ? (
          <View style={{ paddingHorizontal: layout.gutter, paddingTop: 20 }}>
            <Markdown content={body} />
          </View>
        ) : (
          <EmptyState
            icon="globe-outline"
            title="This one lives on the web"
            body="The full piece is published on aisocratic.org."
            action={<Button label="Read it there" variant="secondary" onPress={openWeb} />}
          />
        )}

        {reactions.length ? (
          <View style={{ paddingHorizontal: layout.gutter, paddingTop: 28, gap: 12 }}>
            <Divider />
            <Reactions reactions={reactions} />
          </View>
        ) : null}

        <View
          style={{ paddingHorizontal: layout.gutter, paddingTop: space.xxl + space.xs, gap: space.lg }}
        >
          <Divider />
          <Touchable
            accessibilityRole="link"
            onPress={openWeb}
            style={{
              flexDirection: "row",
              alignItems: "center",
              gap: space.sm,
              paddingVertical: space.xs,
            }}
          >
            <Ionicons name="globe-outline" size={16} color={p.muted} />
            <Muted style={{ flex: 1 }}>Read this story on aisocratic.org</Muted>
            <Ionicons name="chevron-forward" size={16} color={p.muted} />
          </Touchable>
        </View>
      </ScrollView>
    </Screen>
  )
}
