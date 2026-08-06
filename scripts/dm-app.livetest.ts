/**
 * Live two-app-instance DM test against the production Buzz relay.
 *
 * Where scripts/dm-live-test.mjs proves the *protocol* (a plain-Node port of the
 * crypto talking straight to the relay), this test proves the *app*: it stands
 * up two full instances of the app's chat stack — the real `NostrChatAdapter`
 * via `getNostrAdapter`, the real `RelayClient`, the real NIP-17/NIP-44 crypto,
 * the real store — as two members A and B, and walks the exact scenario the
 * recent app-level fixes addressed:
 *
 *   1. A opens a thread to B (`resolveChannel` on a raw pubkey) and sends a
 *      first-contact DM through `adapter.send` → `publishWrappedDm`.
 *   2. B — who has never had a thread with A — must *discover* the peer: the
 *      wrap unseals in `toMessage`, routes by the sender's pubkey, fires
 *      `onDiscovered`, and the thread is persisted via `rememberThread`.
 *   3. B replies; A must receive it into the existing thread, with no
 *      re-discovery.
 *   4. A cold-restarts (fresh module registry + fresh adapter, same device
 *      storage, same keys) and the whole conversation must backfill from the
 *      relay (self-copy wrap + incoming wrap).
 *
 * "Two app instances" is literal: each instance is created inside
 * `jest.isolateModulesAsync`, so it gets its own copies of every module-level
 * singleton (`RelayClient` socket, chat store, supabase client, directory
 * cache) — the same isolation two phones have. Device storage (Keychain via
 * expo-secure-store, AsyncStorage) is mocked per *device* and survives the
 * cold restart, exactly like a real reinstall-free relaunch.
 *
 * What is real and what is not:
 *   REAL      NostrChatAdapter (send/subscribeMessages/toMessage/resolveChannel/
 *             autoJoin/identity/capabilities), RelayClient (NIP-42 AUTH,
 *             subscription replay, publish acks), dm-send.ts, nip17/nip44/
 *             protocol, dm-discovery.ts, store.ts (ingestMessages,
 *             putLocalMessage, loadThreads/rememberThread), buzz.ts join
 *             pipeline, directory.ts registerChatIdentity (with a real
 *             authenticated supabase session), the production relay and the
 *             production https://aisocratic.org/api/buzz/join endpoint.
 *   MOCKED    expo-secure-store and AsyncStorage (in-memory per-device maps —
 *             they are native modules), plus whatever jest.setup.ts mocks.
 *   REPLICA   the ~4-line handler wiring that src/chat/index.ts's hooks do
 *             (onMessages→ingestMessages, onDiscovered→loadThreads+
 *             rememberThread, onPending→putLocalMessage). React hooks cannot
 *             run headless, so those closures are copied here verbatim; the
 *             hook layer itself (index.ts) is NOT exercised.
 *
 * Credentials (all resolvable automatically on the owner's machine):
 *   - Supabase URL + anon key: from this repo's .env (loaded by
 *     jest.live.setup.ts as EXPO_PUBLIC_API_URL / EXPO_PUBLIC_API_KEY).
 *   - Service-role key (to create/delete the two throwaway auth accounts):
 *     SUPABASE_SERVICE_ROLE_KEY env var, falling back to API_SERVICE_ROLE_KEY
 *     in ../website/.env.local.
 *
 * The test creates two throwaway confirmed-email auth users, lets each app
 * instance mint-and-claim its own membership through the app's auto-join, and
 * on teardown deletes the chat_identities rows and the auth users. Relay-side
 * residue (two member keys in the Buzz community, the stored gift wraps) has
 * no deletion API and is left behind — noted in the report it prints.
 *
 * Run:  npx jest -c jest.live.config.js --runInBand
 */

import { readFileSync } from "node:fs"
import { join as joinPath } from "node:path"

import type { ChatAdapter, ChatChannel, ChatMessage } from "@/chat/types"

/* ------------------------------------------------------- device storage --- */

type MockDevice = { secure: Map<string, string>; async: Map<string, string> }

/** Per-user "device" storage that survives a cold restart of an instance. */
const mockDevices = new Map<string, MockDevice>()

/**
 * The device whose storage the *next* isolated module registry captures.
 * The factories below run once per registry (i.e. once per app instance),
 * synchronously inside `jest.isolateModulesAsync`, while this is set.
 */
const mockActive: { device: MockDevice } = {
  device: { secure: new Map(), async: new Map() },
}

jest.mock("expo-secure-store", () => {
  const device = mockActive.device
  return {
    getItemAsync: async (key: string) => device.secure.get(key) ?? null,
    setItemAsync: async (key: string, value: string) => {
      device.secure.set(key, value)
    },
    deleteItemAsync: async (key: string) => {
      device.secure.delete(key)
    },
  }
})

jest.mock("@react-native-async-storage/async-storage", () => {
  const device = mockActive.device
  return {
    getItem: async (key: string) => device.async.get(key) ?? null,
    setItem: async (key: string, value: string) => {
      device.async.set(key, value)
    },
    removeItem: async (key: string) => {
      device.async.delete(key)
    },
    clear: async () => {
      device.async.clear()
    },
  }
})

/* ------------------------------------------------------------ wire tap --- */

type Frame = { at: number; instance: string; dir: "->" | "<-"; raw: string }

/** Every websocket frame either side exchanged with the relay, verbatim. */
const frames: Frame[] = []
const wsOwner = { current: "?" }

type WebSocketCtor = new (url: string) => WebSocket
let realWebSocket: WebSocketCtor

beforeAll(() => {
  const g = globalThis as unknown as { WebSocket: WebSocketCtor }
  realWebSocket = g.WebSocket
  g.WebSocket = class TappedWebSocket extends realWebSocket {
    constructor(url: string) {
      super(url)
      const owner = wsOwner.current
      this.addEventListener("message", (ev: MessageEvent) => {
        frames.push({ at: Date.now(), instance: owner, dir: "<-", raw: String(ev.data) })
      })
      const send = this.send.bind(this)
      this.send = (data: string) => {
        frames.push({ at: Date.now(), instance: owner, dir: "->", raw: String(data) })
        send(data)
      }
    }
  } as unknown as WebSocketCtor
})

afterAll(() => {
  ;(globalThis as unknown as { WebSocket: WebSocketCtor }).WebSocket = realWebSocket
})

/* ---------------------------------------------------------- credentials --- */

function parseEnvFile(path: string): Record<string, string> {
  const out: Record<string, string> = {}
  try {
    for (const line of readFileSync(path, "utf8").split("\n")) {
      const m = /^([A-Z0-9_]+)=(.*)$/.exec(line.trim())
      if (m) out[m[1]] = m[2]
    }
  } catch {
    /* absent file: caller decides whether that is fatal */
  }
  return out
}

function config() {
  const url = process.env.EXPO_PUBLIC_API_URL
  const anonKey = process.env.EXPO_PUBLIC_API_KEY
  if (!url || !anonKey) throw new Error("EXPO_PUBLIC_API_URL / EXPO_PUBLIC_API_KEY missing — is .env present?")

  const serviceKey =
    process.env.SUPABASE_SERVICE_ROLE_KEY ||
    parseEnvFile(joinPath(__dirname, "..", "..", "website", ".env.local")).API_SERVICE_ROLE_KEY
  if (!serviceKey) {
    throw new Error(
      "No service-role key. Set SUPABASE_SERVICE_ROLE_KEY, or make ../website/.env.local (API_SERVICE_ROLE_KEY) readable.",
    )
  }
  return { url, anonKey, serviceKey }
}

/* -------------------------------------------------- throwaway auth users --- */

type TestUser = {
  name: string
  id: string
  email: string
  accessToken: string
  refreshToken: string
}

async function adminFetch(path: string, init: RequestInit): Promise<Response> {
  const { url, serviceKey } = config()
  return fetch(`${url}${path}`, {
    ...init,
    headers: {
      apikey: serviceKey,
      authorization: `Bearer ${serviceKey}`,
      "content-type": "application/json",
      ...(init.headers ?? {}),
    },
  })
}

async function createThrowawayUser(name: string): Promise<TestUser> {
  const { url, anonKey } = config()
  const email = `dm-livetest-${Date.now()}-${name.toLowerCase()}@aisocratic.org`
  const password = `LiveTest!${Math.random().toString(36).slice(2)}${Date.now()}`

  const created = await adminFetch("/auth/v1/admin/users", {
    method: "POST",
    body: JSON.stringify({ email, password, email_confirm: true }),
  })
  const createdBody = (await created.json()) as { id?: string; msg?: string; message?: string }
  if (!created.ok || !createdBody.id) {
    throw new Error(`admin create user ${name}: HTTP ${created.status} ${JSON.stringify(createdBody)}`)
  }

  const signIn = await fetch(`${url}/auth/v1/token?grant_type=password`, {
    method: "POST",
    headers: { apikey: anonKey, "content-type": "application/json" },
    body: JSON.stringify({ email, password }),
  })
  const session = (await signIn.json()) as { access_token?: string; refresh_token?: string }
  if (!signIn.ok || !session.access_token || !session.refresh_token) {
    throw new Error(`password sign-in ${name}: HTTP ${signIn.status} ${JSON.stringify(session)}`)
  }

  return {
    name,
    id: createdBody.id,
    email,
    accessToken: session.access_token,
    refreshToken: session.refresh_token,
  }
}

/* -------------------------------------------------------- app instances --- */

type StoreModule = typeof import("@/chat/store")

type AppInstance = {
  name: string
  userId: string
  adapter: ChatAdapter & { destroy(): void }
  store: StoreModule
  destroy: () => void
}

/**
 * Boot one app instance: a fresh module registry (fresh RelayClient socket,
 * fresh store, fresh supabase client) bound to this user's device storage,
 * with the user's real Supabase session installed before the adapter is
 * constructed — exactly the state a signed-in app process starts from.
 */
async function startInstance(name: string, user: TestUser): Promise<AppInstance> {
  const device = mockDevices.get(user.id) ?? { secure: new Map(), async: new Map() }
  mockDevices.set(user.id, device)

  let instance!: AppInstance
  await jest.isolateModulesAsync(async () => {
    mockActive.device = device
    wsOwner.current = name

    const { supabase } = require("@/lib/supabase") as typeof import("@/lib/supabase")
    const { error } = await supabase.auth.setSession({
      access_token: user.accessToken,
      refresh_token: user.refreshToken,
    })
    if (error) throw new Error(`setSession(${name}): ${error.message}`)

    const { getNostrAdapter } = require("@/chat/nostr") as typeof import("@/chat/nostr")
    const store = require("@/chat/store") as StoreModule
    // NostrChatAdapter has destroy(); the narrow ChatAdapter type omits it.
    const adapter = getNostrAdapter(user.id) as ChatAdapter & { destroy(): void }

    instance = {
      name,
      userId: user.id,
      adapter,
      store,
      destroy: () => {
        adapter.destroy()
        supabase.auth.stopAutoRefresh()
      },
    }
  })
  wsOwner.current = "?"
  return instance
}

/* ------------------------------------------------------- feed plumbing --- */

type FeedState = {
  ready: boolean
  error: string | null
  discovered: ChatChannel[]
  received: { at: number; message: ChatMessage }[]
  close: () => void
}

/**
 * Open the message subscription the way `useMessageFeed` (src/chat/index.ts)
 * does, with its exact handler wiring — the only part of the hook layer this
 * headless test has to replicate rather than execute.
 */
function openFeed(inst: AppInstance, channels: ChatChannel[], limitPerChannel: number): FeedState {
  const state: FeedState = {
    ready: false,
    error: null,
    discovered: [],
    received: [],
    close: () => {},
  }
  const sub = inst.adapter.subscribeMessages(
    channels,
    {
      onMessages: (messages) => {
        const at = Date.now()
        for (const message of messages) state.received.push({ at, message })
        inst.store.ingestMessages(messages)
      },
      onReady: () => {
        state.ready = true
      },
      onError: (message) => {
        state.error = message
      },
      onDiscovered: (channel) => {
        state.discovered.push(channel)
        void inst.store.loadThreads(inst.userId).then(() => inst.store.rememberThread(inst.userId, channel))
      },
    },
    limitPerChannel,
  )
  state.close = () => sub.close()
  return state
}

/** Discover the community's NIP-29 rooms like `useChannels` does. */
async function discoverRooms(inst: AppInstance, settleMs = 1500, timeoutMs = 15000): Promise<ChatChannel[]> {
  return new Promise((resolve) => {
    let latest: ChatChannel[] = []
    let settle: ReturnType<typeof setTimeout> | null = null
    let done = false
    const finish = () => {
      if (done) return
      done = true
      clearTimeout(timer)
      if (settle) clearTimeout(settle)
      // Close asynchronously: `sub` is assigned after subscribeChannels returns.
      setTimeout(() => sub.close(), 0)
      resolve(latest)
    }
    const timer = setTimeout(finish, timeoutMs)
    const sub = inst.adapter.subscribeChannels((rooms) => {
      latest = rooms
      if (settle) clearTimeout(settle)
      settle = setTimeout(finish, settleMs)
    })
  })
}

async function until(label: string, cond: () => boolean, timeoutMs = 20000): Promise<void> {
  const start = Date.now()
  while (!cond()) {
    if (Date.now() - start > timeoutMs) throw new Error(`Timed out waiting for: ${label}`)
    await new Promise((r) => setTimeout(r, 50))
  }
}

/* ------------------------------------------------------------ scenario --- */

const ctx: {
  users: TestUser[]
  A?: AppInstance
  B?: AppInstance
  A2?: AppInstance
  feedA?: FeedState
  feedB?: FeedState
  feedA2?: FeedState
  pkA?: string
  pkB?: string
  threadAtoB?: ChatChannel
  msg1?: string
  msg2?: string
  latencies: Record<string, number>
  cleanup: string[]
} = { users: [], latencies: {}, cleanup: [] }

beforeAll(async () => {
  config() // fail fast with a clear message when credentials are missing
  const [a, b] = await Promise.all([createThrowawayUser("A"), createThrowawayUser("B")])
  ctx.users = [a, b]
}, 60_000)

afterAll(async () => {
  for (const feed of [ctx.feedA, ctx.feedB, ctx.feedA2]) feed?.close()
  for (const inst of [ctx.A, ctx.B, ctx.A2]) {
    try {
      inst?.destroy()
    } catch {
      /* already down */
    }
  }

  // ---- Supabase cleanup: chat_identities rows, then the auth users. ----
  if (ctx.users.length) {
    const ids = ctx.users.map((u) => u.id)
    try {
      const del = await adminFetch(`/rest/v1/chat_identities?user_id=in.(${ids.join(",")})`, {
        method: "DELETE",
        headers: { prefer: "return=representation" },
      })
      const rows = (await del.json().catch(() => [])) as unknown[]
      ctx.cleanup.push(
        `chat_identities delete: HTTP ${del.status}, removed ${Array.isArray(rows) ? rows.length : "?"} row(s)`,
      )
    } catch (e) {
      ctx.cleanup.push(`chat_identities delete FAILED: ${String(e)}`)
    }

    for (const user of ctx.users) {
      try {
        const del = await adminFetch(`/auth/v1/admin/users/${user.id}`, { method: "DELETE" })
        ctx.cleanup.push(`auth user ${user.name} (${user.email}) delete: HTTP ${del.status}`)
      } catch (e) {
        ctx.cleanup.push(`auth user ${user.name} delete FAILED: ${String(e)}`)
      }
    }

    try {
      const check = await adminFetch(`/rest/v1/chat_identities?user_id=in.(${ids.join(",")})&select=user_id`, {
        method: "GET",
      })
      const rows = (await check.json()) as unknown[]
      ctx.cleanup.push(`chat_identities residue check: ${Array.isArray(rows) ? rows.length : "?"} row(s) remain`)
    } catch {
      ctx.cleanup.push("chat_identities residue check failed")
    }
  }
  ctx.cleanup.push(
    "relay residue (no deletion API): 2 member keys remain in the Buzz community; the test's gift wraps remain stored on the relay",
  )

  // ---- Report: verbatim relay verdicts, latencies, store state. ----
  const verdicts = frames.filter(
    (f) => f.raw.startsWith('["OK"') || f.raw.startsWith('["CLOSED"') || f.raw.startsWith('["NOTICE"'),
  )
  const lines = [
    "================ LIVE DM TEST REPORT ================",
    `users: ${ctx.users.map((u) => `${u.name}=${u.id} <${u.email}>`).join("  ")}`,
    `pubkeys: A=${ctx.pkA ?? "?"} B=${ctx.pkB ?? "?"}`,
    "",
    "--- relay verdict frames (verbatim) ---",
    ...verdicts.map((f) => `${new Date(f.at).toISOString()} [${f.instance} ${f.dir}] ${f.raw}`),
    "",
    "--- latencies (ms) ---",
    ...Object.entries(ctx.latencies).map(([k, v]) => `${k}: ${v}`),
    "",
    "--- store state ---",
    ...[ctx.A, ctx.B, ctx.A2]
      .filter((i): i is AppInstance => !!i)
      .flatMap((i) => {
        const threads = i.store.getThreads()
        const byThread = threads.map((t) => {
          const msgs = i.store.getChannelMessages(t.id)
          return `  [${i.name}] thread ${t.id.slice(0, 12)}… (${t.name}): ${msgs
            .map((m) => `${m.mine ? "me" : m.authorId.slice(0, 8)}: "${m.body}"${m.pending ? " (pending)" : ""}${m.failed ? " (failed)" : ""}`)
            .join(" | ")}`
        })
        return [`[${i.name}] threads=${threads.length}`, ...byThread]
      }),
    "",
    "--- cleanup ---",
    ...ctx.cleanup.map((c) => `  ${c}`),
    "=====================================================",
  ]
  // eslint-disable-next-line no-console
  console.log(lines.join("\n"))
}, 60_000)

test("both app instances come up and join the community through the app's auto-join", async () => {
  const [userA, userB] = ctx.users
  ctx.A = await startInstance("A", userA)
  ctx.B = await startInstance("B", userB)

  for (const inst of [ctx.A, ctx.B]) {
    wsOwner.current = inst.name
    const t0 = Date.now()
    const result = await inst.adapter.autoJoin(true)
    ctx.latencies[`${inst.name} auto-join (mint+claim+reconnect)`] = Date.now() - t0
    expect(["joined", "already_member"]).toContain(result.status)
  }
  wsOwner.current = "?"

  const idA = await ctx.A.adapter.identity()
  const idB = await ctx.B.adapter.identity()
  ctx.pkA = idA.pubkey
  ctx.pkB = idB.pubkey
  expect(idA.pubkey).toMatch(/^[0-9a-f]{64}$/)
  expect(idB.pubkey).toMatch(/^[0-9a-f]{64}$/)
  expect(idA.pubkey).not.toBe(idB.pubkey)
  // Fresh device: the key was generated this boot and persisted to the mock
  // Keychain; the directory row was written under a real authenticated session.
  expect(idA.source).toBe("created")
  expect(idA.registered).toBe(true)
  expect(idB.registered).toBe(true)
})

test("A's first-contact DM reaches B, which discovers the peer and persists the thread", async () => {
  const { A, B, pkA, pkB } = ctx
  if (!A || !B || !pkA || !pkB) throw new Error("previous step failed")

  // B comes up the way the chat tab does: discover the community rooms, then
  // open one subscription over them (the NIP-17 wrap filter rides along).
  wsOwner.current = "B"
  const roomsB = await discoverRooms(B)
  ctx.feedB = openFeed(B, roomsB, 50)
  await until("B feed ready (EOSE after AUTH)", () => ctx.feedB!.ready)
  expect(B.store.getChannelMessages(pkA)).toHaveLength(0)
  expect(B.store.getThreads()).toHaveLength(0)

  // A opens a conversation with B by pubkey — the same route id the app uses —
  // and remembers the thread like useChannel does.
  wsOwner.current = "A"
  const thread = await A.adapter.resolveChannel(pkB)
  if (!thread) throw new Error("resolveChannel(pkB) returned null")
  ctx.threadAtoB = thread
  expect(thread.kind).toBe("dm")
  expect(thread.address).toBe(pkB)
  await A.store.loadThreads(A.userId)
  A.store.rememberThread(A.userId, thread)

  ctx.feedA = openFeed(A, [thread], 50)
  await until("A feed ready", () => ctx.feedA!.ready)

  // Send. Wiring identical to useSendMessage.
  ctx.msg1 = `app-live first contact ${new Date().toISOString()}`
  const t0 = Date.now()
  const confirmed = await A.adapter.send(thread, ctx.msg1, (pending) => A.store.putLocalMessage(pending))
  ctx.latencies["msg1 publish acked (A)"] = Date.now() - t0
  A.store.putLocalMessage(confirmed)

  // B must receive, decrypt, and discover the peer.
  await until("B receives msg1", () => B.store.getChannelMessages(pkA).some((m) => m.body === ctx.msg1))
  const arrival = ctx.feedB!.received.find((r) => r.message.body === ctx.msg1)
  ctx.latencies["msg1 send -> visible in B's store"] = (arrival?.at ?? Date.now()) - t0

  const received = B.store.getChannelMessages(pkA).find((m) => m.body === ctx.msg1)!
  expect(received.authorId).toBe(pkA)
  expect(received.channelId).toBe(pkA)
  expect(received.mine).toBe(false)

  // onDiscovered fired exactly once, with the peer-keyed channel, and the
  // thread was persisted.
  expect(ctx.feedB!.discovered.map((c) => c.id)).toEqual([pkA])
  await until("B persists discovered thread", () =>
    B.store.getThreads().some((t) => t.id === pkA && t.address === pkA),
  )

  // A's own store shows the message confirmed (optimistic row replaced).
  const mine = A.store.getChannelMessages(thread.id).find((m) => m.body === ctx.msg1)!
  expect(mine.mine).toBe(true)
  expect(mine.pending).toBeFalsy()
  expect(mine.failed).toBeFalsy()

  // The relay's verbatim OK for a kind-1059 wrap published by A.
  const okFrames = frames.filter((f) => f.dir === "<-" && f.raw.startsWith('["OK"'))
  expect(okFrames.length).toBeGreaterThan(0)
})

test("B's reply arrives in A's existing thread without re-discovery", async () => {
  const { A, B, pkA, pkB, threadAtoB } = ctx
  if (!A || !B || !pkA || !pkB || !threadAtoB) throw new Error("previous step failed")

  const threadBtoA = B.store.getThreads().find((t) => t.id === pkA)
  if (!threadBtoA) throw new Error("B has no discovered thread for A")

  // Rumor timestamps are unix *seconds* and the store orders equal-second
  // messages by id (see store.ts byTime). Reply in a later second so the
  // ordering assertion below tests chronology, not the tie-break.
  await new Promise((r) => setTimeout(r, 1100))

  wsOwner.current = "B"
  ctx.msg2 = `app-live reply ${new Date().toISOString()}`
  const t0 = Date.now()
  const confirmed = await B.adapter.send(threadBtoA, ctx.msg2, (pending) => B.store.putLocalMessage(pending))
  ctx.latencies["msg2 publish acked (B)"] = Date.now() - t0
  B.store.putLocalMessage(confirmed)

  await until("A receives msg2", () =>
    A.store.getChannelMessages(threadAtoB.id).some((m) => m.body === ctx.msg2),
  )
  const arrival = ctx.feedA!.received.find((r) => r.message.body === ctx.msg2)
  ctx.latencies["msg2 send -> visible in A's store"] = (arrival?.at ?? Date.now()) - t0

  const received = A.store.getChannelMessages(threadAtoB.id).find((m) => m.body === ctx.msg2)!
  expect(received.authorId).toBe(pkB)
  expect(received.mine).toBe(false)
  // The reply landed in the thread A already had — no first-contact discovery.
  expect(ctx.feedA!.discovered).toHaveLength(0)

  // A's thread now holds the whole conversation, in order.
  const bodies = A.store.getChannelMessages(threadAtoB.id).map((m) => m.body)
  expect(bodies.indexOf(ctx.msg1!)).toBeLessThan(bodies.indexOf(ctx.msg2!))
})

test("A cold-restarts with the same keys and the conversation backfills from the relay", async () => {
  const { A, pkA, pkB, msg1, msg2 } = ctx
  if (!A || !pkA || !pkB || !msg1 || !msg2) throw new Error("previous step failed")

  // Shut instance A down completely; its in-memory store dies with it.
  ctx.feedA?.close()
  A.destroy()

  // Same user, same device storage, brand-new process (module registry).
  const t0 = Date.now()
  ctx.A2 = await startInstance("A2", ctx.users[0])
  const A2 = ctx.A2

  const idA2 = await A2.adapter.identity()
  expect(idA2.pubkey).toBe(pkA) // key came back from the (mock) Keychain
  expect(idA2.source).toBe("stored")

  // Cold start: nothing in memory…
  expect(A2.store.getChannelMessages(pkB)).toHaveLength(0)
  // …but the thread list was persisted on the device…
  const threads = await A2.store.loadThreads(A2.userId)
  expect(threads.some((t) => t.id === pkB)).toBe(true)

  // …and the relay backfills the messages (self-copy wrap + B's wrap).
  ctx.feedA2 = openFeed(A2, threads, 60)
  await until("A2 feed ready", () => ctx.feedA2!.ready)
  await until(
    "A2 backfills both messages",
    () => {
      const bodies = A2.store.getChannelMessages(pkB).map((m) => m.body)
      return bodies.includes(msg1) && bodies.includes(msg2)
    },
    30_000,
  )
  ctx.latencies["A cold restart -> both messages backfilled"] = Date.now() - t0

  const messages = A2.store.getChannelMessages(pkB)
  const m1 = messages.find((m) => m.body === msg1)!
  const m2 = messages.find((m) => m.body === msg2)!
  expect(m1.mine).toBe(true) // read back from A's own self-copy wrap
  expect(m2.mine).toBe(false)
  expect(m2.authorId).toBe(pkB)
  const bodies = messages.map((m) => m.body)
  expect(bodies.indexOf(msg1)).toBeLessThan(bodies.indexOf(msg2))
})
