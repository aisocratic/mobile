import { useQuery } from "@tanstack/react-query"

import { supabase } from "@/lib/supabase"
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
 * Everyone but the signed-in viewer, members first, then alphabetical.
 *
 * The `full_name IS NULL` filter happens in Postgres; a name that is present
 * but blank (whitespace only) still slips through and is dropped in
 * `toMember` instead — PostgREST has no clean "is blank" filter, and this is
 * rare enough that doing it client-side costs nothing.
 */
export async function fetchCommunityMembers(viewerId: string): Promise<CommunityMember[]> {
  const { data, error } = await supabase
    .from(TABLE)
    .select(COLUMNS)
    .neq("id", viewerId)
    .not("full_name", "is", null)
    .order("is_member", { ascending: false })
    .order("full_name", { ascending: true })
    .limit(MAX_ROWS)

  if (error) throw new Error(error.message)

  const rows: CommunityMember[] = []
  for (const raw of (data ?? []) as Row[]) {
    const member = toMember(raw)
    if (member) rows.push(member)
  }
  return rows
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
