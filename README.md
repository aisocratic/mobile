# AI Socratic — Mobile

A native iOS and Android client for [aisocratic.org](https://aisocratic.org): events, news, the blog, community chat, and the people you've met at AI Socratic events.

Built with **Expo (React Native) + expo-router**, talking directly to the community's self-hosted Supabase stack at `api.aisocratic.org`.

---

## Quick start

```bash
brew install watchman     # strongly recommended — see note below
cp .env.example .env      # then fill in EXPO_PUBLIC_API_KEY (the anon key)
npm install
npm run ios               # or: npm run android / npm start
```

> **Install watchman.** Without it Metro falls back to Node's file watching, which on macOS misses *newly created* files. New routes then don't enter expo-router's manifest and their tabs silently do nothing until you restart with `npx expo start --clear`. This costs more debugging time than it sounds like it should.

`npm run ios` boots the iOS simulator and opens the app in Expo Go. No Xcode project, no CocoaPods, no Android Studio needed for day-to-day development.

Other scripts:

| Command | What it does |
| --- | --- |
| `npm start` | Metro dev server + QR code for a physical device |
| `npm run ios` / `npm run android` | Launch in **Expo Go** — fast, no native toolchain |
| `npm run ios:native` / `npm run android:native` | Build and run a **development build**. Slower and needs Xcode + CocoaPods, but the app owns the `aisocratic://` scheme, which is what Google sign-in requires (see the auth notes below) |
| `npm run web` | React Native Web preview (see the CORS caveat below) |
| `npm run typecheck` | `tsc --noEmit` |
| `npm test` | Jest unit tests |
| `npm run doctor` | `expo-doctor` dependency/version audit |

`npx expo prebuild` regenerates `ios/` and `android/`; both are gitignored, so the native projects are disposable and the Expo config stays the source of truth.

### Environment

| Variable | Purpose |
| --- | --- |
| `EXPO_PUBLIC_API_URL` | Kong gateway in front of GoTrue + PostgREST — `https://api.aisocratic.org` |
| `EXPO_PUBLIC_API_KEY` | Supabase **anon** key. A public, RLS-scoped JWT; safe to ship in a client bundle |
| `EXPO_PUBLIC_SITE_URL` | `https://aisocratic.org`, used for share links and "open on the web" |
| `EXPO_PUBLIC_NOSTR_RELAY` | Relay powering chat (see [Chat](#chat)) |

These mirror `NEXT_PUBLIC_API_URL` / `NEXT_PUBLIC_API_KEY` in the website repo. `.env` is gitignored.

---

## Why Expo / React Native

The brief said "choose the best native solution." The options and the reasoning:

| Option | Verdict |
| --- | --- |
| **Expo + React Native** ✅ | One TypeScript codebase for iOS and Android, genuinely native views (real `UITableView`-backed lists, native navigation, native gestures). Expo Go means a running app in minutes with no signing, no CocoaPods, no Android SDK. Ships to both stores via EAS when it's time. |
| Swift/SwiftUI + Kotlin/Compose | The most native possible, but two codebases for a six-surface community app, and the Android half would be greenfield. Not justified by anything in this feature set. |
| Capacitor / WKWebView shell | There is an existing plan in the website repo (`docs/ai-cafe-capacitor-plan.md`) proposing this. It sidesteps the API work by reusing web session cookies, but it isn't a native app — no native lists, no offline caching, no native navigation feel, and its own plan flags the cookie-in-WKWebView session as "the top integration risk." |
| Flutter | Fine technically, but adds Dart to a TypeScript organization and can't share types or logic with the Next.js site. |

Two further points settled it:

1. The website repo already contains a fixtures-only Expo prototype at `apps/ios` (Expo SDK 54, expo-router 6, RN 0.81). This project reuses that exact, proven version matrix and its brand theme — so the choice is consistent with where the team was already heading.
2. The backend is Supabase. `@supabase/supabase-js` runs natively in React Native, which means auth and data need no bespoke mobile API layer.

**Stack:** Expo SDK 54 · React Native 0.81.5 · React 19.1 · expo-router 6 (typed routes, file-based) · TanStack Query 5 · `@supabase/supabase-js` 2 · TypeScript strict.

---

## Architecture

```
app/                          # expo-router — file path == route
  _layout.tsx                 # providers + AuthGate (session-based redirects)
  index.tsx                   # entry redirect
  (auth)/                     # welcome, sign-in, sign-up
  (tabs)/                     # events, feed, chat, connections, profile
  event/[id].tsx              # event detail
  news/[id].tsx               # news reader
  article/[slug].tsx          # blog reader
  member/[id].tsx             # member profile + shared events
  profile/edit.tsx            # in-app profile editor
  chat/[id].tsx               # conversation

src/
  api/                        # one module per domain: PostgREST queries + React Query hooks
    events.ts  news.ts  blog.ts  feed.ts  connections.ts
  chat/                       # Nostr chat adapter (see below)
  components/
    ui.tsx                    # design system: Txt, Card, Button, Field, Chip, Avatar, states…
    markdown.tsx              # dependency-free markdown renderer for article bodies
    auth-form.tsx             # shared two-step passwordless form
  lib/
    supabase.ts               # client + SecureStore-backed session storage
    query.ts                  # QueryClient
    format.ts                 # date/text helpers
  store/auth.tsx              # AuthProvider, useAuth()
  theme.ts                    # brand palette, light + dark
  types.ts                    # row types transcribed from the live schema
```

**Data flow.** Screens call hooks from `src/api/*`, which wrap TanStack Query around `supabase.from(...)` calls straight to PostgREST. There is no bespoke backend-for-frontend: the app is a first-class API client of the same database the website uses. Row Level Security is what separates public content from private.

**Theming.** Every surface derives colour from `usePalette()`, which follows the OS light/dark setting. The palette is lifted from the website's design tokens — near-black `#0A0A0A` backgrounds with the amber accent (`#D97706` light / `#FBBF24` dark).

---

## Features

Which sections exist in a build is a flag, not a branch — see `src/features.ts`.

| Section | First release | Notes |
| --- | --- | --- |
| Feed | ✅ | Landing tab |
| Events | ✅ | |
| Connections ("People") | ✅ | ⚠️ Returns an empty list for non-admin accounts — see limitation 4 |
| Profile | ✅ | Holds sign-out; on by default so nobody is stranded signed in |
| Chat | ❌ | Built and tested; needs the `chat_identities` migration applied and `BUZZ_OWNER_KEY` set |

Flip one with `EXPO_PUBLIC_FEATURES`, whose entries are **deltas** against those defaults so adding a feature later doesn't mean editing every deployment:

```bash
EXPO_PUBLIC_FEATURES=chat            # turn chat back on
EXPO_PUBLIC_FEATURES=-connections    # hide the People tab
EXPO_PUBLIC_FEATURES=chat,-profile   # both, left to right
```

A disabled section loses its **tab and its routes**. `href: null` takes it out of the tab bar; the guard in `app/_layout.tsx` catches everything that doesn't come through the bar — deep links, `aisocratic://invite/<code>`, the Message button on a member profile — and redirects to `homeRoute()`, which follows the flags rather than naming a tab. Switching off the landing tab moves the landing tab; it can't strand the app on a screen the build doesn't ship.

Chat is **off, not deleted**: no `getNostrAdapter` call means no relay socket is ever opened. It's one word in `.env` from coming back.

One deliberate constraint: `process.env.EXPO_PUBLIC_*` is *inlined by Metro at build time* by matching literal text, so `process.env["EXPO_PUBLIC_FEATURE_" + name]` reads `undefined` forever and every flag silently takes its default. Hence one statically-named variable parsed at runtime, rather than one variable per flag.

### Authentication
`aisocratic.org` has **no passwords**. GoTrue is configured for passwordless 6-digit email OTP plus Google OAuth, and this app uses exactly the same two flows as the website's `/login`:

- **Email code** — `signInWithOtp({ shouldCreateUser: true })` → `verifyOtp()`. Sign-up and sign-in are the same call; the screens differ only in that sign-up also collects a name (stored as `full_name` in user metadata). Resends are throttled client-side to match GoTrue's 60-second limit.
- **Google** — `signInWithOAuth({ skipBrowserRedirect: true })` opened in `expo-web-browser`, returning to the `aisocratic://` deep link. The client is configured `flowType: "pkce"`, so the code verifier never leaves the device; `detectSessionInUrl` is off on native, so the callback is parsed by hand (PKCE `?code=` first, implicit fragment as a fallback).

> ### ⚠️ Google sign-in needs a server-side allowlist entry
>
> GoTrue only honours a `redirect_to` that matches `GOTRUE_URI_ALLOW_LIST`. Anything else is **silently discarded** and replaced with `SITE_URL` — so the browser finishes the login on aisocratic.org, the app never receives the callback, and it looks like sign-in "opens the website and does nothing."
>
> The deployed list was `https://aisocratic.org/**,http://localhost:**`, which excludes every mobile scheme. `website/docker-compose.yml` now defaults to including `aisocratic://**`:
>
> ```yaml
> GOTRUE_URI_ALLOW_LIST: ${GOTRUE_URI_ALLOW_LIST:-https://aisocratic.org/**,http://localhost:**,aisocratic://**}
> ```
>
> **✅ Applied to production on 2026-08-02.** The live value is now:
>
> ```
> GOTRUE_URI_ALLOW_LIST=https://aisocratic.org/**,https://meet.aisocratic.org/**,http://localhost:**,aisocratic://**
> ```
>
> The compose default was **not** what governed this. Production sets the variable explicitly at **`/opt/aisocratic/.env:50`**, which overrides `${VAR:-default}` — so that file is the one to edit, and the compose change alone would have been a no-op. A timestamped backup (`.env.bak-*-pre-mobile-oauth`) sits next to it, and the `auth` container was recreated. `exp://**` was deliberately left off; the development build removes the need for it.
>
> Should this ever need redoing, per `website/DEPLOY.md` the stack is Docker Compose on Hetzner at `/opt/aisocratic`:
>
> ```bash
> # 1. get the compose change onto the server
> git push origin main
> ssh hetzner 'cd /opt/aisocratic && git pull'
>
> # 2. check nothing overrides the default — an explicit value wins over
> #    the ${VAR:-default} in docker-compose.yml
> ssh hetzner 'cd /opt/aisocratic && grep -r GOTRUE_URI_ALLOW_LIST .env* 2>/dev/null'
>
> # 3. recreate just the auth container (a few seconds of auth downtime)
> ssh hetzner 'cd /opt/aisocratic && docker compose up -d auth'
>
> # 4. verify
> ssh hetzner 'docker inspect $(docker compose -f /opt/aisocratic/docker-compose.yml ps -q auth) \
>   | grep GOTRUE_URI_ALLOW_LIST'
> ```
>
> If step 2 finds an explicit `GOTRUE_URI_ALLOW_LIST=`, edit **that** and add `aisocratic://**` to it — the compose default will never apply.
>
> **Expo Go is a separate case.** Its redirect is `exp://<lan-ip>:8081/--/auth/callback`, which no fixed pattern matches, so Google cannot work in Expo Go against a server that only allows `aisocratic://**`. Two options:
>
> 1. **Use the development build** (recommended) — `npx expo run:ios` produces a build that owns the `aisocratic://` scheme, so Google works against the production allowlist with nothing extra. Requires CocoaPods (`brew install cocoapods`).
> 2. **Temporarily add `exp://**`** to the server list. Already set in `.env.docker` for local stacks. Don't leave it on the public server: it lets any Expo dev server receive a completed OAuth redirect. PKCE with S256 limits the damage — an intercepted code is useless without the on-device verifier — but an attacker can request the implicit flow instead, so it is still worth removing before launch.
>
> **Email sign-in needs none of this** — `verifyOtp` is a plain HTTP call with no browser and no redirect, so it works in Expo Go, in dev builds, and in production **as-is, today**. Verified against the live server: a wrong code returns `403 otp_expired "Token has expired or is invalid"`, i.e. the endpoint is reachable and doing real verification.

`app/auth/callback.tsx` is a safety net, not the happy path. `WebBrowser.openAuthSessionAsync` intercepts the redirect inside the auth sheet and hands the URL straight back to `signInWithGoogle`, so no navigation normally occurs. But the OS can deliver `aisocratic://auth/callback` out of band — sheet dismissed early, a magic link opened from a mail client, a cold start — and without that route those landed on expo-router's "Unmatched Route" screen. Verified with `xcrun simctl openurl booted "aisocratic://auth/callback?probe=1"` against the dev build: it now redeems any credentials in the link and redirects into the app.

**PKCE needs a WebCrypto shim on Hermes.** `@supabase/auth-js` feature-detects `crypto.subtle` when building the code challenge; Hermes has no WebCrypto, so it logs *"WebCrypto API is not supported. Code challenge method will default to use plain instead of sha256"* and falls back to `plain` — which sends the verifier itself as the challenge and discards most of PKCE's value. `src/lib/webcrypto.ts` supplies the one primitive it needs (SHA-256 `digest`, on `@noble/hashes`, already a dependency) and is imported before the client is constructed. The warning is gone and the challenge is S256. It's unit-tested against known vectors, including that it hashes only a view's slice rather than its whole backing buffer.

Sessions persist in the iOS Keychain / Android Keystore via `expo-secure-store`, chunked to stay under SecureStore's 2 KB per-item limit.

`AuthGate` in the root layout decides who needs a session. Events and the feed are public on the website, so they stay browsable signed-out; only Connections, Chat, Profile and member pages bounce to the welcome screen. (Members-only blog posts are the one thing the feed withholds until you sign in.) Because that bounce is a `replace()`, there is no back stack out of it — so the welcome screen carries a **"Not now — browse events"** action that returns you to the public tabs. Nobody gets trapped in the sign-in flow.

That action is deliberately a normal in-flow button rather than a floating ✕. An absolutely positioned close icon loses iOS hit-testing to a later non-positioned sibling even with a higher `zIndex`: it renders perfectly and silently ignores every tap. Worth remembering before adding a floating control to any screen here.

### Events
`events` table — 77 rows. Upcoming/Past segmented filter, month-grouped `SectionList` with sticky headers, host avatar stacks, and a detail screen with hero image, markdown body, host profiles linking to LinkedIn, and a "Register on Luma" action.

Times are rendered in the **event's** timezone (rows carry an IANA `timezone`), not the device's.

### Feed
News and the blog are two tables but one reading surface. `src/api/feed.ts` normalises both into a single `FeedItem` and merges them newest-first; the tab carries two filter rows — source (**All / News / Blog**) and topic — and the topic row is the union of both sides' categories, deduplicated case-insensitively.

- `updates` table — the website renamed this surface to "News" in July 2026 but the table kept its old name. Paged 20 at a time, category filtered server-side; link-only items open their source directly instead of an empty reader.
- `blog_posts` table — 31 posts, fetched whole and filtered client-side, read through the in-house markdown renderer.

The two paginate differently, which the merge has to absorb: the blog arrives in one request while news is paged, so a blog post older than the last loaded news item is held back until news catches up with it. Without that cutoff every new page of news would insert rows *above* posts the reader had already scrolled past.

Selecting **News** or **Blog** disables the other query rather than filtering its results, so a single-source view costs a single request. The top item renders as a hero card; the rest as rows tagged with their source.

### Connections
The list of people you've met at AI Socratic events, with the role each of you had — **host** or **guest**.

There is no "connections" table to read. The relationship is derived:

1. Find the `event_users` rows that are you (matched on `user_id`, or on email — people often register on Luma before claiming an account).
2. Collect your events from `event_attendance`, plus any event whose `events.hosts` jsonb names you.
3. Find everyone else who attended those same events.
4. Hydrate them from `event_users`, enriched from `members` / `users` where they've claimed a profile.
5. Derive each side's role per shared event by checking membership of `events.hosts`.

Per-event roles are denormalized from Luma into `events.organizer` (a JSON *string*) and `events.hosts` (jsonb) — there is no relational event-organizer model to join against, so the host check is done in TypeScript. Identities are matched across sources on Luma's `api_id` (`events.hosts[].api_id` == `event_users.source_user_id`), falling back to case-insensitive name and then normalized LinkedIn handle. A missed match degrades a host to "guest", never the other way round.

Two things the live data forced:

- **Co-hosts rarely register for their own events**, so they have no `event_attendance` row. They're recovered from the public `events.hosts` jsonb and mapped back via `source_user_id` — on the current data that's the difference between finding 4 co-hosts and finding 10.
- **`status` is `invited` on ~70% of attendance rows.** Someone only counts as present on `status = 'approved'` or a real `checked_in_at`, matching the website's own guest-list rule.

> ⚠️ **This feature is only fully populated for `admin`/`editor` accounts.** See limitation 4 below — it's an RLS constraint, not an app bug.

### Chat

> **Off in the first release** (`src/features.ts`). Everything below is built and tested; it needs the `chat_identities` migration applied and `BUZZ_OWNER_KEY` set on the server. Re-enable with `EXPO_PUBLIC_FEATURES=chat`.

Chat doesn't exist on the website. The brief said to use **buzz.xyz** — so first, what buzz.xyz actually is:

> **buzz.xyz is Block, Inc.'s open-source Slack/GitHub alternative**, launched 21 July 2026 and built on the **Nostr** protocol ([github.com/block/buzz](https://github.com/block/buzz), Apache-2.0).
>
> It is a *product*, not a chat-backend vendor. There is **no hosted chat API, no API keys or dashboard, no npm SDK, and no React Native SDK**. `docs.buzz.xyz` does not resolve. No `@buzz/*` packages exist on npm — and the `buzz-cli` package that *is* on npm is an unrelated Vue scaffolding tool, not Block's. Buzz's own SDK and CLI are Rust crates inside the monorepo, unpublished. Its official mobile client is Flutter and still marked in-progress.

What Buzz *does* expose is its wire protocol: **Nostr over WebSocket**. Chat here is a real Nostr client speaking it — real secp256k1 keys, real Schnorr signatures, real relay, real encryption, real persistence. Nothing is mocked.

**The app points at the AI Socratic community relay** (`EXPO_PUBLIC_NOSTR_RELAY`):

```
wss://aisocratic.communities.buzz.xyz
```

The adapter reads the relay's NIP-11 document at connect time and picks its dialect from `supported_nips`, because a Buzz community and a public relay speak measurably different protocols:

| | Buzz community | Public relay (e.g. `relay.primal.net`) |
| --- | --- | --- |
| Channels | **NIP-29** relay-managed groups — kind `9` with an `h` tag (lowercase UUID v4), discovered from kind 39000 | **NIP-28** — kinds 40/42, deterministic client-computed room ids |
| DMs | **NIP-17** gift-wrapped (kind 1059 → sealed 13 → rumor 14), over NIP-44 v2 | **NIP-04** (kind 4) |
| Auth | **NIP-42 required** — no `REQ` is answered before it | usually none |
| Membership | **required** — an unknown key is refused *at authentication* | open |

Setting `EXPO_PUBLIC_NOSTR_RELAY` back to a public relay switches the whole dialect with no code change; that path is kept working deliberately, since it's the one provable end to end without an invite.

#### Your chat account

A Nostr account *is* a keypair — nothing issues it and nothing confirms it. The app generates 32 random bytes on the device (`src/chat/account.ts`), keeps the secret in the iOS Keychain / Android Keystore, and publishes the public half to `public.chat_identities` (`src/chat/directory.ts`) so other members can address it.

That directory is what makes random keys possible at all. Nostr addresses people by public key, so before it existed the only way two devices could agree on a member's key with no server involved was to **derive** it from their auth uuid — which meant anyone who read this repo could compute anyone's secret key. Now:

| | before | now |
| --- | --- | --- |
| Key | `sha256("aisocratic:nostr:v1:" + uuid)` | 32 random bytes, `expo-crypto` |
| Secret lives | recomputable from the bundle | Keychain / Keystore only |
| Addressing others | recompute their key | `chat_identities` lookup, derived key as fallback |

The derivation survives in exactly two places, both about not breaking people: members with no directory row yet (anyone who used chat before this, or an event guest with no account) still resolve to their old derived key, and a device whose secure storage is unusable falls back to a *stable* derived key rather than a random one that dies on restart — the identity bar says so when that happens.

**Only the public half is ever written.** `chat_identities` has no column for a secret and no code path that would send one, RLS restricts writes to `auth.uid() = user_id` (so nobody can park their key on someone else's id and receive their DMs), and `SELECT` is granted to `authenticated` only — not `anon`, unlike `public.users`, so correlating pubkeys to real names costs an account. Migration: `website/lib/db/migrations/20260801_chat_identities.sql`.

The trade is that the key is **unrecoverable**. Reinstalling produces a new account rather than restoring the old one, which is exactly why the relay operator cannot read anyone's DMs. Auto-join below is what makes that cheap.

#### Joining the community

The community relay reports `auth_required: true` and `restricted_writes: true`, and a fresh keypair is rejected during NIP-42 with:

```
["OK","<id>",false,"restricted: not a relay member"]
```

So membership is a precondition for *reading*, not just posting. The way in is the relay's HTTP invite API, and the app implements the claimant half:

1. `GET /api/join-policy` — this community sets `age_attestation_required: true`.
2. `POST /api/invites/accept-policy` — `{ code, policy_version, age_confirmed }`, returns a receipt. Unauthenticated (despite what `invites.rs`'s header comment implies — verified against the live server).
3. `POST /api/invites/claim` — `{ code, policy_receipt }`, signed with **NIP-98** (kind 27235). Explicitly exempt from the membership check.

#### Joining without a code

Steps 1–3 need an invite code, and a code can only be minted by a key holding `owner` or `admin`. That key can never ship in the app: every `EXPO_PUBLIC_` value is plain text inside the JS bundle, and codes default to unlimited uses, so one extraction would make a private community permanently public.

So the key lives on the server instead, and the app asks it for a code:

```
app  ──Authorization: Bearer <supabase JWT>──▶  POST /api/buzz/join   (website repo)
                                                     │ holds BUZZ_OWNER_KEY
                                                     ├─▶ POST /api/invites   NIP-98, owner key
                                                     │      { ttl_secs: 300, max_uses: 1 }
                                                     ◀── code
app  ◀──{ code }──────────────────────────────────────┘
app  ──its own key──▶  accept-policy + claim          = member, nothing typed
```

The code that reaches the device is deliberately near worthless: **single use, five-minute TTL**, spent on the next line. The route authenticates the caller against GoTrue with the *anon* key (using the service role would make it trust tokens this process minted), rate-limits per account rather than per IP, and answers `501` when `BUZZ_OWNER_KEY` is unset — at which point the app falls back to asking for a pasted code, exactly as before. Configure with `EXPO_PUBLIC_BUZZ_JOIN_URL` (a URL, not a secret).

**What is not automated is the consent.** The community sets `age_attestation_required: true`, and the relay rejects `age_confirmed: false` with `join_policy_not_accepted` — so a hardcoded `true` would not be satisfying that requirement, it would be forging an answer to a question asked of a person. The checkbox stays; auto-join is one tap *after* it. `src/chat/auto-join.test.ts` asserts that an unattested auto-join refuses **without spending the invite**.

#### Inviting other people

The other half of the loop, added in the same shape:

4. `POST /api/invites` — `{ ttl_secs, max_uses }`, signed with **NIP-98** by whoever is signed in. Returns `{ code, expires_at, max_uses, uses_remaining, url }`, where `url` is a relay-hosted landing page at `https://<host>/invite/<code>`.

Authorization is the relay's job, not the app's: `mint_invite` looks the signing key up in the community and refuses anything that isn't `owner` or `admin` with `403 only relay owners and admins can create invites` (it mirrors the kind:9030 authz). So **Chat → the person-add button** is offered to every member, and a member who isn't an admin gets that sentence back instead of a button that mysteriously isn't there. The app can't read its own role — there is no endpoint for it — and guessing would be wrong in both directions.

Three deliberate choices in `src/chat/invite-people.tsx`:

- **Unlimited uses is never a default.** Omitting `max_uses` is how Buzz spells "unlimited", so the careless implementation gets it by accident. Here it is one of four labelled options and the default is a single use.
- **The code is never persisted.** The relay returns it once and has no endpoint that reads it back, so it lives in component state until the screen closes. Writing it to storage would leave a standing join capability on the device to save one navigation.
- **Bounds are checked before signing.** `MIN/MAX_INVITE_TTL_SECS` (60 s … 30 d) and `MAX_INVITE_USES` (10 000) are mirrored from `buzz_core::invite`, because every NIP-98 event sent is one the relay's replay guard has to remember — spending one on a request the server will certainly reject is waste.

Sharing goes through the native share sheet (`Share` from react-native — no new dependency, and it carries "Copy" on both platforms). The message contains the landing URL and the raw code. A recipient who opens `aisocratic://invite/<code>` lands on `app/invite/[code].tsx`, which parks the code and routes to Chat; the code is prefilled into the join form whether they already had an account or sign up first. The path mirrors the relay's own so one link addresses both clients.

**No invite code is ever shipped in the bundle.** An `EXPO_PUBLIC_BUZZ_INVITE` would be inlined into the JS and trivially extractable, which would make a relay that describes itself as "private team communication" joinable by anyone who downloads the app; codes default to unlimited uses, so that mistake would be permanent until revoked. A code either comes from the user (pasted, or opened as a link they chose to follow) or is minted server-side per account, single-use, with a five-minute life. The age attestation is a real checkbox over the fetched policy text on both paths, not an auto-`true` — the server rejects `age_confirmed: false` with `join_policy_not_accepted`.

Three findings from building it:

- **`nostr-tools` was installed, evaluated, and removed.** It's ESM-only with subpaths reachable only through its `exports` map, and this project must keep Metro's `unstable_enablePackageExports` **off** for `@supabase/supabase-js` to resolve. Rather than flip a global resolver flag, the ~150 lines of protocol are implemented directly on `@noble/curves`, `@noble/hashes`, `@noble/ciphers` and `@scure/base` — nostr-tools' own dependencies, which ship flat files and resolve identically either way.
- **The public-relay default was chosen by testing writes, not by reputation.** Most large relays now refuse events from keys outside their web of trust — `nos.lol` returns "not acceptable at this point", `offchain.pub` and `nostr.bitcoiner.social` return "pubkey is not in our web of trust", `nostr.land` is paid. A fresh key would have produced an app that looks fine and silently drops every message. `relay.primal.net` accepts them; verified by publishing on one connection and reading the event back on a separate fresh one with the signature re-checked.
- **NIP-28 rooms were not reused as a NIP-29 fallback**, though it was tempting. A NIP-28 room id is a 32-byte event hash and Buzz requires `h` to be a lowercase UUID v4, so those rooms would have rendered fine and had every message rejected on send. A Buzz community with no groups shows an honest empty state instead. The built-in rooms remain the full channel set on the public-relay path.

---

## Backend notes and known limitations

These are real constraints of the current backend, not app bugs. They're worth a look from whoever owns the website repo.

1. **The Next.js API can't authenticate a mobile client.** Every authenticated route in `website/app/(main)/api/**` resolves identity through `@supabase/ssr` cookies via `next/headers`. There is no `Authorization: Bearer` fallback, so a native client cannot call them. This app therefore reads PostgREST directly. A ~20-line change in `website/lib/db/auth-server.ts` — use `global: { headers: { Authorization } }` when a Bearer header is present — would unblock all ~280 routes at once.

2. **Profile provisioning is web-only.** The `public.users` row is created by `POST /api/auth/complete`, which is cookie-authenticated. A user who signs up *in the app* gets a valid GoTrue session but may have no `public.users` row. The app edits profiles natively (`app/profile/edit.tsx` → `updateProfile` in `src/store/auth.tsx`), writing straight to PostgREST with an **upsert** so the first save also provisions the row. That needs an RLS insert/update policy for `auth.uid() = id` on `public.users`; where the policy is missing the write is refused and the screen surfaces the error. The editor always writes `full_name` into auth metadata too, so the display name survives a refused row write — but bio, role, organization and location live only in the row. Provisioning still belongs somewhere a native client can reach (a Postgres trigger, or the Bearer fix above).

3. **`public.updates` has RLS disabled**, so the anon key can read unpublished drafts. The app applies the same `moderation_status = 'approved' AND is_published AND status != 'archived'` filter the website uses, but that's politeness, not enforcement. Similarly `members` is world-readable *including `email`* — the `public_profile` gate lives in application code, not in a policy.

4. **Connections can't work for ordinary members without a backend change.** The tables hold real data (4,219 attendance rows, 975 event users), but the RLS policies are:

   ```sql
   CREATE POLICY "Users can view own event attendance" ON public.event_attendance FOR SELECT
     USING (event_user_id IN (SELECT id FROM event_users WHERE user_id = auth.uid()));
   CREATE POLICY "Users can view own event_user record" ON public.event_users FOR SELECT
     USING (user_id = auth.uid());
   ```

   A member can read **their own** attendance but not their co-attendees' rows — so co-attendee discovery is structurally impossible from any client. Only `admin`/`editor` accounts, which have a second policy via `is_admin_or_editor()`, see the full graph. The website does these joins server-side with a service client, which a mobile app can't do.

   The fix is a `SECURITY DEFINER` RPC — e.g. `get_my_connections()` — that performs the join server-side and returns only co-attendees of events you actually attended. Nothing in the app can substitute for it. (The existing `get_chapter_community_members` RPC doesn't help: it's plain `STABLE`, so it's still RLS-filtered.) Until then the Connections tab shows an honest empty state explaining that guest lists aren't visible to this account, rather than pretending you have no connections.

5. **Expo Web won't reach the API.** `kong.yml` allowlists specific origins for CORS and `http://localhost:8081` isn't among them. Native builds are unaffected (native HTTP clients don't send `Origin`); `npm run web` is for layout previews only unless that origin is added.

6. **Data is messier than the schema suggests.** `cover_url_thumb/medium/large` are null on all 77 events; `tags` is a jsonb array of Luma *objects*, not `string[]`; `content` is sometimes `""` rather than `NULL`. The API layer normalizes all of this — see `src/api/events.ts`.

7. ~~**Chat DMs are private from the relay operator, but not from someone with the source.**~~ **Fixed.** Chat keys are now random and device-held, with the public half published to `public.chat_identities` (migration in the website repo). Two caveats remain: members who have not opened the app since the change are still addressed at their old derived key until they register, and a device whose secure storage is unusable falls back to a derived key — the identity bar labels that case rather than letting it pass for a generated one.

8. **Chat is single-relay.** Given how many relays gate writes, one relay is a real single point of failure. Multi-relay fan-out is the obvious next step.

### Getting into the community chat

You need one invite code from someone who already holds `owner` or `admin` on the relay. Two ways to get it:

- **From inside this app**, if that person is an app user: Chat tab → person-add button → pick an expiry and a use limit → **Create invite** → share.
- **From the Buzz app or CLI** that holds the key, NIP-98 signed:

  ```bash
  POST https://aisocratic.communities.buzz.xyz/api/invites
  { "ttl_secs": 604800, "max_uses": 10 }
  ```

  `ttl_secs` defaults to 72h; **omitting `max_uses` means unlimited uses**, so set it deliberately.

Then, as the recipient: open the invite link, or Chat tab → paste into *Invite code* → tick the age/terms box → **Join community**. On success the socket reconnects immediately instead of waiting out the backoff.

**Or skip all of that.** With `BUZZ_OWNER_KEY` set on the website and `EXPO_PUBLIC_BUZZ_JOIN_URL` pointing at `/api/buzz/join`, the Chat tab shows *Create my account & join*: tick the age/terms box, tap once, and the app generates a key, registers it, fetches a single-use invite and redeems it. Nobody handles a code.

Pointing at a different Buzz community is one line and no code change — `EXPO_PUBLIC_NOSTR_RELAY=wss://<host>` — since the dialect is detected from that relay's NIP-11 document.

**What is and isn't proven.** Verified live against this relay: NIP-11 capability detection, the AUTH challenge/response shape, the `restricted: not a relay member` rejection, the join-policy fetch (still `age_attestation_required: true`), the age gate being server-enforced, `POST /api/invites` answering `401 missing Nostr auth` unsigned, and NIP-98 signing (a correctly signed claim reaches `403 invite_invalid`, while a corrupted signature gets `401 invalid Schnorr signature` and a mismatched body gets `401 payload tag SHA-256 mismatch` — so the 403 really does mean auth passed). The **server-side** signer in `website/lib/buzz/invite.ts` was probed the same way and behaves identically: unsigned → `401 missing Nostr auth`, validly signed with a non-member key → `403 only relay owners and admins can create invites`, corrupted → `401 invalid Schnorr signature`, mismatched body → `401 payload tag SHA-256 mismatch`. NIP-44 v2 passes all 122 official vectors, NIP-17 wrapping is unit-tested including stranger-blocked and tamper-rejected cases, and the NIP-98 binding is asserted on both sides (`src/chat/buzz.test.ts`, `website/lib/buzz/invite.test.ts`).

**Unexercised pending real credentials:** a successful mint (still needs an owner/admin key in `BUZZ_OWNER_KEY` — everything up to the role check is proven), a successful claim, `POST /api/buzz/join` end to end, NIP-42 succeeding as a member, NIP-29 group discovery, and kind-9 send/receive over the wire. The `chat_identities` migration has been written but **not applied** — nothing that writes to it has run against the live database.

---

## Conventions

- Double quotes, no semicolons, 2-space indent, TypeScript `strict`.
- `@/*` path alias maps to `src/*`.
- Screens stay presentational; all PostgREST access lives in `src/api/*`.
- Every list handles loading, empty and error states explicitly — the shared `Loading`, `EmptyState` and `ErrorState` components exist so no screen ships a blank spinner.
- Production data is full of nulls. Assume every column is nullable and normalize at the API layer.
