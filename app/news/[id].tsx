import { Ionicons } from "@expo/vector-icons"
import { Image } from "expo-image"
import { Stack, useLocalSearchParams } from "expo-router"
import * as WebBrowser from "expo-web-browser"
import React, { useCallback } from "react"
import { Pressable, ScrollView, Share, StyleSheet, View } from "react-native"

import { newsImage, newsShareUrl, useNewsItem, type NewsItem } from "@/api/news"
import { Markdown } from "@/components/markdown"
import { Button, Chip, ErrorState, Loading, Muted, Screen, Txt } from "@/components/ui"
import { formatDay } from "@/lib/format"
import { layout, usePalette } from "@/theme"

function ShareButton({ item }: { item: NewsItem | undefined }) {
  const p = usePalette()

  const onPress = useCallback(() => {
    if (!item) return
    const url = newsShareUrl(item)
    void Share.share({
      // Android ignores `url`, so the link has to ride along in the message.
      message: item.title ? `${item.title}\n${url}` : url,
      url,
      title: item.title ?? undefined,
    })
  }, [item])

  return (
    <Pressable
      accessibilityRole="button"
      accessibilityLabel="Share this story"
      onPress={onPress}
      disabled={!item}
      hitSlop={10}
      style={({ pressed }) => ({ opacity: !item ? 0.4 : pressed ? 0.6 : 1 })}
    >
      <Ionicons name="share-outline" size={22} color={p.text} />
    </Pressable>
  )
}

export default function NewsDetailScreen() {
  const p = usePalette()
  const { id } = useLocalSearchParams<{ id: string }>()
  const { data, isPending, isError, error, refetch } = useNewsItem(id)

  const cover = data ? newsImage(data, "large") : null
  const authors = data?.authors?.join(", ") ?? null
  const readingTime = data?.reading_time_minutes
  const meta = [
    formatDay(data?.published_at),
    authors,
    readingTime ? `${readingTime} min read` : null,
  ]
    .filter((part): part is string => !!part)
    .join(" · ")
  const link = data?.link ?? null

  return (
    <Screen>
      <Stack.Screen options={{ title: "", headerRight: () => <ShareButton item={data} /> }} />

      {isError ? (
        <ErrorState error={error} onRetry={() => void refetch()} />
      ) : !id ? (
        <ErrorState error={new Error("That story is missing an id.")} />
      ) : isPending || !data ? (
        <Loading />
      ) : (
        <ScrollView
          contentContainerStyle={{ padding: layout.gutter, paddingBottom: 48, gap: 16 }}
          showsVerticalScrollIndicator={false}
        >
          {cover ? (
            <Image
              source={{ uri: cover }}
              style={{
                width: "100%",
                aspectRatio: 16 / 9,
                borderRadius: layout.radius,
                backgroundColor: p.input,
                borderWidth: StyleSheet.hairlineWidth,
                borderColor: p.border,
              }}
              contentFit="cover"
              transition={180}
            />
          ) : null}

          <View style={{ gap: 8 }}>
            <Txt variant="display" style={{ lineHeight: 36 }}>
              {data.title ?? "Untitled"}
            </Txt>
            {meta ? <Muted>{meta}</Muted> : null}
          </View>

          {data.categories?.length ? (
            <View style={{ flexDirection: "row", flexWrap: "wrap", gap: 8 }}>
              {data.categories.map((c) => (
                <Chip key={c} label={c} tone={data.type === "model" ? "accent" : "muted"} />
              ))}
            </View>
          ) : null}

          {/* The summary is a near-duplicate of the body's opening for most rows,
              so the reader shows the body alone and only falls back to summary. */}
          <Markdown content={data.content ?? data.summary} />

          {link ? (
            <Button
              label="Read the original"
              variant="secondary"
              icon="open-outline"
              onPress={() => void WebBrowser.openBrowserAsync(link)}
              style={{ marginTop: 8 }}
            />
          ) : null}
        </ScrollView>
      )}
    </Screen>
  )
}
