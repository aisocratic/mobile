import { useQuery, useQueryClient } from "@tanstack/react-query"

import { SITE_URL, api } from "@/lib/api"
import type { EventHost, EventRow } from "@/types"

/**
 * Events come straight from the Luma sync, so the rows are messy: `content` is
 * often an empty string rather than null, `tags` is an array of Luma category
 * *objects* (not strings), `hosts` entries can be as thin as `{ name }`, and
 * the resized `cover_url_*` variants are not populated yet. Everything is
 * normalised here so the screens can trust `EventRow`.
 */

export type EventFilter = "upcoming" | "past"

/** The list doesn't render bodies — skip `content` to keep the payload small. */
const LIST_COLUMNS =
  "id,slug,title,summary,url,start_at,end_at,timezone,city,country,venue,is_virtual,organizer,hosts,tags,guest_count,cover_url,cover_url_medium,cover_url_thumb,image_url,blog_post_slug"

const DETAIL_COLUMNS = `${LIST_COLUMNS},content`

const LIST_LIMIT = 200

type Raw = Record<string, unknown>

/** Empty strings are as good as null for everything we render. */
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

/** Luma tags arrive as `{ name, slug, … }` objects; older rows may be strings. */
function normalizeTags(value: unknown): string[] | null {
  if (!Array.isArray(value)) return null

  const tags = value
    .map((tag) => {
      if (typeof tag === "string") return str(tag)
      if (tag && typeof tag === "object") {
        const t = tag as { name?: unknown; slug?: unknown }
        return str(t.name) ?? str(t.slug)
      }
      return null
    })
    .filter((tag): tag is string => !!tag)

  return tags.length ? tags : null
}

function normalizeHosts(value: unknown): EventHost[] | null {
  if (!Array.isArray(value)) return null

  const hosts = value
    .filter((host): host is Raw => !!host && typeof host === "object")
    .map((host) => ({
      name: str(host.name),
      bio: str(host.bio),
      api_id: str(host.api_id),
      avatar_url: str(host.avatar_url),
      twitter_handle: str(host.twitter_handle),
      linkedin_handle: str(host.linkedin_handle),
    }))
    .filter((host) => !!host.name)

  return hosts.length ? hosts : null
}

function toEvent(raw: Raw): EventRow {
  return {
    id: String(raw.id ?? ""),
    slug: str(raw.slug),
    title: str(raw.title),
    summary: str(raw.summary),
    content: str(raw.content),
    url: str(raw.url),
    start_at: str(raw.start_at),
    end_at: str(raw.end_at),
    timezone: str(raw.timezone),
    city: str(raw.city),
    country: str(raw.country),
    venue: str(raw.venue),
    is_virtual: bool(raw.is_virtual),
    organizer: str(raw.organizer),
    hosts: normalizeHosts(raw.hosts),
    tags: normalizeTags(raw.tags),
    guest_count: num(raw.guest_count),
    cover_url: str(raw.cover_url),
    cover_url_medium: str(raw.cover_url_medium),
    cover_url_thumb: str(raw.cover_url_thumb),
    image_url: str(raw.image_url),
    blog_post_slug: str(raw.blog_post_slug),
  }
}

/* ------------------------------------------------------------------ derived */

/** Best available cover. The resized variants are empty today, so fall through. */
export function eventCover(event: EventRow, size: "small" | "large" = "large"): string | null {
  if (size === "small") {
    return event.cover_url_thumb ?? event.cover_url_medium ?? event.cover_url ?? event.image_url
  }
  return event.cover_url ?? event.cover_url_medium ?? event.image_url ?? event.cover_url_thumb
}

/**
 * `short` gives the one-liner used in list rows; the long form is the full
 * venue / city / country line on the detail screen.
 */
export function eventPlace(event: EventRow, short = false): string | null {
  if (event.is_virtual) return "Virtual"

  const parts = short
    ? [event.venue ?? event.city]
    : [event.venue, event.city, event.country === event.city ? null : event.country]

  const seen = new Set<string>()
  const line = parts
    .filter((part): part is string => !!part)
    .filter((part) => {
      const key = part.toLowerCase()
      if (seen.has(key)) return false
      seen.add(key)
      return true
    })
    .join(", ")

  return line || null
}

/** Where "View event" goes: the Luma page, else the website's event page. */
export function eventLink(event: EventRow): string | null {
  if (event.url) return event.url
  return event.slug ? `${SITE_URL}/events/${event.slug}` : null
}

/* ------------------------------------------------------------------ queries */

export async function fetchEvents(filter: EventFilter): Promise<EventRow[]> {
  const now = new Date().toISOString()

  const base = api.from("events").select(LIST_COLUMNS)
  const upcoming = filter === "upcoming"

  const { data, error } = await (upcoming ? base.gte("start_at", now) : base.lt("start_at", now))
    .order("start_at", { ascending: upcoming })
    .limit(LIST_LIMIT)

  if (error) throw new Error(error.message)
  return ((data ?? []) as Raw[]).map(toEvent)
}

export async function fetchEvent(id: string): Promise<EventRow> {
  const { data, error } = await api
    .from("events")
    .select(DETAIL_COLUMNS)
    .eq("id", id)
    .maybeSingle()

  if (error) throw new Error(error.message)
  if (!data) throw new Error("That event doesn't exist any more.")
  return toEvent(data as Raw)
}

/* -------------------------------------------------------------------- hooks */

export function useEvents(filter: EventFilter) {
  return useQuery({
    queryKey: ["events", filter],
    queryFn: () => fetchEvents(filter),
  })
}

export function useEvent(id: string | undefined) {
  const client = useQueryClient()

  return useQuery({
    queryKey: ["event", id],
    queryFn: () => fetchEvent(id as string),
    enabled: !!id,
    // Render instantly from whichever list the user tapped through, then let
    // the detail fetch fill in `content`.
    placeholderData: () => {
      if (!id) return undefined
      for (const [, rows] of client.getQueriesData<EventRow[]>({ queryKey: ["events"] })) {
        const hit = rows?.find((row) => row.id === id)
        if (hit) return hit
      }
      return undefined
    },
  })
}
