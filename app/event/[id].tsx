import { Ionicons } from "@expo/vector-icons"
import { Image } from "expo-image"
import { LinearGradient } from "expo-linear-gradient"
import { Stack, useLocalSearchParams } from "expo-router"
import * as WebBrowser from "expo-web-browser"
import React, { useCallback, useMemo } from "react"
import { Pressable, ScrollView, Share, StyleSheet, View } from "react-native"

import { eventCover, eventLink, eventPlace, useEvent } from "@/api/events"
import { Markdown } from "@/components/markdown"
import { Avatar, Chip, Divider, ErrorState, Loading, Screen, Txt } from "@/components/ui"
import { excerpt, linkedinUrl, organizerName, parseDate } from "@/lib/format"
import { layout, usePalette, type Palette } from "@/theme"
import type { EventHost, EventRow } from "@/types"

const HERO_RATIO = 16 / 9

/**
 * Events carry an IANA `timezone` and the timestamps are UTC, so we format in
 * the event's own zone — "6:00 PM" should mean 6pm where the event happens,
 * not on the reader's phone. Falls back to device time if the zone is bad.
 */
function formatInZone(
  value: string | null,
  timezone: string | null,
  options: Intl.DateTimeFormatOptions,
): string | null {
  const date = parseDate(value)
  if (!date) return null

  try {
    return new Intl.DateTimeFormat(undefined, {
      ...options,
      timeZone: timezone ?? undefined,
    }).format(date)
  } catch {
    return new Intl.DateTimeFormat(undefined, options).format(date)
  }
}

function sameDayInZone(a: string | null, b: string | null, timezone: string | null): boolean {
  const opts: Intl.DateTimeFormatOptions = { year: "numeric", month: "2-digit", day: "2-digit" }
  const left = formatInZone(a, timezone, opts)
  const right = formatInZone(b, timezone, opts)
  return !!left && left === right
}

function formatWhen(event: EventRow): { date: string; time: string | null } {
  const tz = event.timezone

  const date =
    formatInZone(event.start_at, tz, {
      weekday: "long",
      month: "long",
      day: "numeric",
      year: "numeric",
    }) ?? "Date to be announced"

  const start = formatInZone(event.start_at, tz, { hour: "numeric", minute: "2-digit" })
  if (!start) return { date, time: null }

  const zone =
    formatInZone(event.start_at, tz, { timeZoneName: "short" })
      ?.split(", ")
      .pop()
      ?.trim() ?? null

  const endSameDay = sameDayInZone(event.start_at, event.end_at, tz)
  const end = event.end_at
    ? formatInZone(
        event.end_at,
        tz,
        endSameDay
          ? { hour: "numeric", minute: "2-digit" }
          : { month: "short", day: "numeric", hour: "numeric", minute: "2-digit" },
      )
    : null

  const range = end ? `${start} – ${end}` : start
  return { date, time: zone ? `${range} ${zone}` : range }
}

/* ----------------------------------------------------------------- pieces */

function Hero({ event, p }: { event: EventRow; p: Palette }) {
  const uri = eventCover(event, "large")

  return (
    <View style={styles.hero}>
      {uri ? (
        <Image
          source={{ uri }}
          style={StyleSheet.absoluteFill}
          contentFit="cover"
          transition={220}
          cachePolicy="memory-disk"
        />
      ) : (
        <LinearGradient
          colors={[`${p.accent}59`, `${p.accent}1A`, p.background]}
          start={{ x: 0, y: 0 }}
          end={{ x: 1, y: 1 }}
          style={[StyleSheet.absoluteFill, styles.heroFallback]}
        >
          <Ionicons name="calendar-outline" size={40} color={p.accent} />
        </LinearGradient>
      )}

      {/* Fade the image into the page instead of ending on a hard edge. */}
      <LinearGradient
        colors={["transparent", `${p.background}00`, p.background]}
        locations={[0, 0.55, 1]}
        style={StyleSheet.absoluteFill}
        pointerEvents="none"
      />
    </View>
  )
}

function MetaRow({
  icon,
  label,
  value,
  p,
}: {
  icon: keyof typeof Ionicons.glyphMap
  label: string
  value: string
  p: Palette
}) {
  return (
    <View style={styles.metaRow}>
      <View style={[styles.metaIcon, { backgroundColor: p.input }]}>
        <Ionicons name={icon} size={16} color={p.accent} />
      </View>
      <View style={{ flex: 1 }}>
        <Txt variant="caption" color={p.muted}>
          {label}
        </Txt>
        <Txt variant="body" style={{ marginTop: 1 }}>
          {value}
        </Txt>
      </View>
    </View>
  )
}

function HostCard({ host, p }: { host: EventHost; p: Palette }) {
  const url = linkedinUrl(host.linkedin_handle)
  const headline = host.bio ? excerpt(host.bio, 90) : null

  const open = useCallback(() => {
    if (url) void WebBrowser.openBrowserAsync(url)
  }, [url])

  return (
    <Pressable
      accessibilityRole={url ? "link" : "text"}
      disabled={!url}
      onPress={open}
      style={({ pressed }) => [styles.host, { opacity: pressed && url ? 0.6 : 1 }]}
    >
      <Avatar uri={host.avatar_url} name={host.name} size={42} />
      <View style={{ flex: 1 }}>
        <Txt variant="heading">{host.name ?? "Host"}</Txt>
        {headline ? (
          <Txt variant="caption" color={p.muted} numberOfLines={2} style={{ marginTop: 2 }}>
            {headline}
          </Txt>
        ) : null}
      </View>
      {url ? <Ionicons name="logo-linkedin" size={18} color={p.muted} /> : null}
    </Pressable>
  )
}

/* ----------------------------------------------------------------- screen */

export default function EventDetailScreen() {
  const p = usePalette()
  const { id } = useLocalSearchParams<{ id: string }>()
  const { data: event, error, isPending, refetch } = useEvent(id)

  const link = event ? eventLink(event) : null
  const title = event?.title ?? "Event"

  const share = useCallback(() => {
    void Share.share({ message: link ? `${title}\n${link}` : title, title })
  }, [link, title])

  const headerRight = useCallback(
    () => (
      <Pressable
        accessibilityRole="button"
        accessibilityLabel="Share event"
        onPress={share}
        hitSlop={12}
        style={({ pressed }) => ({ opacity: pressed ? 0.5 : 1 })}
      >
        <Ionicons name="share-outline" size={22} color={p.text} />
      </Pressable>
    ),
    [share, p.text],
  )

  const when = useMemo(() => (event ? formatWhen(event) : null), [event])

  if (isPending && !event) {
    return (
      <Screen>
        <Stack.Screen options={{ title: "" }} />
        <Loading label="Loading event…" />
      </Screen>
    )
  }

  if (error || !event) {
    return (
      <Screen>
        <Stack.Screen options={{ title: "" }} />
        <ErrorState error={error ?? new Error("Event not found.")} onRetry={() => void refetch()} />
      </Screen>
    )
  }

  const place = eventPlace(event)
  const organizer = organizerName(event.organizer)
  const guests = event.guest_count && event.guest_count > 0 ? event.guest_count : null
  const body = event.content ?? event.summary
  const isLuma = !!event.url && /lu\.?ma/i.test(event.url)

  return (
    <Screen>
      {/* The title lives in the hero, so the nav bar stays out of the way. */}
      <Stack.Screen options={{ title: "", headerRight }} />

      <ScrollView contentContainerStyle={{ paddingBottom: 48 }} showsVerticalScrollIndicator={false}>
        <Hero event={event} p={p} />

        <View style={styles.body}>
          <Txt variant="display" style={{ lineHeight: 36 }}>
            {title}
          </Txt>

          {organizer ? (
            <Txt variant="caption" color={p.muted} style={{ marginTop: 6 }}>
              Hosted by {organizer}
            </Txt>
          ) : null}

          {event.tags?.length ? (
            <View style={styles.tags}>
              {event.tags.map((tag) => (
                <Chip key={tag} label={tag} tone="accent" />
              ))}
            </View>
          ) : null}

          <View style={styles.metaBlock}>
            <MetaRow
              icon="calendar-outline"
              label={when?.time ? "When" : "Date"}
              value={when?.time ? `${when.date}\n${when.time}` : (when?.date ?? "Date TBA")}
              p={p}
            />

            {event.is_virtual ? (
              <MetaRow icon="videocam-outline" label="Where" value="Virtual event" p={p} />
            ) : place ? (
              <MetaRow icon="location-outline" label="Where" value={place} p={p} />
            ) : null}

            {guests ? (
              <MetaRow
                icon="people-outline"
                label="Attendance"
                value={`${guests} ${guests === 1 ? "guest" : "guests"}`}
                p={p}
              />
            ) : null}
          </View>

          {link ? (
            <View style={styles.actions}>
              <Pressable
                accessibilityRole="button"
                onPress={() => void WebBrowser.openBrowserAsync(link)}
                style={({ pressed }) => [
                  styles.primary,
                  { backgroundColor: p.primary, opacity: pressed ? 0.85 : 1 },
                ]}
              >
                <Ionicons name="open-outline" size={18} color={p.primaryText} />
                <Txt variant="heading" color={p.primaryText}>
                  {isLuma ? "Register on Luma" : "View event"}
                </Txt>
              </Pressable>

              <Pressable
                accessibilityRole="button"
                accessibilityLabel="Share event"
                onPress={share}
                style={({ pressed }) => [
                  styles.secondary,
                  { backgroundColor: p.input, borderColor: p.border, opacity: pressed ? 0.7 : 1 },
                ]}
              >
                <Ionicons name="share-outline" size={18} color={p.text} />
              </Pressable>
            </View>
          ) : null}

          {event.hosts?.length ? (
            <View style={styles.section}>
              <Divider />
              <Txt variant="title" style={{ marginTop: 22, marginBottom: 6 }}>
                {event.hosts.length === 1 ? "Host" : "Hosts"}
              </Txt>
              {event.hosts.map((host, i) => (
                <HostCard key={host.api_id ?? `${host.name}-${i}`} host={host} p={p} />
              ))}
            </View>
          ) : null}

          {body ? (
            <View style={styles.section}>
              <Divider />
              <Txt variant="title" style={{ marginTop: 22, marginBottom: 4 }}>
                About
              </Txt>
              <Markdown content={body} />
            </View>
          ) : null}
        </View>
      </ScrollView>
    </Screen>
  )
}

const styles = StyleSheet.create({
  hero: {
    width: "100%",
    aspectRatio: HERO_RATIO,
  },
  heroFallback: {
    alignItems: "center",
    justifyContent: "center",
  },
  body: {
    paddingHorizontal: layout.gutter,
    marginTop: -12,
  },
  tags: {
    flexDirection: "row",
    flexWrap: "wrap",
    gap: 8,
    marginTop: 14,
  },
  metaBlock: {
    marginTop: 20,
    gap: 14,
  },
  metaRow: {
    flexDirection: "row",
    alignItems: "flex-start",
    gap: 12,
  },
  metaIcon: {
    width: 34,
    height: 34,
    borderRadius: layout.radiusSmall,
    alignItems: "center",
    justifyContent: "center",
  },
  actions: {
    flexDirection: "row",
    gap: 10,
    marginTop: 22,
  },
  primary: {
    flex: 1,
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "center",
    gap: 8,
    paddingVertical: 14,
    borderRadius: layout.radiusSmall,
  },
  secondary: {
    width: 52,
    alignItems: "center",
    justifyContent: "center",
    borderRadius: layout.radiusSmall,
    borderWidth: StyleSheet.hairlineWidth,
  },
  section: {
    marginTop: 26,
  },
  host: {
    flexDirection: "row",
    alignItems: "center",
    gap: 12,
    paddingVertical: 10,
  },
})
