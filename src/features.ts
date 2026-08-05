/**
 * Feature flags — which sections of the app exist in this build.
 *
 * The first release ships Feed, Blog, Events, Chat and Profile. Chat's tab now
 * carries its own member directory (the People segment), so the standalone
 * Connections tab is folded away: it read from `event_attendance`, a table RLS
 * scopes to rows you already share, and the same "who else is here" job is
 * better served by chat's `public.users` directory, which needs nothing you
 * haven't already met to show a name.
 *
 * Nothing is deleted. A flag is one word in `.env`, so turning connections back
 * on — or chat back off — is a rebuild rather than a revert.
 *
 * ## Why one variable and not one per feature
 *
 * Metro *inlines* `process.env.EXPO_PUBLIC_*` at build time by matching the
 * literal text — `process.env.EXPO_PUBLIC_FEATURE_CHAT` is replaced with its
 * value during bundling. It is not a real object at runtime, so a computed
 * lookup like `process.env["EXPO_PUBLIC_FEATURE_" + name]` reads `undefined`
 * forever and every flag silently takes its default. One statically-named
 * variable, parsed at runtime, is the shape that actually survives bundling.
 *
 * ## Syntax
 *
 *   EXPO_PUBLIC_FEATURES=chat            enable chat on top of the defaults
 *   EXPO_PUBLIC_FEATURES=-connections    disable connections
 *   EXPO_PUBLIC_FEATURES=chat,-profile   both, applied left to right
 *
 * Entries are deltas against the defaults below, not a replacement list, so
 * adding a feature later does not mean editing every deployment's env.
 */

export const FEATURES = ["feed", "blog", "events", "connections", "chat", "profile"] as const

export type FeatureName = (typeof FEATURES)[number]

/**
 * First-release defaults.
 *
 * `profile` is on even though it is not a headline feature: it holds sign-out
 * and the profile editor, and shipping without it would leave someone signed in
 * with no way out.
 */
const DEFAULTS: Record<FeatureName, boolean> = {
  feed: true,
  // The blog got its own tab when Feed became news-only: two different kinds
  // of reading, two different rhythms, one shared screen (StoryStream).
  blog: true,
  events: true,
  profile: true,
  chat: true,
  // Superseded by chat's People segment, which shows the same directory
  // without needing `event_attendance` to already know you. Left in the
  // build, off by default, in case a chapter wants the shared-events framing
  // back.
  connections: false,
}

function isFeature(value: string): value is FeatureName {
  return (FEATURES as readonly string[]).includes(value)
}

function resolve(): Record<FeatureName, boolean> {
  const enabled = { ...DEFAULTS }

  // Must stay a literal member expression — see the note above.
  const raw = process.env.EXPO_PUBLIC_FEATURES?.trim()
  if (!raw) return enabled

  for (const entry of raw.split(",")) {
    const token = entry.trim()
    if (!token) continue

    const off = token.startsWith("-")
    const name = (off ? token.slice(1) : token).trim().toLowerCase()

    if (!isFeature(name)) {
      // A typo here would silently ship the wrong app, and the flag it was
      // meant to set would look like it simply had no effect.
      if (__DEV__) {
        console.warn(
          `[features] Unknown feature "${name}" in EXPO_PUBLIC_FEATURES. Known: ${FEATURES.join(", ")}`,
        )
      }
      continue
    }

    enabled[name] = !off
  }

  return enabled
}

const ENABLED = resolve()

export function isEnabled(feature: FeatureName): boolean {
  return ENABLED[feature]
}

/** Everything currently switched on — handy for a debug screen or a log line. */
export function enabledFeatures(): FeatureName[] {
  return FEATURES.filter((f) => ENABLED[f])
}

/* ----------------------------------------------------------------- routing */

/**
 * Tab order, which is also priority order: the first enabled one is where the
 * app opens. Feed leads because the news is the reason to open the app on a
 * given morning; Blog sits beside it as the other reading surface; Events and
 * Chat are destinations you go looking for. Connections sits last — off by
 * default, and superseded by chat's own People segment when it is on.
 */
const TAB_ROUTES = [
  ["feed", "/(tabs)/feed"],
  ["blog", "/(tabs)/blog"],
  ["events", "/(tabs)/events"],
  ["chat", "/(tabs)/chat"],
  ["profile", "/(tabs)/profile"],
  ["connections", "/(tabs)/connections"],
] as const

export type TabRoute = (typeof TAB_ROUTES)[number][1]

/**
 * Where "home" is for this build.
 *
 * Hardcoding a tab would strand the app on a blank screen the moment that tab
 * is switched off, which is exactly the failure a flag system is supposed to
 * prevent. Falls back to Profile — always on by default, and the one screen
 * that works with nothing else configured.
 */
export function homeRoute(): TabRoute {
  const first = TAB_ROUTES.find(([feature]) => ENABLED[feature])
  return first ? first[1] : "/(tabs)/profile"
}
