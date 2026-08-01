import { Ionicons } from "@expo/vector-icons"
import { Image } from "expo-image"
import { LinearGradient } from "expo-linear-gradient"
import { useRouter } from "expo-router"
import React, { useMemo, useRef, useState } from "react"
import { FlatList, Pressable, RefreshControl, StyleSheet, View } from "react-native"

import {
  authorLine,
  categoriesOf,
  coverUri,
  readingTime,
  useBlogPosts,
  type BlogListItem,
} from "@/api/blog"
import { Avatar, EmptyState, ErrorState, Loading, Muted, Screen, SegmentedControl, Txt } from "@/components/ui"
import { excerpt, formatDay, timeAgo } from "@/lib/format"
import { useAuth } from "@/store/auth"
import { layout, usePalette } from "@/theme"

const ALL = "__all"

/** summary is the editorial blurb; teaser is the fallback the CMS writes. */
function preview(post: BlogListItem, max: number): string {
  return excerpt(post.summary || post.teaser, max)
}

function Dot() {
  const p = usePalette()
  return (
    <Txt variant="caption" color={p.muted}>
      ·
    </Txt>
  )
}

function RowSeparator() {
  const p = usePalette()
  return (
    <View
      style={{
        height: StyleSheet.hairlineWidth,
        backgroundColor: p.border,
        // Indent past the thumbnail so the rule reads as an editorial column.
        marginLeft: layout.gutter + 88 + 14,
      }}
    />
  )
}

function MetaLine({ post, compact }: { post: BlogListItem; compact?: boolean }) {
  const p = usePalette()
  const by = authorLine(post.authors, compact ? 1 : 2)
  const minutes = readingTime(post.reading_time_minutes)
  const when = compact ? timeAgo(post.published_at) : formatDay(post.published_at)

  const parts = [by, minutes, when].filter((v): v is string => !!v)

  return (
    <View style={{ flexDirection: "row", alignItems: "center", gap: 6, flexWrap: "wrap" }}>
      {parts.map((part, i) => (
        <React.Fragment key={part + i}>
          {i > 0 ? <Dot /> : null}
          <Txt variant="caption" color={i === 0 ? p.text : p.muted} numberOfLines={1}>
            {part}
          </Txt>
        </React.Fragment>
      ))}
    </View>
  )
}

function Eyebrow({ text }: { text: string }) {
  const p = usePalette()
  return (
    <Txt
      variant="caption"
      color={p.accent}
      numberOfLines={1}
      style={{ textTransform: "uppercase", letterSpacing: 0.9 }}
    >
      {text}
    </Txt>
  )
}

function Hero({ post, onPress }: { post: BlogListItem; onPress: () => void }) {
  const p = usePalette()
  const uri = coverUri(post, "medium")
  const category = post.categories?.[0]?.trim()
  const blurb = preview(post, 180)

  return (
    <Pressable
      accessibilityRole="button"
      onPress={onPress}
      style={({ pressed }) => ({ opacity: pressed ? 0.9 : 1, paddingHorizontal: layout.gutter })}
    >
      <View
        style={{
          borderRadius: layout.radius,
          overflow: "hidden",
          backgroundColor: p.elevated,
          borderWidth: StyleSheet.hairlineWidth,
          borderColor: p.border,
        }}
      >
        <View style={{ width: "100%", aspectRatio: 16 / 9, backgroundColor: p.input }}>
          {uri ? (
            <Image
              source={{ uri }}
              style={{ width: "100%", height: "100%" }}
              contentFit="cover"
              transition={180}
            />
          ) : null}

          {/* Scrim so the overlaid label stays legible on any cover. */}
          <LinearGradient
            colors={["transparent", "rgba(0,0,0,0.15)", "rgba(0,0,0,0.72)"]}
            style={StyleSheet.absoluteFill}
          />

          <View
            style={{
              position: "absolute",
              left: 14,
              right: 14,
              bottom: 12,
              flexDirection: "row",
              alignItems: "center",
              gap: 8,
            }}
          >
            <View
              style={{
                flexDirection: "row",
                alignItems: "center",
                gap: 5,
                paddingHorizontal: 9,
                paddingVertical: 4,
                borderRadius: layout.radiusPill,
                backgroundColor: "rgba(255,255,255,0.16)",
              }}
            >
              <Ionicons name="bookmark" size={11} color="#FFFFFF" />
              <Txt
                variant="caption"
                color="#FFFFFF"
                style={{ textTransform: "uppercase", letterSpacing: 0.9 }}
              >
                Latest
              </Txt>
            </View>
            {category ? (
              <Txt
                variant="caption"
                color="rgba(255,255,255,0.9)"
                numberOfLines={1}
                style={{ flex: 1, textTransform: "uppercase", letterSpacing: 0.9 }}
              >
                {category}
              </Txt>
            ) : null}
          </View>
        </View>

        <View style={{ padding: 16, gap: 8 }}>
          <Txt variant="title" numberOfLines={3} style={{ lineHeight: 28 }}>
            {post.title ?? "Untitled"}
          </Txt>
          {blurb ? (
            <Txt variant="body" color={p.muted} numberOfLines={3} style={{ lineHeight: 21 }}>
              {blurb}
            </Txt>
          ) : null}
          <View style={{ flexDirection: "row", alignItems: "center", gap: 10, marginTop: 2 }}>
            <Avatar name={post.authors?.[0] ?? null} size={28} />
            <View style={{ flex: 1 }}>
              <MetaLine post={post} />
            </View>
          </View>
        </View>
      </View>
    </Pressable>
  )
}

function Row({ post, onPress }: { post: BlogListItem; onPress: () => void }) {
  const p = usePalette()
  const uri = coverUri(post, "thumb")
  const category = post.categories?.[0]?.trim()
  const blurb = preview(post, 110)

  return (
    <Pressable
      accessibilityRole="button"
      onPress={onPress}
      style={({ pressed }) => ({
        flexDirection: "row",
        gap: 14,
        paddingHorizontal: layout.gutter,
        paddingVertical: 16,
        opacity: pressed ? 0.7 : 1,
      })}
    >
      <View
        style={{
          width: 88,
          height: 88,
          borderRadius: layout.radiusSmall,
          overflow: "hidden",
          backgroundColor: p.input,
        }}
      >
        {uri ? (
          <Image
            source={{ uri }}
            style={{ width: "100%", height: "100%" }}
            contentFit="cover"
            transition={150}
          />
        ) : (
          <View style={{ flex: 1, alignItems: "center", justifyContent: "center" }}>
            <Ionicons name="document-text-outline" size={20} color={p.muted} />
          </View>
        )}
      </View>

      <View style={{ flex: 1, gap: 5 }}>
        {category ? <Eyebrow text={category} /> : null}
        <Txt variant="heading" numberOfLines={2} style={{ lineHeight: 22 }}>
          {post.title ?? "Untitled"}
        </Txt>
        {blurb ? (
          <Muted numberOfLines={2} style={{ lineHeight: 17 }}>
            {blurb}
          </Muted>
        ) : null}
        <MetaLine post={post} compact />
      </View>
    </Pressable>
  )
}

export default function BlogScreen() {
  const p = usePalette()
  const router = useRouter()
  const { session } = useAuth()
  const [category, setCategory] = useState<string>(ALL)
  const listRef = useRef<FlatList<BlogListItem>>(null)

  // Members-only posts (visibility "users") are readable once signed in.
  const { data, isLoading, isRefetching, error, refetch } = useBlogPosts(!!session)

  const posts = useMemo(() => data ?? [], [data])
  const options = useMemo(
    () => [
      { value: ALL, label: "All" },
      ...categoriesOf(posts).map((c) => ({ value: c, label: c })),
    ],
    [posts],
  )

  const filtered = useMemo(
    () =>
      category === ALL ? posts : posts.filter((post) => (post.categories ?? []).includes(category)),
    [posts, category],
  )

  const [featured, ...rest] = filtered

  const open = (slug: string) => router.push(`/article/${slug}`)

  // Switching category swaps the whole list, so start the new one at the top.
  const onCategory = (value: string) => {
    setCategory(value)
    listRef.current?.scrollToOffset({ offset: 0, animated: false })
  }

  if (isLoading && !data) {
    return (
      <Screen>
        <Loading label="Loading stories…" />
      </Screen>
    )
  }

  if (error && !data) {
    return (
      <Screen>
        <ErrorState error={error} onRetry={() => void refetch()} />
      </Screen>
    )
  }

  return (
    <Screen>
      <FlatList
        ref={listRef}
        data={rest}
        keyExtractor={(item) => item.id}
        contentContainerStyle={{ paddingBottom: 40 }}
        refreshControl={
          <RefreshControl
            refreshing={isRefetching && !isLoading}
            onRefresh={() => void refetch()}
            tintColor={p.muted}
          />
        }
        ItemSeparatorComponent={RowSeparator}
        ListHeaderComponent={
          <View style={{ gap: 20, paddingTop: 8, paddingBottom: rest.length ? 4 : 0 }}>
            {options.length > 1 ? (
              <SegmentedControl options={options} value={category} onChange={onCategory} />
            ) : null}

            {featured ? <Hero post={featured} onPress={() => open(featured.slug)} /> : null}

            {rest.length ? (
              <View
                style={{
                  flexDirection: "row",
                  alignItems: "center",
                  justifyContent: "space-between",
                  paddingHorizontal: layout.gutter,
                }}
              >
                <Txt
                  variant="label"
                  color={p.muted}
                  style={{ textTransform: "uppercase", letterSpacing: 1 }}
                >
                  More stories
                </Txt>
                <Muted>{rest.length}</Muted>
              </View>
            ) : null}
          </View>
        }
        ListEmptyComponent={
          featured ? null : (
            <EmptyState
              icon="newspaper-outline"
              title={category === ALL ? "No stories yet" : `Nothing in ${category}`}
              body={
                category === ALL
                  ? "New essays and market rundowns land here."
                  : "Try another category."
              }
            />
          )
        }
        renderItem={({ item }) => <Row post={item} onPress={() => open(item.slug)} />}
      />
    </Screen>
  )
}
