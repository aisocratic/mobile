import { useQuery } from "@tanstack/react-query"

import { api } from "@/lib/api"
import { useAuth } from "@/store/auth"

/**
 * The community member directory: `public.users`, world-readable.
 *
 * This is deliberately not `src/api/connections.ts`'s pipeline. Connections
 * answers "who have I actually met", which is derived from `event_attendance`
 * — a table RLS scopes to your own rows, so it can only ever describe people
 * you already share an event with. The chat People tab asks a simpler
 * question, "who is in this community", and `public.users` answers it for
 * anyone signed in without touching a locked-down table at all.
 *
 * Kept intentionally thin: no bios, no expertise, no shared-event math — just
 * enough to recognise a name and start a DM. `/chat/[id]` resolves a bare
 * `users.id` on its own (see `resolveChannel` in `src/chat/nostr.ts`), so this
 * module doesn't need to know anything about chat itself.
 */

const TABLE = "users"
const COLUMNS = "id,full_name,avatar_url,job_title,organization,location,is_member"

/** Comfortably more than any chapter has today; keeps the query bounded regardless. */
const MAX_ROWS = 200

export type CommunityMember = {
  id: string
  fullName: string
  avatarUrl: string | null
  jobTitle: string | null
  organization: string | null
  location: string | null
  isMember: boolean
}

type Row = {
  id: string
  full_name: string | null
  avatar_url: string | null
  job_title: string | null
  organization: string | null
  location: string | null
  is_member: boolean | null
}

function toMember(row: Row): CommunityMember | null {
  const fullName = row.full_name?.trim()
  // A blank name renders as a nameless row with no way to recognise the
  // person it points at, which is worse than leaving them out of the list.
  if (!fullName) return null

  return {
    id: row.id,
    fullName,
    avatarUrl: row.avatar_url,
    jobTitle: row.job_title,
    organization: row.organization,
    location: row.location,
    isMember: !!row.is_member,
  }
}

/**
 * The set of user ids with a registered chat key in `chat_identities` — the
 * people a DM can actually reach. Anyone else resolves to the legacy derived
 * key, which the relay happily accepts wraps for even though no device holds
 * it (verified live), so a DM to them is a black hole, not an error.
 *
 * Best-effort: an unreachable directory returns an empty set, which turns the
 * dedupe below off rather than hiding anyone.
 */
export async function fetchReachableUserIds(): Promise<Set<string>> {
  try {
    const { data, error } = await api.from("chat_identities").select("user_id")
    if (error) return new Set()
    const ids = new Set<string>()
    for (const raw of (data ?? []) as { user_id: string | null }[]) {
      if (raw.user_id) ids.add(raw.user_id)
    }
    return ids
  } catch {
    return new Set()
  }
}

/**
 * Which of these user ids still exist in `public.users`?
 *
 * Used to sweep DM threads whose person was merged away during an account
 * dedupe. Returns null when the directory can't be reached, so callers can
 * tell "this person is gone" apart from "the network is down" — only the
 * former is safe to act on.
 */
export async function fetchExistingUserIds(ids: string[]): Promise<Set<string> | null> {
  if (!ids.length) return new Set()
  try {
    const { data, error } = await api.from("users").select("id").in("id", ids)
    if (error) return null
    const found = new Set<string>()
    for (const raw of (data ?? []) as { id: string | null }[]) {
      if (raw.id) found.add(raw.id)
    }
    return found
  } catch {
    return null
  }
}

/**
 * Collapse duplicate directory entries for the same person.
 *
 * Production `users` has several rows per human — old sign-ups, Telegram
 * imports, a second email — all with the same name and no linking key. Every
 * extra row is a live footgun: tapping it starts a DM to a derived key nobody
 * holds. There is nothing to join the rows on, so the rule is deliberately
 * narrow: within a group of identical (normalized) names, if at least one row
 * has a registered chat identity, drop the rows that don't — they are
 * near-certain black holes standing next to an address that works. Groups
 * with no reachable row are left alone, because two strangers can legitimately
 * share a name and neither row is better than the other.
 */
export function dedupeCommunityMembers(
  members: CommunityMember[],
  reachableIds: Set<string>,
): CommunityMember[] {
  if (!reachableIds.size) return members

  const reachableNames = new Set<string>()
  const nameCounts = new Map<string, number>()
  for (const m of members) {
    const key = m.fullName.trim().toLowerCase()
    nameCounts.set(key, (nameCounts.get(key) ?? 0) + 1)
    if (reachableIds.has(m.id)) reachableNames.add(key)
  }

  return members.filter((m) => {
    const key = m.fullName.trim().toLowerCase()
    if ((nameCounts.get(key) ?? 0) < 2) return true
    return reachableIds.has(m.id) || !reachableNames.has(key)
  })
}

/**
 * Everyone but the signed-in viewer, members first, then alphabetical.
 *
 * The `full_name IS NULL` filter happens in Postgres; a name that is present
 * but blank (whitespace only) still slips through and is dropped in
 * `toMember` instead — PostgREST has no clean "is blank" filter, and this is
 * rare enough that doing it client-side costs nothing.
 */
export async function fetchCommunityMembers(viewerId: string): Promise<CommunityMember[]> {
  const [{ data, error }, reachable] = await Promise.all([
    api
      .from(TABLE)
      .select(COLUMNS)
      .neq("id", viewerId)
      .not("full_name", "is", null)
      .order("is_member", { ascending: false })
      .order("full_name", { ascending: true })
      .limit(MAX_ROWS),
    fetchReachableUserIds(),
  ])

  if (error) throw new Error(error.message)

  const rows: CommunityMember[] = []
  for (const raw of (data ?? []) as Row[]) {
    const member = toMember(raw)
    if (member) rows.push(member)
  }
  return dedupeCommunityMembers(rows, reachable)
}

export function useCommunityMembers() {
  const { session, user } = useAuth()
  const viewerId = user?.id ?? null

  return useQuery({
    queryKey: ["community-members", viewerId ?? "anonymous"],
    queryFn: () => fetchCommunityMembers(viewerId as string),
    enabled: !!session && !!viewerId,
    staleTime: 5 * 60_000,
  })
}

/* -------------------------------------------------------------------- search */

export function matchesMemberSearch(member: CommunityMember, query: string): boolean {
  const q = query.trim().toLowerCase()
  if (!q) return true
  return [member.fullName, member.organization, member.jobTitle, member.location].some(
    (field) => !!field && field.toLowerCase().includes(q),
  )
}

export function filterCommunityMembers(
  members: CommunityMember[],
  search: string,
): CommunityMember[] {
  return members.filter((m) => matchesMemberSearch(m, search))
}
