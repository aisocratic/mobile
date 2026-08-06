/**
 * Live end-to-end DM test against the real Buzz relay.
 *
 * Reproduces, in plain Node, exactly what the app does end to end:
 *   1. two fresh keypairs A and B
 *   2. join both to the community via the auto-join endpoint (needs two
 *      Supabase access tokens — see env below)
 *   3. connect both, complete NIP-42 AUTH
 *   4. A sends B a NIP-17 gift-wrapped DM the way src/chat/dm-send.ts does
 *      (recipient wrap awaited, self wrap after; current timestamps, jitter on)
 *   5. B listens with the app's exact filter (kinds:[1059], "#p":[B]) and a
 *      no-#p control; every OK/CLOSED/NOTICE/EVENT is printed verbatim
 *   6. probes: publish before AUTH, wrap addressed to a non-member key,
 *      subscribe before AUTH, filter with/without #p
 *
 * The crypto here is a line-for-line port of src/chat/protocol.ts,
 * src/chat/nip44.ts and src/chat/nip17.ts onto the same @noble primitives,
 * with expo-crypto's getRandomBytes swapped for node:crypto.
 *
 * Env:
 *   RELAY      wss URL           (default: the app's EXPO_PUBLIC_NOSTR_RELAY)
 *   JOIN_URL   auto-join POST    (default: the app's EXPO_PUBLIC_BUZZ_JOIN_URL)
 *   JWT_A, JWT_B    Supabase access tokens for two accounts, or
 *   JWT_A_FILE, JWT_B_FILE   paths to files containing them
 *   SK_A, SK_B      hex secret keys to reuse instead of generating (skips join
 *                   when the key is already a member)
 *   SKIP_JOIN=1     don't call the join endpoint (keys must already be members)
 *
 * Run from the repo root so @noble resolves:  node scripts/dm-live-test.mjs
 */

import { randomBytes } from "node:crypto"
import { readFileSync } from "node:fs"

import { chacha20 } from "@noble/ciphers/chacha.js"
import { schnorr, secp256k1 } from "@noble/curves/secp256k1.js"
import { extract as hkdfExtract, expand as hkdfExpand } from "@noble/hashes/hkdf.js"
import { hmac } from "@noble/hashes/hmac.js"
import { sha256 } from "@noble/hashes/sha2.js"
import { bytesToHex, concatBytes, hexToBytes, utf8ToBytes } from "@noble/hashes/utils.js"
import { base64 } from "@scure/base"

/* ----------------------------------------------------------------- config */

const RELAY = process.env.RELAY || "wss://aisocratic.communities.buzz.xyz"
const JOIN_URL = process.env.JOIN_URL || "https://aisocratic.org/api/buzz/join"
const HTTP_ORIGIN = RELAY.replace(/^wss:\/\//, "https://")

const log = (...args) => console.log(new Date().toISOString().slice(11, 23), ...args)

/* ------------------------------------------------- protocol.ts equivalents */

const serializeEvent = (e) => JSON.stringify([0, e.pubkey, e.created_at, e.kind, e.tags, e.content])
const eventId = (e) => bytesToHex(sha256(utf8ToBytes(serializeEvent(e))))
const getPublicKey = (sk) => bytesToHex(schnorr.getPublicKey(sk))

function finalizeEvent(draft, sk) {
  const unsigned = { ...draft, pubkey: getPublicKey(sk) }
  const id = eventId(unsigned)
  return { ...unsigned, id, sig: bytesToHex(schnorr.sign(hexToBytes(id), sk)) }
}

function nip98AuthHeader(sk, url, method, body) {
  const tags = [["u", url], ["method", method]]
  if (body !== undefined) tags.push(["payload", bytesToHex(sha256(utf8ToBytes(body)))])
  const event = finalizeEvent(
    { created_at: Math.floor(Date.now() / 1000), kind: 27235, tags, content: "" },
    sk,
  )
  return `Nostr ${base64.encode(utf8ToBytes(JSON.stringify(event)))}`
}

/* --------------------------------------------------- nip44.ts equivalents */

const SALT = utf8ToBytes("nip44-v2")

function conversationKey(sk, theirPubkeyHex) {
  const shared = secp256k1.getSharedSecret(sk, hexToBytes(`02${theirPubkeyHex}`)).subarray(1, 33)
  return hkdfExtract(sha256, shared, SALT)
}

function messageKeys(convKey, nonce) {
  const keys = hkdfExpand(sha256, convKey, nonce, 76)
  return { chachaKey: keys.subarray(0, 32), chachaNonce: keys.subarray(32, 44), hmacKey: keys.subarray(44, 76) }
}

function calcPaddedLen(len) {
  if (len <= 32) return 32
  const nextPower = 1 << (Math.floor(Math.log2(len - 1)) + 1)
  const chunk = nextPower <= 256 ? 32 : nextPower / 8
  return chunk * (Math.floor((len - 1) / chunk) + 1)
}

function pad(plaintext) {
  const bytes = utf8ToBytes(plaintext)
  const prefix = new Uint8Array(2)
  new DataView(prefix.buffer).setUint16(0, bytes.length, false)
  return concatBytes(prefix, bytes, new Uint8Array(calcPaddedLen(bytes.length) - bytes.length))
}

function unpad(padded) {
  const declared = new DataView(padded.buffer, padded.byteOffset, padded.byteLength).getUint16(0, false)
  return new TextDecoder().decode(padded.subarray(2, 2 + declared))
}

function nip44Encrypt(plaintext, convKey, nonce) {
  const { chachaKey, chachaNonce, hmacKey } = messageKeys(convKey, nonce)
  const ciphertext = chacha20(chachaKey, chachaNonce, pad(plaintext))
  const mac = hmac(sha256, hmacKey, concatBytes(nonce, ciphertext))
  return base64.encode(concatBytes(new Uint8Array([2]), nonce, ciphertext, mac))
}

function nip44Decrypt(payload, convKey) {
  const data = base64.decode(payload)
  const nonce = data.subarray(1, 33)
  const ciphertext = data.subarray(33, data.length - 32)
  const { chachaKey, chachaNonce } = messageKeys(convKey, nonce)
  return unpad(chacha20(chachaKey, chachaNonce, ciphertext))
}

/* --------------------------------------------------- nip17.ts equivalents */

const MAX_TIME_JITTER_SECONDS = 15 * 60

function jitteredTimestamp({ skewSeconds = 0, jitterSeconds = MAX_TIME_JITTER_SECONDS } = {}) {
  const now = Math.floor(Date.now() / 1000) + skewSeconds
  if (jitterSeconds <= 0) return now
  const value = new DataView(randomBytes(4).buffer).getUint32(0, false)
  return now - (value % jitterSeconds)
}

function buildRumor(senderPubkey, recipientPubkey, body) {
  const unsigned = {
    pubkey: senderPubkey,
    created_at: Math.floor(Date.now() / 1000),
    kind: 14,
    tags: [["p", recipientPubkey]],
    content: body,
  }
  return { ...unsigned, id: eventId(unsigned) }
}

function giftWrap(rumor, senderSk, recipientPubkey, timestamps = {}) {
  const seal = finalizeEvent(
    {
      created_at: jitteredTimestamp(timestamps),
      kind: 13,
      tags: [],
      content: nip44Encrypt(JSON.stringify(rumor), conversationKey(senderSk, recipientPubkey), randomBytes(32)),
    },
    senderSk,
  )
  const ephemeralSk = randomBytes(32)
  return finalizeEvent(
    {
      created_at: jitteredTimestamp(timestamps),
      kind: 1059,
      tags: [["p", recipientPubkey]],
      content: nip44Encrypt(JSON.stringify(seal), conversationKey(ephemeralSk, recipientPubkey), randomBytes(32)),
    },
    ephemeralSk,
  )
}

function unwrapGift(wrap, sk) {
  try {
    const seal = JSON.parse(nip44Decrypt(wrap.content, conversationKey(sk, wrap.pubkey)))
    const rumor = JSON.parse(nip44Decrypt(seal.content, conversationKey(sk, seal.pubkey)))
    if (rumor.pubkey !== seal.pubkey) return null
    return rumor
  } catch {
    return null
  }
}

/* ------------------------------------------------------------ relay client */

/** Minimal relay connection that logs every frame verbatim. */
class Relay {
  constructor(name, sk, { auth = true } = {}) {
    this.name = name
    this.sk = sk
    this.pubkey = getPublicKey(sk)
    this.autoAuth = auth
    this.acks = new Map()
    this.events = []
    this.authed = false
    this.authResult = null
  }

  connect() {
    return new Promise((resolve, reject) => {
      this.ws = new WebSocket(RELAY)
      this.ws.onopen = () => resolve()
      this.ws.onerror = (e) => reject(new Error(`${this.name}: socket error ${e.message ?? ""}`))
      this.ws.onmessage = (ev) => this.onMessage(String(ev.data))
    })
  }

  onMessage(raw) {
    log(`  [${this.name} <-]`, raw.length > 400 ? raw.slice(0, 400) + `…(${raw.length}b)` : raw)
    const msg = JSON.parse(raw)
    if (msg[0] === "AUTH" && this.autoAuth) this.answerAuth(msg[1])
    if (msg[0] === "EVENT") this.events.push({ subId: msg[1], event: msg[2] })
    if (msg[0] === "OK") {
      if (msg[1] === this.pendingAuthId) {
        this.authed = msg[2] === true
        this.authResult = { ok: msg[2], reason: msg[3] ?? "" }
        this.authWaiter?.()
      }
      this.acks.get(msg[1])?.(msg)
    }
    if (msg[0] === "EOSE") this.eoseWaiters?.get(msg[1])?.()
  }

  answerAuth(challenge) {
    const event = finalizeEvent(
      {
        created_at: Math.floor(Date.now() / 1000),
        kind: 22242,
        tags: [["relay", RELAY], ["challenge", challenge]],
        content: "",
      },
      this.sk,
    )
    this.pendingAuthId = event.id
    this.send(["AUTH", event])
  }

  waitForAuth(ms = 5000) {
    if (this.authResult) return Promise.resolve(this.authResult)
    return new Promise((resolve) => {
      const timer = setTimeout(() => resolve({ ok: null, reason: "no AUTH exchange" }), ms)
      this.authWaiter = () => {
        clearTimeout(timer)
        resolve(this.authResult)
      }
    })
  }

  send(payload) {
    const raw = JSON.stringify(payload)
    log(`  [${this.name} ->]`, raw.length > 400 ? raw.slice(0, 400) + `…(${raw.length}b)` : raw)
    this.ws.send(raw)
  }

  publish(event, ms = 8000) {
    return new Promise((resolve) => {
      const timer = setTimeout(() => {
        this.acks.delete(event.id)
        resolve(["OK", event.id, null, "TIMEOUT: no OK received"])
      }, ms)
      this.acks.set(event.id, (msg) => {
        clearTimeout(timer)
        this.acks.delete(event.id)
        resolve(msg)
      })
      this.send(["EVENT", event])
    })
  }

  subscribe(subId, filters, ms = 6000) {
    this.eoseWaiters ??= new Map()
    const eose = new Promise((resolve) => {
      const timer = setTimeout(() => resolve("TIMEOUT: no EOSE"), ms)
      this.eoseWaiters.set(subId, () => {
        clearTimeout(timer)
        resolve("EOSE")
      })
    })
    this.send(["REQ", subId, ...filters])
    return eose
  }

  close() {
    try {
      this.ws?.close()
    } catch {}
  }
}

/* ------------------------------------------------------------------- join */

async function fetchJoinPolicy() {
  const r = await fetch(`${HTTP_ORIGIN}/api/join-policy`, { headers: { accept: "application/json" } })
  const body = await r.json()
  return body.policy ?? null
}

async function joinViaEndpoint(name, sk, jwt) {
  const pubkey = getPublicKey(sk)
  log(`[join ${name}] requesting invite from ${JOIN_URL}`)
  const inviteRes = await fetch(JOIN_URL, {
    method: "POST",
    headers: { "content-type": "application/json", accept: "application/json", authorization: `Bearer ${jwt}` },
    body: JSON.stringify({ nostr_pubkey: pubkey }),
  })
  const inviteBody = await inviteRes.text()
  log(`[join ${name}] invite endpoint: HTTP ${inviteRes.status} ${inviteBody.slice(0, 300)}`)
  if (!inviteRes.ok) throw new Error(`join endpoint refused: ${inviteBody.slice(0, 200)}`)
  const { code } = JSON.parse(inviteBody)

  const policy = await fetchJoinPolicy()
  let receipt = null
  if (policy) {
    const acceptBody = JSON.stringify({ code, policy_version: policy.version, age_confirmed: true })
    const acceptRes = await fetch(`${HTTP_ORIGIN}/api/invites/accept-policy`, {
      method: "POST",
      headers: { "content-type": "application/json", accept: "application/json" },
      body: acceptBody,
    })
    const acceptJson = await acceptRes.json()
    log(`[join ${name}] accept-policy: HTTP ${acceptRes.status} ${JSON.stringify(acceptJson).slice(0, 200)}`)
    receipt = acceptJson.receipt ?? null
  }

  const claimUrl = `${HTTP_ORIGIN}/api/invites/claim`
  const claimBody = JSON.stringify(receipt ? { code, policy_receipt: receipt } : { code })
  const claimRes = await fetch(claimUrl, {
    method: "POST",
    headers: {
      "content-type": "application/json",
      accept: "application/json",
      authorization: nip98AuthHeader(sk, claimUrl, "POST", claimBody),
    },
    body: claimBody,
  })
  const claimJson = await claimRes.text()
  log(`[join ${name}] claim: HTTP ${claimRes.status} ${claimJson.slice(0, 300)}`)
  if (!claimRes.ok) throw new Error(`claim failed: ${claimJson.slice(0, 200)}`)
  return JSON.parse(claimJson)
}

/* ------------------------------------------------------------------- main */

const readEnvFile = (name) => {
  const path = process.env[`${name}_FILE`]
  if (path) return readFileSync(path, "utf8").trim()
  return process.env[name] || null
}

const sleep = (ms) => new Promise((r) => setTimeout(r, ms))

async function main() {
  log(`relay: ${RELAY}`)
  const skA = process.env.SK_A ? hexToBytes(process.env.SK_A) : randomBytes(32)
  const skB = process.env.SK_B ? hexToBytes(process.env.SK_B) : randomBytes(32)
  const pkA = getPublicKey(skA)
  const pkB = getPublicKey(skB)
  log(`A pubkey ${pkA}`)
  log(`B pubkey ${pkB}`)
  log(`A sk ${bytesToHex(skA)}`)
  log(`B sk ${bytesToHex(skB)}`)

  if (!process.env.SKIP_JOIN) {
    const jwtA = readEnvFile("JWT_A")
    const jwtB = readEnvFile("JWT_B")
    if (!jwtA || !jwtB) throw new Error("Set JWT_A/JWT_B (or *_FILE), or SKIP_JOIN=1")
    await joinViaEndpoint("A", skA, jwtA)
    await joinViaEndpoint("B", skB, jwtB)
  }

  /* --- probe: publish before AUTH completes, from a fresh non-auth socket --- */
  log("\n=== probe 1: publish kind-1059 without answering AUTH ===")
  const noAuth = new Relay("noauth", randomBytes(32), { auth: false })
  await noAuth.connect()
  await sleep(500)
  const strayWrap = giftWrap(buildRumor(pkA, pkB, "pre-auth probe"), skA, pkB)
  log("no-auth publish result:", JSON.stringify(await noAuth.publish(strayWrap, 4000)))
  noAuth.close()

  /* --- both members connect and AUTH --- */
  log("\n=== connect + NIP-42 AUTH as members ===")
  const A = new Relay("A", skA)
  const B = new Relay("B", skB)
  await A.connect()
  await B.connect()
  const authA = await A.waitForAuth()
  const authB = await B.waitForAuth()
  log("A auth:", JSON.stringify(authA))
  log("B auth:", JSON.stringify(authB))

  /* --- B subscribes exactly like the app, plus a no-#p control --- */
  log("\n=== B subscribes (app filter + no-#p control) ===")
  const appFilterEose = B.subscribe("app-filter", [{ kinds: [1059], "#p": [pkB], limit: 100 }])
  const noPFilterEose = B.subscribe("no-p", [{ kinds: [1059], limit: 100 }])
  log("app-filter backfill:", await appFilterEose)
  log("no-p backfill:", await noPFilterEose)

  /* --- A sends the DM exactly like dm-send.ts --- */
  log("\n=== A sends B a NIP-17 DM (app semantics: recipient wrap awaited, self wrap after) ===")
  const rumor = buildRumor(pkA, pkB, `live harness DM ${new Date().toISOString()}`)
  const wrapToB = giftWrap(rumor, skA, pkB)
  const wrapToSelf = giftWrap(rumor, skA, pkA)
  const okRecipient = await A.publish(wrapToB)
  log("A publish (wrap->B) OK:", JSON.stringify(okRecipient))
  const okSelf = await A.publish(wrapToSelf)
  log("A publish (wrap->self) OK:", JSON.stringify(okSelf))

  /* --- did B receive it live? --- */
  await sleep(3000)
  const got = B.events.filter((e) => e.event?.kind === 1059)
  log(`B received ${got.length} kind-1059 event(s) across subscriptions:`)
  for (const { subId, event } of got) {
    const opened = unwrapGift(event, skB)
    log(`  sub=${subId} wrap=${event.id.slice(0, 12)} unwrap=${opened ? `"${opened.content}" from ${opened.pubkey.slice(0, 12)}` : "not for us"}`)
  }

  /* --- cold read-back: a brand new connection for B backfills --- */
  log("\n=== cold read-back: fresh socket, AUTH, backfill with app filter ===")
  const B2 = new Relay("B2", skB)
  await B2.connect()
  await B2.waitForAuth()
  await B2.subscribe("cold", [{ kinds: [1059], "#p": [pkB], limit: 100 }])
  const cold = B2.events.filter((e) => e.event?.kind === 1059)
  log(`B2 backfilled ${cold.length} wrap(s); decryptable: ${cold.filter((e) => unwrapGift(e.event, skB)).length}`)
  B2.close()

  /* --- probe: wrap addressed to a non-member key --- */
  log("\n=== probe 2: member A publishes a wrap addressed to a NON-member key ===")
  const strangerPk = getPublicKey(randomBytes(32))
  const wrapToStranger = giftWrap(buildRumor(pkA, strangerPk, "to a non-member"), skA, strangerPk)
  log("A publish (wrap->stranger) OK:", JSON.stringify(await A.publish(wrapToStranger)))

  /* --- probe: subscription issued before AUTH on a fresh socket --- */
  log("\n=== probe 3: REQ sent before AUTH completes ===")
  const early = new Relay("early", skB)
  await early.connect()
  const earlyEose = early.subscribe("early", [{ kinds: [1059], "#p": [pkB], limit: 10 }], 4000)
  log("early REQ result:", await earlyEose, `(events: ${early.events.length})`)
  await early.waitForAuth()
  await sleep(1500)
  log("after AUTH, early socket events:", early.events.length)
  early.close()

  A.close()
  B.close()
  log("\ndone")
}

main().catch((e) => {
  console.error("FATAL:", e)
  process.exit(1)
})
