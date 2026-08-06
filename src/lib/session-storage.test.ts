import { chunkedSecureStorage } from "./session-storage"

/**
 * The chunked SecureStore adapter is what keeps a >2048-byte session JSON in
 * the Keychain, and it is also the format every previously-installed build
 * wrote — so the round trip and the legacy layout are both pinned here. The
 * mock enforces SecureStore's real 2048-byte limit, so an oversized write is
 * a test failure rather than a silent production bug.
 */

const mockStore = new Map<string, string>()

jest.mock("expo-secure-store", () => ({
  getItemAsync: async (key: string) => mockStore.get(key) ?? null,
  setItemAsync: async (key: string, value: string) => {
    if (value.length > 2048) throw new Error(`SecureStore value too large: ${value.length}`)
    mockStore.set(key, value)
  },
  deleteItemAsync: async (key: string) => {
    mockStore.delete(key)
  },
}))

beforeEach(() => mockStore.clear())

describe("chunkedSecureStorage", () => {
  it("round-trips a small value in a single entry", async () => {
    await chunkedSecureStorage.setItem("k", "hello")
    expect(await chunkedSecureStorage.getItem("k")).toBe("hello")
    expect(mockStore.size).toBe(1)
  })

  it("round-trips a session-sized value through chunks", async () => {
    // Realistic: a supabase-era session JSON with a large user object runs
    // 3-6 KB, well past SecureStore's 2048-byte cap.
    const value = JSON.stringify({ access_token: "x".repeat(4000), refresh_token: "rt" })
    await chunkedSecureStorage.setItem("k", value)

    expect(mockStore.get("k")).toMatch(/^__chunked__:\d+$/)
    for (const [, stored] of mockStore) expect(stored.length).toBeLessThanOrEqual(2048)
    expect(await chunkedSecureStorage.getItem("k")).toBe(value)
  })

  it("reads a chunked value written by a previous build (fixed layout)", async () => {
    mockStore.set("k", "__chunked__:2")
    mockStore.set("k__0", "first-half-")
    mockStore.set("k__1", "second-half")
    expect(await chunkedSecureStorage.getItem("k")).toBe("first-half-second-half")
  })

  it("a shrinking value leaves no stale chunk tails behind", async () => {
    await chunkedSecureStorage.setItem("k", "y".repeat(5000))
    await chunkedSecureStorage.setItem("k", "tiny")

    expect(await chunkedSecureStorage.getItem("k")).toBe("tiny")
    expect([...mockStore.keys()]).toEqual(["k"])
  })

  it("removeItem clears the head and every chunk", async () => {
    await chunkedSecureStorage.setItem("k", "z".repeat(5000))
    await chunkedSecureStorage.removeItem("k")
    expect(mockStore.size).toBe(0)
    expect(await chunkedSecureStorage.getItem("k")).toBeNull()
  })

  it("a missing chunk reads as absent, not as a truncated session", async () => {
    await chunkedSecureStorage.setItem("k", "w".repeat(5000))
    mockStore.delete("k__1")
    expect(await chunkedSecureStorage.getItem("k")).toBeNull()
  })
})
