/**
 * Pubkey -> person resolution: the reason chat shows "Anissa Felix" and not a
 * 64-character hash.
 *
 * Nostr addresses people by public key, so every sender label, DM title and
 * avatar in chat starts life as a hex string. This module turns those keys
 * back into humans, consulting sources in order of trustworthiness:
 *
 *   1. the community directory — `chat_identities` (pubkey -> user id, the
 *      reverse of the lookup ./directory does) joined to `public.users`
 *      (real names and avatars, entered at signup);
 *   2. kind-0 relay metadata — self-published, so it exists only for keys
 *      whose owner has announced, and it says whatever they chose to say;
 *   3. a short truncated npub — `npub1abcd…wxyz` — because a raw hash is
 *      never an acceptable thing to call a person.
 *
 * The fetch half here is plain async (react-query orchestrates it from
 * `./index`); the rest is pure functions, so screens stay presentational and
 * the precedence rules are testable without React or a socket.
 *
 * Production data is full of nulls — members with no name, identities whose
 * user row is gone, kind-0 events with empty strings — so everything is
 * normalized at this layer: names are trimmed, blank collapses to null, and a
 * caller can trust that a non-null name is printable.
 */

import { api } from "@/lib/api"

import { npubEncode, shortNpub } from "./protocol"
import type { ChatChannel, ChatProfile } from "./types"

/* ---------------------------------------------------------------- display */

/**
 * What to call a key nobody recognises. NIP-19 short form, never the raw hex:
 * an npub is at least shareable and matches what other Nostr clients show.
 * The catch arm covers values that aren't a valid x-only key at all (they do
 * appear — a malformed row, a legacy id) — truncate rather than crash, and
 * still never render the full blob.
 */
export function fallbackDisplayName(pubkey: string): string {
  const key = pubkey.trim()
  if (key.toLowerCase().startsWith("npub1")) return shortNpub(key)
  try {
    return shortNpub(npubEncode(key.toLowerCase()))
  } catch {
    return key.length > 13 ? `${key.slice(0, 8)}…${key.slice(-4)}` : key
  }
}

/** The one rule for sender labels: a resolved name, else a short npub. */
export function profileDisplayName(
  pubkey: string,
  profile: Pick<ChatProfile, "name"> | null | undefined,
): string {
  return profile?.name ?? fallbackDisplayName(pubkey)
}

/** True when a string is a key pretending to be a name (hex or npub). */
export function looksLikeRawKey(value: string): boolean {
  const v = value.trim().toLowerCase()
  return /^[0-9a-f]{64}$/.test(v) || /^npub1[0-9a-z]{10,}$/.test(v)
}

/* ------------------------------------------------------------- precedence */

/** Directory names are entered at signup; kind-0 is whatever a key claims. */
const rank = (p: ChatProfile) => (p.source === "directory" ? 2 : 1)

/**
 * Combine what two sources know about one key.
 *
 * Field-wise, not record-wise: a directory row with a name but no photo and a
 * kind-0 event with a photo but no name should produce a profile with both.
 * The higher-ranked source wins each field it actually has; on a tie the
 * incoming record wins, so a fresh kind-0 update replaces a stale one without
 * ever displacing a directory name.
 */
export function mergeProfiles(
  previous: ChatProfile | undefined,
  incoming: ChatProfile,
): ChatProfile {
  if (!previous) return incoming
  const [primary, secondary] =
    rank(incoming) >= rank(previous) ? [incoming, previous] : [previous, incoming]
  return {
    pubkey: primary.pubkey,
    name: primary.name ?? secondary.name,
    avatarUrl: primary.avatarUrl ?? secondary.avatarUrl,
    source: primary.source,
  }
}

/* ---------------------------------------------------------------- channel */

/**
 * A DM channel with its title and avatar resolved for display.
 *
 * The name persisted with the thread was right when the thread was opened;
 * the live profile is fresher, so it wins when it has anything to say. When
 * neither does, keep the stored name — unless it is itself a raw key (threads
 * persisted before this module existed), which is the one thing this function
 * exists to never show.
 *
 * Public rooms pass through untouched, by reference, so memoized rows don't
 * re-render for nothing.
 */
export function displayChannel(
  channel: ChatChannel,
  profile: ChatProfile | null | undefined,
): ChatChannel {
  if (channel.kind !== "dm") return channel

  const stored = channel.name.trim()
  const storedUsable = stored.length > 0 && !looksLikeRawKey(stored)
  const name = profile?.name ?? (storedUsable ? stored : fallbackDisplayName(channel.address))
  const avatarUrl = profile?.avatarUrl ?? channel.avatarUrl

  if (name === channel.name && avatarUrl === channel.avatarUrl) return channel
  return { ...channel, name, avatarUrl }
}

/* -------------------------------------------------------------- directory */

type IdentityRow = { user_id: string | null; nostr_pubkey: string | null }
type UserRow = { id: string; full_name: string | null; avatar_url: string | null }

/**
 * pubkey -> profile, for the lifetime of a session.
 *
 * Same shape and same reasoning as `peerCache` in ./directory, pointed the
 * other way: names change rarely, message lists re-render constantly, and a
 * `null` ("this key belongs to nobody we know" — an unregistered peer, a
 * guest on a derived key) is an answer worth remembering too, or every render
 * of a busy room would re-ask about the same strangers.
 */
const profileCache = new Map<string, ChatProfile | null>()

export function clearProfileCache() {
  profileCache.clear()
}

/**
 * Resolve pubkeys through the community directory, in two round trips total
 * (identities, then their user rows) regardless of how many keys are asked.
 *
 * Returns only the keys it could put a face or a name to; absence means the
 * caller should fall back to kind-0 metadata and then to a short npub. Throws
 * when the directory is unreachable — and caches nothing in that case — so
 * the react-query layer above retries instead of freezing a blank answer.
 */
export async function fetchProfilesForPubkeys(pubkeys: string[]): Promise<ChatProfile[]> {
  const hits: ChatProfile[] = []
  const unknown: string[] = []

  for (const pubkey of new Set(pubkeys)) {
    if (!pubkey) continue
    const cached = profileCache.get(pubkey)
    if (cached === undefined) unknown.push(pubkey)
    else if (cached) hits.push(cached)
  }

  if (!unknown.length) return hits

  const { data, error } = await api
    .from("chat_identities")
    .select("user_id,nostr_pubkey")
    .in("nostr_pubkey", unknown)

  if (error) throw new Error(error.message)

  const userByPubkey = new Map<string, string>()
  for (const raw of (data ?? []) as IdentityRow[]) {
    if (raw.nostr_pubkey && raw.user_id) userByPubkey.set(raw.nostr_pubkey, raw.user_id)
  }

  const people = new Map<string, { name: string | null; avatarUrl: string | null }>()
  const userIds = [...new Set(userByPubkey.values())]
  if (userIds.length) {
    const { data: userRows, error: usersError } = await api
      .from("users")
      .select("id,full_name,avatar_url")
      .in("id", userIds)

    if (usersError) throw new Error(usersError.message)

    for (const raw of (userRows ?? []) as UserRow[]) {
      people.set(raw.id, {
        // Whitespace-only names exist in production; they are not names.
        name: raw.full_name?.trim() || null,
        avatarUrl: raw.avatar_url?.trim() || null,
      })
    }
  }

  for (const pubkey of unknown) {
    const userId = userByPubkey.get(pubkey)
    const person = userId ? people.get(userId) : undefined

    // An identity row pointing at a user with neither name nor photo tells the
    // UI nothing — cache the miss and let kind-0 or the npub fallback speak.
    if (!person || (!person.name && !person.avatarUrl)) {
      profileCache.set(pubkey, null)
      continue
    }

    const profile: ChatProfile = {
      pubkey,
      name: person.name,
      avatarUrl: person.avatarUrl,
      source: "directory",
    }
    profileCache.set(pubkey, profile)
    hits.push(profile)
  }

  return hits
}
