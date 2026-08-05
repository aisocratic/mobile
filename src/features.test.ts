/**
 * Feature flags decide what ships, so the failure modes that matter are the
 * quiet ones: a typo that looks like it worked, or a disabled tab that leaves
 * the app opening onto a screen it no longer has.
 */

function loadFeatures(value?: string): typeof import("./features") {
  jest.resetModules()
  if (value === undefined) delete process.env.EXPO_PUBLIC_FEATURES
  else process.env.EXPO_PUBLIC_FEATURES = value
  // eslint-disable-next-line @typescript-eslint/no-require-imports
  return require("./features") as typeof import("./features")
}

afterEach(() => {
  delete process.env.EXPO_PUBLIC_FEATURES
})

describe("first-release defaults", () => {
  it("ships feed, blog, events, chat and profile, and holds connections back", () => {
    const f = loadFeatures()

    expect(f.enabledFeatures().sort()).toEqual(["blog", "chat", "events", "feed", "profile"].sort())
    // Chat's own People segment reads the same directory without needing
    // event_attendance, so the standalone tab is redundant rather than needed.
    expect(f.isEnabled("connections")).toBe(false)
  })

  it("opens on the feed", () => {
    expect(loadFeatures().homeRoute()).toBe("/(tabs)/feed")
  })

  it("keeps profile on, so nobody is stranded signed in with no way out", () => {
    expect(loadFeatures().isEnabled("profile")).toBe(true)
  })
})

describe("EXPO_PUBLIC_FEATURES", () => {
  it("enables a feature that is off by default", () => {
    expect(loadFeatures("connections").isEnabled("connections")).toBe(true)
  })

  it("disables a feature with a leading minus", () => {
    const f = loadFeatures("-chat")
    expect(f.isEnabled("chat")).toBe(false)
    // A delta, not a replacement list: everything else keeps its default.
    expect(f.isEnabled("feed")).toBe(true)
    expect(f.isEnabled("events")).toBe(true)
  })

  it("applies several entries left to right", () => {
    const f = loadFeatures("connections,-feed")
    expect(f.isEnabled("connections")).toBe(true)
    expect(f.isEnabled("feed")).toBe(false)
  })

  it("tolerates whitespace and casing", () => {
    expect(loadFeatures("  CONNECTIONS , -Feed ").isEnabled("connections")).toBe(true)
    expect(loadFeatures("  CONNECTIONS , -Feed ").isEnabled("feed")).toBe(false)
  })

  it("ignores an unknown name rather than crashing the app", () => {
    const f = loadFeatures("connectionss")
    // Still off by default: the misspelled token never matched "connections",
    // so this only proves the typo didn't silently turn it on.
    expect(f.isEnabled("connections")).toBe(false)
    expect(f.enabledFeatures()).toContain("feed")
  })

  it("treats an empty value as unset", () => {
    expect(loadFeatures("").enabledFeatures()).toEqual(loadFeatures().enabledFeatures())
  })
})

describe("homeRoute", () => {
  it("follows the flags instead of naming a tab", () => {
    // The whole point: switching off the landing tab must not strand the app on
    // a screen this build doesn't ship.
    expect(loadFeatures("-feed").homeRoute()).toBe("/(tabs)/blog")
    // Connections is off by default, so with the reading tabs and events gone
    // it's chat's turn, not connections'.
    expect(loadFeatures("-feed,-blog,-events").homeRoute()).toBe("/(tabs)/chat")
  })

  it("falls back to profile when every content tab is off", () => {
    expect(loadFeatures("-feed,-blog,-events,-chat").homeRoute()).toBe("/(tabs)/profile")
  })

  it("falls further back to connections if even profile is off but it was turned on", () => {
    expect(loadFeatures("-feed,-blog,-events,-chat,-profile,connections").homeRoute()).toBe(
      "/(tabs)/connections",
    )
  })

  it("never returns a route for a disabled feature", () => {
    const f = loadFeatures("-feed,-blog,-events,-chat,-profile")
    // Everything off is a misconfiguration, but it must still resolve to a real
    // route rather than undefined — a blank redirect target hangs the app.
    expect(f.homeRoute()).toMatch(/^\/\(tabs\)\//)
  })
})
