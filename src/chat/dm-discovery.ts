/**
 * First-contact DM discovery.
 *
 * Nostr has no conversation list: the app can only show DM threads it already
 * knows about, and until now the only way a thread came to exist was the user
 * opening one from the People tab. An incoming gift wrap from anyone else was
 * unwrapped, found to have no channel, and silently dropped — so the very first
 * message a person ever sent you was invisible on your phone even though the
 * relay delivered it (verified live: the relay accepts and serves such wraps;
 * see scripts/dm-live-test.mjs).
 *
 * The fix is to route a wrap from an unknown peer by the peer's own pubkey.
 * That key becomes the channel id (and the `/chat/[id]` route), the thread is
 * persisted like any other, and profile resolution turns the key into a name
 * the same way it does everywhere else. This module holds the pure pieces so
 * the adapter and the router agree on what such a channel looks like.
 */

import { fallbackDisplayName } from "./profiles"
import type { ChatChannel } from "./types"

/**
 * True when a route id is a raw x-only pubkey rather than a users/event_users
 * uuid. The two alphabets cannot collide: a uuid is 36 characters with dashes,
 * a pubkey is 64 bare hex characters.
 */
export function isHexPubkey(value: string): boolean {
  return /^[0-9a-f]{64}$/.test(value)
}

/**
 * The channel for a DM thread that exists only because a message arrived.
 * There may be no users row behind this key at all, so the id and address are
 * both the pubkey itself; `displayChannel` overlays the directory or kind-0
 * name once profile resolution catches up.
 */
export function discoveredDmChannel(peer: string): ChatChannel {
  return {
    id: peer,
    kind: "dm",
    name: fallbackDisplayName(peer),
    topic: null,
    icon: null,
    avatarUrl: null,
    address: peer,
  }
}
