import { useQuery } from "@tanstack/react-query"

import { api } from "@/lib/api"
import { useAuth } from "@/store/auth"
import type { Connection, ConnectionRole, MemberRow, SharedEvent } from "@/types"

/**
 * Connections = the people you were at an event with, as a host or as a guest.
 *
 * Three tables carry the graph, and two of them are locked down by RLS:
 *
 *   event_users       SELECT where `user_id = auth.uid()`  (your own row only)
 *   event_attendance  SELECT where the row belongs to one of your event_users
 *   events / members / users   world-readable
 *
 * (Both restricted tables also have an "admins and editors see everything"
 * policy.) A blocked read comes back as an empty array, not an error, so every
 * step here degrades to "nothing found" rather than throwing — and the screen
 * says so honestly instead of pretending you have met nobody.
 *
 * The one path that always works for an organiser is `events.hosts`: it is
 * public jsonb, so events you ran can be resolved without touching
 * event_attendance at all.
 */

/* ------------------------------------------------------------------ columns */

const EVENT_USER_COLUMNS =
  "id,source,source_user_id,email,name,linkedin_url,github_url,twitter_url,company,title,location,avatar_url,event_count,checkin_count,user_id,member_id"

const ATTENDANCE_COLUMNS = "event_user_id,event_id,event_name,event_date,status,checked_in_at"

const EVENT_COLUMNS = "id,title,start_at,city,country,hosts"

const MEMBER_COLUMNS =
  "id,slug,user_id,name,first_name,last_name,organization,role,location,bio_summary,summary,linkedin,linkedin_headline,profile_picture_url,expertise,event_approved_count,event_checked_in_count,public_profile"

const USER_COLUMNS = "id,full_name,avatar_url,bio,organization,job_title,location,linkedin_url"

/** PostgREST puts `.in()` lists in the URL, so keep each batch short. */
const CHUNK_SIZE = 100
const PAGE_SIZE = 1000
const MAX_PAGES = 25
const EVENT_LIMIT = 500

/* -------------------------------------------------------------------- types */

export type EventUserRow = {
  id: string
  source: string | null
  /** Luma's own user id — equals `events.hosts[].api_id`. */
  sourceUserId: string | null
  email: string | null
  name: string | null
  linkedinUrl: string | null
  githubUrl: string | null
  twitterUrl: string | null
  company: string | null
  title: string | null
  location: string | null
  avatarUrl: string | null
  eventCount: number | null
  checkinCount: number | null
  userId: string | null
  memberId: string | null
}

export type MemberProfile = {
  /** event_users.id — what `/member/[id]` is keyed by. */
  id: string
  name: string | null
  email: string | null
  avatarUrl: string | null
  company: string | null
  title: string | null
  location: string | null
  bio: string | null
  headline: string | null
  expertise: string[]
  linkedinUrl: string | null
  twitterUrl: string | null
  githubUrl: string | null
  eventCount: number | null
}

export type ConnectionsResult = {
  connections: Connection[]
  /** Events we could resolve as yours (attended or hosted). */
  myEventCount: number
  /** Distinct events that produced at least one connection. */
  sharedEventCount: number
}

export type ConnectionFilter = "all" | "hosts" | "guests"

/** Who you are, flattened out of the auth store. */
export type Viewer = {
  userId: string
  email: string | null
  fullName: string | null
  linkedinUrl: string | null
}

type Raw = Record<string, unknown>

type AttendanceRow = {
  eventUserId: string
  eventId: string | null
  eventName: string | null
  eventDate: string | null
  status: string | null
  checkedInAt: string | null
}

type EventInfo = {
  id: string
  title: string | null
  startAt: string | null
  city: string | null
  hostLumaIds: Set<string>
  hostNames: Set<string>
  hostLinkedin: Set<string>
}

/** The keys we can recognise a person by across Luma exports. */
type Identity = {
  lumaIds: Set<string>
  names: Set<string>
  linkedin: Set<string>
  emails: Set<string>
}

type UserLite = {
  id: string
  full_name: string | null
  avatar_url: string | null
  bio: string | null
  organization: string | null
  job_title: string | null
  location: string | null
  linkedin_url: string | null
}

type Enrichment = {
  byMemberId: Map<string, MemberRow>
  byUserId: Map<string, UserLite>
}

/* ------------------------------------------------------------------ helpers */

function str(value: unknown): string | null {
  if (typeof value !== "string") return null
  const trimmed = value.trim()
  return trimmed ? trimmed : null
}

function num(value: unknown): number | null {
  return typeof value === "number" && Number.isFinite(value) ? value : null
}

function bool(value: unknown): boolean | null {
  return typeof value === "boolean" ? value : null
}

function strings(value: unknown): string[] {
  if (!Array.isArray(value)) return []
  return value.map((v) => str(v)).filter((v): v is string => !!v)
}

function lower(value: string | null | undefined): string | null {
  if (!value) return null
  const trimmed = value.trim().toLowerCase()
  return trimmed ? trimmed : null
}

function chunk<T>(items: T[], size = CHUNK_SIZE): T[][] {
  const out: T[][] = []
  for (let i = 0; i < items.length; i += size) out.push(items.slice(i, i + size))
  return out
}

/** "https://linkedin.com/in/foo/", "/in/foo" and "foo" all reduce to "foo". */
function linkedinKey(value: string | null | undefined): string | null {
  const cleaned = lower(value)
  if (!cleaned) return null
  const last = cleaned
    .replace(/[?#].*$/, "")
    .split("/")
    .filter(Boolean)
    .pop()
  // A bare host ("linkedin.com") means the profile part was missing.
  if (!last || last.includes(".")) return null
  return last
}

function addTo(set: Set<string>, value: string | null | undefined): void {
  if (value) set.add(value)
}

/* -------------------------------------------------------------- normalisers */

function toEventUser(raw: Raw): EventUserRow {
  return {
    id: String(raw.id ?? ""),
    source: str(raw.source),
    sourceUserId: str(raw.source_user_id),
    email: str(raw.email),
    name: str(raw.name),
    linkedinUrl: str(raw.linkedin_url),
    githubUrl: str(raw.github_url),
    twitterUrl: str(raw.twitter_url),
    company: str(raw.company),
    title: str(raw.title),
    location: str(raw.location),
    avatarUrl: str(raw.avatar_url),
    eventCount: num(raw.event_count),
    checkinCount: num(raw.checkin_count),
    userId: str(raw.user_id),
    memberId: str(raw.member_id),
  }
}

function toAttendance(raw: Raw): AttendanceRow {
  return {
    eventUserId: String(raw.event_user_id ?? ""),
    eventId: str(raw.event_id),
    eventName: str(raw.event_name),
    eventDate: str(raw.event_date),
    status: lower(str(raw.status)),
    checkedInAt: str(raw.checked_in_at),
  }
}

function toEventInfo(raw: Raw): EventInfo {
  const hostLumaIds = new Set<string>()
  const hostNames = new Set<string>()
  const hostLinkedin = new Set<string>()

  const hosts = Array.isArray(raw.hosts) ? (raw.hosts as unknown[]) : []
  for (const entry of hosts) {
    if (!entry || typeof entry !== "object") continue
    const host = entry as Raw
    addTo(hostLumaIds, str(host.api_id))
    addTo(hostNames, lower(str(host.name)))
    addTo(hostLinkedin, linkedinKey(str(host.linkedin_handle)))
  }

  return {
    id: String(raw.id ?? ""),
    title: str(raw.title),
    startAt: str(raw.start_at),
    city: str(raw.city) ?? str(raw.country),
    hostLumaIds,
    hostNames,
    hostLinkedin,
  }
}

function toMember(raw: Raw): MemberRow {
  return {
    id: String(raw.id ?? ""),
    slug: str(raw.slug),
    user_id: str(raw.user_id),
    name: str(raw.name),
    first_name: str(raw.first_name),
    last_name: str(raw.last_name),
    organization: str(raw.organization),
    role: str(raw.role),
    location: str(raw.location),
    bio_summary: str(raw.bio_summary),
    summary: str(raw.summary),
    linkedin: str(raw.linkedin),
    linkedin_headline: str(raw.linkedin_headline),
    profile_picture_url: str(raw.profile_picture_url),
    expertise: strings(raw.expertise),
    event_approved_count: num(raw.event_approved_count),
    event_checked_in_count: num(raw.event_checked_in_count),
    public_profile: bool(raw.public_profile),
  }
}

function toUserLite(raw: Raw): UserLite {
  return {
    id: String(raw.id ?? ""),
    full_name: str(raw.full_name),
    avatar_url: str(raw.avatar_url),
    bio: str(raw.bio),
    organization: str(raw.organization),
    job_title: str(raw.job_title),
    location: str(raw.location),
    linkedin_url: str(raw.linkedin_url),
  }
}

/* -------------------------------------------------------------- role logic */

function identityOf(rows: EventUserRow[], extra?: Partial<Viewer>): Identity {
  const identity: Identity = {
    lumaIds: new Set(),
    names: new Set(),
    linkedin: new Set(),
    emails: new Set(),
  }

  for (const row of rows) {
    addTo(identity.lumaIds, row.sourceUserId)
    addTo(identity.names, lower(row.name))
    addTo(identity.linkedin, linkedinKey(row.linkedinUrl))
    addTo(identity.emails, lower(row.email))
  }

  addTo(identity.names, lower(extra?.fullName))
  addTo(identity.linkedin, linkedinKey(extra?.linkedinUrl))
  addTo(identity.emails, lower(extra?.email))

  return identity
}

/**
 * You must never turn up in your own connection list. `event_users` rows that
 * belong to you but that step 1 couldn't claim — a second Luma export under
 * another address, or the row you were listed under when you hosted — are only
 * recognisable by the same fuzzy keys used for hosts, so reuse them here.
 */
function isSelf(row: EventUserRow, me: Identity): boolean {
  if (row.sourceUserId && me.lumaIds.has(row.sourceUserId)) return true

  const email = lower(row.email)
  if (email && me.emails.has(email)) return true

  const name = lower(row.name)
  if (name && me.names.has(name)) return true

  const handle = linkedinKey(row.linkedinUrl)
  if (handle && me.linkedin.has(handle)) return true

  return false
}

/**
 * Role derivation. `events.hosts` is the only record of who ran an event, and
 * it is a Luma jsonb blob rather than a foreign key — so "is this person a host
 * of this event?" is a fuzzy join we do in TypeScript.
 *
 * Keys, strongest first:
 *   1. `hosts[].api_id` === `event_users.source_user_id` — Luma's own user id,
 *      exact and stable; this resolves most real hosts.
 *   2. case-insensitive full name — Luma re-types host names by hand, so this
 *      catches people whose api_id was never captured.
 *   3. LinkedIn handle — `hosts[].linkedin_handle` is "/in/foo" while
 *      `event_users.linkedin_url` is a full URL, hence linkedinKey().
 *
 * Anyone who does not match is a guest. False negatives are the safe failure
 * (a host shown as "Guest"); we never invent a host badge.
 */
function isHostOf(event: EventInfo, who: Identity): boolean {
  for (const id of who.lumaIds) if (event.hostLumaIds.has(id)) return true
  for (const name of who.names) if (event.hostNames.has(name)) return true
  for (const handle of who.linkedin) if (event.hostLinkedin.has(handle)) return true
  return false
}

function roleAt(event: EventInfo | undefined, who: Identity): ConnectionRole {
  return event && isHostOf(event, who) ? "host" : "guest"
}

/**
 * Luma exports every invitation, so `event_attendance` is mostly `invited` rows
 * for people who never turned up. Only an approved registration or a real
 * check-in means two people shared a room — the same rule the website's guest
 * list uses.
 */
function wasThere(row: AttendanceRow): boolean {
  return row.status === "approved" || !!row.checkedInAt
}

/* ----------------------------------------------------------------- fetching */

async function fetchEventUsersBy(
  column: "id" | "user_id" | "source_user_id",
  values: string[],
): Promise<EventUserRow[]> {
  if (!values.length) return []
  const rows: EventUserRow[] = []

  for (const group of chunk(values)) {
    const { data, error } = await api
      .from("event_users")
      .select(EVENT_USER_COLUMNS)
      .in(column, group)
    if (error) throw new Error(error.message)
    rows.push(...((data ?? []) as Raw[]).map(toEventUser))
  }

  return rows
}

/** Paged so a busy event series can't be silently truncated at PostgREST's cap. */
async function fetchAttendanceBy(
  column: "event_user_id" | "event_id",
  values: string[],
): Promise<AttendanceRow[]> {
  if (!values.length) return []
  const rows: AttendanceRow[] = []

  for (const group of chunk(values)) {
    for (let page = 0; page < MAX_PAGES; page++) {
      const from = page * PAGE_SIZE
      const { data, error } = await api
        .from("event_attendance")
        .select(ATTENDANCE_COLUMNS)
        .in(column, group)
        .range(from, from + PAGE_SIZE - 1)
      if (error) throw new Error(error.message)

      const batch = (data ?? []) as Raw[]
      rows.push(...batch.map(toAttendance))
      if (batch.length < PAGE_SIZE) break
    }
  }

  return rows
}

async function fetchEventIndex(): Promise<Map<string, EventInfo>> {
  const { data, error } = await api
    .from("events")
    .select(EVENT_COLUMNS)
    .order("start_at", { ascending: false })
    .limit(EVENT_LIMIT)
  if (error) throw new Error(error.message)

  const index = new Map<string, EventInfo>()
  for (const raw of (data ?? []) as Raw[]) {
    const info = toEventInfo(raw)
    if (info.id) index.set(info.id, info)
  }
  return index
}

/**
 * Optional polish: `members` and `users` are world-readable and carry better
 * names, avatars and headlines than the per-event Luma snapshot. Never fatal.
 */
async function fetchEnrichment(rows: EventUserRow[]): Promise<Enrichment> {
  const memberIds = [...new Set(rows.map((r) => r.memberId).filter((v): v is string => !!v))]
  const userIds = [...new Set(rows.map((r) => r.userId).filter((v): v is string => !!v))]

  const byMemberId = new Map<string, MemberRow>()
  const byUserId = new Map<string, UserLite>()

  try {
    for (const group of chunk(memberIds)) {
      const { data } = await api.from("members").select(MEMBER_COLUMNS).in("id", group)
      for (const raw of (data ?? []) as Raw[]) {
        const member = toMember(raw)
        if (member.id) byMemberId.set(member.id, member)
      }
    }
  } catch {
    // Enrichment is cosmetic — a blocked or failing read must not lose the list.
  }

  try {
    for (const group of chunk(userIds)) {
      const { data } = await api.from("users").select(USER_COLUMNS).in("id", group)
      for (const raw of (data ?? []) as Raw[]) {
        const user = toUserLite(raw)
        if (user.id) byUserId.set(user.id, user)
      }
    }
  } catch {
    // Same here.
  }

  return { byMemberId, byUserId }
}

/* ---------------------------------------------------------------- assembly */

/**
 * `event_users.company`, `.title` and `.location` are free-text Luma
 * registration answers, so people paste entire bios and URLs into them. Treat
 * anything multi-line or essay-length as not-an-affiliation; the curated
 * `members` / `users` columns are always preferred anyway.
 */
function affiliation(value: string | null): string | null {
  if (!value) return null
  const firstLine = value.split(/[\r\n]/)[0]?.trim()
  if (!firstLine || firstLine.length > 60 || firstLine.startsWith("http")) return null
  return firstLine
}

function enrichedFields(row: EventUserRow, enrich: Enrichment) {
  const member = row.memberId ? enrich.byMemberId.get(row.memberId) : undefined
  const user = row.userId ? enrich.byUserId.get(row.userId) : undefined

  return {
    member,
    user,
    name: row.name ?? member?.name ?? user?.full_name ?? null,
    avatarUrl: row.avatarUrl ?? member?.profile_picture_url ?? user?.avatar_url ?? null,
    company: member?.organization ?? user?.organization ?? affiliation(row.company),
    title: member?.role ?? member?.linkedin_headline ?? user?.job_title ?? affiliation(row.title),
    location: member?.location ?? user?.location ?? affiliation(row.location),
    linkedinUrl: row.linkedinUrl ?? member?.linkedin ?? user?.linkedin_url ?? null,
  }
}

function toProfile(row: EventUserRow, enrich: Enrichment): MemberProfile {
  const f = enrichedFields(row, enrich)

  return {
    id: row.id,
    name: f.name,
    email: row.email,
    avatarUrl: f.avatarUrl,
    company: f.company,
    title: f.title,
    location: f.location,
    bio: f.member?.bio_summary ?? f.member?.summary ?? f.user?.bio ?? null,
    headline: f.member?.linkedin_headline ?? null,
    expertise: f.member?.expertise ?? [],
    linkedinUrl: f.linkedinUrl,
    twitterUrl: row.twitterUrl,
    githubUrl: row.githubUrl,
    eventCount: row.eventCount,
  }
}

function mostRecent(events: SharedEvent[]): number {
  let best = 0
  for (const e of events) {
    const t = e.startAt ? new Date(e.startAt).getTime() : 0
    if (Number.isFinite(t) && t > best) best = t
  }
  return best
}

/**
 * One human can hold several `event_users` rows (one per source/email). Collapse
 * them on lowercased email, falling back to the row id, and keep whichever row
 * is best linked to a real profile as the canonical one.
 */
function dedupeKey(row: EventUserRow): string {
  return lower(row.email) ?? `id:${row.id}`
}

function rowScore(row: EventUserRow): number {
  return (row.userId ? 4 : 0) + (row.memberId ? 2 : 0) + (row.avatarUrl ? 1 : 0)
}

/* ------------------------------------------------------------------ pipeline */

export async function fetchConnections(viewer: Viewer): Promise<ConnectionsResult> {
  const events = await fetchEventIndex()

  // 1. Who am I in the event registry? Match on the claimed account first, then
  //    on the email people actually registered with on Luma.
  const byUserId = await fetchEventUsersBy("user_id", [viewer.userId])
  const byEmail = viewer.email ? await fetchEventUsersByEmail(viewer.email) : []

  const mineById = new Map<string, EventUserRow>()
  for (const row of [...byUserId, ...byEmail]) if (row.id) mineById.set(row.id, row)

  const myRows = [...mineById.values()]
  const myIdentity = identityOf(myRows, viewer)

  // 2. My events: everything I registered for, plus everything I hosted. The
  //    hosted half comes from public `events.hosts`, so it survives RLS.
  const myAttendance = await fetchAttendanceBy(
    "event_user_id",
    myRows.map((r) => r.id),
  )

  const myEventIds = new Set<string>()
  for (const row of myAttendance) {
    if (row.eventId && wasThere(row)) myEventIds.add(row.eventId)
  }
  for (const event of events.values()) {
    if (isHostOf(event, myIdentity)) myEventIds.add(event.id)
  }

  if (myEventIds.size === 0) {
    return { connections: [], myEventCount: 0, sharedEventCount: 0 }
  }

  const eventIds = [...myEventIds]

  // 3. Co-attendees of those events.
  const theirAttendance = await fetchAttendanceBy("event_id", eventIds)

  /** event_user_id -> event ids we know we shared. */
  const sharedByPerson = new Map<string, Set<string>>()
  const note = (personId: string, eventId: string) => {
    if (!personId || mineById.has(personId)) return
    const set = sharedByPerson.get(personId)
    if (set) set.add(eventId)
    else sharedByPerson.set(personId, new Set([eventId]))
  }

  for (const row of theirAttendance) {
    if (!row.eventId || !myEventIds.has(row.eventId) || !wasThere(row)) continue
    note(row.eventUserId, row.eventId)
  }

  // 3b. Co-hosts rarely register for their own events, so they have no
  //     attendance row at all. Pull them straight off `events.hosts` and map the
  //     Luma api_id back onto an event_users row.
  const hostLumaIds = new Set<string>()
  for (const id of eventIds) {
    const event = events.get(id)
    if (!event) continue
    for (const lumaId of event.hostLumaIds) {
      if (!myIdentity.lumaIds.has(lumaId)) hostLumaIds.add(lumaId)
    }
  }

  const hostRows = await fetchEventUsersBy("source_user_id", [...hostLumaIds])
  const hostRowByLumaId = new Map<string, EventUserRow>()
  for (const row of hostRows) if (row.sourceUserId) hostRowByLumaId.set(row.sourceUserId, row)

  for (const id of eventIds) {
    const event = events.get(id)
    if (!event) continue
    for (const lumaId of event.hostLumaIds) {
      const row = hostRowByLumaId.get(lumaId)
      if (row) note(row.id, id)
    }
  }

  if (sharedByPerson.size === 0) {
    return { connections: [], myEventCount: myEventIds.size, sharedEventCount: 0 }
  }

  // 4. Hydrate the people.
  const fetched = await fetchEventUsersBy("id", [...sharedByPerson.keys()])
  const peopleById = new Map<string, EventUserRow>()
  for (const row of [...fetched, ...hostRows]) {
    if (row.id && sharedByPerson.has(row.id) && !isSelf(row, myIdentity)) peopleById.set(row.id, row)
  }
  if (peopleById.size === 0) {
    return { connections: [], myEventCount: myEventIds.size, sharedEventCount: 0 }
  }

  const people = [...peopleById.values()]
  const enrich = await fetchEnrichment(people)

  // 5 + 6. Roles, dedupe, shape.
  type Bucket = { rows: EventUserRow[]; eventIds: Set<string> }
  const buckets = new Map<string, Bucket>()

  for (const row of people) {
    const key = dedupeKey(row)
    const shared = sharedByPerson.get(row.id) ?? new Set<string>()
    const bucket = buckets.get(key)
    if (bucket) {
      bucket.rows.push(row)
      for (const id of shared) bucket.eventIds.add(id)
    } else {
      buckets.set(key, { rows: [row], eventIds: new Set(shared) })
    }
  }

  const connections: Connection[] = []
  const sharedEventIds = new Set<string>()

  // Titles/dates for the rare event id that isn't in the public `events` table.
  const fallbackByEvent = new Map<string, AttendanceRow>()
  for (const row of theirAttendance) {
    if (row.eventId && !fallbackByEvent.has(row.eventId)) fallbackByEvent.set(row.eventId, row)
  }

  for (const bucket of buckets.values()) {
    const rows = [...bucket.rows].sort((a, b) => rowScore(b) - rowScore(a))
    const primary = rows[0]
    if (!primary) continue

    const theirIdentity = identityOf(rows)

    const sharedEvents: SharedEvent[] = [...bucket.eventIds]
      .map((eventId) => {
        const event = events.get(eventId)
        const fallback = fallbackByEvent.get(eventId)
        return {
          eventId,
          title: event?.title ?? fallback?.eventName ?? null,
          startAt: event?.startAt ?? fallback?.eventDate ?? null,
          city: event?.city ?? null,
          myRole: roleAt(event, myIdentity),
          theirRole: roleAt(event, theirIdentity),
        }
      })
      .sort((a, b) => (b.startAt ?? "").localeCompare(a.startAt ?? ""))

    if (!sharedEvents.length) continue
    for (const e of sharedEvents) sharedEventIds.add(e.eventId)

    const f = enrichedFields(primary, enrich)

    connections.push({
      id: primary.id,
      name: f.name,
      email: primary.email ?? rows.find((r) => r.email)?.email ?? null,
      avatarUrl: f.avatarUrl,
      company: f.company,
      title: f.title,
      location: f.location,
      linkedinUrl: f.linkedinUrl,
      userId: primary.userId ?? rows.find((r) => r.userId)?.userId ?? null,
      memberId: primary.memberId ?? rows.find((r) => r.memberId)?.memberId ?? null,
      sharedEvents,
    })
  }

  connections.sort((a, b) => {
    const byCount = b.sharedEvents.length - a.sharedEvents.length
    if (byCount) return byCount
    const byDate = mostRecent(b.sharedEvents) - mostRecent(a.sharedEvents)
    if (byDate) return byDate
    return (a.name ?? "").localeCompare(b.name ?? "")
  })

  return {
    connections,
    myEventCount: myEventIds.size,
    sharedEventCount: sharedEventIds.size,
  }
}

/**
 * Email lookup is separate from the user_id lookup so a stray comma or dot in
 * an address can never break a PostgREST `or=(…)` filter.
 */
async function fetchEventUsersByEmail(email: string): Promise<EventUserRow[]> {
  const { data, error } = await api
    .from("event_users")
    .select(EVENT_USER_COLUMNS)
    .ilike("email", email.trim())
  if (error) throw new Error(error.message)
  return ((data ?? []) as Raw[]).map(toEventUser)
}

export async function fetchMemberProfile(id: string): Promise<MemberProfile | null> {
  const { data, error } = await api
    .from("event_users")
    .select(EVENT_USER_COLUMNS)
    .eq("id", id)
    .maybeSingle()

  if (error) throw new Error(error.message)
  if (!data) return null

  const row = toEventUser(data as Raw)
  const enrich = await fetchEnrichment([row])
  return toProfile(row, enrich)
}

/* ------------------------------------------------------------------ derived */

export function hostedShared(connection: Connection): boolean {
  return connection.sharedEvents.some((e) => e.theirRole === "host")
}

/** The badge on a list row: "Host" the moment they hosted anything you shared. */
export function primaryRole(connection: Connection): ConnectionRole {
  return hostedShared(connection) ? "host" : "guest"
}

/** "Met at AI Socratic Zurich" for one event, "3 shared events" beyond that. */
export function connectionSubtitle(connection: Connection): string {
  const events = connection.sharedEvents
  if (events.length === 0) return "No shared events"
  if (events.length === 1) {
    const title = events[0]?.title
    return title ? `Met at ${title}` : "1 shared event"
  }
  return `${events.length} shared events`
}

export function matchesSearch(connection: Connection, query: string): boolean {
  const q = query.trim().toLowerCase()
  if (!q) return true
  return [connection.name, connection.company, connection.title, connection.location].some(
    (field) => !!field && field.toLowerCase().includes(q),
  )
}

export function filterConnections(
  connections: Connection[],
  filter: ConnectionFilter,
  search: string,
): Connection[] {
  return connections.filter((c) => {
    if (filter === "hosts" && !hostedShared(c)) return false
    if (filter === "guests" && hostedShared(c)) return false
    return matchesSearch(c, search)
  })
}

/* -------------------------------------------------------------------- hooks */

export function useConnections() {
  const { user, profile } = useAuth()

  const viewer: Viewer | null = user
    ? {
        userId: user.id,
        email: profile?.email ?? user.email ?? null,
        fullName:
          profile?.full_name ?? (user.user_metadata?.full_name as string | undefined) ?? null,
        linkedinUrl: profile?.linkedin_url ?? null,
      }
    : null

  return useQuery({
    queryKey: [
      "connections",
      viewer?.userId ?? "anonymous",
      viewer?.email ?? "",
      viewer?.fullName ?? "",
    ],
    queryFn: () => fetchConnections(viewer as Viewer),
    enabled: !!viewer,
    staleTime: 5 * 60_000,
  })
}

export function useMemberProfile(id: string | undefined) {
  return useQuery({
    queryKey: ["member-profile", id],
    queryFn: () => fetchMemberProfile(id as string),
    enabled: !!id,
    staleTime: 5 * 60_000,
  })
}
