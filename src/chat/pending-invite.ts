/**
 * A code that arrived by link rather than by paste.
 *
 * Opening `aisocratic://invite/<code>` can't join anybody on the spot: the
 * claim has to be signed by a chat key, and there is no chat key without a
 * session. So the code is parked here, the app routes to Chat, and whatever
 * happens next — an immediate join, or a sign-up first and a join five minutes
 * later — finds it waiting.
 *
 * Deliberately AsyncStorage and not SecureStore: an invite is a capability to
 * *join a community*, it is single-purpose and short-lived, and it is about to
 * be shown on screen and typed by hand anyway. SecureStore is reserved for the
 * secret key, which is the thing worth protecting.
 */

import AsyncStorage from "@react-native-async-storage/async-storage"

const KEY = "aisocratic.chat.pending-invite.v1"

/**
 * How long a parked code stays interesting. Invites themselves live up to 30
 * days, but a link tapped a day ago and never acted on is stale context, and
 * silently prefilling it into a join form weeks later would be confusing.
 */
const MAX_AGE_SECONDS = 24 * 60 * 60

type Parked = { code: string; at: number }

export async function rememberPendingInvite(code: string): Promise<void> {
  const trimmed = code.trim()
  if (!trimmed) return
  const parked: Parked = { code: trimmed, at: Math.floor(Date.now() / 1000) }
  try {
    await AsyncStorage.setItem(KEY, JSON.stringify(parked))
  } catch {
    // Storage being unavailable costs the prefill, not the join — the code is
    // still in the link the user can reopen.
  }
}

/** Read and clear. Returns null when nothing is parked, or it has gone stale. */
export async function takePendingInvite(): Promise<string | null> {
  try {
    const raw = await AsyncStorage.getItem(KEY)
    if (!raw) return null
    await AsyncStorage.removeItem(KEY)

    const parked = JSON.parse(raw) as Partial<Parked>
    if (typeof parked.code !== "string" || typeof parked.at !== "number") return null
    if (Math.floor(Date.now() / 1000) - parked.at > MAX_AGE_SECONDS) return null
    return parked.code
  } catch {
    return null
  }
}
