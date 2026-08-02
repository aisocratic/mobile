import { pubkeyForPerson } from "./account"
import {
  clearDirectoryCache,
  lookupPubkeys,
  registerChatIdentity,
} from "./directory"

/**
 * The directory is what makes random keys usable: without it, one member has no
 * way to learn another's public key. These cover the two things it must never
 * get wrong —
 *
 *   - it publishes the PUBLIC key and nothing else (a secret leaking into this
 *     table would be unrecoverable and silent);
 *   - a member it has never heard of still resolves, to the legacy derived key,
 *     so people who used chat before this table existed stay reachable.
 */

type Op = { table: string; verb: string; payload?: unknown; filter?: unknown }

const mockOps: Op[] = []

/** Rows the fake PostgREST will answer with, keyed by user_id. */
let mockRows = new Map<string, { user_id: string; nostr_pubkey: string; relay_url: string }>()
let mockFailNextSelect = false

jest.mock("@/lib/supabase", () => ({
  supabase: {
    from(table: string) {
      const op: Op = { table, verb: "" }

      const builder: Record<string, unknown> = {
        select() {
          if (!op.verb) op.verb = "select"
          return builder
        },
        eq(_column: string, value: string) {
          op.filter = value
          const row = mockRows.get(value) ?? null
          return {
            maybeSingle: async () => ({ data: row, error: null }),
            // `update(...).eq(...)` terminates here, with no row returned.
            then: (resolve: (r: unknown) => unknown) => resolve({ data: null, error: null }),
          }
        },
        in(_column: string, values: string[]) {
          mockOps.push(op)
          if (mockFailNextSelect) {
            mockFailNextSelect = false
            return Promise.resolve({ data: null, error: { message: "directory unreachable" } })
          }
          return Promise.resolve({
            data: values.map((v) => mockRows.get(v)).filter(Boolean),
            error: null,
          })
        },
        upsert(payload: Record<string, unknown>) {
          op.verb = "upsert"
          op.payload = payload
          mockOps.push(op)
          mockRows.set(payload.user_id as string, {
            user_id: payload.user_id as string,
            nostr_pubkey: payload.nostr_pubkey as string,
            relay_url: payload.relay_url as string,
          })
          return {
            select: () => ({
              maybeSingle: async () => ({
                data: {
                  user_id: payload.user_id,
                  nostr_pubkey: payload.nostr_pubkey,
                  relay_url: payload.relay_url,
                  community_id: payload.community_id ?? null,
                  role: payload.role ?? null,
                  joined_at: payload.joined_at ?? null,
                },
                error: null,
              }),
            }),
          }
        },
        update(payload: Record<string, unknown>) {
          op.verb = "update"
          op.payload = payload
          mockOps.push(op)
          return builder
        },
      }

      return builder
    },
  },
}))

const ALICE = "aaaaaaaa-0000-0000-0000-000000000001"
const BOB = "bbbbbbbb-0000-0000-0000-000000000002"
const RELAY = "wss://aisocratic.communities.buzz.xyz"

const ALICE_KEY = "1".repeat(63) + "a"

beforeEach(() => {
  mockOps.length = 0
  mockRows = new Map()
  mockFailNextSelect = false
  clearDirectoryCache()
})

describe("lookupPubkeys", () => {
  it("returns the registered key for members who have one", async () => {
    mockRows.set(ALICE, { user_id: ALICE, nostr_pubkey: ALICE_KEY, relay_url: RELAY })

    const found = await lookupPubkeys([ALICE])

    expect(found.get(ALICE)).toBe(ALICE_KEY)
    // Specifically NOT the derivable one — that is the whole point of the table.
    expect(found.get(ALICE)).not.toBe(pubkeyForPerson(ALICE))
  })

  it("falls back to the legacy derived key for members with no row", async () => {
    const found = await lookupPubkeys([BOB])

    // Someone who used chat before the directory existed, or an event guest
    // with no account at all. Their messages live at the derived key.
    expect(found.get(BOB)).toBe(pubkeyForPerson(BOB))
  })

  it("resolves a mixed set in a single round trip", async () => {
    mockRows.set(ALICE, { user_id: ALICE, nostr_pubkey: ALICE_KEY, relay_url: RELAY })

    const found = await lookupPubkeys([ALICE, BOB])

    expect(found.get(ALICE)).toBe(ALICE_KEY)
    expect(found.get(BOB)).toBe(pubkeyForPerson(BOB))
    expect(mockOps.filter((o) => o.verb === "select")).toHaveLength(1)
  })

  it("caches both hits and misses", async () => {
    mockRows.set(ALICE, { user_id: ALICE, nostr_pubkey: ALICE_KEY, relay_url: RELAY })

    await lookupPubkeys([ALICE, BOB])
    await lookupPubkeys([ALICE, BOB])

    // A member list re-rendering must not mean a query per row per render.
    expect(mockOps.filter((o) => o.verb === "select")).toHaveLength(1)
  })

  it("still resolves everyone when the directory is unreachable", async () => {
    mockRows.set(ALICE, { user_id: ALICE, nostr_pubkey: ALICE_KEY, relay_url: RELAY })
    mockFailNextSelect = true

    const found = await lookupPubkeys([ALICE, BOB])

    // Degrades to exactly what the app did before this table existed, rather
    // than leaving the user unable to open a conversation.
    expect(found.get(ALICE)).toBe(pubkeyForPerson(ALICE))
    expect(found.get(BOB)).toBe(pubkeyForPerson(BOB))

    // Nothing was cached, so the next attempt re-queries and gets it right.
    const retry = await lookupPubkeys([ALICE])
    expect(retry.get(ALICE)).toBe(ALICE_KEY)
  })
})

describe("registerChatIdentity", () => {
  it("publishes the public key and nothing resembling a secret", async () => {
    await registerChatIdentity({ userId: ALICE, pubkey: ALICE_KEY, relayUrl: RELAY })

    const upsert = mockOps.find((o) => o.verb === "upsert")
    expect(upsert).toBeDefined()
    const payload = upsert!.payload as Record<string, unknown>

    expect(payload.user_id).toBe(ALICE)
    expect(payload.nostr_pubkey).toBe(ALICE_KEY)
    // The column set is closed on purpose: a stray `secret`/`sk`/`nsec` here
    // would be an unrecoverable disclosure, and it would be silent.
    expect(Object.keys(payload).sort()).toEqual(
      ["community_id", "joined_at", "nostr_pubkey", "relay_url", "role", "user_id"].sort(),
    )
  })

  it("does not write when nothing has changed", async () => {
    mockRows.set(ALICE, { user_id: ALICE, nostr_pubkey: ALICE_KEY, relay_url: RELAY })

    await registerChatIdentity({ userId: ALICE, pubkey: ALICE_KEY, relayUrl: RELAY })

    // The common case is "app launched, same key as yesterday". That should
    // cost one indexed read, not a write on every cold start.
    expect(mockOps.filter((o) => o.verb === "upsert")).toHaveLength(0)
  })

  it("clears stale membership when the key has changed", async () => {
    mockRows.set(ALICE, { user_id: ALICE, nostr_pubkey: ALICE_KEY, relay_url: RELAY })
    const reinstalled = "2".repeat(63) + "b"

    await registerChatIdentity({ userId: ALICE, pubkey: reinstalled, relayUrl: RELAY })

    const payload = mockOps.find((o) => o.verb === "upsert")!.payload as Record<string, unknown>
    expect(payload.nostr_pubkey).toBe(reinstalled)
    // A reinstall generated a new key; the relay has never seen it. Leaving the
    // old membership would tell the app it is already a member and skip the
    // join it actually needs.
    expect(payload.community_id).toBeNull()
    expect(payload.joined_at).toBeNull()
  })

  it("records membership when a join succeeds", async () => {
    await registerChatIdentity({
      userId: ALICE,
      pubkey: ALICE_KEY,
      relayUrl: RELAY,
      membership: { communityId: "community-1", role: "member" },
    })

    const payload = mockOps.find((o) => o.verb === "upsert")!.payload as Record<string, unknown>
    expect(payload.community_id).toBe("community-1")
    expect(payload.role).toBe("member")
    expect(payload.joined_at).toEqual(expect.any(String))
  })
})
