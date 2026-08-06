import { createPostgrest, type PostgrestClient } from "./postgrest"

/**
 * The client's whole job is translating builder calls into PostgREST URLs,
 * headers and bodies — so that is what these tests pin down, against a mocked
 * fetch. Every filter shape exercised here is one the app actually issues.
 */

const URL_BASE = "https://api.example.test"
const ANON = "anon-key"

let fetchMock: jest.Mock
let accessToken: string | null

function jsonResponse(body: unknown, status = 200): Response {
  return {
    ok: status >= 200 && status < 300,
    status,
    text: async () => JSON.stringify(body),
  } as unknown as Response
}

function client(): PostgrestClient {
  return createPostgrest({
    url: URL_BASE,
    anonKey: ANON,
    getAccessToken: async () => accessToken,
  })
}

function requestedUrl(call = 0): string {
  return decodeURIComponent(String(fetchMock.mock.calls[call][0]))
}

function requestedInit(call = 0): { method: string; headers: Record<string, string>; body?: string } {
  return fetchMock.mock.calls[call][1]
}

beforeEach(() => {
  accessToken = null
  fetchMock = jest.fn(async () => jsonResponse([]))
  global.fetch = fetchMock as unknown as typeof fetch
})

describe("filter building", () => {
  it("renders eq/order chains the way the blog list issues them", async () => {
    await client()
      .from("blog_posts")
      .select("id,slug,title")
      .eq("is_published", true)
      .eq("status", "published")
      .eq("visibility", "public")
      .order("published_at", { ascending: false })

    expect(requestedUrl()).toBe(
      `${URL_BASE}/rest/v1/blog_posts?select=id,slug,title` +
        "&is_published=eq.true&status=eq.published&visibility=eq.public" +
        "&order=published_at.desc",
    )
    expect(requestedInit().method).toBe("GET")
  })

  it("renders match + contains + range the way the news feed does", async () => {
    await client()
      .from("updates")
      .select("id")
      .match({ is_published: true, status: "published" })
      .order("published_at", { ascending: false })
      .order("id", { ascending: false })
      .range(20, 39)
      .contains("categories", ["Research"])

    expect(requestedUrl()).toBe(
      `${URL_BASE}/rest/v1/updates?select=id` +
        "&is_published=eq.true&status=eq.published" +
        "&offset=20&limit=20" +
        '&categories=cs.{"Research"}' +
        "&order=published_at.desc,id.desc",
    )
  })

  it("supports the directory's mutate-in-place style (filter added after order)", async () => {
    const query = client().from("users").select("id").order("full_name", { ascending: true })
    query.eq("is_member", true)
    await query
    expect(requestedUrl()).toContain("is_member=eq.true")
  })

  it("quotes in() lists so ids with commas can never split the filter", async () => {
    await client().from("users").select("id").in("id", ["a,b", 'say "hi"'])
    expect(requestedUrl()).toContain('id=in.("a,b","say \\"hi\\"")')
  })

  it("renders neq, gte, lt, ilike, limit and negated is-null", async () => {
    await client()
      .from("event_users")
      .select("id")
      .neq("id", "me")
      .gte("start_at", "2026-01-01")
      .lt("end_at", "2027-01-01")
      .ilike("email", "Person@Example.org")
      .not("full_name", "is", null)
      .limit(200)

    expect(requestedUrl()).toBe(
      `${URL_BASE}/rest/v1/event_users?select=id&id=neq.me` +
        "&start_at=gte.2026-01-01&end_at=lt.2027-01-01" +
        "&email=ilike.Person@Example.org&full_name=not.is.null&limit=200",
    )
  })
})

describe("upsert", () => {
  it("POSTs with merge-duplicates, on_conflict and representation like updateProfile", async () => {
    fetchMock.mockResolvedValueOnce(jsonResponse([{ id: "u1" }]))

    const { data, error } = await client()
      .from("users")
      .upsert({ id: "u1", bio: "hi" }, { onConflict: "id" })
      .select("id")
      .maybeSingle()

    expect(error).toBeNull()
    expect(data).toEqual({ id: "u1" })

    const init = requestedInit()
    expect(init.method).toBe("POST")
    expect(init.body).toBe(JSON.stringify({ id: "u1", bio: "hi" }))
    expect(init.headers.prefer).toBe("resolution=merge-duplicates,return=representation")
    expect(requestedUrl()).toContain("on_conflict=id")
    expect(requestedUrl()).toContain("select=id")
  })
})

describe("auth headers", () => {
  it("sends the anon key twice when signed out", async () => {
    await client().from("events").select("id")
    const headers = requestedInit().headers
    expect(headers.apikey).toBe(ANON)
    expect(headers.authorization).toBe(`Bearer ${ANON}`)
  })

  it("sends the session access token when signed in — how RLS sees the user", async () => {
    accessToken = "user-jwt"
    await client().from("event_users").select("id")
    const headers = requestedInit().headers
    expect(headers.apikey).toBe(ANON)
    expect(headers.authorization).toBe("Bearer user-jwt")
  })
})

describe("results", () => {
  it("maybeSingle: null for no rows, the row for one, an error beyond one", async () => {
    fetchMock.mockResolvedValueOnce(jsonResponse([]))
    expect(await client().from("users").select("id").eq("id", "x").maybeSingle()).toEqual({
      data: null,
      error: null,
    })

    fetchMock.mockResolvedValueOnce(jsonResponse([{ id: "x" }]))
    expect(await client().from("users").select("id").eq("id", "x").maybeSingle()).toEqual({
      data: { id: "x" },
      error: null,
    })

    fetchMock.mockResolvedValueOnce(jsonResponse([{ id: "x" }, { id: "y" }]))
    const { data, error } = await client().from("users").select("id").maybeSingle()
    expect(data).toBeNull()
    expect(error?.message).toMatch(/single row/)
  })

  it("normalises a PostgREST error body to { message }", async () => {
    fetchMock.mockResolvedValueOnce(
      jsonResponse({ code: "42501", message: "permission denied for table users" }, 403),
    )
    const { data, error } = await client().from("users").select("id")
    expect(data).toBeNull()
    expect(error).toEqual({ message: "permission denied for table users" })
  })

  it("normalises a network failure instead of throwing", async () => {
    fetchMock.mockRejectedValueOnce(new Error("Network request failed"))
    const { data, error } = await client().from("users").select("id")
    expect(data).toBeNull()
    expect(error).toEqual({ message: "Network request failed" })
  })
})
