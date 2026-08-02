import React, { useEffect, useRef, useState } from "react"
import { AccessibilityInfo, Animated, StyleSheet, View, type ViewStyle } from "react-native"

import { Txt } from "@/components/ui"

/**
 * Chromatic aberration on a headline: the RGB channels pulled apart slightly,
 * the way a fast lens fringes toward the edges of its frame.
 *
 * Built from three stacked copies rather than a blend mode. RN 0.81 does expose
 * `mixBlendMode`, and `screen` would be the textbook way to do this — but its
 * Android support is patchy and a headline that silently renders as three
 * overlapping words on some devices is not worth the extra fidelity. Two
 * tinted, semi-transparent ghosts under a crisp base give the same fringe with
 * no platform caveat, and it reads correctly on light and dark alike.
 *
 * The ghosts are `absoluteFill` inside a container the base text sizes, so they
 * inherit its exact width and wrap identically — no duplicated layout, and
 * nothing shifts when the effect is disabled.
 *
 * Accessibility: the ghosts are decorative duplicates of text that is already
 * present. They are hidden from assistive tech, or a screen reader would read
 * every headline three times. Reduce Motion stops the drift but keeps the
 * static fringe — the aberration is a visual style, not motion; only its
 * animation is.
 */

/** Pulled toward the classic red/cyan split rather than pure RGB primaries. */
const FRINGE_WARM = "#FF2D55"
const FRINGE_COOL = "#00D8FF"

export type ChromaticTextProps = {
  children: string
  /** Any `Txt` variant; `display` is what this is designed around. */
  variant?: React.ComponentProps<typeof Txt>["variant"]
  color?: string
  /** Peak channel separation in points. Above ~3 it stops reading as a lens. */
  intensity?: number
  /** Drift the separation continuously. Ignored under Reduce Motion. */
  animated?: boolean
  style?: ViewStyle
  textStyle?: React.ComponentProps<typeof Txt>["style"]
}

export function ChromaticText({
  children,
  variant = "display",
  color = "#FFFFFF",
  intensity = 1.8,
  animated = true,
  style,
  textStyle,
}: ChromaticTextProps) {
  const [reduceMotion, setReduceMotion] = useState<boolean | undefined>(undefined)
  const drift = useRef(new Animated.Value(0)).current

  useEffect(() => {
    let active = true
    AccessibilityInfo.isReduceMotionEnabled()
      .then((enabled) => {
        if (active) setReduceMotion(enabled)
      })
      .catch(() => {
        if (active) setReduceMotion(false)
      })
    return () => {
      active = false
    }
  }, [])

  useEffect(() => {
    if (!animated || reduceMotion !== false) return

    // Slow, uneven breathing. A short symmetric loop reads as a glitch effect;
    // this is meant to look like an optical property of the type.
    const loop = Animated.loop(
      Animated.sequence([
        Animated.timing(drift, { toValue: 1, duration: 2600, useNativeDriver: true }),
        Animated.timing(drift, { toValue: 0, duration: 3400, useNativeDriver: true }),
      ]),
    )
    loop.start()
    return () => loop.stop()
  }, [animated, reduceMotion, drift])

  // Static separation until the accessibility answer lands, so the fringe never
  // pops in a frame late.
  const moving = animated && reduceMotion === false

  const offset = moving
    ? drift.interpolate({ inputRange: [0, 1], outputRange: [intensity * 0.55, intensity] })
    : intensity * 0.8

  const negOffset = moving
    ? drift.interpolate({ inputRange: [0, 1], outputRange: [-intensity * 0.55, -intensity] })
    : -intensity * 0.8

  const ghost = (tint: string, translateX: Animated.AnimatedInterpolation<number> | number) => (
    <Animated.View
      style={[StyleSheet.absoluteFill, { transform: [{ translateX }] }]}
      accessibilityElementsHidden
      importantForAccessibility="no-hide-descendants"
      pointerEvents="none"
    >
      <Txt variant={variant} color={tint} style={[{ opacity: 0.55 }, textStyle]}>
        {children}
      </Txt>
    </Animated.View>
  )

  return (
    <View style={style}>
      {ghost(FRINGE_WARM, negOffset)}
      {ghost(FRINGE_COOL, offset)}
      <Txt variant={variant} color={color} style={textStyle}>
        {children}
      </Txt>
    </View>
  )
}
