import { Ionicons } from "@expo/vector-icons"
import React, { useCallback, useMemo, useState } from "react"
import { FlatList, RefreshControl, View } from "react-native"

import { filterCommunityMembers, useCommunityMembers, type CommunityMember } from "@/api/people"
import { Avatar, Divider, EmptyState, ErrorState, Field, Loading, Muted, Txt } from "@/components/ui"
import { FadeIn } from "@/components/fade-in"
import { Touchable } from "@/components/touchable"
import { layout, motion, space, usePalette } from "@/theme"

/* ----------------------------------------------------------- people row */

const AVATAR = 44

/** A stable identity for "no members", so `visible` below isn't recomputed on
 * every render just because `data ?? []` minted a new empty array. */
const NO_MEMBERS: CommunityMember[] = []

/** Indented past the avatar, so the rules read as a column of people rather
 * than as full-width dividers slicing the screen. Defined out here because an
 * inline arrow would be a new component type on every render, which makes
 * FlatList tear down and rebuild every separator. */
function PeopleSeparator() {
  return <Divider inset={layout.gutter + AVATAR + space.md} />
}

export const PersonRow = React.memo(function PersonRow({
  member,
  onPress,
}: {
  member: CommunityMember
  onPress: (id: string) => void
}) {
  const p = usePalette()
  const affiliation = [member.jobTitle, member.organization].filter(Boolean).join(" · ")

  return (
    <Touchable
      accessibilityRole="button"
      accessibilityLabel={member.fullName}
      onPress={() => onPress(member.id)}
      style={{
        flexDirection: "row",
        alignItems: "center",
        gap: space.md,
        paddingHorizontal: layout.gutter,
        paddingVertical: space.md,
      }}
    >
      <Avatar uri={member.avatarUrl} name={member.fullName} size={AVATAR} />
      <View style={{ flex: 1, gap: space.hair }}>
        <Txt variant="heading" numberOfLines={1}>
          {member.fullName}
        </Txt>
        {affiliation ? (
          <Txt variant="body" color={p.muted} numberOfLines={1}>
            {affiliation}
          </Txt>
        ) : null}
        {member.location ? <Muted numberOfLines={1}>{member.location}</Muted> : null}
      </View>
      <Ionicons name="chevron-forward" size={16} color={p.border} />
    </Touchable>
  )
})

/**
 * The member directory: everyone in the community, searchable, one tap from a
 * DM. Deliberately independent of the relay — it reads `public.users` over
 * PostgREST, not Nostr, so it renders the same whether the socket above is
 * live, reconnecting, or this key hasn't joined the relay's rooms yet.
 */
export function PeopleList({ onOpen }: { onOpen: (id: string) => void }) {
  const p = usePalette()
  const [search, setSearch] = useState("")
  const { data, isPending, isFetching, error, refetch } = useCommunityMembers()

  const members = data ?? NO_MEMBERS
  const visible = useMemo(() => filterCommunityMembers(members, search), [members, search])

  const renderItem = useCallback(
    ({ item, index }: { item: CommunityMember; index: number }) => {
      const row = <PersonRow member={item} onPress={onOpen} />
      // Only the first screenful is staggered; past that, rows would animate
      // as you scroll onto them, which reads as lag rather than as arrival.
      return index < motion.staggerCap ? (
        <FadeIn index={index} offset={space.sm}>
          {row}
        </FadeIn>
      ) : (
        row
      )
    },
    [onOpen],
  )

  const empty = isPending ? (
    <Loading label="Finding people…" />
  ) : error ? (
    <ErrorState error={error} onRetry={() => void refetch()} />
  ) : members.length === 0 ? (
    <EmptyState
      icon="people-outline"
      title="No one here yet"
      body="Once people join the community, you'll be able to find them here and start a conversation."
    />
  ) : (
    <EmptyState icon="search-outline" title="No matches" body="Try a different name, company or location." />
  )

  return (
    <FlatList
      data={visible}
      keyExtractor={(item) => item.id}
      renderItem={renderItem}
      ListHeaderComponent={
        members.length > 0 ? (
          <View style={{ paddingHorizontal: layout.gutter, paddingBottom: space.sm + space.hair }}>
            <Field
              placeholder="Search name, company or location"
              value={search}
              onChangeText={setSearch}
              autoCapitalize="none"
              autoCorrect={false}
              returnKeyType="search"
              clearButtonMode="while-editing"
            />
          </View>
        ) : null
      }
      ListEmptyComponent={empty}
      ItemSeparatorComponent={PeopleSeparator}
      contentContainerStyle={{ paddingBottom: space.xxl - space.xs }}
      keyboardShouldPersistTaps="handled"
      keyboardDismissMode="on-drag"
      refreshControl={
        <RefreshControl
          refreshing={isFetching && !isPending}
          onRefresh={() => void refetch()}
          tintColor={p.muted}
          colors={[p.accent]}
        />
      }
    />
  )
}
