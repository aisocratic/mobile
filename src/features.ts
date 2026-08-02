/**
 * Feature flags — which sections of the app exist in this build.
 *
 * The first release ships Feed, Events and People. Chat is built and tested but
 * turned off: it needs a database migration applied and a community owner key
 * on the server before it works for anyone, and a tab that dead-ends is worse
 * than a tab that isn't there.
 *
 * Nothing is deleted. A flag is one word in `.env`, so turning chat back on is
 * a rebuild rather than a revert.
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

export const FEATURES = ["feed", "events", "connections", "chat", "profile"] as const

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
  events: true,
  connections: true,
  profile: true,
  // Off until `chat_identities` is applied and BUZZ_OWNER_KEY is set — see the
  // chat section of README.md.
  chat: false,
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
 * app opens. Feed leads because the news feed is the reason to open the app on
 * a given morning; Events and People are destinations you go looking for.
 */
const TAB_ROUTES = [
  ["feed", "/(tabs)/feed"],
  ["events", "/(tabs)/events"],
  ["connections", "/(tabs)/connections"],
  ["chat", "/(tabs)/chat"],
  ["profile", "/(tabs)/profile"],
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
