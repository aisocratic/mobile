import {
  clearProfileCache,
  displayChannel,
  fallbackDisplayName,
  fetchProfilesForPubkeys,
  looksLikeRawKey,
  mergeProfiles,
  profileDisplayName,
} from "./profiles"
import { ingestProfiles, getProfile, clearStore } from "./store"
import type { ChatChannel, ChatProfile } from "./types"

/**
 * Name resolution is what stands between the user and a screen full of hex.
 * These cover the promises it makes:
 *
 *   - a pubkey the directory knows renders as the member's real name;
 *   - a pubkey nobody knows renders as a short npub — never the raw hash;
 *   - the directory outranks self-published kind-0 metadata, field by field;
 *   - production nulls (blank names, dangling identity rows) degrade to the
 *     next source instead of to garbage.
 */

type Op = { table: string; values: string[] }

const mockOps: Op[] = []

/** `chat_identities` rows the fake PostgREST answers with, keyed by pubkey. */
let mockIdentities = new Map<string, { user_id: string | null; nostr_pubkey: string }>()
/** `users` rows, keyed by id. */
let mockUsers = new Map<string, { id: string; full_name: string | null; avatar_url: string | null }>()
let mockFailNextSelect = false

jest.mock("@/lib/api", () => ({
  api: {
    from(table: string) {
      return {
        select() {
          return {
            in(_column: string, values: string[]) {
              mockOps.push({ table, values })
              if (mockFailNextSelect) {
                mockFailNextSelect = false
                return Promise.resolve({ data: null, error: { message: "directory unreachable" } })
              }
              const source = table === "chat_identities" ? mockIdentities : mockUsers
              return Promise.resolve({
                data: values.map((v) => source.get(v)).filter(Boolean),
                error: null,
              })
            },
          }
        },
      }
    },
  },
}))

const ANISSA_KEY = "a".repeat(64)
const BOB_KEY = "b".repeat(64)
const STRANGER_KEY = "c".repeat(64)

const ANISSA_ID = "aaaaaaaa-0000-0000-0000-000000000001"
const BOB_ID = "bbbbbbbb-0000-0000-0000-000000000002"

function registerAnissa() {
  mockIdentities.set(ANISSA_KEY, { user_id: ANISSA_ID, nostr_pubkey: ANISSA_KEY })
  mockUsers.set(ANISSA_ID, {
    id: ANISSA_ID,
    full_name: "Anissa Felix",
    avatar_url: "https://cdn.example/anissa.png",
  })
}

beforeEach(() => {
  mockOps.length = 0
  mockIdentities = new Map()
  mockUsers = new Map()
  mockFailNextSelect = false
  clearProfileCache()
  clearStore()
})

/* ------------------------------------------------------------- directory */

describe("fetchProfilesForPubkeys", () => {
  it("resolves a registered member's pubkey to their real name", async () => {
    registerAnissa()

    const profiles = await fetchProfilesForPubkeys([ANISSA_KEY])

    expect(profiles).toEqual([
      {
        pubkey: ANISSA_KEY,
        name: "Anissa Felix",
        avatarUrl: "https://cdn.example/anissa.png",
        source: "directory",
      },
    ])
  })

  it("resolves a mixed set in one round trip per table", async () => {
    registerAnissa()
    mockIdentities.set(BOB_KEY, { user_id: BOB_ID, nostr_pubkey: BOB_KEY })
    mockUsers.set(BOB_ID, { id: BOB_ID, full_name: "Bob Chen", avatar_url: null })

    const profiles = await fetchProfilesForPubkeys([ANISSA_KEY, BOB_KEY, STRANGER_KEY])

    expect(profiles.map((p) => p.name).sort()).toEqual(["Anissa Felix", "Bob Chen"])
    expect(mockOps.filter((o) => o.table === "chat_identities")).toHaveLength(1)
    expect(mockOps.filter((o) => o.table === "users")).toHaveLength(1)
  })

  it("omits pubkeys the directory does not know", async () => {
    const profiles = await fetchProfilesForPubkeys([STRANGER_KEY])
    expect(profiles).toEqual([])
  })

  it("normalizes production nulls: blank names collapse, dangling rows drop", async () => {
    // A name that is whitespace is not a name, but the avatar is still useful.
    mockIdentities.set(ANISSA_KEY, { user_id: ANISSA_ID, nostr_pubkey: ANISSA_KEY })
    mockUsers.set(ANISSA_ID, {
      id: ANISSA_ID,
      full_name: "   ",
      avatar_url: "https://cdn.example/anissa.png",
    })
    // An identity row whose user has neither name nor photo says nothing.
    mockIdentities.set(BOB_KEY, { user_id: BOB_ID, nostr_pubkey: BOB_KEY })
    mockUsers.set(BOB_ID, { id: BOB_ID, full_name: null, avatar_url: "  " })

    const profiles = await fetchProfilesForPubkeys([ANISSA_KEY, BOB_KEY])

    expect(profiles).toEqual([
      {
        pubkey: ANISSA_KEY,
        name: null,
        avatarUrl: "https://cdn.example/anissa.png",
        source: "directory",
      },
    ])
  })

  it("caches both hits and misses for the session", async () => {
    registerAnissa()

    await fetchProfilesForPubkeys([ANISSA_KEY, STRANGER_KEY])
    const again = await fetchProfilesForPubkeys([ANISSA_KEY, STRANGER_KEY])

    // A message list re-rendering must not mean a directory query per render.
    expect(again.map((p) => p.name)).toEqual(["Anissa Felix"])
    expect(mockOps.filter((o) => o.table === "chat_identities")).toHaveLength(1)
  })

  it("throws when the directory is unreachable, caching nothing", async () => {
    registerAnissa()
    mockFailNextSelect = true

    await expect(fetchProfilesForPubkeys([ANISSA_KEY])).rejects.toThrow("directory unreachable")

    // Nothing was cached, so the retry queries again and gets the real answer.
    const retry = await fetchProfilesForPubkeys([ANISSA_KEY])
    expect(retry[0]?.name).toBe("Anissa Felix")
  })
})

/* ------------------------------------------------------------ precedence */

describe("mergeProfiles", () => {
  const directory: ChatProfile = {
    pubkey: ANISSA_KEY,
    name: "Anissa Felix",
    avatarUrl: null,
    source: "directory",
  }
  const relay: ChatProfile = {
    pubkey: ANISSA_KEY,
    name: "anissa_nostr",
    avatarUrl: "https://cdn.example/kind0.png",
    source: "relay",
  }

  it("keeps the directory name when kind-0 metadata arrives later", () => {
    const merged = mergeProfiles(directory, relay)
    expect(merged.name).toBe("Anissa Felix")
    expect(merged.source).toBe("directory")
  })

  it("lets kind-0 fill fields the directory lacks", () => {
    const merged = mergeProfiles(directory, relay)
    expect(merged.avatarUrl).toBe("https://cdn.example/kind0.png")
  })

  it("lets the directory displace an earlier kind-0 name", () => {
    const merged = mergeProfiles(relay, directory)
    expect(merged.name).toBe("Anissa Felix")
    expect(merged.source).toBe("directory")
  })

  it("lets a fresh kind-0 update replace an older one", () => {
    const updated: ChatProfile = { ...relay, name: "anissa_v2" }
    expect(mergeProfiles(relay, updated).name).toBe("anissa_v2")
  })

  it("holds the precedence through the store", () => {
    ingestProfiles([relay])
    ingestProfiles([directory])
    ingestProfiles([{ ...relay, name: "anissa_v3" }])

    const held = getProfile(ANISSA_KEY)
    expect(held?.name).toBe("Anissa Felix")
    expect(held?.avatarUrl).toBe("https://cdn.example/kind0.png")
  })
})

/* --------------------------------------------------------------- display */

describe("fallbackDisplayName", () => {
  it("renders a short npub, never the raw hash", () => {
    const label = fallbackDisplayName(ANISSA_KEY)
    expect(label.startsWith("npub1")).toBe(true)
    expect(label).toContain("…")
    expect(label.length).toBeLessThan(20)
    expect(label).not.toContain(ANISSA_KEY)
  })

  it("shortens a value that is already an npub, without double encoding", () => {
    const full = "npub1" + "q".repeat(58)
    const label = fallbackDisplayName(full)
    expect(label.startsWith("npub1")).toBe(true)
    expect(label).toContain("…")
    expect(label.length).toBeLessThan(full.length)
  })

  it("truncates values that are not keys at all rather than crashing", () => {
    const label = fallbackDisplayName("not-a-key-but-quite-long-anyway")
    expect(label).toContain("…")
    expect(label.length).toBeLessThan("not-a-key-but-quite-long-anyway".length)
  })
})

describe("profileDisplayName", () => {
  it("prefers the resolved name", () => {
    expect(profileDisplayName(ANISSA_KEY, { name: "Anissa Felix" })).toBe("Anissa Felix")
  })

  it("falls back to the short npub when nothing resolved", () => {
    expect(profileDisplayName(ANISSA_KEY, undefined).startsWith("npub1")).toBe(true)
    expect(profileDisplayName(ANISSA_KEY, { name: null }).startsWith("npub1")).toBe(true)
  })
})

describe("looksLikeRawKey", () => {
  it("recognises hex pubkeys and npubs, but not names", () => {
    expect(looksLikeRawKey(ANISSA_KEY)).toBe(true)
    expect(looksLikeRawKey("npub1" + "q".repeat(58))).toBe(true)
    expect(looksLikeRawKey("Anissa Felix")).toBe(false)
    expect(looksLikeRawKey("Member")).toBe(false)
  })
})

/* --------------------------------------------------------------- channel */

describe("displayChannel", () => {
  const dm: ChatChannel = {
    id: "route-id",
    kind: "dm",
    name: "Anissa Felix",
    topic: null,
    icon: null,
    avatarUrl: null,
    address: ANISSA_KEY,
  }

  it("returns public rooms untouched, by reference", () => {
    const room: ChatChannel = { ...dm, kind: "public", name: "#general" }
    expect(displayChannel(room, undefined)).toBe(room)
  })

  it("overlays the resolved profile onto a DM", () => {
    const resolved = displayChannel(dm, {
      pubkey: ANISSA_KEY,
      name: "Anissa Felix-Ortega",
      avatarUrl: "https://cdn.example/anissa.png",
      source: "directory",
    })
    expect(resolved.name).toBe("Anissa Felix-Ortega")
    expect(resolved.avatarUrl).toBe("https://cdn.example/anissa.png")
    // Addressing must never change with presentation.
    expect(resolved.address).toBe(ANISSA_KEY)
  })

  it("keeps the stored name when nothing resolved", () => {
    expect(displayChannel(dm, undefined)).toBe(dm)
  })

  it("replaces a stored name that is itself a raw key with a short npub", () => {
    const hashTitled: ChatChannel = { ...dm, name: BOB_KEY, address: BOB_KEY }
    const resolved = displayChannel(hashTitled, undefined)
    expect(resolved.name.startsWith("npub1")).toBe(true)
    expect(resolved.name).toContain("…")
    expect(resolved.name).not.toContain(BOB_KEY)
  })

  it("replaces a blank stored name with a short npub", () => {
    const unnamed: ChatChannel = { ...dm, name: "  " }
    expect(displayChannel(unnamed, undefined).name.startsWith("npub1")).toBe(true)
  })
})
