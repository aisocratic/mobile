import {
  dedupeCommunityMembers,
  fetchCommunityMembers,
  filterCommunityMembers,
  matchesMemberSearch,
  type CommunityMember,
} from "./people"

/**
 * `fetchCommunityMembers` delegates filtering, ordering and the row cap to
 * PostgREST — `.neq()`, `.order()`, `.limit()` — so a mock that just hands
 * back canned rows would prove nothing about whether those calls are wired up
 * correctly. This fake implements the same semantics (filter, multi-key sort,
 * limit) against an in-memory row set, so the assertions below exercise the
 * real query-building code in people.ts, not a stand-in for it.
 */

type Row = {
  id: string
  full_name: string | null
  avatar_url: string | null
  job_title: string | null
  organization: string | null
  location: string | null
  is_member: boolean | null
}

let mockRows: Row[] = []
let mockError: { message: string } | null = null
let mockIdentityRows: { user_id: string | null }[] = []

jest.mock("@/lib/supabase", () => ({
  supabase: {
    from(table: string) {
      // `chat_identities` is a flat read — resolve it directly so the
      // reachability lookup in fetchReachableUserIds sees realistic rows.
      if (table === "chat_identities") {
        return {
          select: () => Promise.resolve({ data: mockIdentityRows, error: null }),
        }
      }
      const state: {
        neq: [string, unknown][]
        notNull: string[]
        order: { column: string; ascending: boolean }[]
      } = { neq: [], notNull: [], order: [] }

      const builder = {
        select: () => builder,
        neq(column: string, value: unknown) {
          state.neq.push([column, value])
          return builder
        },
        not(column: string, _operator: string, value: unknown) {
          if (value === null) state.notNull.push(column)
          return builder
        },
        order(column: string, opts?: { ascending?: boolean }) {
          state.order.push({ column, ascending: opts?.ascending ?? true })
          return builder
        },
        limit(n: number) {
          if (mockError) return Promise.resolve({ data: null, error: mockError })

          let rows = mockRows.slice()
          for (const [column, value] of state.neq) {
            rows = rows.filter((r) => (r as Record<string, unknown>)[column] !== value)
          }
          for (const column of state.notNull) {
            rows = rows.filter((r) => (r as Record<string, unknown>)[column] !== null)
          }
          rows.sort((a, b) => {
            for (const { column, ascending } of state.order) {
              const av = (a as Record<string, unknown>)[column]
              const bv = (b as Record<string, unknown>)[column]
              if (av === bv) continue
              // eslint-disable-next-line @typescript-eslint/no-explicit-any
              const cmp = (av as any) < (bv as any) ? -1 : 1
              return ascending ? cmp : -cmp
            }
            return 0
          })
          return Promise.resolve({ data: rows.slice(0, n), error: null })
        },
      }
      return builder
    },
  },
}))

const VIEWER = "viewer-0000-0000-0000-000000000000"

function row(overrides: Partial<Row> & { id: string }): Row {
  return {
    full_name: null,
    avatar_url: null,
    job_title: null,
    organization: null,
    location: null,
    is_member: false,
    ...overrides,
  }
}

beforeEach(() => {
  mockRows = []
  mockError = null
  mockIdentityRows = []
})

describe("fetchCommunityMembers", () => {
  it("excludes the signed-in viewer", async () => {
    mockRows = [
      row({ id: VIEWER, full_name: "Me" }),
      row({ id: "other-1", full_name: "Alice" }),
    ]

    const result = await fetchCommunityMembers(VIEWER)

    expect(result.map((m) => m.id)).toEqual(["other-1"])
  })

  it("excludes rows with a null or blank full_name", async () => {
    mockRows = [
      row({ id: "1", full_name: null }),
      row({ id: "2", full_name: "   " }),
      row({ id: "3", full_name: "Real Name" }),
    ]

    const result = await fetchCommunityMembers(VIEWER)

    expect(result.map((m) => m.id)).toEqual(["3"])
  })

  it("sorts members before non-members, alphabetically within each group", async () => {
    mockRows = [
      row({ id: "1", full_name: "Zoe", is_member: false }),
      row({ id: "2", full_name: "Bob", is_member: true }),
      row({ id: "3", full_name: "Amy", is_member: false }),
      row({ id: "4", full_name: "Alice", is_member: true }),
    ]

    const result = await fetchCommunityMembers(VIEWER)

    expect(result.map((m) => m.fullName)).toEqual(["Alice", "Bob", "Amy", "Zoe"])
  })

  it("caps the result at 200 rows", async () => {
    mockRows = Array.from({ length: 250 }, (_, i) =>
      row({ id: `id-${i}`, full_name: `Person ${String(i).padStart(3, "0")}` }),
    )

    const result = await fetchCommunityMembers(VIEWER)

    expect(result).toHaveLength(200)
  })

  it("throws when the query fails", async () => {
    mockError = { message: "network unreachable" }

    await expect(fetchCommunityMembers(VIEWER)).rejects.toThrow("network unreachable")
  })

  it("drops same-name rows without a chat identity when a reachable row exists", async () => {
    // Production reality: the same human appears as several users rows (old
    // sign-ups, imports), only one of which has a registered chat key. The
    // others resolve to derived keys nobody holds — DMs to them vanish.
    mockRows = [
      row({ id: "fed-old", full_name: "Federico Ulfo" }),
      row({ id: "fed-live", full_name: "Federico Ulfo" }),
      row({ id: "fed-gmail", full_name: "Federico Ulfo" }),
      row({ id: "solo", full_name: "Only Once" }),
    ]
    mockIdentityRows = [{ user_id: "fed-live" }]

    const result = await fetchCommunityMembers(VIEWER)

    expect(result.map((m) => m.id)).toEqual(["fed-live", "solo"])
  })
})

/* -------------------------------------------------------------------- dedupe */

describe("dedupeCommunityMembers", () => {
  const twins = [
    member({ id: "a-1", fullName: "Anissa Felix" }),
    member({ id: "a-2", fullName: "Anissa Felix" }),
  ]

  it("keeps every row when nobody is reachable — two strangers can share a name", () => {
    expect(dedupeCommunityMembers(twins, new Set())).toEqual(twins)
    expect(dedupeCommunityMembers(twins, new Set(["someone-else"]))).toEqual(twins)
  })

  it("keeps all reachable rows in a group, dropping only the unreachable ones", () => {
    const rows = [
      member({ id: "j-1", fullName: "Jo Chen" }),
      member({ id: "j-2", fullName: "Jo Chen" }),
      member({ id: "j-3", fullName: "Jo Chen" }),
    ]

    const result = dedupeCommunityMembers(rows, new Set(["j-1", "j-3"]))

    expect(result.map((m) => m.id)).toEqual(["j-1", "j-3"])
  })

  it("normalizes names before grouping", () => {
    const rows = [
      member({ id: "n-1", fullName: "  Nora Vale " }),
      member({ id: "n-2", fullName: "nora vale" }),
    ]

    expect(dedupeCommunityMembers(rows, new Set(["n-2"])).map((m) => m.id)).toEqual(["n-2"])
  })

  it("never touches unique names, reachable or not", () => {
    const rows = [
      member({ id: "u-1", fullName: "Unique One" }),
      member({ id: "u-2", fullName: "Unique Two" }),
    ]

    expect(dedupeCommunityMembers(rows, new Set(["u-1"]))).toEqual(rows)
  })
})

/* -------------------------------------------------------------------- search */

function member(overrides: Partial<CommunityMember> & { id: string; fullName: string }): CommunityMember {
  return {
    avatarUrl: null,
    jobTitle: null,
    organization: null,
    location: null,
    isMember: false,
    ...overrides,
  }
}

describe("matchesMemberSearch / filterCommunityMembers", () => {
  const alice = member({
    id: "1",
    fullName: "Alice Nguyen",
    organization: "Acme Corp",
    jobTitle: "Engineer",
    location: "Berlin",
  })
  const bob = member({
    id: "2",
    fullName: "Bob Vance",
    organization: "Vance Refrigeration",
    jobTitle: "Sales",
    location: "Scranton",
  })

  it("matches on full name, case-insensitively", () => {
    expect(matchesMemberSearch(alice, "alice")).toBe(true)
    expect(matchesMemberSearch(alice, "ALICE")).toBe(true)
  })

  it("matches on organization, job title and location", () => {
    expect(matchesMemberSearch(alice, "acme")).toBe(true)
    expect(matchesMemberSearch(alice, "engineer")).toBe(true)
    expect(matchesMemberSearch(alice, "berlin")).toBe(true)
  })

  it("ignores surrounding whitespace in the query", () => {
    expect(matchesMemberSearch(alice, "  alice  ")).toBe(true)
  })

  it("treats a blank or empty query as matching everything", () => {
    expect(matchesMemberSearch(alice, "")).toBe(true)
    expect(matchesMemberSearch(alice, "   ")).toBe(true)
  })

  it("does not match unrelated fields", () => {
    expect(matchesMemberSearch(alice, "scranton")).toBe(false)
  })

  it("filters a list down to only the matching members", () => {
    expect(filterCommunityMembers([alice, bob], "vance").map((m) => m.id)).toEqual(["2"])
    expect(filterCommunityMembers([alice, bob], "").map((m) => m.id)).toEqual(["1", "2"])
  })
})
