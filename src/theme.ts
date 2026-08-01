import { useColorScheme } from "react-native"

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

export function usePalette(): Palette {
  return useColorScheme() === "dark" ? darkPalette : lightPalette
}

export function useIsDark(): boolean {
  return useColorScheme() === "dark"
}

export const layout = {
  gutter: 20,
  radius: 18,
  radiusSmall: 12,
  radiusPill: 999,
}

export const type = {
  display: { fontSize: 30, fontWeight: "700" as const, letterSpacing: -0.6 },
  title: { fontSize: 22, fontWeight: "700" as const, letterSpacing: -0.4 },
  heading: { fontSize: 17, fontWeight: "600" as const, letterSpacing: -0.2 },
  body: { fontSize: 15, fontWeight: "400" as const },
  label: { fontSize: 13, fontWeight: "600" as const },
  caption: { fontSize: 12, fontWeight: "500" as const },
}
