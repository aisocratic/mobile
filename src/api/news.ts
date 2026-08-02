import { useInfiniteQuery, useQuery, useQueryClient } from "@tanstack/react-query"

import { excerpt } from "@/lib/format"
import { SITE_URL, supabase } from "@/lib/supabase"
import type { NewsRow } from "@/types"

/**
 * The website's news feed lives in `updates`. 576 rows are readable but only
 * 490 are public — drafts, rejected and pending_review items share the table,
 * and one row carries status='published' while `is_published` is false. Every
 * flag below is load-bearing; none of them can stand in for another.
 */
const PUBLIC_FILTERS = {
  is_published: true,
  status: "published",
  moderation_status: "approved",
  is_private: false,
  visibility: "public",
}

/** `updates` has two columns the shared NewsRow doesn't model but the feed uses. */
export type NewsItem = NewsRow & {
  cover_image_thumb: string | null
  view_count: number | null
}

export const NEWS_PAGE_SIZE = 20

/**
 * `content` is carried in the list payload on purpose: it decides whether a row
 * opens in the reader or jumps to its source (see `isLinkOnly`), and it lets the
 * detail screen render instantly from cache. The median body is ~600 chars, so a
 * page costs about 12 KB.
 */
const COLUMNS =
  "id,slug,title,summary,teaser,content,link,type,cover_image,cover_image_medium,cover_image_thumb,categories,authors,reading_time_minutes,published_at,comment_count,like_count,view_count"

type Raw = Record<string, unknown>

function str(value: unknown): string | null {
  if (typeof value !== "string") return null
  const trimmed = value.trim()
  return trimmed ? trimmed : null
}

function num(value: unknown): number | null {
  return typeof value === "number" && Number.isFinite(value) ? value : null
}

function strArray(value: unknown): string[] | null {
  if (!Array.isArray(value)) return null
  const items = value.map(str).filter((item): item is string => !!item)
  return items.length ? items : null
}

function toNews(raw: Raw): NewsItem {
  return {
    id: String(raw.id ?? ""),
    slug: str(raw.slug),
    title: str(raw.title),
    summary: str(raw.summary),
    teaser: str(raw.teaser),
    content: str(raw.content),
    link: str(raw.link),
    type: str(raw.type),
    cover_image: str(raw.cover_image),
    cover_image_medium: str(raw.cover_image_medium),
    cover_image_thumb: str(raw.cover_image_thumb),
    categories: strArray(raw.categories),
    authors: strArray(raw.authors),
    reading_time_minutes: num(raw.reading_time_minutes),
    published_at: str(raw.published_at),
    comment_count: num(raw.comment_count),
    like_count: num(raw.like_count),
    view_count: num(raw.view_count),
  }
}

/* ------------------------------------------------------------------ derived */

/** 65 covers are generated OG images stored as site-relative paths. */
function absolute(url: string | null): string | null {
  if (!url) return null
  if (/^https?:\/\//i.test(url)) return url
  return `${SITE_URL}${url.startsWith("/") ? "" : "/"}${url}`
}

/** Resized variants exist for 378 of 490 rows, so always fall through. */
export function newsImage(item: NewsItem, size: "small" | "large" = "large"): string | null {
  return size === "small"
    ? absolute(item.cover_image_thumb ?? item.cover_image_medium ?? item.cover_image)
    : absolute(item.cover_image ?? item.cover_image_medium ?? item.cover_image_thumb)
}

/**
 * Every public row has a body, but 16 of the 62 rows with an external `link`
 * carry a headline-length stub rather than an article. Those go straight to the
 * source instead of opening a reader with nothing in it.
 */
const STUB_LENGTH = 200

export function isLinkOnly(item: NewsItem): boolean {
  return !!item.link && (item.content?.length ?? 0) < STUB_LENGTH
}

/** Almost everything is tagged "News"; prefer whatever is more specific. */
export function newsCategory(item: NewsItem): string | null {
  const categories = item.categories ?? []
  return categories.find((c) => c.toLowerCase() !== "news") ?? categories[0] ?? null
}

export function newsSnippet(item: NewsItem, max = 120): string {
  return excerpt(item.summary ?? item.teaser ?? item.content, max)
}

export function newsShareUrl(item: NewsItem): string {
  return item.slug ? `${SITE_URL}/news/${item.slug}` : SITE_URL
}

/* ------------------------------------------------------------------ queries */

export type NewsPage = {
  items: NewsItem[]
  /** Offset of the next page, or null when this was the last one. */
  next: number | null
}

export async function fetchNewsPage(offset: number, category: string | null): Promise<NewsPage> {
  let query = supabase
    .from("updates")
    .select(COLUMNS)
    .match(PUBLIC_FILTERS)
    .order("published_at", { ascending: false })
    // 18 rows share a timestamp; the id tiebreak keeps .range() pages stable.
    .order("id", { ascending: false })
    .range(offset, offset + NEWS_PAGE_SIZE - 1)

  if (category) query = query.contains("categories", [category])

  const { data, error } = await query
  if (error) throw new Error(error.message)

  const items = ((data ?? []) as Raw[]).map(toNews)
  return { items, next: items.length < NEWS_PAGE_SIZE ? null : offset + items.length }
}

/**
 * Facets come from their own tiny request rather than from the loaded pages, so
 * the filter row doesn't reshuffle as the reader scrolls.
 */
export async function fetchNewsCategories(): Promise<string[]> {
  const { data, error } = await supabase.from("updates").select("categories").match(PUBLIC_FILTERS)
  if (error) throw new Error(error.message)

  // Tags are hand-entered, so "Research" and "research" both appear; keep the
  // dominant casing and drop the long tail of one-off labels.
  const counts = new Map<string, { label: string; total: number }>()
  for (const row of (data ?? []) as Raw[]) {
    for (const label of strArray(row.categories) ?? []) {
      const key = label.toLowerCase()
      const seen = counts.get(key)
      if (seen) seen.total += 1
      else counts.set(key, { label, total: 1 })
    }
  }

  return [...counts.values()]
    .filter((c) => c.total >= MIN_CATEGORY_ROWS)
    .sort((a, b) => b.total - a.total)
    .slice(0, MAX_CATEGORIES)
    .map((c) => c.label)
}

const MIN_CATEGORY_ROWS = 5
const MAX_CATEGORIES = 12

export async function fetchNewsItem(id: string): Promise<NewsItem> {
  const { data, error } = await supabase
    .from("updates")
    .select(COLUMNS)
    .eq("id", id)
    .match(PUBLIC_FILTERS)
    .maybeSingle()

  if (error) throw new Error(error.message)
  if (!data) throw new Error("That story isn't available any more.")
  return toNews(data as Raw)
}

/* -------------------------------------------------------------------- hooks */

export function useNewsFeed(category: string | null, enabled = true) {
  return useInfiniteQuery({
    queryKey: ["news", "feed", category ?? "all"],
    queryFn: ({ pageParam }) => fetchNewsPage(pageParam, category),
    initialPageParam: 0,
    getNextPageParam: (last: NewsPage) => last.next,
    enabled,
  })
}

export function useNewsCategories(enabled = true) {
  return useQuery({
    queryKey: ["news", "categories"],
    queryFn: fetchNewsCategories,
    staleTime: 30 * 60_000,
    enabled,
  })
}

export function useNewsItem(id: string | undefined) {
  const client = useQueryClient()

  return useQuery({
    queryKey: ["news", "item", id],
    queryFn: () => fetchNewsItem(id as string),
    enabled: !!id,
    // The feed already carries the full row, so a tap renders with no spinner.
    placeholderData: () => {
      if (!id) return undefined
      const cached = client.getQueriesData<{ pages: NewsPage[] }>({ queryKey: ["news", "feed"] })
      for (const [, data] of cached) {
        for (const page of data?.pages ?? []) {
          const hit = page.items.find((item) => item.id === id)
          if (hit) return hit
        }
      }
      return undefined
    },
  })
}
