import { Ionicons } from "@expo/vector-icons"
import { Image } from "expo-image"
import { LinearGradient } from "expo-linear-gradient"
import { useRouter } from "expo-router"
import * as WebBrowser from "expo-web-browser"
import React, { useCallback, useEffect, useMemo, useRef, useState } from "react"
import { ActivityIndicator, FlatList, RefreshControl, StyleSheet, View } from "react-native"

import { authorLine, readingTime } from "@/api/blog"
import { ALL, useFeed, type FeedItem, type FeedSource } from "@/api/feed"
import { CommunityCta } from "@/components/community-cta"
import { FadeIn } from "@/components/fade-in"
import { Touchable } from "@/components/touchable"
import {
  Avatar,
  Divider,
  EmptyState,
  ErrorState,
  Loading,
  Muted,
  Screen,
  SectionLabel,
  SegmentedControl,
  Txt,
} from "@/components/ui"
import { formatDay, timeAgo } from "@/lib/format"
import { useAuth } from "@/store/auth"
import { layout, motion, space, usePalette } from "@/theme"

/**
 * One reading stream, whichever table feeds it.
 *
 * Feed (news) and Blog are the same screen with a different `source`: hero for
 * the newest story, rows for the rest, a topic filter, pull-to-refresh. The
 * split into two tabs is editorial, not structural — news is what happened,
 * the blog is what we think — so the rendering stays shared and each tab
 * contributes only its source, its masthead and its empty-state copy.
 */

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
    <View
      style={{ flexDirection: "row", alignItems: "center", gap: space.xs + space.hair, flexWrap: "wrap" }}
    >
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

/** Source icon + category, so a row still says what it is at a glance. */
function Eyebrow({ item }: { item: FeedItem }) {
  const p = usePalette()
  const label = item.category ?? (item.source === "blog" ? "Blog" : "News")

  return (
    <View style={{ flexDirection: "row", alignItems: "center", gap: space.xs + 1, flex: 1 }}>
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
    <View style={{ flexDirection: "row", alignItems: "center", gap: space.xs - 1 }}>
      <Ionicons name={icon} size={12} color={p.muted} />
      <Muted>{value}</Muted>
    </View>
  )
}

/**
 * Memoized so a screen-level re-render (filter chips, refetch state,
 * scrolling near the end) doesn't redo this work for every mounted row —
 * only rows whose own `item`/`onPress` actually changed re-render.
 */
const Hero = React.memo(function Hero({
  item,
  onPress,
}: {
  item: FeedItem
  onPress: (item: FeedItem) => void
}) {
  const p = usePalette()

  return (
    <Touchable
      accessibilityRole="button"
      accessibilityLabel={item.title ?? "Untitled"}
      onPress={() => onPress(item)}
      // Shallower than a list row: a near-full-width card scaling by the usual
      // amount travels a lot of pixels and reads as the whole screen flinching.
      scale={0.985}
      style={{ paddingHorizontal: layout.gutter }}
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
              transition={motion.image}
              cachePolicy="memory-disk"
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
              left: space.md + space.hair,
              right: space.md + space.hair,
              bottom: space.md,
              flexDirection: "row",
              alignItems: "center",
              gap: space.sm,
            }}
          >
            <View
              style={{
                flexDirection: "row",
                alignItems: "center",
                gap: space.xs + 1,
                paddingHorizontal: space.sm + 1,
                paddingVertical: space.xs,
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

        <View style={{ padding: space.lg, gap: space.sm }}>
          <Txt variant="title" numberOfLines={3}>
            {item.title ?? "Untitled"}
          </Txt>
          {item.snippet ? (
            <Txt variant="body" color={p.muted} numberOfLines={3}>
              {item.snippet}
            </Txt>
          ) : null}
          <View
            style={{
              flexDirection: "row",
              alignItems: "center",
              gap: space.sm + space.hair,
              marginTop: space.hair,
            }}
          >
            {/* Most news rows are unbylined — an initials bubble reading "?"
                is worse than no bubble. */}
            {item.authors?.[0] ? <Avatar name={item.authors[0]} size={28} /> : null}
            <View style={{ flex: 1 }}>
              <MetaLine item={item} />
            </View>
          </View>
        </View>
      </View>
    </Touchable>
  )
})

const Row = React.memo(function Row({
  item,
  onPress,
}: {
  item: FeedItem
  onPress: (item: FeedItem) => void
}) {
  const p = usePalette()

  return (
    <Touchable
      accessibilityRole="button"
      accessibilityLabel={item.title ?? "Untitled"}
      onPress={() => onPress(item)}
      style={{
        flexDirection: "row",
        gap: space.lg,
        paddingHorizontal: layout.gutter,
        paddingVertical: space.lg,
      }}
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
            transition={motion.image}
            cachePolicy="memory-disk"
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

      <View style={{ flex: 1, gap: space.xs + 1 }}>
        <View style={{ flexDirection: "row", alignItems: "center", gap: space.sm }}>
          <Eyebrow item={item} />
          {item.externalLink ? <Ionicons name="open-outline" size={12} color={p.muted} /> : null}
        </View>

        <Txt variant="heading" numberOfLines={2}>
          {item.title ?? "Untitled"}
        </Txt>

        {item.snippet ? <Muted numberOfLines={2}>{item.snippet}</Muted> : null}

        <MetaLine item={item} compact />

        {item.likeCount > 0 || item.commentCount > 0 ? (
          <View style={{ flexDirection: "row", gap: space.md, marginTop: space.hair }}>
            {item.likeCount > 0 ? <Stat icon="heart-outline" value={item.likeCount} /> : null}
            {item.commentCount > 0 ? (
              <Stat icon="chatbubble-outline" value={item.commentCount} />
            ) : null}
          </View>
        ) : null}
      </View>
    </Touchable>
  )
})

/** Indented past the thumbnail so the rule reads as an editorial column. */
function RowSeparator() {
  return <Divider inset={layout.gutter + THUMB + space.lg} />
}

/**
 * The Feed masthead carries a background video, so it matters that this stays
 * the *same* element across re-renders rather than a freshly built one each
 * time — passed inline, `ListHeaderComponent` would otherwise be a brand-new
 * subtree (new `Hero` onPress closure, new "More stories" count view) on every
 * re-render of the screen, which is wasted work even when nothing it needs
 * actually changed. Memoizing on the few props that genuinely describe its
 * content keeps it inert the rest of the time.
 */
const StreamHeader = React.memo(function StreamHeader({
  masthead,
  featured,
  moreCount,
  onPressItem,
}: {
  masthead: React.ReactNode
  featured: FeedItem | null
  moreCount: number
  onPressItem: (item: FeedItem) => void
}) {
  return (
    // The masthead renders whether or not there is a featured story — an
    // empty stream should still look like the app, not like a blank.
    <View style={{ gap: space.xl, paddingBottom: moreCount ? space.xs : 0 }}>
      {masthead}
      {featured ? (
        <FadeIn delay={motion.stagger * 2}>
          <Hero item={featured} onPress={onPressItem} />
        </FadeIn>
      ) : null}
      {moreCount ? (
        <View
          style={{
            flexDirection: "row",
            alignItems: "center",
            justifyContent: "space-between",
            paddingHorizontal: layout.gutter,
          }}
        >
          <SectionLabel>More stories</SectionLabel>
          <Muted>{moreCount}</Muted>
        </View>
      ) : null}
    </View>
  )
})

const StreamEmpty = React.memo(function StreamEmpty({
  source,
  category,
}: {
  source: FeedSource
  category: string
}) {
  if (category !== ALL) {
    return (
      <EmptyState
        icon={source === "blog" ? "book-outline" : "newspaper-outline"}
        title={`Nothing in ${category}`}
        body="Try another topic."
      />
    )
  }

  return source === "blog" ? (
    <EmptyState
      icon="book-outline"
      title="No posts yet"
      body="Essays and monthly digests land here. Pull to refresh."
    />
  ) : (
    <EmptyState
      icon="newspaper-outline"
      title="Nothing here yet"
      body="News lands here. Pull to refresh."
    />
  )
})

const StreamFooter = React.memo(function StreamFooter({
  isFetchingMore,
  hasMore,
}: {
  isFetchingMore: boolean
  hasMore: boolean
}) {
  const p = usePalette()

  if (isFetchingMore) {
    return (
      <View style={{ paddingVertical: space.xxl - space.xs }}>
        <ActivityIndicator color={p.accent} />
      </View>
    )
  }

  if (hasMore) return <View style={{ height: space.xxl - space.xs }} />

  // Only once the stream is exhausted — the same place the website puts it.
  // Mounting it mid-scroll would start the video download while there are
  // still stories to read.
  return <CommunityCta />
})

export function StoryStream({
  source,
  masthead = null,
}: {
  source: FeedSource
  masthead?: React.ReactNode
}) {
  const p = usePalette()
  const router = useRouter()
  const { session } = useAuth()
  const listRef = useRef<FlatList<FeedItem>>(null)

  const [category, setCategory] = useState<string>(ALL)

  // Members-only posts (visibility "users") are readable once signed in.
  const feed = useFeed(source, category === ALL ? null : category, !!session)

  const categoryOptions = useMemo(
    () => [{ value: ALL, label: "All topics" }, ...feed.categories.map((c) => ({ value: c, label: c }))],
    [feed.categories],
  )

  // A refetch can retire the selected topic — fall back to everything
  // rather than showing an empty list filtered by an invisible chip.
  useEffect(() => {
    if (category !== ALL && feed.categories.length && !feed.categories.includes(category)) {
      setCategory(ALL)
    }
  }, [feed.categories, category])

  const onCategory = useCallback((value: string) => {
    setCategory(value)
    listRef.current?.scrollToOffset({ offset: 0, animated: false })
  }, [])

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

  // Stable across renders so FlatList doesn't treat every screen re-render
  // (filter chips, refetch state, pagination) as a reason to re-render every
  // mounted row — only rows whose own `item` actually changed do.
  const keyExtractor = useCallback((item: FeedItem) => item.key, [])
  const renderItem = useCallback(
    ({ item, index }: { item: FeedItem; index: number }) => {
      const row = <Row item={item} onPress={open} />
      // Only the first screenful arrives staggered. Wrapping every row would
      // mean each one fades in as you scroll onto it, which reads as the list
      // struggling to keep up rather than as an entrance.
      return index < motion.staggerCap ? (
        <FadeIn index={index} offset={space.sm}>
          {row}
        </FadeIn>
      ) : (
        row
      )
    },
    [open],
  )

  const filters =
    categoryOptions.length > 1 ? (
      <View style={{ paddingTop: space.md, paddingBottom: space.md }}>
        <SegmentedControl options={categoryOptions} value={category} onChange={onCategory} />
      </View>
    ) : null

  const body = () => {
    if (feed.isPending) return <Loading label="Loading stories…" />
    if (feed.isError && !feed.items.length) {
      return <ErrorState error={feed.error} onRetry={feed.refetch} />
    }

    const [featured, ...rest] = feed.items

    return (
      <FlatList
        ref={listRef}
        style={{ flex: 1 }}
        data={rest}
        keyExtractor={keyExtractor}
        renderItem={renderItem}
        ItemSeparatorComponent={RowSeparator}
        onEndReached={feed.loadMore}
        onEndReachedThreshold={0.6}
        initialNumToRender={8}
        maxToRenderPerBatch={8}
        windowSize={7}
        contentContainerStyle={{
          paddingBottom: space.xxxl,
          flexGrow: feed.items.length ? undefined : 1,
        }}
        refreshControl={
          <RefreshControl
            refreshing={feed.isRefetching}
            onRefresh={feed.refetch}
            tintColor={p.muted}
          />
        }
        ListHeaderComponent={
          <StreamHeader
            masthead={masthead}
            featured={featured ?? null}
            moreCount={rest.length}
            onPressItem={open}
          />
        }
        ListEmptyComponent={featured ? null : <StreamEmpty source={source} category={category} />}
        ListFooterComponent={
          <StreamFooter isFetchingMore={feed.isFetchingMore} hasMore={feed.hasMore} />
        }
      />
    )
  }

  return (
    <Screen>
      {filters}
      {filters ? <Divider /> : null}
      {body()}
    </Screen>
  )
}
