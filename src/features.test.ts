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
  it("ships feed, events and people, and holds chat back", () => {
    const f = loadFeatures()

    expect(f.enabledFeatures().sort()).toEqual(
      ["connections", "events", "feed", "profile"].sort(),
    )
    // Chat needs a migration applied and an owner key on the server; a tab that
    // dead-ends is worse than a tab that isn't there.
    expect(f.isEnabled("chat")).toBe(false)
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
    expect(loadFeatures("chat").isEnabled("chat")).toBe(true)
  })

  it("disables a feature with a leading minus", () => {
    const f = loadFeatures("-connections")
    expect(f.isEnabled("connections")).toBe(false)
    // A delta, not a replacement list: everything else keeps its default.
    expect(f.isEnabled("feed")).toBe(true)
    expect(f.isEnabled("events")).toBe(true)
  })

  it("applies several entries left to right", () => {
    const f = loadFeatures("chat,-feed")
    expect(f.isEnabled("chat")).toBe(true)
    expect(f.isEnabled("feed")).toBe(false)
  })

  it("tolerates whitespace and casing", () => {
    expect(loadFeatures("  CHAT , -Feed ").isEnabled("chat")).toBe(true)
    expect(loadFeatures("  CHAT , -Feed ").isEnabled("feed")).toBe(false)
  })

  it("ignores an unknown name rather than crashing the app", () => {
    const f = loadFeatures("chatt")
    expect(f.isEnabled("chat")).toBe(false)
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
    expect(loadFeatures("-feed").homeRoute()).toBe("/(tabs)/events")
    expect(loadFeatures("-feed,-events").homeRoute()).toBe("/(tabs)/connections")
  })

  it("falls back to profile when every content tab is off", () => {
    expect(loadFeatures("-feed,-events,-connections").homeRoute()).toBe("/(tabs)/profile")
  })

  it("never returns a route for a disabled feature", () => {
    const f = loadFeatures("-feed,-events,-connections,-profile")
    // Everything off is a misconfiguration, but it must still resolve to a real
    // route rather than undefined — a blank redirect target hangs the app.
    expect(f.homeRoute()).toMatch(/^\/\(tabs\)\//)
  })
})
