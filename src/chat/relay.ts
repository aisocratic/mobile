/**
 * A minimal, resilient Nostr relay connection.
 *
 * Speaks the NIP-01 wire protocol over a single WebSocket:
 *   client -> ["EVENT", <event>] | ["REQ", <subId>, ...filters] | ["CLOSE", <subId>]
 *   relay  -> ["EVENT", <subId>, <event>] | ["OK", <id>, <ok>, <msg>]
 *             ["EOSE", <subId>] | ["CLOSED", <subId>, <msg>] | ["NOTICE", <msg>]
 *             ["AUTH", <challenge>]                                    (NIP-42)
 *
 * This is exactly what a Buzz relay speaks, so the same client works against
 * `wss://<your-buzz-host>` unchanged.
 *
 * Design rules:
 *  - Never throw at the caller for connectivity problems. The socket being down
 *    is a *state* (`offline`), surfaced through `onStatus`, not an exception.
 *  - Subscriptions are declarative: they are stored and re-issued verbatim on
 *    every reconnect, so callers never have to resubscribe by hand.
 *  - Reconnect with exponential backoff plus jitter, capped, forever.
 */

import type { ChatConnectionStatus } from "./types"
import { finalizeEvent, isNostrEvent, KIND_AUTH, type NostrEvent, type NostrFilter } from "./protocol"

type SubHandlers = {
  onEvent: (event: NostrEvent) => void
  onEose?: () => void
  onError?: (message: string) => void
}

type Sub = SubHandlers & { filters: NostrFilter[] }

const BASE_BACKOFF_MS = 1000
const MAX_BACKOFF_MS = 30000
const PUBLISH_TIMEOUT_MS = 10000
const OPEN_WAIT_MS = 8000

export class RelayClient {
  readonly url: string

  private ws: WebSocket | null = null
  private currentStatus: ChatConnectionStatus = "offline"
  private statusListeners = new Set<(status: ChatConnectionStatus) => void>()
  private subs = new Map<string, Sub>()
  private acks = new Map<string, { resolve: () => void; reject: (e: Error) => void }>()
  private attempt = 0
  private reconnectTimer: ReturnType<typeof setTimeout> | null = null
  private subCounter = 0
  private stopped = false

  /**
   * NIP-42 state for closed relays.
   *  none  — relay never challenged us (open relay); subscriptions go straight out.
   *  pending — challenge answered, waiting for the OK.
   *  ok    — authenticated; queued subscriptions have been replayed.
   *  denied — the relay refused our key. On Buzz this means "not a member",
   *           which no amount of reconnecting will fix.
   */
  private authState: "none" | "pending" | "ok" | "denied" = "none"
  private pendingAuthEventId: string | null = null
  private authDenialReason: string | null = null

  /**
   * Supplies the secret key used to answer a NIP-42 AUTH challenge. Public
   * relays never ask; Buzz relays and other gated deployments do.
   */
  private authSigner: (() => Promise<Uint8Array | null>) | null = null

  constructor(url: string) {
    this.url = url
  }

  setAuthSigner(signer: () => Promise<Uint8Array | null>) {
    this.authSigner = signer
  }

  /* ------------------------------------------------------------- status */

  status(): ChatConnectionStatus {
    return this.currentStatus
  }

  onStatus(listener: (status: ChatConnectionStatus) => void): () => void {
    this.statusListeners.add(listener)
    return () => {
      this.statusListeners.delete(listener)
    }
  }

  private setStatus(next: ChatConnectionStatus) {
    if (this.currentStatus === next) return
    this.currentStatus = next
    for (const listener of this.statusListeners) {
      try {
        listener(next)
      } catch {
        /* a bad listener must not take the socket down */
      }
    }
  }

  /* --------------------------------------------------------- connection */

  connect() {
    this.stopped = false
    if (this.ws || this.reconnectTimer) return
    this.open()
  }

  private open() {
    if (this.stopped) return
    this.setStatus("connecting")

    let socket: WebSocket
    try {
      socket = new WebSocket(this.url)
    } catch {
      // A malformed URL shouldn't crash the app — treat it as a dead relay.
      this.setStatus("offline")
      this.scheduleReconnect()
      return
    }
    this.ws = socket

    socket.onopen = () => {
      if (this.ws !== socket) return
      this.attempt = 0
      // A fresh socket is a fresh auth session — the relay has no memory of us.
      this.authState = "none"
      this.pendingAuthEventId = null
      this.setStatus("live")
      // Open relays accept these immediately. Closed relays answer
      // "auth-required" and we replay them once AUTH succeeds.
      for (const [id, sub] of this.subs) this.sendRaw(["REQ", id, ...sub.filters])
    }

    socket.onmessage = (ev: WebSocketMessageEvent) => {
      if (this.ws !== socket) return
      this.handleMessage(ev.data)
    }

    socket.onerror = () => {
      // RN fires error then close; the close handler does the reconnecting.
      // Swallowing here is what keeps an unreachable relay from crashing us.
    }

    socket.onclose = () => {
      if (this.ws !== socket) return
      this.ws = null
      this.failPendingAcks("Relay connection closed.")
      this.setStatus("offline")
      this.scheduleReconnect()
    }
  }

  private scheduleReconnect() {
    if (this.stopped || this.reconnectTimer) return
    const backoff = Math.min(BASE_BACKOFF_MS * 2 ** this.attempt, MAX_BACKOFF_MS)
    // Jitter keeps every client on the network from reconnecting in lockstep.
    const delay = backoff * (0.5 + Math.random() * 0.5)
    this.attempt += 1
    this.reconnectTimer = setTimeout(() => {
      this.reconnectTimer = null
      this.open()
    }, delay)
  }

  /**
   * Force an immediate reconnect. Used after an invite claim succeeds: the key
   * the relay just refused is now a member, and waiting out the backoff would
   * leave the user staring at "not a member" after a successful join.
   */
  reconnectNow() {
    this.resetAuth()
    if (this.reconnectTimer) {
      clearTimeout(this.reconnectTimer)
      this.reconnectTimer = null
    }
    this.attempt = 0
    const socket = this.ws
    this.ws = null
    try {
      socket?.close()
    } catch {
      /* already gone */
    }
    this.stopped = false
    this.open()
  }

  /** Tear the connection down for good (app-level shutdown). */
  destroy() {
    this.stopped = true
    if (this.reconnectTimer) clearTimeout(this.reconnectTimer)
    this.reconnectTimer = null
    this.subs.clear()
    this.failPendingAcks("Relay client shut down.")
    const socket = this.ws
    this.ws = null
    try {
      socket?.close()
    } catch {
      /* already gone */
    }
    this.setStatus("offline")
  }

  /* ----------------------------------------------------------- messages */

  private handleMessage(raw: unknown) {
    if (typeof raw !== "string") return

    let msg: unknown
    try {
      msg = JSON.parse(raw)
    } catch {
      return
    }
    if (!Array.isArray(msg) || typeof msg[0] !== "string") return

    switch (msg[0]) {
      case "EVENT": {
        const sub = this.subs.get(String(msg[1]))
        if (sub && isNostrEvent(msg[2])) sub.onEvent(msg[2])
        break
      }
      case "EOSE": {
        this.subs.get(String(msg[1]))?.onEose?.()
        break
      }
      case "CLOSED": {
        const id = String(msg[1])
        const reason = String(msg[2] ?? "Subscription closed by relay.")
        // A closed relay rejects subscriptions sent before AUTH completes.
        // That is expected choreography, not an error: keep the subscription
        // registered so it replays once we are authenticated.
        if (reason.startsWith("auth-required")) break
        this.subs.get(id)?.onError?.(reason)
        this.subs.delete(id)
        break
      }
      case "OK": {
        const id = String(msg[1])

        // The OK for our own AUTH event decides whether we're a member.
        if (id === this.pendingAuthEventId) {
          this.pendingAuthEventId = null
          if (msg[2] === true) {
            this.authState = "ok"
            this.authDenialReason = null
            this.setStatus("live")
            // Everything queued before AUTH was refused; send it again.
            for (const [subId, sub] of this.subs) this.sendRaw(["REQ", subId, ...sub.filters])
          } else {
            const reason = String(msg[3] || "Relay refused authentication.")
            this.authState = "denied"
            this.authDenialReason = reason
            // "restricted: not a relay member" is a membership problem, and
            // reconnecting forever would just hammer the relay. Surface it.
            this.setStatus(reason.includes("not a relay member") ? "not-a-member" : "offline")
            this.failPendingAcks(reason)
          }
          break
        }

        const ack = this.acks.get(id)
        if (!ack) break
        this.acks.delete(id)
        if (msg[2] === true) ack.resolve()
        else ack.reject(new Error(String(msg[3] || "Relay rejected the message.")))
        break
      }
      case "AUTH": {
        void this.answerAuth(String(msg[1] ?? ""))
        break
      }
      default:
        // NOTICE and anything newer than us: nothing useful to do.
        break
    }
  }

  /**
   * NIP-42: prove key ownership by signing a kind-22242 event that echoes the
   * relay's challenge back, bound to this relay's URL.
   */
  private async answerAuth(challenge: string) {
    if (!challenge || !this.authSigner) return
    this.authState = "pending"
    this.setStatus("authenticating")
    try {
      const sk = await this.authSigner()
      if (!sk) return
      const event = finalizeEvent(
        {
          created_at: Math.floor(Date.now() / 1000),
          kind: KIND_AUTH,
          tags: [
            // The relay matches this against the bare WS origin it was reached
            // on (`nip42_expected_relay_url` -> `wss://{host}`, no path), so
            // `this.url` must stay the plain connect URL.
            ["relay", this.url],
            ["challenge", challenge],
          ],
          content: "",
        },
        sk,
      )
      this.pendingAuthEventId = event.id
      this.sendRaw(["AUTH", event])
    } catch {
      // Auth is best-effort: an open relay does not need it and a gated one
      // will simply keep refusing, which surfaces as an empty channel.
      this.authState = "none"
    }
  }

  /** True once a closed relay has accepted us, or when none was required. */
  isAuthenticated(): boolean {
    return this.authState === "ok" || this.authState === "none"
  }

  /** The relay's own words when it refused our key, for honest UI copy. */
  authDenial(): string | null {
    return this.authDenialReason
  }

  /**
   * Drop the cached auth verdict so the next connection re-attempts AUTH.
   * Called after a successful invite claim, when the same key that was just
   * refused is now a member.
   */
  resetAuth() {
    this.authState = "none"
    this.authDenialReason = null
    this.pendingAuthEventId = null
  }

  private sendRaw(payload: unknown[]): boolean {
    const socket = this.ws
    if (!socket || socket.readyState !== 1 /* OPEN */) return false
    try {
      socket.send(JSON.stringify(payload))
      return true
    } catch {
      return false
    }
  }

  private failPendingAcks(reason: string) {
    for (const ack of this.acks.values()) ack.reject(new Error(reason))
    this.acks.clear()
  }

  /* ------------------------------------------------------ subscriptions */

  /**
   * Register a subscription. It is sent immediately if the socket is up and
   * automatically re-sent after every reconnect until `close()` is called.
   */
  subscribe(filters: NostrFilter[], handlers: SubHandlers): { close: () => void } {
    this.connect()
    this.subCounter += 1
    const id = `s${this.subCounter}`
    this.subs.set(id, { ...handlers, filters })
    this.sendRaw(["REQ", id, ...filters])

    let closed = false
    return {
      close: () => {
        if (closed) return
        closed = true
        this.subs.delete(id)
        this.sendRaw(["CLOSE", id])
      },
    }
  }

  /* ----------------------------------------------------------- publish */

  /** Ready to send = socket open *and* past the relay's auth gate. */
  private isReady(): boolean {
    return this.currentStatus === "live" && this.isAuthenticated()
  }

  private waitForReady(timeoutMs: number): Promise<boolean> {
    if (this.isReady()) return Promise.resolve(true)
    return new Promise((resolve) => {
      const timer = setTimeout(() => {
        off()
        resolve(false)
      }, timeoutMs)
      const off = this.onStatus(() => {
        // A denied relay will never become ready; fail fast instead of
        // burning the full timeout on every send.
        if (this.authState === "denied") {
          clearTimeout(timer)
          off()
          resolve(false)
          return
        }
        if (!this.isReady()) return
        clearTimeout(timer)
        off()
        resolve(true)
      })
    })
  }

  /** Publish an event and resolve once the relay ACKs it with `OK … true`. */
  async publish(event: NostrEvent): Promise<void> {
    this.connect()
    const ready = await this.waitForReady(OPEN_WAIT_MS)
    if (!ready) {
      throw new Error(this.authDenialReason ?? "Relay is unreachable.")
    }

    return new Promise<void>((resolve, reject) => {
      const timer = setTimeout(() => {
        this.acks.delete(event.id)
        reject(new Error("Relay did not acknowledge the message."))
      }, PUBLISH_TIMEOUT_MS)

      this.acks.set(event.id, {
        resolve: () => {
          clearTimeout(timer)
          resolve()
        },
        reject: (e) => {
          clearTimeout(timer)
          reject(e)
        },
      })

      if (!this.sendRaw(["EVENT", event])) {
        clearTimeout(timer)
        this.acks.delete(event.id)
        reject(new Error("Relay is unreachable."))
      }
    })
  }

  /** Fire-and-forget publish for idempotent bookkeeping events. */
  publishQuietly(event: NostrEvent) {
    void this.publish(event).catch(() => {
      /* room-create and profile events are not worth surfacing */
    })
  }
}
