import { Ionicons } from "@expo/vector-icons"
import React, { useCallback, useMemo, useState } from "react"
import { FlatList, Pressable, RefreshControl, View } from "react-native"

import { filterCommunityMembers, useCommunityMembers, type CommunityMember } from "@/api/people"
import { Avatar, Divider, EmptyState, ErrorState, Field, Loading, Muted, Txt } from "@/components/ui"
import { FadeIn } from "@/components/fade-in"
import { layout, usePalette } from "@/theme"

/* ----------------------------------------------------------- people row */

// Long member lists shouldn't take seconds to finish animating in; everyone
// past the cap arrives on the same beat as row 10 instead of queuing further.
const STAGGER_CAP = 10
const STAGGER_STEP = 35

export function PersonRow({
  member,
  index,
  onPress,
}: {
  member: CommunityMember
  index: number
  onPress: () => void
}) {
  const p = usePalette()
  const affiliation = [member.jobTitle, member.organization].filter(Boolean).join(" · ")

  return (
    <FadeIn delay={Math.min(index, STAGGER_CAP) * STAGGER_STEP} offset={8}>
      <Pressable
        accessibilityRole="button"
        accessibilityLabel={member.fullName}
        onPress={onPress}
        style={({ pressed }) => ({
          flexDirection: "row",
          alignItems: "center",
          gap: 12,
          paddingHorizontal: layout.gutter,
          paddingVertical: 12,
          backgroundColor: pressed ? p.surface : "transparent",
        })}
      >
        <Avatar uri={member.avatarUrl} name={member.fullName} size={44} />
        <View style={{ flex: 1, gap: 2 }}>
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
      </Pressable>
    </FadeIn>
  )
}

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

  const members = data ?? []
  const visible = useMemo(() => filterCommunityMembers(members, search), [members, search])

  const renderItem = useCallback(
    ({ item, index }: { item: CommunityMember; index: number }) => (
      <PersonRow member={item} index={index} onPress={() => onOpen(item.id)} />
    ),
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
          <View style={{ paddingHorizontal: layout.gutter, paddingBottom: 10 }}>
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
      ItemSeparatorComponent={Divider}
      contentContainerStyle={{ paddingBottom: 24 }}
      keyboardShouldPersistTaps="handled"
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
