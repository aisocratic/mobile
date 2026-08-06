/**
 * Live smoke: anonymous reads through the in-repo PostgREST client against
 * the production backend — the exact queries the Feed issues on first paint,
 * with no session (RLS anon role).
 *
 * Run:  npx jest -c jest.live.config.js --runInBand
 * (jest.live.setup.ts loads the real .env, so `@/lib/api` points at
 * https://api.aisocratic.org with the shipped anon key.)
 */

import { fetchNewsPage, NEWS_PAGE_SIZE } from "@/api/news"
import { api } from "@/lib/api"

test("the news feed's first page returns real rows anonymously", async () => {
  const page = await fetchNewsPage(0, null)

  expect(page.items.length).toBe(NEWS_PAGE_SIZE)
  expect(page.next).toBe(NEWS_PAGE_SIZE)
  for (const item of page.items.slice(0, 3)) {
    expect(item.id).toMatch(/\S/)
    expect(item.title).toMatch(/\S/)
    expect(item.published_at).toMatch(/^\d{4}-/)
  }
  // Newest-first, the way the feed renders it.
  const dates = page.items.map((i) => i.published_at ?? "")
  expect([...dates].sort().reverse()).toEqual(dates)
})

test("the public blog list returns real rows anonymously", async () => {
  const { data, error } = await api
    .from("blog_posts")
    .select("id,slug,title,visibility,published_at")
    .eq("is_published", true)
    .eq("status", "published")
    .eq("visibility", "public")
    .order("published_at", { ascending: false })

  expect(error).toBeNull()
  const rows = (data ?? []) as { id: string; slug: string | null; title: string | null }[]
  // The blog holds ~29 public posts; anything past "a real handful" proves
  // the anon read path without pinning the exact editorial count.
  expect(rows.length).toBeGreaterThan(10)
  expect(rows[0]?.title).toMatch(/\S/)
  expect(rows[0]?.slug).toMatch(/\S/)
})

test("RLS still hides what anon must not see (locked-down table reads empty)", async () => {
  // event_attendance is SELECT-scoped to your own rows; with no session this
  // must come back empty, not erroring and not leaking.
  const { data, error } = await api.from("event_attendance").select("event_id").limit(5)
  expect(error).toBeNull()
  expect(data).toEqual([])
})
