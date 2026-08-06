import { staleDmThreadIds, uuidRoutedThreadIds } from "./store"
import type { ChatChannel } from "./types"

const UUID_A = "54cc941c-66eb-4dae-baa0-a95bb4bc6282"
const UUID_B = "2f65e679-1cd0-4e0e-9c8a-1d29e78a3b41"
const PUBKEY = "a".repeat(64)

const dm = (id: string): ChatChannel => ({
  id,
  kind: "dm",
  name: "Someone",
  topic: null,
  icon: null,
  address: id,
  avatarUrl: null,
})

const room = (id: string): ChatChannel => ({
  id,
  kind: "public",
  name: "General",
  topic: null,
  icon: null,
  address: id,
  avatarUrl: null,
})

describe("uuidRoutedThreadIds", () => {
  it("returns only dm threads routed by uuid", () => {
    const threads = [dm(UUID_A), dm(PUBKEY), room(UUID_B)]
    expect(uuidRoutedThreadIds(threads)).toEqual([UUID_A])
  })
})

describe("staleDmThreadIds", () => {
  it("flags uuid threads whose person no longer exists", () => {
    const threads = [dm(UUID_A), dm(UUID_B)]
    expect(staleDmThreadIds(threads, new Set([UUID_B]))).toEqual([UUID_A])
  })

  it("never flags pubkey-routed threads, even with an empty directory", () => {
    expect(staleDmThreadIds([dm(PUBKEY)], new Set())).toEqual([])
  })

  it("never flags public rooms", () => {
    expect(staleDmThreadIds([room(UUID_A)], new Set())).toEqual([])
  })
})
