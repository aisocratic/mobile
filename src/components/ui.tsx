import { Ionicons } from "@expo/vector-icons"
import { Image } from "expo-image"
import React, { useCallback, useEffect, useMemo, useRef, useState } from "react"
import {
  ActivityIndicator,
  Pressable,
  ScrollView,
  StyleSheet,
  Text,
  TextInput,
  type TextInputProps,
  type TextProps,
  View,
  type ViewProps,
} from "react-native"

import { FadeIn } from "@/components/fade-in"
import { fire, Touchable } from "@/components/touchable"
import { useMayAnimate } from "@/lib/reduce-motion"
import { layout, motion, space, usePalette, type as typeScale } from "@/theme"

/* ------------------------------------------------------------------ text */

type Variant = keyof typeof typeScale

export function Txt({
  variant = "body",
  color,
  style,
  ...rest
}: TextProps & { variant?: Variant; color?: string }) {
  const p = usePalette()
  return <Text style={[typeScale[variant], { color: color ?? p.text }, style]} {...rest} />
}

export function Muted({ style, ...rest }: TextProps & { variant?: Variant }) {
  const p = usePalette()
  return <Txt variant="caption" color={p.muted} style={style} {...rest} />
}

/**
 * Small all-caps rule label — "MORE STORIES", "HOSTS". Section headings were
 * being spelled out with a `Txt variant="label"` plus the same three style
 * overrides on four different screens; two of them had drifted to a different
 * letter-spacing.
 */
export function SectionLabel({
  children,
  color,
  style,
}: {
  children: React.ReactNode
  color?: string
  style?: TextProps["style"]
}) {
  const p = usePalette()
  return (
    <Txt
      variant="label"
      color={color ?? p.muted}
      style={[{ fontSize: 11, textTransform: "uppercase", letterSpacing: 1 }, style]}
    >
      {children}
    </Txt>
  )
}

/* ---------------------------------------------------------------- layout */

export function Screen({ style, ...rest }: ViewProps) {
  const p = usePalette()
  return <View style={[{ flex: 1, backgroundColor: p.background }, style]} {...rest} />
}

export function Card({ style, ...rest }: ViewProps) {
  const p = usePalette()
  return (
    <View
      style={[
        {
          backgroundColor: p.elevated,
          borderColor: p.border,
          borderWidth: StyleSheet.hairlineWidth,
          borderRadius: layout.radius,
          padding: space.lg,
        },
        style,
      ]}
      {...rest}
    />
  )
}

export function Divider({ inset = 0 }: { inset?: number }) {
  const p = usePalette()
  return (
    <View
      style={{ height: StyleSheet.hairlineWidth, backgroundColor: p.border, marginLeft: inset }}
    />
  )
}

/* --------------------------------------------------------------- buttons */

export function Button({
  label,
  onPress,
  loading,
  disabled,
  variant = "primary",
  icon,
  style,
}: {
  label: string
  onPress?: () => void
  loading?: boolean
  disabled?: boolean
  variant?: "primary" | "secondary" | "ghost"
  icon?: keyof typeof Ionicons.glyphMap
  style?: ViewProps["style"]
}) {
  const p = usePalette()
  const isPrimary = variant === "primary"
  const isGhost = variant === "ghost"

  const bg = isPrimary ? p.primary : isGhost ? "transparent" : p.input
  const fg = isPrimary ? p.primaryText : p.text
  const off = disabled || loading

  return (
    <Touchable
      accessibilityRole="button"
      accessibilityState={{ disabled: !!off, busy: !!loading }}
      onPress={onPress}
      disabled={off}
      // A button is a commitment, unlike a row that just navigates — this is
      // the one place a tap is worth feeling.
      haptic="light"
      style={[
        {
          backgroundColor: bg,
          borderRadius: layout.radiusSmall,
          paddingVertical: space.lg - 2,
          paddingHorizontal: space.lg + space.hair,
          flexDirection: "row",
          alignItems: "center",
          justifyContent: "center",
          gap: space.sm,
          opacity: off ? 0.5 : 1,
          borderWidth: isGhost ? StyleSheet.hairlineWidth : 0,
          borderColor: p.border,
        },
        style,
      ]}
    >
      {loading ? (
        <ActivityIndicator color={fg} size="small" />
      ) : (
        <>
          {icon ? <Ionicons name={icon} size={18} color={fg} /> : null}
          <Txt variant="heading" color={fg}>
            {label}
          </Txt>
        </>
      )}
    </Touchable>
  )
}

/**
 * A bare tappable icon — nav-bar actions, the close on a sheet. Gives them all
 * the same 44pt target and the same press response, which hand-rolled
 * `Pressable`s with `hitSlop={12}` were not doing consistently.
 */
export function IconButton({
  icon,
  onPress,
  label,
  color,
  size = 22,
}: {
  icon: keyof typeof Ionicons.glyphMap
  onPress?: () => void
  label: string
  color?: string
  size?: number
}) {
  const p = usePalette()
  return (
    <Touchable
      accessibilityRole="button"
      accessibilityLabel={label}
      onPress={onPress}
      haptic="light"
      hitSlop={space.md}
      scale={0.9}
      activeOpacity={0.6}
      style={{ padding: space.xs, alignItems: "center", justifyContent: "center" }}
    >
      <Ionicons name={icon} size={size} color={color ?? p.text} />
    </Touchable>
  )
}

/* ----------------------------------------------------------------- input */

export function Field({
  label,
  error,
  style,
  onFocus,
  onBlur,
  ...rest
}: TextInputProps & { label?: string; error?: string | null }) {
  const p = usePalette()
  const [focused, setFocused] = useState(false)

  return (
    <View style={{ gap: space.xs + space.hair }}>
      {label ? (
        <Txt variant="label" color={p.muted}>
          {label}
        </Txt>
      ) : null}
      <TextInput
        placeholderTextColor={p.muted}
        // Destructured out of `rest` on purpose: spreading `rest` below would
        // otherwise put the caller's handler back over these and the focus
        // ring would never light up.
        onFocus={(e) => {
          setFocused(true)
          onFocus?.(e)
        }}
        onBlur={(e) => {
          setFocused(false)
          onBlur?.(e)
        }}
        style={[
          {
            backgroundColor: p.input,
            borderRadius: layout.radiusSmall,
            borderWidth: StyleSheet.hairlineWidth,
            // The focused ring is the only affordance telling you which field
            // the keyboard is pointed at once more than one is on screen.
            borderColor: error ? p.danger : focused ? p.accent : p.border,
            paddingHorizontal: space.md + space.hair,
            paddingVertical: space.md + 1,
            fontSize: 16,
            color: p.text,
          },
          style,
        ]}
        {...rest}
      />
      {error ? (
        <Txt variant="caption" color={p.danger}>
          {error}
        </Txt>
      ) : null}
    </View>
  )
}

/* ----------------------------------------------------------------- chips */

export function Chip({ label, tone }: { label: string; tone?: "accent" | "muted" }) {
  const p = usePalette()
  const accent = tone === "accent"
  return (
    <View
      style={{
        paddingHorizontal: space.sm + space.hair,
        paddingVertical: space.xs,
        borderRadius: layout.radiusPill,
        backgroundColor: accent ? `${p.accent}22` : p.input,
        borderWidth: StyleSheet.hairlineWidth,
        borderColor: accent ? `${p.accent}55` : p.border,
      }}
    >
      <Txt variant="caption" color={accent ? p.accent : p.muted}>
        {label}
      </Txt>
    </View>
  )
}

type Measured = { x: number; width: number; height: number }

/**
 * Where the filter row must scroll so the selected chip is fully visible, or
 * `null` when it already is — in which case the row must not move at all.
 *
 * Exported for tests: this is the decision that used to cause the bug where
 * tapping any chip snapped the whole row to put that chip at the left edge,
 * a layout jump on every selection. Scrolling is now the exception (chip
 * clipped by an edge) and travels the minimum distance, with a gutter of
 * breathing room so a rescued chip doesn't sit flush against the edge.
 */
export function segmentScrollTarget(
  chip: Measured,
  scrollX: number,
  viewportWidth: number,
): number | null {
  const left = chip.x - layout.gutter
  const right = chip.x + chip.width + layout.gutter
  if (left < scrollX) return Math.max(0, left)
  if (right > scrollX + viewportWidth) return right - viewportWidth
  return null
}

/**
 * A horizontal filter bar. The selection changes instantly — this control used
 * to slide a pill between options, and on a row you retap several times in a
 * row the travel read as lag, not polish. Frames are still measured, but only
 * to keep the selected chip scrolled into view on rows wider than the screen.
 *
 * Selection restyles a chip with colour only (background, border, text) — the
 * padding, border width and font metrics are identical in both states, so a
 * chip never changes width when it becomes selected and its siblings never
 * shift.
 */
export function SegmentedControl<T extends string>({
  options,
  value,
  onChange,
}: {
  options: { value: T; label: string }[]
  value: T
  onChange: (v: T) => void
}) {
  const p = usePalette()
  const mayAnimate = useMayAnimate()
  const scroller = useRef<ScrollView>(null)
  // Refs, not state: the current offset and viewport width only matter at the
  // moment a selection lands, and tracking them as state would re-render the
  // whole row on every scroll frame.
  const scrollX = useRef(0)
  const viewportWidth = useRef(0)
  const [frames, setFrames] = useState<Record<string, Measured>>({})

  const onLayoutOption = useCallback((key: string, frame: Measured) => {
    setFrames((prev) => {
      const known = prev[key]
      if (known && known.x === frame.x && known.width === frame.width) return prev
      return { ...prev, [key]: frame }
    })
  }, [])

  const target = frames[value]

  // Keep the selection reachable: on Feed the topic list is far wider than the
  // screen, and selecting the last chip used to leave it half off the edge.
  // But only when the chip is actually clipped — an unconditional scroll here
  // shifted the row on every tap, a layout jump for chips in plain view.
  useEffect(() => {
    if (!target || !viewportWidth.current) return
    const x = segmentScrollTarget(target, scrollX.current, viewportWidth.current)
    if (x !== null) scroller.current?.scrollTo({ x, animated: mayAnimate })
  }, [target, mayAnimate])

  return (
    <ScrollView
      ref={scroller}
      horizontal
      showsHorizontalScrollIndicator={false}
      onLayout={(e) => {
        viewportWidth.current = e.nativeEvent.layout.width
      }}
      onScroll={(e) => {
        scrollX.current = e.nativeEvent.contentOffset.x
      }}
      scrollEventThrottle={16}
      contentContainerStyle={{ gap: space.sm, paddingHorizontal: layout.gutter }}
    >
      {options.map((o) => {
        const active = o.value === value
        return (
          <Pressable
            key={o.value}
            accessibilityRole="tab"
            accessibilityState={{ selected: active }}
            onPress={() => {
              // The one gesture iOS itself gives a haptic to: moving a
              // selection. Skipped when you tap the option already selected,
              // which produces no movement to feel.
              if (!active) fire("selection")
              onChange(o.value)
            }}
            onLayout={(e) => onLayoutOption(o.value, e.nativeEvent.layout)}
            style={{
              paddingHorizontal: space.md + space.hair,
              paddingVertical: space.sm,
              borderRadius: layout.radiusPill,
              backgroundColor: active ? p.primary : p.input,
              borderWidth: StyleSheet.hairlineWidth,
              borderColor: active ? p.primary : p.border,
            }}
          >
            <Txt variant="label" color={active ? p.primaryText : p.muted}>
              {o.label}
            </Txt>
          </Pressable>
        )
      })}
    </ScrollView>
  )
}

/* ---------------------------------------------------------------- avatar */

export function Avatar({
  uri,
  name,
  size = 44,
}: {
  uri?: string | null
  name?: string | null
  size?: number
}) {
  const p = usePalette()
  const initials = useMemo(
    () =>
      (name ?? "?")
        .split(/\s+/)
        .filter(Boolean)
        .slice(0, 2)
        .map((w) => w[0]?.toUpperCase())
        .join(""),
    [name],
  )

  if (uri) {
    return (
      <Image
        source={{ uri }}
        style={{ width: size, height: size, borderRadius: size / 2, backgroundColor: p.input }}
        contentFit="cover"
        transition={motion.image}
        cachePolicy="memory-disk"
      />
    )
  }

  return (
    <View
      style={{
        width: size,
        height: size,
        borderRadius: size / 2,
        backgroundColor: p.input,
        alignItems: "center",
        justifyContent: "center",
        borderWidth: StyleSheet.hairlineWidth,
        borderColor: p.border,
      }}
    >
      <Txt variant="label" color={p.muted} style={size < 32 ? { fontSize: 10 } : undefined}>
        {initials || "?"}
      </Txt>
    </View>
  )
}

/* --------------------------------------------------------------- states */

export function Loading({ label }: { label?: string }) {
  const p = usePalette()
  return (
    <View
      style={{
        flex: 1,
        alignItems: "center",
        justifyContent: "center",
        gap: space.md,
        padding: space.xxxl,
      }}
    >
      <ActivityIndicator color={p.accent} />
      {label ? <Muted>{label}</Muted> : null}
    </View>
  )
}

export function EmptyState({
  icon = "sparkles-outline",
  title,
  body,
  action,
}: {
  icon?: keyof typeof Ionicons.glyphMap
  title: string
  body?: string
  action?: React.ReactNode
}) {
  const p = usePalette()
  return (
    // An empty state is always a small disappointment; letting it settle in
    // rather than snap in takes the edge off. The icon gets a soft plate so it
    // reads as a considered state and not as a missing image.
    <FadeIn
      style={{
        alignItems: "center",
        gap: space.sm + space.hair,
        paddingVertical: space.huge,
        paddingHorizontal: space.xxl + space.xs,
      }}
    >
      <View
        style={{
          width: space.huge,
          height: space.huge,
          borderRadius: space.huge / 2,
          backgroundColor: p.input,
          alignItems: "center",
          justifyContent: "center",
          marginBottom: space.xs,
        }}
      >
        <Ionicons name={icon} size={26} color={p.muted} />
      </View>
      <Txt variant="heading" style={{ textAlign: "center" }}>
        {title}
      </Txt>
      {body ? (
        <Txt variant="body" color={p.muted} style={{ textAlign: "center" }}>
          {body}
        </Txt>
      ) : null}
      {action ? <View style={{ marginTop: space.sm }}>{action}</View> : null}
    </FadeIn>
  )
}

export function ErrorState({ error, onRetry }: { error: unknown; onRetry?: () => void }) {
  const message = error instanceof Error ? error.message : "Something went wrong."
  return (
    <EmptyState
      icon="cloud-offline-outline"
      title="Couldn't load that"
      body={message}
      action={onRetry ? <Button label="Try again" variant="secondary" onPress={onRetry} /> : null}
    />
  )
}
