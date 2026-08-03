import { useCallback, useMemo, useRef } from "react"

import { categoriesOf, coverUri, useBlogPosts, type BlogListItem } from "@/api/blog"
import {
  isLinkOnly,
  newsCategory,
  newsImage,
  newsSnippet,
  useNewsCategories,
  useNewsFeed,
  type NewsItem,
} from "@/api/news"
import { excerpt, parseDate } from "@/lib/format"

/**
 * News (`updates`) and the blog (`blog_posts`) are two tables with two very
 * different shapes, but readers see one stream. This module normalises both
 * into `FeedItem` and merges them newest-first behind a single hook.
 */

export type FeedSource = "news" | "blog"

/** Sentinel for "no filter" in both the source and category rows. */
export const ALL = "__all__"

export type SourceFilter = typeof ALL | FeedSource

export type FeedItem = {
  /** ids are only unique per table, so lists key on source + id. */
  key: string
  source: FeedSource
  id: string
  slug: string | null
  title: string | null
  category: string | null
  categories: string[]
  snippet: string
  thumb: string | null
  cover: string | null
  publishedAt: string | null
  authors: string[] | null
  readingMinutes: number | null
  likeCount: number
  commentCount: number
  /** Set on news stubs that carry no body of their own — open the source. */
  externalLink: string | null
}

const SNIPPET = 140

function fromNews(item: NewsItem): FeedItem {
  return {
    key: `news:${item.id}`,
    source: "news",
    id: item.id,
    slug: item.slug,
    title: item.title,
    category: newsCategory(item),
    categories: item.categories ?? [],
    snippet: newsSnippet(item, SNIPPET),
    thumb: newsImage(item, "small"),
    cover: newsImage(item, "large"),
    publishedAt: item.published_at,
    authors: item.authors,
    readingMinutes: item.reading_time_minutes,
    likeCount: item.like_count ?? 0,
    commentCount: item.comment_count ?? 0,
    externalLink: isLinkOnly(item) ? item.link : null,
  }
}

function fromBlog(post: BlogListItem): FeedItem {
  return {
    key: `blog:${post.id}`,
    source: "blog",
    id: post.id,
    slug: post.slug,
    title: post.title,
    category: post.categories?.[0]?.trim() ?? null,
    categories: post.categories ?? [],
    snippet: excerpt(post.summary || post.teaser, SNIPPET),
    thumb: coverUri(post, "thumb"),
    cover: coverUri(post, "medium"),
    publishedAt: post.published_at,
    authors: post.authors,
    readingMinutes: post.reading_time_minutes,
    likeCount: post.like_count ?? 0,
    commentCount: 0,
    externalLink: null,
  }
}

function time(value: string | null): number {
  return parseDate(value)?.getTime() ?? 0
}

function hasCategory(categories: string[] | null, category: string): boolean {
  const wanted = category.toLowerCase()
  return (categories ?? []).some((c) => c.trim().toLowerCase() === wanted)
}

export type Feed = {
  items: FeedItem[]
  /** Category labels available for the current source selection. */
  categories: string[]
  isPending: boolean
  isError: boolean
  error: unknown
  isRefetching: boolean
  isFetchingMore: boolean
  /** More pages exist. False means this really is the bottom of the feed. */
  hasMore: boolean
  refetch: () => void
  loadMore: () => void
}

/**
 * `category` is applied server-side for news (`categories @> [label]`) and
 * client-side for the blog, whose 31 rows all arrive in one request anyway.
 */
export function useFeed(
  source: SourceFilter,
  category: string | null,
  includeMembersOnly: boolean,
): Feed {
  const wantsNews = source !== "blog"
  const wantsBlog = source !== "news"

  const news = useNewsFeed(category, wantsNews)
  const newsCategories = useNewsCategories(wantsNews)
  const blog = useBlogPosts(includeMembersOnly, wantsBlog)

  const newsRows = useMemo(
    () => (wantsNews ? (news.data?.pages.flatMap((page) => page.items) ?? []) : []),
    [wantsNews, news.data],
  )

  const blogRows = useMemo(() => (wantsBlog ? (blog.data ?? []) : []), [wantsBlog, blog.data])

  // A page loading in re-derives `newsRows`/`blogRows` as brand-new arrays, and a
  // naive `.map(fromNews)` would hand every already-seen row a brand-new object
  // too — which reads to FlatList as every visible row changing, not just the
  // new ones, and floods it with re-renders on each `loadMore`. Caching by the
  // underlying row's own reference keeps unchanged rows referentially stable
  // across recomputation, so `React.memo` on the row component actually holds.
  const newsItemCache = useRef(new WeakMap<NewsItem, FeedItem>()).current
  const blogItemCache = useRef(new WeakMap<BlogListItem, FeedItem>()).current

  const cachedFromNews = useCallback(
    (item: NewsItem): FeedItem => {
      let cached = newsItemCache.get(item)
      if (!cached) {
        cached = fromNews(item)
        newsItemCache.set(item, cached)
      }
      return cached
    },
    [newsItemCache],
  )

  const cachedFromBlog = useCallback(
    (post: BlogListItem): FeedItem => {
      let cached = blogItemCache.get(post)
      if (!cached) {
        cached = fromBlog(post)
        blogItemCache.set(post, cached)
      }
      return cached
    },
    [blogItemCache],
  )

  const items = useMemo(() => {
    const fromNewsRows = newsRows.map(cachedFromNews)
    let fromBlogRows = blogRows
      .filter((post) => !category || hasCategory(post.categories, category))
      .map(cachedFromBlog)

    // The blog arrives whole while news is paged, so a blog post older than the
    // last loaded news item would sit at the bottom of the list and then have
    // news rows inserted above it on every page fetch. Hold those back until
    // news has caught up with them.
    if (fromNewsRows.length && fromBlogRows.length && news.hasNextPage) {
      const oldest = time(fromNewsRows[fromNewsRows.length - 1].publishedAt)
      fromBlogRows = fromBlogRows.filter((post) => time(post.publishedAt) >= oldest)
    }

    return [...fromNewsRows, ...fromBlogRows].sort(
      (a, b) => time(b.publishedAt) - time(a.publishedAt),
    )
  }, [newsRows, blogRows, category, news.hasNextPage, cachedFromNews, cachedFromBlog])

  const categories = useMemo(() => {
    // Tags are hand-entered on both sides, so "Research" and "research" are the
    // same facet; keep whichever casing we meet first.
    const labels = new Map<string, string>()
    const add = (label: string) => {
      const key = label.trim().toLowerCase()
      if (key && !labels.has(key)) labels.set(key, label.trim())
    }

    if (wantsNews) for (const label of newsCategories.data ?? []) add(label)
    if (wantsBlog) for (const label of categoriesOf(blogRows)) add(label)

    return [...labels.values()]
  }, [wantsNews, wantsBlog, newsCategories.data, blogRows])

  const refetch = useCallback(() => {
    if (wantsNews) void news.refetch()
    if (wantsBlog) void blog.refetch()
  }, [wantsNews, wantsBlog, news, blog])

  const loadMore = useCallback(() => {
    if (!wantsNews || !news.hasNextPage || news.isFetchingNextPage) return
    void news.fetchNextPage()
  }, [wantsNews, news])

  return {
    items,
    categories,
    isPending: (wantsNews && news.isPending) || (wantsBlog && blog.isPending),
    isError: (wantsNews && news.isError) || (wantsBlog && blog.isError),
    error: (wantsNews ? news.error : null) ?? (wantsBlog ? blog.error : null),
    isRefetching:
      (wantsNews && news.isRefetching && !news.isFetchingNextPage) || (wantsBlog && blog.isRefetching),
    isFetchingMore: wantsNews && news.isFetchingNextPage,
    // Only news paginates; the blog's rows all arrive in one request, so a
    // blog-only feed is complete the moment it has loaded.
    hasMore: wantsNews && !!news.hasNextPage,
    refetch,
    loadMore,
  }
}
