import "react-native-url-polyfill/auto"
// Must come before createClient: auth-js decides its PKCE challenge method at
// call time based on whether crypto.subtle exists.
import "@/lib/webcrypto"

import AsyncStorage from "@react-native-async-storage/async-storage"
import { createClient } from "@supabase/supabase-js"
import * as SecureStore from "expo-secure-store"
import { Platform } from "react-native"

const API_URL = process.env.EXPO_PUBLIC_API_URL
const API_KEY = process.env.EXPO_PUBLIC_API_KEY

if (!API_URL || !API_KEY) {
  throw new Error(
    "Missing EXPO_PUBLIC_API_URL / EXPO_PUBLIC_API_KEY. Copy .env.example to .env and fill them in.",
  )
}

export const SITE_URL = process.env.EXPO_PUBLIC_SITE_URL ?? "https://aisocratic.org"

/**
 * Session storage.
 *
 * On device we keep the refresh token in the Keychain / Android Keystore via
 * expo-secure-store. SecureStore rejects values over 2048 bytes, so we chunk.
 * On web (Expo's web target, used for quick previews) we fall back to
 * AsyncStorage since SecureStore has no browser implementation.
 */
const CHUNK_SIZE = 1800

const secureStorage = {
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
    await secureStorage.removeItem(key)

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

const storage = Platform.OS === "web" ? AsyncStorage : secureStorage

export const supabase = createClient(API_URL, API_KEY, {
  auth: {
    storage,
    storageKey: "aisocratic-auth",
    autoRefreshToken: true,
    persistSession: true,
    // PKCE is the correct flow for a native client: the code verifier stays on
    // the device, so the authorization code in the redirect is useless to
    // anyone who intercepts it. GoTrue then returns `?code=` rather than a
    // fragment. src/store/auth.tsx handles the exchange.
    flowType: "pkce",
    // There is no browser URL to inspect on device; we parse the OAuth callback
    // ourselves after expo-web-browser hands it back.
    detectSessionInUrl: false,
  },
})
