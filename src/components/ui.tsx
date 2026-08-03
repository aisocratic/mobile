import { Ionicons } from "@expo/vector-icons"
import { Image } from "expo-image"
import React, { useCallback, useEffect, useMemo, useRef, useState } from "react"
import {
  ActivityIndicator,
  Animated,
  Easing,
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
 * A horizontal filter bar whose selection *travels* between options rather
 * than blinking from one to the next.
 *
 * The pill is a single view behind the labels, animated to the measured frame
 * of whichever option is selected. That costs a layout pass per option, but it
 * buys the thing that makes the control feel native: you can see where the
 * selection went, so changing a filter reads as moving through one list rather
 * than being handed a different one. The selected option is also scrolled into
 * view, which matters on Feed where the topic row runs well past the screen.
 *
 * Width and position can't ride the native driver, so this animates on the JS
 * thread — a single small view for ~260ms, which is nothing, and the
 * alternative (`scaleX` on a fixed-width pill) distorts the pill's corner
 * radius as it moves.
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
  const [frames, setFrames] = useState<Record<string, Measured>>({})

  const left = useRef(new Animated.Value(0)).current
  const width = useRef(new Animated.Value(0)).current
  // Until the first frame is measured the pill has no width, so it must not be
  // painted — a zero-width rounded rect at x=0 is a visible speck.
  const opacity = useRef(new Animated.Value(0)).current
  const placed = useRef(false)

  const onLayoutOption = useCallback((key: string, frame: Measured) => {
    setFrames((prev) => {
      const known = prev[key]
      if (known && known.x === frame.x && known.width === frame.width) return prev
      return { ...prev, [key]: frame }
    })
  }, [])

  const target = frames[value]

  useEffect(() => {
    if (!target) return

    if (!placed.current || !mayAnimate) {
      // First placement, or Reduce Motion: be where you belong immediately.
      placed.current = true
      left.setValue(target.x)
      width.setValue(target.width)
      opacity.setValue(1)
      return
    }

    const animation = Animated.parallel([
      Animated.timing(left, {
        toValue: target.x,
        duration: motion.base,
        easing: Easing.out(Easing.cubic),
        useNativeDriver: false,
      }),
      Animated.timing(width, {
        toValue: target.width,
        duration: motion.base,
        easing: Easing.out(Easing.cubic),
        useNativeDriver: false,
      }),
    ])
    animation.start()
    return () => animation.stop()
  }, [target, mayAnimate, left, width, opacity])

  // Keep the selection reachable: on Feed the topic list is far wider than the
  // screen, and selecting the last chip used to leave it half off the edge.
  useEffect(() => {
    if (!target) return
    scroller.current?.scrollTo({
      x: Math.max(0, target.x - layout.gutter * 2),
      animated: mayAnimate,
    })
  }, [target, mayAnimate])

  const height = target?.height ?? 0

  return (
    <ScrollView
      ref={scroller}
      horizontal
      showsHorizontalScrollIndicator={false}
      contentContainerStyle={{ gap: space.sm, paddingHorizontal: layout.gutter }}
    >
      <Animated.View
        pointerEvents="none"
        style={{
          position: "absolute",
          left,
          width,
          height,
          opacity,
          top: 0,
          borderRadius: layout.radiusPill,
          backgroundColor: p.primary,
        }}
      />
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
              // The pill behind carries the selected fill; unselected options
              // keep their own so the row still reads as a set of controls.
              backgroundColor: active ? "transparent" : p.input,
              borderWidth: StyleSheet.hairlineWidth,
              borderColor: active ? "transparent" : p.border,
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
