import AsyncStorage from "@react-native-async-storage/async-storage"
import * as SecureStore from "expo-secure-store"
import { Platform } from "react-native"

/**
 * Session storage.
 *
 * On device we keep the session (access + refresh tokens) in the Keychain /
 * Android Keystore via expo-secure-store. SecureStore rejects values over
 * 2048 bytes, so we chunk. On web (Expo's web target, used for quick
 * previews) we fall back to AsyncStorage since SecureStore has no browser
 * implementation.
 *
 * The chunking format is the one the app has always used — a head value of
 * `__chunked__:<count>` with the pieces at `<key>__0` … `<key>__<n>` — so a
 * session written by any previous build reads back unchanged.
 */

export type StorageAdapter = {
  getItem(key: string): Promise<string | null>
  setItem(key: string, value: string): Promise<void>
  removeItem(key: string): Promise<void>
}

const CHUNK_SIZE = 1800

export const chunkedSecureStorage: StorageAdapter = {
  async getItem(key: string): Promise<string | null> {
    const head = await SecureStore.getItemAsync(key)
    if (head === null) return null
    if (!head.startsWith("__chunked__:")) return head

    const count = Number(head.slice("__chunked__:".length))
    const parts: string[] = []
    for (let i = 0; i < count; i++) {
      const part = await SecureStore.getItemAsync(`${key}__${i}`)
      if (part === null) return null
      parts.push(part)
    }
    return parts.join("")
  },

  async setItem(key: string, value: string): Promise<void> {
    // Clear any previous chunks so a shrinking value can't leave stale tails.
    await chunkedSecureStorage.removeItem(key)

    if (value.length <= CHUNK_SIZE) {
      await SecureStore.setItemAsync(key, value)
      return
    }

    const count = Math.ceil(value.length / CHUNK_SIZE)
    for (let i = 0; i < count; i++) {
      await SecureStore.setItemAsync(
        `${key}__${i}`,
        value.slice(i * CHUNK_SIZE, (i + 1) * CHUNK_SIZE),
      )
    }
    await SecureStore.setItemAsync(key, `__chunked__:${count}`)
  },

  async removeItem(key: string): Promise<void> {
    const head = await SecureStore.getItemAsync(key)
    if (head?.startsWith("__chunked__:")) {
      const count = Number(head.slice("__chunked__:".length))
      for (let i = 0; i < count; i++) {
        await SecureStore.deleteItemAsync(`${key}__${i}`)
      }
    }
    await SecureStore.deleteItemAsync(key)
  },
}

export const sessionStorage: StorageAdapter =
  Platform.OS === "web" ? AsyncStorage : chunkedSecureStorage
