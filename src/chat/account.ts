/**
 * The user's chat account: one secp256k1 keypair, created on the device.
 *
 * A Nostr account *is* a keypair — there is no registration step, no server
 * that issues it, and nothing to confirm. Creating an account means generating
 * 32 random bytes; the public half becomes the address other members send to,
 * and the app publishes it to `public.chat_identities` (see ./directory).
 *
 * The secret half is generated here and stored in the iOS Keychain / Android
 * Keystore through expo-secure-store. It is never sent anywhere — not to
 * Supabase, not to the relay, not to the website. The relay only ever sees
 * signatures. That is deliberate and it has a price: the key is unrecoverable,
 * so reinstalling the app produces a NEW account rather than restoring the old
 * one. Auto-join is what makes that price small — the new key re-registers and
 * is re-admitted without the user doing anything.
 *
 * ── Why there is still a derivation in this file ──
 *
 * Chat originally had no directory, so every member's key was derived from
 * their auth uuid with the constant below. Two devices could then agree on a
 * key with no server involved — and so could anyone who read this source, which
 * is why keys are random now.
 *
 * The derivation is kept for exactly two jobs, both of which are about not
 * breaking people:
 *
 *   1. Addressing members who have no directory row yet — someone who used
 *      chat before this change, or an event guest with no account at all.
 *      Their derived key is where their messages actually are.
 *   2. A last-resort fallback when secure storage is unavailable (Expo's web
 *      target has no SecureStore, and a locked keychain can fail on device).
 *      A random key we cannot persist would mean a new identity on every
 *      launch and no readable history; a derived key at least works.
 *
 * Neither job is a secrecy claim. A derived key is only as private as this
 * file, and the app reports which kind it holds so the UI can say so.
 */

import * as SecureStore from "expo-secure-store"

import {
  bytesToHex,
  deriveSecretKey,
  getPublicKey,
  hexToBytes,
  randomSecretKey,
} from "./protocol"

/** Legacy, and load-bearing: do not change — it is where old messages live. */
const KEY_DERIVATION_PREFIX = "aisocratic:nostr:v1:"

const secretKeyStorageKey = (userId: string) => `aisocratic.chat.sk.${userId}`

/**
 * How the key in hand came to exist.
 *
 *   created  freshly generated random key, persisted to secure storage
 *   stored   read back from secure storage (created on an earlier launch)
 *   derived  computed from the user id because secure storage is unusable
 */
export type ChatKeySource = "created" | "stored" | "derived"

export type ChatAccount = {
  sk: Uint8Array
  pubkey: string
  source: ChatKeySource
}

/**
 * The public key a member had before the directory existed.
 *
 * Used to address people the directory does not know about. See ./directory —
 * a directory hit always wins over this.
 */
export function pubkeyForPerson(personId: string): string {
  return getPublicKey(deriveSecretKey(KEY_DERIVATION_PREFIX + personId))
}

function isHex32(value: string): boolean {
  return /^[0-9a-f]{64}$/i.test(value)
}

/**
 * Load this user's account, creating one the first time.
 *
 * The order matters. An existing stored key always wins, including a legacy
 * derived key that an earlier version wrote there — that key is the identity
 * other members already have, and quietly replacing it would orphan every
 * conversation and drop the user out of the community.
 */
export async function loadOrCreateAccount(userId: string): Promise<ChatAccount> {
  const storageKey = secretKeyStorageKey(userId)

  try {
    const stored = await SecureStore.getItemAsync(storageKey)
    if (stored && isHex32(stored)) {
      const sk = hexToBytes(stored.toLowerCase())
      return { sk, pubkey: getPublicKey(sk), source: "stored" }
    }
  } catch {
    /* Unreadable keychain: fall through and try to create. If storage is truly
       unavailable the write below fails too, and we end up on the derived
       fallback — which is stable, so history stays readable. */
  }

  const sk = randomSecretKey()

  try {
    await SecureStore.setItemAsync(storageKey, bytesToHex(sk))
    return { sk, pubkey: getPublicKey(sk), source: "created" }
  } catch {
    // Persisting failed, so this random key would not survive the launch.
    // Never return it: an identity that changes every cold start cannot hold a
    // membership or receive a reply.
    const fallback = deriveSecretKey(KEY_DERIVATION_PREFIX + userId)
    return { sk: fallback, pubkey: getPublicKey(fallback), source: "derived" }
  }
}

/**
 * Forget this device's key.
 *
 * Unrecoverable by construction: the secret exists nowhere else, so this ends
 * the account rather than signing out of it. The next load creates a new one,
 * which then re-registers and re-joins.
 */
export async function forgetAccount(userId: string): Promise<void> {
  try {
    await SecureStore.deleteItemAsync(secretKeyStorageKey(userId))
  } catch {
    /* nothing to delete, or storage is unavailable */
  }
}
