import { useQuery } from "@tanstack/react-query"

import { isVideoUrl } from "@/lib/media"
import { SITE_URL, api } from "@/lib/api"
import type { BlogPostRow } from "@/types"

/**
 * blog_posts carries a few columns beyond BlogPostRow that only the blog
 * surfaces care about: the reaction counters and the visibility flags used to
 * decide what an anonymous reader may see.
 */
export type BlogPost = BlogPostRow & {
  visibility: string | null
  insightful_count: number | null
  helpful_count: number | null
  celebrate_count: number | null
  /** Some posts are published on the website under a bespoke path. */
  custom_page: string | null
}

/** List rows never carry `content` — articles run 5–65 KB each. */
export type BlogListItem = Omit<BlogPost, "content">

const LIST_COLUMNS =
  "id,slug,title,summary,teaser,cover_image,cover_image_medium,cover_image_thumb,authors,categories,reading_time_minutes,published_at,view_count,like_count,insightful_count,helpful_count,celebrate_count,visibility,custom_page"

const DETAIL_COLUMNS = `${LIST_COLUMNS},content`

/**
 * Every live row is `is_published = true, status = "published"`, so the flag
 * that actually gates a post is `is_private` / `visibility`: 29 rows are
 * `public` and 2 are `users` (members-only). Signed-in readers get all 31.
 */
function publishedQuery(columns: string) {
  return api
    .from("blog_posts")
    .select(columns)
    .eq("is_published", true)
    .eq("status", "published")
}

export const blogKeys = {
  all: ["blog"] as const,
  list: (membersOnly: boolean) => ["blog", "list", membersOnly] as const,
  detail: (slug: string) => ["blog", "post", slug] as const,
}

async function fetchPosts(includeMembersOnly: boolean): Promise<BlogListItem[]> {
  const query = publishedQuery(LIST_COLUMNS).order("published_at", { ascending: false })
  if (!includeMembersOnly) query.eq("visibility", "public")

  const { data, error } = await query
  if (error) throw new Error(error.message)
  return (data ?? []) as unknown as BlogListItem[]
}

async function fetchPost(slug: string): Promise<BlogPost | null> {
  const { data, error } = await publishedQuery(DETAIL_COLUMNS).eq("slug", slug).maybeSingle()
  if (error) throw new Error(error.message)
  return (data ?? null) as unknown as BlogPost | null
}

export function useBlogPosts(includeMembersOnly: boolean, enabled = true) {
  return useQuery({
    queryKey: blogKeys.list(includeMembersOnly),
    queryFn: () => fetchPosts(includeMembersOnly),
    enabled,
  })
}

export function useBlogPost(slug: string | undefined) {
  return useQuery({
    queryKey: blogKeys.detail(slug ?? ""),
    queryFn: () => fetchPost(slug as string),
    enabled: !!slug,
  })
}

/* --------------------------------------------------------------- helpers */

/**
 * Several rows store "" rather than NULL for missing image derivatives, and a
 * cover column can also hold a video — skip both so `expo-image` only ever
 * receives a real still.
 */
function firstImage(...candidates: (string | null | undefined)[]): string | null {
  const found = candidates.find((c) => c && c.trim() && !isVideoUrl(c))
  return found?.trim() ?? null
}

export function coverUri(
  post: Pick<BlogListItem, "cover_image" | "cover_image_medium" | "cover_image_thumb">,
  size: "thumb" | "medium" | "full" = "medium",
): string | null {
  if (size === "thumb") return firstImage(post.cover_image_thumb, post.cover_image_medium, post.cover_image)
  if (size === "full") return firstImage(post.cover_image, post.cover_image_medium)
  return firstImage(post.cover_image_medium, post.cover_image)
}

/** The post's cover when it is a clip rather than a still, else null. */
export function coverVideo(
  post: Pick<BlogListItem, "cover_image" | "cover_image_medium" | "cover_image_thumb">,
): string | null {
  const found = [post.cover_image, post.cover_image_medium, post.cover_image_thumb].find((c) =>
    isVideoUrl(c),
  )
  return found?.trim() ?? null
}

export function authorLine(authors: string[] | null, max = 2): string | null {
  const names = (authors ?? []).map((a) => a?.trim()).filter((a): a is string => !!a)
  if (!names.length) return null
  if (names.length <= max) return names.join(" & ")
  return `${names.slice(0, max).join(", ")} +${names.length - max}`
}

export function readingTime(minutes: number | null): string | null {
  return minutes && minutes > 0 ? `${minutes} min read` : null
}

/** Web permalink — a handful of posts live at a bespoke path. */
export function webUrl(post: Pick<BlogPost, "slug" | "custom_page">): string {
  const custom = post.custom_page?.trim()
  if (custom) return `${SITE_URL}${custom.startsWith("/") ? "" : "/"}${custom}`
  return `${SITE_URL}/blog/${post.slug}`
}

export type Reaction = { key: string; label: string; count: number }

export function reactionsOf(post: BlogPost): Reaction[] {
  return [
    { key: "like", label: "Likes", count: post.like_count ?? 0 },
    { key: "insightful", label: "Insightful", count: post.insightful_count ?? 0 },
    { key: "helpful", label: "Helpful", count: post.helpful_count ?? 0 },
    { key: "celebrate", label: "Celebrate", count: post.celebrate_count ?? 0 },
  ].filter((r) => r.count > 0)
}

/**
 * The CMS authors markdown but wraps chunks in layout shortcodes
 * (`[columns col=50,50] … [/col] … [/columns]`, `[align center]`,
 * `[full-width]`, `[events]`) that the website expands and our renderer would
 * otherwise print verbatim. Drop the wrapper lines, keep the content inside,
 * and turn tweet embeds into links since we can't render the embed.
 */
export function readableContent(content: string | null | undefined): string | null {
  if (!content) return null
  const cleaned = content
    .replace(/\r\n/g, "\n")
    .replace(
      /^[ \t]*\[\/?(columns|column|col|align|full-width|events|grid|row)\b[^\]\n]*\][ \t]*$/gim,
      "",
    )
    .replace(/\[button\b[^\]\n]*\]/gi, "")
    .replace(/\[\/button\]/gi, "")
    // x.com/i/status/<id> redirects to the canonical tweet URL.
    .replace(/\[tweet\s+id=["']?(\d+)["']?\s*\]/gi, "[View post on X](https://x.com/i/status/$1)")
    // Stray editorial placeholders like [BENCHMARK_GAP].
    .replace(/^[ \t]*\[[A-Z0-9_]+\][ \t]*$/gm, "")
    .replace(/\n{3,}/g, "\n\n")
    .trim()
  return cleaned || null
}

/** Category values as they appear in the data, most used first. */
export function categoriesOf(posts: BlogListItem[]): string[] {
  const counts = new Map<string, number>()
  for (const post of posts) {
    for (const raw of post.categories ?? []) {
      const category = raw?.trim()
      if (!category) continue
      counts.set(category, (counts.get(category) ?? 0) + 1)
    }
  }
  return [...counts.entries()]
    .sort((a, b) => b[1] - a[1] || a[0].localeCompare(b[0]))
    .map(([category]) => category)
}
