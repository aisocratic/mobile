import { Ionicons } from "@expo/vector-icons"
import { Image } from "expo-image"
import { LinearGradient } from "expo-linear-gradient"
import { useRouter } from "expo-router"
import * as WebBrowser from "expo-web-browser"
import React, { useCallback, useEffect, useMemo, useRef, useState } from "react"
import { ActivityIndicator, FlatList, Pressable, RefreshControl, StyleSheet, View } from "react-native"

import { authorLine, readingTime } from "@/api/blog"
import { ALL, useFeed, type FeedItem, type SourceFilter } from "@/api/feed"
import {
  Avatar,
  Divider,
  EmptyState,
  ErrorState,
  Loading,
  Muted,
  Screen,
  SegmentedControl,
  Txt,
} from "@/components/ui"
import { formatDay, timeAgo } from "@/lib/format"
import { useAuth } from "@/store/auth"
import { layout, usePalette } from "@/theme"

const SOURCES: { value: SourceFilter; label: string }[] = [
  { value: ALL, label: "All" },
  { value: "news", label: "News" },
  { value: "blog", label: "Blog" },
]

const SOURCE_ICON = {
  news: "flash-outline",
  blog: "book-outline",
} as const

const THUMB = 88

function Dot() {
  const p = usePalette()
  return (
    <Txt variant="caption" color={p.muted}>
      ·
    </Txt>
  )
}

/** author · reading time · date, with the parts that are missing dropped. */
function MetaLine({ item, compact }: { item: FeedItem; compact?: boolean }) {
  const p = usePalette()
  const parts = [
    authorLine(item.authors, compact ? 1 : 2),
    readingTime(item.readingMinutes),
    compact ? timeAgo(item.publishedAt) : formatDay(item.publishedAt),
  ].filter((v): v is string => !!v)

  return (
    <View style={{ flexDirection: "row", alignItems: "center", gap: 6, flexWrap: "wrap" }}>
      {parts.map((part, i) => (
        <React.Fragment key={part + i}>
          {i > 0 ? <Dot /> : null}
          <Txt variant="caption" color={i === 0 && !compact ? p.text : p.muted} numberOfLines={1}>
            {part}
          </Txt>
        </React.Fragment>
      ))}
    </View>
  )
}

/** Source icon + category, so a mixed list still says what each row is. */
function Eyebrow({ item }: { item: FeedItem }) {
  const p = usePalette()
  const label = item.category ?? (item.source === "blog" ? "Blog" : "News")

  return (
    <View style={{ flexDirection: "row", alignItems: "center", gap: 5, flex: 1 }}>
      <Ionicons name={SOURCE_ICON[item.source]} size={11} color={p.accent} />
      <Txt
        variant="caption"
        color={p.accent}
        numberOfLines={1}
        style={{ flexShrink: 1, textTransform: "uppercase", letterSpacing: 0.9 }}
      >
        {label}
      </Txt>
    </View>
  )
}

function Stat({ icon, value }: { icon: keyof typeof Ionicons.glyphMap; value: number }) {
  const p = usePalette()
  return (
    <View style={{ flexDirection: "row", alignItems: "center", gap: 3 }}>
      <Ionicons name={icon} size={12} color={p.muted} />
      <Muted>{value}</Muted>
    </View>
  )
}

function Hero({ item, onPress }: { item: FeedItem; onPress: () => void }) {
  const p = usePalette()

  return (
    <Pressable
      accessibilityRole="button"
      accessibilityLabel={item.title ?? "Untitled"}
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
          {item.cover ? (
            <Image
              source={{ uri: item.cover }}
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
              <Ionicons name={SOURCE_ICON[item.source]} size={11} color="#FFFFFF" />
              <Txt
                variant="caption"
                color="#FFFFFF"
                style={{ textTransform: "uppercase", letterSpacing: 0.9 }}
              >
                {item.source === "blog" ? "Blog" : "News"}
              </Txt>
            </View>
            {item.category ? (
              <Txt
                variant="caption"
                color="rgba(255,255,255,0.9)"
                numberOfLines={1}
                style={{ flex: 1, textTransform: "uppercase", letterSpacing: 0.9 }}
              >
                {item.category}
              </Txt>
            ) : null}
          </View>
        </View>

        <View style={{ padding: 16, gap: 8 }}>
          <Txt variant="title" numberOfLines={3} style={{ lineHeight: 28 }}>
            {item.title ?? "Untitled"}
          </Txt>
          {item.snippet ? (
            <Txt variant="body" color={p.muted} numberOfLines={3} style={{ lineHeight: 21 }}>
              {item.snippet}
            </Txt>
          ) : null}
          <View style={{ flexDirection: "row", alignItems: "center", gap: 10, marginTop: 2 }}>
            <Avatar name={item.authors?.[0] ?? null} size={28} />
            <View style={{ flex: 1 }}>
              <MetaLine item={item} />
            </View>
          </View>
        </View>
      </View>
    </Pressable>
  )
}

function Row({ item, onPress }: { item: FeedItem; onPress: () => void }) {
  const p = usePalette()

  return (
    <Pressable
      accessibilityRole="button"
      accessibilityLabel={item.title ?? "Untitled"}
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
          width: THUMB,
          height: THUMB,
          borderRadius: layout.radiusSmall,
          overflow: "hidden",
          backgroundColor: p.input,
        }}
      >
        {item.thumb ? (
          <Image
            source={{ uri: item.thumb }}
            style={{ width: "100%", height: "100%" }}
            contentFit="cover"
            transition={150}
          />
        ) : (
          <View style={{ flex: 1, alignItems: "center", justifyContent: "center" }}>
            <Ionicons
              name={item.source === "blog" ? "document-text-outline" : "newspaper-outline"}
              size={20}
              color={p.muted}
            />
          </View>
        )}
      </View>

      <View style={{ flex: 1, gap: 5 }}>
        <View style={{ flexDirection: "row", alignItems: "center", gap: 8 }}>
          <Eyebrow item={item} />
          {item.externalLink ? <Ionicons name="open-outline" size={12} color={p.muted} /> : null}
        </View>

        <Txt variant="heading" numberOfLines={2} style={{ lineHeight: 22 }}>
          {item.title ?? "Untitled"}
        </Txt>

        {item.snippet ? (
          <Muted numberOfLines={2} style={{ lineHeight: 17 }}>
            {item.snippet}
          </Muted>
        ) : null}

        <MetaLine item={item} compact />

        {item.likeCount > 0 || item.commentCount > 0 ? (
          <View style={{ flexDirection: "row", gap: 12, marginTop: 2 }}>
            {item.likeCount > 0 ? <Stat icon="heart-outline" value={item.likeCount} /> : null}
            {item.commentCount > 0 ? (
              <Stat icon="chatbubble-outline" value={item.commentCount} />
            ) : null}
          </View>
        ) : null}
      </View>
    </Pressable>
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
        marginLeft: layout.gutter + THUMB + 14,
      }}
    />
  )
}

export default function FeedScreen() {
  const p = usePalette()
  const router = useRouter()
  const { session } = useAuth()
  const listRef = useRef<FlatList<FeedItem>>(null)

  const [source, setSource] = useState<SourceFilter>(ALL)
  const [category, setCategory] = useState<string>(ALL)

  // Members-only posts (visibility "users") are readable once signed in.
  const feed = useFeed(source, category === ALL ? null : category, !!session)

  const categoryOptions = useMemo(
    () => [{ value: ALL, label: "All topics" }, ...feed.categories.map((c) => ({ value: c, label: c }))],
    [feed.categories],
  )

  // Switching source can retire the selected topic — fall back to everything
  // rather than showing an empty list filtered by an invisible chip.
  useEffect(() => {
    if (category !== ALL && !feed.categories.includes(category)) setCategory(ALL)
  }, [feed.categories, category])

  const toTop = () => listRef.current?.scrollToOffset({ offset: 0, animated: false })

  const onSource = (value: SourceFilter) => {
    setSource(value)
    toTop()
  }

  const onCategory = (value: string) => {
    setCategory(value)
    toTop()
  }

  const open = useCallback(
    (item: FeedItem) => {
      // News stubs exist only to point at their source — skip the empty reader.
      if (item.externalLink) {
        void WebBrowser.openBrowserAsync(item.externalLink)
        return
      }
      if (item.source === "blog") {
        if (item.slug) router.push(`/article/${item.slug}`)
        return
      }
      router.push({ pathname: "/news/[id]", params: { id: item.id } })
    },
    [router],
  )

  const filters = (
    <View style={{ gap: 8, paddingTop: 12, paddingBottom: 12 }}>
      <SegmentedControl options={SOURCES} value={source} onChange={onSource} />
      {categoryOptions.length > 1 ? (
        <SegmentedControl options={categoryOptions} value={category} onChange={onCategory} />
      ) : null}
    </View>
  )

  const body = () => {
    if (feed.isPending) return <Loading label="Loading the feed…" />
    // One source failing while the other loaded still leaves a usable feed —
    // only take over the screen when there is nothing to show at all.
    if (feed.isError && !feed.items.length) {
      return <ErrorState error={feed.error} onRetry={feed.refetch} />
    }

    const [featured, ...rest] = feed.items

    return (
      <FlatList
        ref={listRef}
        style={{ flex: 1 }}
        data={rest}
        keyExtractor={(item) => item.key}
        renderItem={({ item }) => <Row item={item} onPress={() => open(item)} />}
        ItemSeparatorComponent={RowSeparator}
        onEndReached={feed.loadMore}
        onEndReachedThreshold={0.6}
        initialNumToRender={8}
        contentContainerStyle={{ paddingBottom: 40, flexGrow: feed.items.length ? undefined : 1 }}
        refreshControl={
          <RefreshControl
            refreshing={feed.isRefetching}
            onRefresh={feed.refetch}
            tintColor={p.muted}
          />
        }
        ListHeaderComponent={
          featured ? (
            <View style={{ gap: 20, paddingTop: 16, paddingBottom: rest.length ? 4 : 0 }}>
              <Hero item={featured} onPress={() => open(featured)} />
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
          ) : null
        }
        ListEmptyComponent={
          featured ? null : (
            <EmptyState
              icon="newspaper-outline"
              title={category === ALL ? "Nothing here yet" : `Nothing in ${category}`}
              body={
                category === ALL
                  ? "News and essays land here. Pull to refresh."
                  : "Try another topic or source."
              }
            />
          )
        }
        ListFooterComponent={
          feed.isFetchingMore ? (
            <View style={{ paddingVertical: 24 }}>
              <ActivityIndicator color={p.accent} />
            </View>
          ) : (
            <View style={{ height: 24 }} />
          )
        }
      />
    )
  }

  return (
    <Screen>
      {filters}
      <Divider />
      {body()}
    </Screen>
  )
}
