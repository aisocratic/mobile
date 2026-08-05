import { Ionicons } from "@expo/vector-icons"
import { useRouter } from "expo-router"
import React, { useCallback, useMemo, useState } from "react"
import { FlatList, RefreshControl, StyleSheet, View } from "react-native"

import {
  connectionSubtitle,
  filterConnections,
  primaryRole,
  useConnections,
  type ConnectionFilter,
} from "@/api/connections"
import {
  Avatar,
  Chip,
  EmptyState,
  ErrorState,
  Field,
  Loading,
  Screen,
  SegmentedControl,
  Txt,
} from "@/components/ui"
import { Touchable } from "@/components/touchable"
import { layout, space, usePalette } from "@/theme"
import type { Connection } from "@/types"

const FILTERS: { value: ConnectionFilter; label: string }[] = [
  { value: "all", label: "All" },
  { value: "hosts", label: "Hosts" },
  { value: "guests", label: "Guests" },
]

/* -------------------------------------------------------------------- row */

const ConnectionRow = React.memo(function ConnectionRow({
  connection,
  onPress,
}: {
  connection: Connection
  onPress: (id: string) => void
}) {
  const p = usePalette()
  const role = primaryRole(connection)

  // "Title @ Company" collapses cleanly when either half is missing.
  const affiliation = [connection.title, connection.company].filter(Boolean).join(" @ ")

  return (
    <Touchable
      accessibilityRole="button"
      accessibilityLabel={connection.name ?? "Member"}
      onPress={() => onPress(connection.id)}
      style={styles.row}
    >
      <Avatar uri={connection.avatarUrl} name={connection.name} size={46} />

      <View style={styles.rowBody}>
        <View style={styles.nameLine}>
          <Txt variant="heading" numberOfLines={1} style={{ flexShrink: 1 }}>
            {connection.name ?? "Unnamed"}
          </Txt>
          <Chip
            label={role === "host" ? "Host" : "Guest"}
            tone={role === "host" ? "accent" : "muted"}
          />
        </View>

        {affiliation ? (
          <Txt variant="body" color={p.muted} numberOfLines={1}>
            {affiliation}
          </Txt>
        ) : null}

        <Txt variant="caption" color={p.accent} numberOfLines={1}>
          {connectionSubtitle(connection)}
        </Txt>
      </View>

      <Ionicons name="chevron-forward" size={16} color={p.border} style={{ marginTop: space.xs + space.hair }} />
    </Touchable>
  )
})

/* ----------------------------------------------------------------- screen */

export default function ConnectionsScreen() {
  const p = usePalette()
  const router = useRouter()

  const [filter, setFilter] = useState<ConnectionFilter>("all")
  const [search, setSearch] = useState("")

  const { data, error, isPending, isFetching, refetch } = useConnections()

  const connections = data?.connections ?? []
  const visible = useMemo(
    () => filterConnections(connections, filter, search),
    [connections, filter, search],
  )

  const open = useCallback(
    (id: string) => router.push({ pathname: "/member/[id]", params: { id } }),
    [router],
  )

  const headline =
    connections.length === 0
      ? "Connections"
      : `${connections.length} ${connections.length === 1 ? "person" : "people"} you've met at ${
          data?.sharedEventCount ?? 0
        } ${data?.sharedEventCount === 1 ? "event" : "events"}`

  /**
   * Three different "nothing here" situations, and it matters which one we
   * show. `event_attendance` and `event_users` are RLS-scoped to your own rows,
   * so a member who has never been linked to the registry — or one whose events
   * we can see but whose guest lists we cannot — gets zero rows rather than an
   * error. Saying "no connections" in either case would be a lie.
   */
  const empty = isPending ? (
    <Loading label="Finding people you've met…" />
  ) : error ? (
    <ErrorState error={error} onRetry={() => void refetch()} />
  ) : connections.length === 0 && (data?.myEventCount ?? 0) === 0 ? (
    <EmptyState
      icon="people-outline"
      title="No events linked to you yet"
      body="Connections appear once you've attended or hosted an AI Socratic event with the email you signed up with. If you registered on Luma with a different address, that's usually why."
    />
  ) : connections.length === 0 ? (
    <EmptyState
      icon="lock-closed-outline"
      title="Guest lists aren't visible yet"
      body={`We found ${data?.myEventCount ?? 0} ${
        data?.myEventCount === 1 ? "event" : "events"
      } linked to you, but the attendee records for them aren't shared with your account, so we can't show who else was there.`}
    />
  ) : (
    <EmptyState
      icon="search-outline"
      title="No matches"
      body="Try a different name, company or filter."
    />
  )

  return (
    <Screen>
      <FlatList
        data={visible}
        keyExtractor={(item) => item.id}
        contentContainerStyle={{ paddingBottom: space.xxxl }}
        keyboardShouldPersistTaps="handled"
        ListHeaderComponent={
          <View style={styles.header}>
            <View style={styles.headerText}>
              <Txt variant="title">{headline}</Txt>
              {connections.length > 0 ? (
                <Txt variant="caption" color={p.muted}>
                  Everyone you shared a room with, as a host or a guest.
                </Txt>
              ) : null}
            </View>

            {connections.length > 0 ? (
              <>
                <View style={styles.search}>
                  <Field
                    placeholder="Search name, company or title"
                    value={search}
                    onChangeText={setSearch}
                    autoCapitalize="none"
                    autoCorrect={false}
                    returnKeyType="search"
                    clearButtonMode="while-editing"
                  />
                </View>
                <SegmentedControl options={FILTERS} value={filter} onChange={setFilter} />
              </>
            ) : null}
          </View>
        }
        renderItem={({ item }) => <ConnectionRow connection={item} onPress={open} />}
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
        initialNumToRender={12}
        windowSize={9}
      />
    </Screen>
  )
}

const styles = StyleSheet.create({
  header: {
    paddingTop: space.md,
    paddingBottom: space.sm,
    gap: space.lg,
  },
  headerText: {
    paddingHorizontal: layout.gutter,
    gap: space.xs,
  },
  search: {
    paddingHorizontal: layout.gutter,
  },
  row: {
    flexDirection: "row",
    alignItems: "flex-start",
    gap: space.lg,
    paddingHorizontal: layout.gutter,
    paddingVertical: space.md,
  },
  rowBody: {
    flex: 1,
    gap: space.xs - 1,
  },
  nameLine: {
    flexDirection: "row",
    alignItems: "center",
    gap: space.sm,
  },
})
