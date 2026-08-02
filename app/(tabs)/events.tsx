import { Ionicons } from "@expo/vector-icons"
import { Image } from "expo-image"
import { LinearGradient } from "expo-linear-gradient"
import { useRouter } from "expo-router"
import React, { useCallback, useMemo, useState } from "react"
import { Pressable, RefreshControl, SectionList, StyleSheet, View } from "react-native"

import { eventCover, eventPlace, useEvents, type EventFilter } from "@/api/events"
import { EmptyState, ErrorState, Loading, Screen, SegmentedControl, Txt } from "@/components/ui"
import { EventsMasthead } from "@/components/events-masthead"
import { FadeIn } from "@/components/fade-in"
import { formatEventTime, parseDate } from "@/lib/format"
import { layout, usePalette, type Palette } from "@/theme"
import type { EventRow } from "@/types"

const FILTERS: { value: EventFilter; label: string }[] = [
  { value: "upcoming", label: "Upcoming" },
  { value: "past", label: "Past" },
]

const COVER_SIZE = 84

/** Rows past this index render without delay — a long list scrolling in
 * staggered would feel laggy rather than composed. */
const STAGGER_CAP = 8
const STAGGER_STEP_MS = 55

type Section = { title: string; data: EventRow[] }

/** Rows arrive already sorted, so a single pass produces month sections. */
function groupByMonth(events: EventRow[]): Section[] {
  const sections: Section[] = []

  for (const event of events) {
    const date = parseDate(event.start_at)
    const title = date
      ? date.toLocaleDateString(undefined, { month: "long", year: "numeric" })
      : "Date to be announced"

    const last = sections[sections.length - 1]
    if (last && last.title === title) last.data.push(event)
    else sections.push({ title, data: [event] })
  }

  return sections
}

/* ----------------------------------------------------------------- pieces */

function Cover({ event, p }: { event: EventRow; p: Palette }) {
  const uri = eventCover(event, "small")

  if (uri) {
    return (
      <Image
        source={{ uri }}
        style={styles.cover}
        contentFit="cover"
        transition={180}
        cachePolicy="memory-disk"
      />
    )
  }

  // Most rows do have a Luma cover, but never show a broken box when they don't.
  return (
    <LinearGradient
      colors={[`${p.accent}33`, `${p.accent}0D`]}
      start={{ x: 0, y: 0 }}
      end={{ x: 1, y: 1 }}
      style={[styles.cover, styles.coverFallback, { borderColor: p.border }]}
    >
      <Ionicons name="calendar-outline" size={24} color={p.accent} />
    </LinearGradient>
  )
}

function HostStack({ hosts, p }: { hosts: EventRow["hosts"]; p: Palette }) {
  if (!hosts?.length) return null
  const shown = hosts.slice(0, 4)

  return (
    <View style={styles.hostStack}>
      {shown.map((host, i) => (
        <View
          key={host.api_id ?? `${host.name}-${i}`}
          style={[
            styles.hostAvatar,
            { backgroundColor: p.input, borderColor: p.background, marginLeft: i === 0 ? 0 : -8 },
          ]}
        >
          {host.avatar_url ? (
            <Image source={{ uri: host.avatar_url }} style={styles.hostImage} contentFit="cover" />
          ) : (
            <Txt variant="caption" color={p.muted} style={{ fontSize: 9 }}>
              {host.name?.trim().charAt(0).toUpperCase() ?? "?"}
            </Txt>
          )}
        </View>
      ))}
      {hosts.length > shown.length ? (
        <Txt variant="caption" color={p.muted} style={{ marginLeft: 6 }}>
          +{hosts.length - shown.length}
        </Txt>
      ) : null}
    </View>
  )
}

const EventCard = React.memo(function EventCard({
  event,
  onPress,
}: {
  event: EventRow
  onPress: (id: string) => void
}) {
  const p = usePalette()
  const date = parseDate(event.start_at)
  const time = formatEventTime(event.start_at)
  const place = eventPlace(event, true)
  const guests = event.guest_count && event.guest_count > 0 ? event.guest_count : null

  const day = date
    ? date.toLocaleDateString(undefined, { weekday: "short", day: "numeric" })
    : "Date TBA"

  return (
    <Pressable
      accessibilityRole="button"
      accessibilityLabel={event.title ?? "Event"}
      onPress={() => onPress(event.id)}
      style={({ pressed }) => [styles.row, { opacity: pressed ? 0.6 : 1 }]}
    >
      <Cover event={event} p={p} />

      <View style={styles.rowBody}>
        <Txt variant="caption" color={p.accent}>
          {time ? `${day} · ${time}` : day}
        </Txt>

        <Txt variant="heading" numberOfLines={2} style={{ lineHeight: 21 }}>
          {event.title ?? "Untitled event"}
        </Txt>

        <View style={styles.metaRow}>
          {event.is_virtual ? (
            <View style={[styles.badge, { backgroundColor: `${p.accent}1F` }]}>
              <Ionicons name="videocam-outline" size={11} color={p.accent} />
              <Txt variant="caption" color={p.accent}>
                Virtual
              </Txt>
            </View>
          ) : place ? (
            <View style={styles.metaItem}>
              <Ionicons name="location-outline" size={12} color={p.muted} />
              <Txt variant="caption" color={p.muted} numberOfLines={1}>
                {place}
              </Txt>
            </View>
          ) : null}

          {guests ? (
            <View style={styles.metaItem}>
              <Ionicons name="people-outline" size={12} color={p.muted} />
              <Txt variant="caption" color={p.muted}>
                {guests}
              </Txt>
            </View>
          ) : null}

          <HostStack hosts={event.hosts} p={p} />
        </View>
      </View>

      <Ionicons name="chevron-forward" size={16} color={p.border} style={{ marginTop: 4 }} />
    </Pressable>
  )
})

/* ----------------------------------------------------------------- screen */

export default function EventsScreen() {
  const p = usePalette()
  const router = useRouter()
  const [filter, setFilter] = useState<EventFilter>("upcoming")

  const { data, error, isPending, isFetching, refetch } = useEvents(filter)
  const sections = useMemo(() => groupByMonth(data ?? []), [data])

  // Delay by an event's position in the whole (unsectioned) list, so the
  // stagger reads top-to-bottom across month boundaries rather than
  // restarting at zero in each section.
  const staggerDelay = useMemo(() => {
    const delays = new Map<string, number>()
    for (const [i, event] of (data ?? []).entries()) {
      if (i >= STAGGER_CAP) break
      delays.set(event.id, i * STAGGER_STEP_MS)
    }
    return delays
  }, [data])

  const open = useCallback(
    (id: string) => router.push({ pathname: "/event/[id]", params: { id } }),
    [router],
  )

  const empty = isPending ? (
    <Loading label="Loading events…" />
  ) : error ? (
    <ErrorState error={error} onRetry={() => void refetch()} />
  ) : filter === "upcoming" ? (
    <EmptyState
      icon="calendar-outline"
      title="Nothing on the calendar"
      body="No upcoming events are scheduled right now. Browse what the community has already run."
    />
  ) : (
    <EmptyState icon="calendar-outline" title="No past events" />
  )

  return (
    <Screen>
      <SectionList
        sections={sections}
        keyExtractor={(item) => item.id}
        stickySectionHeadersEnabled
        contentContainerStyle={{ paddingBottom: 40 }}
        ListHeaderComponent={
          <View>
            <EventsMasthead />
            <View style={styles.header}>
              <SegmentedControl options={FILTERS} value={filter} onChange={setFilter} />
            </View>
          </View>
        }
        renderSectionHeader={({ section }) => (
          <View style={[styles.sectionHeader, { backgroundColor: p.background }]}>
            <Txt variant="label" color={p.muted} style={styles.sectionTitle}>
              {section.title.toUpperCase()}
            </Txt>
            <View style={[styles.sectionRule, { backgroundColor: p.border }]} />
            <Txt variant="caption" color={p.muted}>
              {section.data.length}
            </Txt>
          </View>
        )}
        renderItem={({ item }) => {
          const delay = staggerDelay.get(item.id)
          const card = <EventCard event={item} onPress={open} />
          return delay === undefined ? card : <FadeIn delay={delay}>{card}</FadeIn>
        }}
        ListEmptyComponent={empty}
        refreshControl={
          <RefreshControl
            refreshing={isFetching && !isPending}
            onRefresh={() => void refetch()}
            tintColor={p.muted}
            colors={[p.accent]}
          />
        }
        removeClippedSubviews
        initialNumToRender={8}
        windowSize={9}
      />
    </Screen>
  )
}

const styles = StyleSheet.create({
  header: {
    paddingTop: 12,
    paddingBottom: 4,
  },
  sectionHeader: {
    flexDirection: "row",
    alignItems: "center",
    gap: 10,
    paddingHorizontal: layout.gutter,
    paddingTop: 18,
    paddingBottom: 8,
  },
  sectionTitle: {
    fontSize: 11,
    letterSpacing: 1,
  },
  sectionRule: {
    flex: 1,
    height: StyleSheet.hairlineWidth,
  },
  row: {
    flexDirection: "row",
    alignItems: "flex-start",
    gap: 14,
    paddingHorizontal: layout.gutter,
    paddingVertical: 10,
  },
  rowBody: {
    flex: 1,
    gap: 4,
  },
  cover: {
    width: COVER_SIZE,
    height: COVER_SIZE,
    borderRadius: layout.radiusSmall,
  },
  coverFallback: {
    alignItems: "center",
    justifyContent: "center",
    borderWidth: StyleSheet.hairlineWidth,
  },
  metaRow: {
    flexDirection: "row",
    alignItems: "center",
    flexWrap: "wrap",
    gap: 10,
    marginTop: 2,
  },
  metaItem: {
    flexDirection: "row",
    alignItems: "center",
    gap: 4,
    flexShrink: 1,
  },
  badge: {
    flexDirection: "row",
    alignItems: "center",
    gap: 4,
    paddingHorizontal: 8,
    paddingVertical: 2,
    borderRadius: layout.radiusPill,
  },
  hostStack: {
    flexDirection: "row",
    alignItems: "center",
  },
  hostAvatar: {
    width: 20,
    height: 20,
    borderRadius: 10,
    borderWidth: 1.5,
    alignItems: "center",
    justifyContent: "center",
    overflow: "hidden",
  },
  hostImage: {
    width: "100%",
    height: "100%",
  },
})
