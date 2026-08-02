/**
 * The chat account directory: `public.chat_identities`.
 *
 * Nostr addresses people by public key, not by account id, so a client that
 * wants to message "the member with this uuid" needs a uuid -> pubkey mapping
 * from somewhere. This module is that somewhere.
 *
 * It is what makes random keys possible. Before it existed, every member's key
 * was derived from their auth uuid by a constant in this bundle — the only way
 * two devices could agree on a key without a directory, and a scheme in which
 * reading this repo yields everyone's secret key. Now the key is random, the
 * secret half never leaves the device's Keychain, and the public half is
 * published here.
 *
 * Only the PUBLIC key is ever written. There is no column for the secret and
 * no code path that would send one; `src/chat/account.ts` holds the secret in
 * expo-secure-store and hands out `getPublicKey(sk)` alone.
 *
 * RLS backs this up rather than relying on the client behaving: a member may
 * write only the row whose `user_id` is their own `auth.uid()`, so nobody can
 * park their key on someone else's id and quietly receive that person's DMs.
 * SELECT is granted to `authenticated` only — see the migration header for why
 * this is not a column on `public.users`.
 */

import { supabase } from "@/lib/supabase"

import { pubkeyForPerson } from "./account"

const TABLE = "chat_identities"

export type ChatMembership = {
  communityId: string | null
  role: string | null
}

export type ChatIdentityRecord = {
  userId: string
  pubkey: string
  relayUrl: string
  communityId: string | null
  role: string | null
  joinedAt: string | null
}

type Row = {
  user_id: string
  nostr_pubkey: string
  relay_url: string
  community_id: string | null
  role: string | null
  joined_at: string | null
}

/**
 * uuid -> pubkey, for the lifetime of a session.
 *
 * A member's key changes only when they reinstall or rotate, which is rare
 * enough that a per-session cache is worth one stale window; `forgetPeer` and
 * `clearDirectoryCache` exist for the moments when we know better. A `null`
 * value is cached too — "this person has never opened chat" is an answer, and
 * re-asking on every render of a member list would be a query per row.
 */
const peerCache = new Map<string, string | null>()

export function clearDirectoryCache() {
  peerCache.clear()
}

export function forgetPeer(userId: string) {
  peerCache.delete(userId)
}

function toRecord(row: Row): ChatIdentityRecord {
  return {
    userId: row.user_id,
    pubkey: row.nostr_pubkey,
    relayUrl: row.relay_url,
    communityId: row.community_id,
    role: row.role,
    joinedAt: row.joined_at,
  }
}

/* ------------------------------------------------------------- own record */

/** This user's registered identity, or null if they have never registered one. */
export async function fetchOwnIdentity(userId: string): Promise<ChatIdentityRecord | null> {
  const { data, error } = await supabase
    .from(TABLE)
    .select("user_id,nostr_pubkey,relay_url,community_id,role,joined_at")
    .eq("user_id", userId)
    .maybeSingle()

  if (error) throw new Error(error.message)
  return data ? toRecord(data as Row) : null
}

/**
 * Publish this device's public key as the user's chat account.
 *
 * Idempotent and quiet: it reads the current row first and writes only when
 * something actually changed, so the common case (app launch, same key as
 * yesterday) costs one indexed SELECT and no write at all.
 *
 * When the pubkey *has* changed — a reinstall generated a new key, since the
 * old secret was unrecoverable by design — the membership columns are cleared
 * in the same statement. Leaving them would claim the new key is already a
 * member of a community that has never seen it, and the caller would skip the
 * join it actually needs.
 */
export async function registerChatIdentity(input: {
  userId: string
  pubkey: string
  relayUrl: string
  membership?: ChatMembership | null
}): Promise<ChatIdentityRecord> {
  const { userId, pubkey, relayUrl, membership } = input

  const existing = await fetchOwnIdentity(userId).catch(() => null)
  const keyChanged = !existing || existing.pubkey !== pubkey

  if (existing && !keyChanged && existing.relayUrl === relayUrl && !membership) {
    return existing
  }

  const patch: Record<string, unknown> = {
    user_id: userId,
    nostr_pubkey: pubkey,
    relay_url: relayUrl,
  }

  if (membership) {
    patch.community_id = membership.communityId
    patch.role = membership.role
    patch.joined_at = new Date().toISOString()
  } else if (keyChanged) {
    patch.community_id = null
    patch.role = null
    patch.joined_at = null
  }

  const { data, error } = await supabase
    .from(TABLE)
    .upsert(patch, { onConflict: "user_id" })
    .select("user_id,nostr_pubkey,relay_url,community_id,role,joined_at")
    .maybeSingle()

  if (error) throw new Error(error.message)

  peerCache.set(userId, pubkey)

  // A successful write with no row back means RLS allowed the statement but
  // hid the result; the write still happened, so report what we sent.
  return data
    ? toRecord(data as Row)
    : {
        userId,
        pubkey,
        relayUrl,
        communityId: membership?.communityId ?? null,
        role: membership?.role ?? null,
        joinedAt: membership ? new Date().toISOString() : null,
      }
}

/* ------------------------------------------------------------------ peers */

/**
 * Resolve the pubkeys of other members, in one round trip.
 *
 * Members with no directory row fall back to the legacy derived key. That
 * fallback is not decoration: it is the whole migration story. Someone who
 * used chat before this table existed is still reachable at their derived key,
 * and stays reachable until their app registers a random one — at which point
 * the directory answer supersedes the derivation for everyone who looks them
 * up. Guests with no account (an `event_users` row and no `user_id`) never get
 * a directory row at all, so for them the derivation is permanent.
 */
export async function lookupPubkeys(userIds: string[]): Promise<Map<string, string>> {
  const resolved = new Map<string, string>()
  const unknown: string[] = []

  for (const id of new Set(userIds)) {
    const cached = peerCache.get(id)
    if (cached === undefined) unknown.push(id)
    else if (cached !== null) resolved.set(id, cached)
  }

  if (unknown.length) {
    const { data, error } = await supabase
      .from(TABLE)
      .select("user_id,nostr_pubkey")
      .in("user_id", unknown)

    // A directory that is unreachable must not break messaging: fall through to
    // the derived keys below, which is exactly what the app did before this
    // table existed. Nothing is cached in that case, so the next call retries.
    if (!error) {
      const rows = (data ?? []) as Pick<Row, "user_id" | "nostr_pubkey">[]
      const found = new Map(rows.map((r) => [r.user_id, r.nostr_pubkey]))
      for (const id of unknown) {
        const pubkey = found.get(id) ?? null
        peerCache.set(id, pubkey)
        if (pubkey) resolved.set(id, pubkey)
      }
    }
  }

  const out = new Map<string, string>()
  for (const id of userIds) {
    out.set(id, resolved.get(id) ?? pubkeyForPerson(id))
  }
  return out
}

/** Single-peer convenience over {@link lookupPubkeys}. */
export async function lookupPubkey(userId: string): Promise<string> {
  const map = await lookupPubkeys([userId])
  return map.get(userId) ?? pubkeyForPerson(userId)
}
