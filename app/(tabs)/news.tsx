import { Ionicons } from "@expo/vector-icons"
import { Image } from "expo-image"
import { useRouter } from "expo-router"
import * as WebBrowser from "expo-web-browser"
import React, { useCallback, useMemo, useState } from "react"
import { ActivityIndicator, FlatList, Pressable, RefreshControl, View } from "react-native"

import {
  isLinkOnly,
  newsCategory,
  newsImage,
  newsSnippet,
  useNewsCategories,
  useNewsFeed,
  type NewsItem,
} from "@/api/news"
import {
  Chip,
  Divider,
  EmptyState,
  ErrorState,
  Loading,
  Muted,
  Screen,
  SegmentedControl,
  Txt,
} from "@/components/ui"
import { timeAgo } from "@/lib/format"
import { layout, usePalette } from "@/theme"

const ALL = "__all__"

const THUMB = 84

function Thumb({ item }: { item: NewsItem }) {
  const p = usePalette()
  const uri = newsImage(item, "small")

  if (!uri) {
    return (
      <View
        style={{
          width: THUMB,
          height: THUMB,
          borderRadius: layout.radiusSmall,
          backgroundColor: p.input,
          alignItems: "center",
          justifyContent: "center",
        }}
      >
        <Ionicons name="newspaper-outline" size={22} color={p.muted} />
      </View>
    )
  }

  return (
    <Image
      source={{ uri }}
      style={{
        width: THUMB,
        height: THUMB,
        borderRadius: layout.radiusSmall,
        backgroundColor: p.input,
      }}
      contentFit="cover"
      transition={150}
    />
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

function NewsCard({ item, onPress }: { item: NewsItem; onPress: (item: NewsItem) => void }) {
  const p = usePalette()
  const category = newsCategory(item)
  const snippet = newsSnippet(item)
  const external = isLinkOnly(item)
  const likes = item.like_count ?? 0
  const comments = item.comment_count ?? 0

  return (
    <Pressable
      accessibilityRole="button"
      accessibilityLabel={item.title ?? "Untitled story"}
      onPress={() => onPress(item)}
      style={({ pressed }) => ({
        flexDirection: "row",
        gap: 14,
        paddingHorizontal: layout.gutter,
        paddingVertical: 14,
        opacity: pressed ? 0.6 : 1,
      })}
    >
      <Thumb item={item} />

      <View style={{ flex: 1, gap: 6 }}>
        <View style={{ flexDirection: "row", alignItems: "center", gap: 8 }}>
          {category ? (
            // Model launches are the feed's marquee items — give them the accent.
            <Chip label={category} tone={item.type === "model" ? "accent" : "muted"} />
          ) : null}
          <Muted>{timeAgo(item.published_at)}</Muted>
          {external ? <Ionicons name="open-outline" size={12} color={p.muted} /> : null}
        </View>

        <Txt variant="heading" numberOfLines={2} style={{ lineHeight: 21 }}>
          {item.title ?? "Untitled"}
        </Txt>

        {snippet ? (
          <Txt variant="body" color={p.muted} numberOfLines={1}>
            {snippet}
          </Txt>
        ) : null}

        {likes > 0 || comments > 0 ? (
          <View style={{ flexDirection: "row", gap: 12, marginTop: 2 }}>
            {likes > 0 ? <Stat icon="heart-outline" value={likes} /> : null}
            {comments > 0 ? <Stat icon="chatbubble-outline" value={comments} /> : null}
          </View>
        ) : null}
      </View>
    </Pressable>
  )
}

export default function NewsScreen() {
  const p = usePalette()
  const router = useRouter()
  const [category, setCategory] = useState<string>(ALL)

  const categories = useNewsCategories()
  const feed = useNewsFeed(category === ALL ? null : category)

  const items = useMemo(
    () => feed.data?.pages.flatMap((page) => page.items) ?? [],
    [feed.data],
  )

  const options = useMemo(
    () => [
      { value: ALL, label: "All" },
      ...(categories.data ?? []).map((c) => ({ value: c, label: c })),
    ],
    [categories.data],
  )

  const open = useCallback(
    (item: NewsItem) => {
      // Stub rows exist only to point at their source — skip the empty reader.
      if (isLinkOnly(item) && item.link) {
        void WebBrowser.openBrowserAsync(item.link)
        return
      }
      router.push({ pathname: "/news/[id]", params: { id: item.id } })
    },
    [router],
  )

  const loadMore = useCallback(() => {
    if (feed.hasNextPage && !feed.isFetchingNextPage) void feed.fetchNextPage()
  }, [feed])

  const body = () => {
    if (feed.isPending) return <Loading label="Loading the feed…" />
    if (feed.isError) return <ErrorState error={feed.error} onRetry={() => void feed.refetch()} />

    return (
      <FlatList
        style={{ flex: 1 }}
        data={items}
        keyExtractor={(item) => item.id}
        renderItem={({ item }) => <NewsCard item={item} onPress={open} />}
        ItemSeparatorComponent={Divider}
        onEndReached={loadMore}
        onEndReachedThreshold={0.6}
        initialNumToRender={8}
        refreshControl={
          <RefreshControl
            refreshing={feed.isRefetching && !feed.isFetchingNextPage}
            onRefresh={() => void feed.refetch()}
            tintColor={p.muted}
          />
        }
        ListEmptyComponent={
          <EmptyState
            icon="newspaper-outline"
            title="Nothing here yet"
            body={
              category === ALL
                ? "The news feed is empty right now. Pull to refresh."
                : `No stories tagged ${category} yet.`
            }
          />
        }
        ListFooterComponent={
          feed.isFetchingNextPage ? (
            <View style={{ paddingVertical: 24 }}>
              <ActivityIndicator color={p.accent} />
            </View>
          ) : (
            <View style={{ height: 24 }} />
          )
        }
        contentContainerStyle={items.length ? undefined : { flexGrow: 1 }}
      />
    )
  }

  return (
    <Screen>
      <View style={{ paddingVertical: 12 }}>
        <SegmentedControl options={options} value={category} onChange={setCategory} />
      </View>
      <Divider />
      {body()}
    </Screen>
  )
}
