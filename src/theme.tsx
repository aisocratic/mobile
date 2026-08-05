import React, { createContext, useContext } from "react"
import { Appearance, useColorScheme } from "react-native"

/**
 * Brand palette lifted from the aisocratic.org design system so the app reads
 * as the same product as the website.
 */
export const brand = {
  amber: "#D97706",
  amberBright: "#FBBF24",
  green: "#10B981",
  purple: "#8B5CF6",
  red: "#EF4444",
  blue: "#2563EB",
}

export const lightPalette = {
  background: "#FFFFFF",
  surface: "#F8F8F8",
  elevated: "#FFFFFF",
  text: "#0A0A0A",
  muted: "#64748B",
  border: "#E2E8F0",
  input: "#F1F5F9",
  primary: "#0A0A0A",
  primaryText: "#FFFFFF",
  accent: brand.amber,
  tab: "#FFFFFF",
  danger: brand.red,
  success: brand.green,
}

export const darkPalette: typeof lightPalette = {
  background: "#0A0A0A",
  surface: "#141414",
  elevated: "#1A1A1A",
  text: "#FAFAFA",
  muted: "#A1A1AA",
  border: "#262626",
  input: "#1A1A1A",
  primary: "#FAFAFA",
  primaryText: "#0A0A0A",
  accent: brand.amberBright,
  tab: "#141414",
  danger: brand.red,
  success: brand.green,
}

export type Palette = typeof lightPalette

/* ------------------------------------------------------------------ theme */

const ThemeContext = createContext<Palette | null>(null)

/**
 * Holds the one `useColorScheme` subscription in the app.
 *
 * `usePalette` is called by nearly every component that renders anything —
 * `Txt` and `Muted` alone put it on every line of text on screen — and each
 * call to `useColorScheme` registers its own listener on RN's `Appearance`
 * emitter. On a scrolling list that meant hundreds of live subscriptions all
 * recomputing the same two-branch answer. One subscription up here, everything
 * else a context read.
 */
export function ThemeProvider({ children }: { children: React.ReactNode }) {
  const scheme = useColorScheme()
  const palette = scheme === "dark" ? darkPalette : lightPalette
  return <ThemeContext.Provider value={palette}>{children}</ThemeContext.Provider>
}

/**
 * The palette for the current colour scheme.
 *
 * Falls back to a direct, *non-subscribing* `Appearance` read when no provider
 * is mounted. That case is not theoretical: `src/components/error-boundary.tsx`
 * can be rendered in place of the root layout itself, with none of the app's
 * providers below it, and a crash screen that throws is worth nothing. It gets
 * the right colours; it just won't repaint if the scheme changes while it's up,
 * which no one will ever see.
 */
export function usePalette(): Palette {
  const provided = useContext(ThemeContext)
  return provided ?? (Appearance.getColorScheme() === "dark" ? darkPalette : lightPalette)
}

export function useIsDark(): boolean {
  return usePalette() === darkPalette
}

/* ----------------------------------------------------------------- layout */

export const layout = {
  gutter: 20,
  radius: 18,
  radiusSmall: 12,
  radiusPill: 999,
}

/**
 * A 4pt spacing scale.
 *
 * Before this, spacing came from roughly two dozen hand-picked numbers — 3, 5,
 * 6, 7, 9, 11, 13, 14, 18, 22 and 26 all appeared — which is why gaps between
 * comparable things didn't match from one screen to the next. Snap to these.
 * `hair` exists because optical alignment occasionally does need 2pt (icon-to-
 * label kerning, hairline nudges); it is not a licence to invent 7.
 */
export const space = {
  hair: 2,
  xs: 4,
  sm: 8,
  md: 12,
  lg: 16,
  xl: 20,
  xxl: 28,
  xxxl: 40,
  huge: 56,
}

/**
 * Type scale, with line heights baked in.
 *
 * They used to be passed per call site — 46 hand-written `lineHeight`s across
 * the app, several of them different for the same variant, which is how a
 * heading ends up set two different ways on two screens. The values here are
 * the ones the screens had converged on anyway.
 */
export const type = {
  display: { fontSize: 30, lineHeight: 36, fontWeight: "700" as const, letterSpacing: -0.6 },
  title: { fontSize: 22, lineHeight: 28, fontWeight: "700" as const, letterSpacing: -0.4 },
  heading: { fontSize: 17, lineHeight: 22, fontWeight: "600" as const, letterSpacing: -0.2 },
  body: { fontSize: 15, lineHeight: 21, fontWeight: "400" as const },
  label: { fontSize: 13, lineHeight: 17, fontWeight: "600" as const },
  caption: { fontSize: 12, lineHeight: 16, fontWeight: "500" as const },
}

/**
 * Timings and curves, so motion across the app is one system rather than a
 * per-screen guess. Durations are milliseconds.
 *
 * `pressScale` is what a tappable element settles to while held. It is
 * deliberately shallow — at 0.97 a card acknowledges the finger without the
 * toy-like bounce 0.9 gives you, and it reads the same on a 44pt row as on a
 * full-width hero.
 */
export const motion = {
  /** Press-in / press-out. Fast enough to feel like a physical response. */
  press: 110,
  pressScale: 0.97,
  /** Colour and opacity swaps: segment changes, chip selection. */
  fast: 180,
  /** The default for anything the eye should follow — entrances, sliders. */
  base: 260,
  /** Entrance fades, where a slower curve reads as composure rather than lag. */
  entrance: 460,
  /** Gap between staggered siblings arriving in reading order. */
  stagger: 45,
  /**
   * Rows past this index skip the stagger and arrive together. A list that is
   * still animating while you scroll it feels laggy, not composed.
   */
  staggerCap: 8,
  /** expo-image cross-fade as a cached or fetched image resolves. */
  image: 200,
}

/** `motion.stagger` applied to a row index, flattened past `staggerCap`. */
export function staggerDelay(index: number): number {
  return Math.min(index, motion.staggerCap) * motion.stagger
}
