import * as SecureStore from "expo-secure-store"

import { loadOrCreateAccount, pubkeyForPerson } from "./account"
import { getPublicKey, hexToBytes } from "./protocol"

/**
 * The chat account is the app's only real secret. These assert the three
 * properties that make it one:
 *
 *   - a new account is RANDOM, not computed from the user id (the old scheme,
 *     under which reading this repo yielded everyone's secret key);
 *   - an existing key is never silently replaced, because it is the identity
 *     other members already hold and the community already admitted;
 *   - the secret is persisted to secure storage, and if it cannot be, the app
 *     falls back to something STABLE rather than a key that dies on restart.
 */

const getItem = SecureStore.getItemAsync as jest.MockedFunction<typeof SecureStore.getItemAsync>
const setItem = SecureStore.setItemAsync as jest.MockedFunction<typeof SecureStore.setItemAsync>

const USER = "11111111-2222-3333-4444-555555555555"

beforeEach(() => {
  jest.clearAllMocks()
  getItem.mockResolvedValue(null)
  setItem.mockResolvedValue(undefined)
})

describe("loadOrCreateAccount", () => {
  it("creates a random key rather than deriving one from the user id", async () => {
    const account = await loadOrCreateAccount(USER)

    expect(account.source).toBe("created")
    // The single most important assertion in this file: if these ever match,
    // the key is computable from public information again.
    expect(account.pubkey).not.toBe(pubkeyForPerson(USER))
  })

  it("does not produce the same key twice for the same user", async () => {
    const first = await loadOrCreateAccount(USER)
    const second = await loadOrCreateAccount(USER)

    // Both calls see an empty keychain (the mock returns null), so each
    // generates fresh randomness. Equality here would mean the "random" key is
    // a function of the user id after all.
    expect(first.pubkey).not.toBe(second.pubkey)
  })

  it("persists the new secret to secure storage", async () => {
    const account = await loadOrCreateAccount(USER)

    expect(setItem).toHaveBeenCalledTimes(1)
    const [key, value] = setItem.mock.calls[0]
    expect(key).toBe(`aisocratic.chat.sk.${USER}`)
    expect(value).toMatch(/^[0-9a-f]{64}$/)
    // What was stored is the secret whose public half we handed back.
    expect(getPublicKey(hexToBytes(value))).toBe(account.pubkey)
  })

  it("reuses a stored key instead of generating a new identity", async () => {
    const existing = "a".repeat(63) + "1"
    getItem.mockResolvedValue(existing)

    const account = await loadOrCreateAccount(USER)

    expect(account.source).toBe("stored")
    expect(account.pubkey).toBe(getPublicKey(hexToBytes(existing)))
    expect(setItem).not.toHaveBeenCalled()
  })

  it("keeps a legacy derived key that an earlier version stored", async () => {
    // Members who used chat before random keys existed have their derived key
    // sitting in the keychain. It is where their history and membership are, so
    // "upgrading" them to a fresh random key would orphan both.
    const legacyPubkey = pubkeyForPerson(USER)
    const { bytesToHex, deriveSecretKey } = jest.requireActual<typeof import("./protocol")>(
      "./protocol",
    )
    getItem.mockResolvedValue(bytesToHex(deriveSecretKey("aisocratic:nostr:v1:" + USER)))

    const account = await loadOrCreateAccount(USER)

    expect(account.source).toBe("stored")
    expect(account.pubkey).toBe(legacyPubkey)
  })

  it("ignores a corrupted stored value and creates a fresh account", async () => {
    getItem.mockResolvedValue("not-a-key")

    const account = await loadOrCreateAccount(USER)

    expect(account.source).toBe("created")
    expect(setItem).toHaveBeenCalledTimes(1)
  })

  it("falls back to a stable derived key when the secret cannot be persisted", async () => {
    // A random key we failed to store would change on every cold start, so the
    // user could never hold a membership or read a reply. Stability wins here,
    // and `source` reports the downgrade so the UI can say so.
    setItem.mockRejectedValue(new Error("keychain unavailable"))

    const account = await loadOrCreateAccount(USER)

    expect(account.source).toBe("derived")
    expect(account.pubkey).toBe(pubkeyForPerson(USER))

    const again = await loadOrCreateAccount(USER)
    expect(again.pubkey).toBe(account.pubkey)
  })

  it("survives an unreadable keychain by creating and storing a new key", async () => {
    getItem.mockRejectedValue(new Error("locked"))

    const account = await loadOrCreateAccount(USER)

    expect(account.source).toBe("created")
    expect(setItem).toHaveBeenCalledTimes(1)
  })

  it("gives different users different accounts", async () => {
    const a = await loadOrCreateAccount(USER)
    const b = await loadOrCreateAccount("99999999-8888-7777-6666-555555555555")

    expect(a.pubkey).not.toBe(b.pubkey)
  })
})
