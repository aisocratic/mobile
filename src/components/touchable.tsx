import * as Haptics from "expo-haptics"
import React, { useCallback, useRef } from "react"
import {
  Animated,
  Pressable,
  type PressableProps,
  type StyleProp,
  type ViewStyle,
} from "react-native"

import { useMayAnimate } from "@/lib/reduce-motion"
import { motion } from "@/theme"

/**
 * Which physical response a tap earns, if any.
 *
 * Deliberately not the default: a phone that buzzes every time you open a list
 * row is the single fastest way to make a considered app feel cheap. iOS
 * itself doesn't vibrate when you tap a table cell. Reserve it for the two
 * cases where the platform does — committing an action (`light`) and moving a
 * selection (`selection`) — and leave navigation silent.
 */
export type Haptic = "none" | "selection" | "light" | "medium" | "success" | "error"

/** Fire a haptic directly, for controls that aren't a `Touchable`. */
export function fire(haptic: Haptic) {
  switch (haptic) {
    case "selection":
      void Haptics.selectionAsync()
      break
    case "light":
      void Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Light)
      break
    case "medium":
      void Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Medium)
      break
    case "success":
      void Haptics.notificationAsync(Haptics.NotificationFeedbackType.Success)
      break
    case "error":
      void Haptics.notificationAsync(Haptics.NotificationFeedbackType.Error)
      break
    case "none":
      break
  }
}

export type TouchableProps = Omit<PressableProps, "style" | "children"> & {
  children: React.ReactNode
  style?: StyleProp<ViewStyle>
  /** Scale settled to while held. `1` opts out and leaves only the fade. */
  scale?: number
  /** Opacity while held. */
  activeOpacity?: number
  haptic?: Haptic
}

/**
 * The animation rides the pressable itself rather than a view inside it.
 *
 * Wrapping the content in an inner `Animated.View` and styling that is the
 * obvious build, and it is subtly wrong: layout style — `flex: 1`, `width` —
 * would then apply to the inner box while the `Pressable` sitting in the parent
 * flex row still sized itself to its content. A full-width primary button
 * silently shrank to the width of its label. One node carries layout,
 * background and transform together.
 */
const AnimatedPressable = Animated.createAnimatedComponent(Pressable)

/**
 * The app's one tappable surface: a shallow scale-and-fade under the finger.
 *
 * It replaces ten different hand-written press states — `opacity` values of
 * 0.5, 0.6, 0.7, 0.8, 0.85 and 0.9, plus two rows that swapped a background
 * colour instead — which meant the same gesture on two screens gave two
 * different answers. Feedback should be a property of the app, not of whoever
 * wrote the screen.
 *
 * Scale is driven on the native thread, so it stays smooth while JS is busy
 * rendering the destination screen. Under Reduce Motion the scale is dropped
 * and only the opacity change remains: still unmistakably a press, with
 * nothing moving.
 */
export function Touchable({
  children,
  style,
  scale = motion.pressScale,
  activeOpacity = 0.85,
  haptic = "none",
  onPressIn,
  onPressOut,
  onPress,
  disabled,
  ...rest
}: TouchableProps) {
  const mayAnimate = useMayAnimate()
  const progress = useRef(new Animated.Value(0)).current

  const animate = useCallback(
    (to: number) => {
      Animated.timing(progress, {
        toValue: to,
        duration: motion.press,
        useNativeDriver: true,
      }).start()
    },
    [progress],
  )

  const handlePressIn = useCallback<NonNullable<PressableProps["onPressIn"]>>(
    (event) => {
      animate(1)
      onPressIn?.(event)
    },
    [animate, onPressIn],
  )

  const handlePressOut = useCallback<NonNullable<PressableProps["onPressOut"]>>(
    (event) => {
      animate(0)
      onPressOut?.(event)
    },
    [animate, onPressOut],
  )

  const handlePress = useCallback<NonNullable<PressableProps["onPress"]>>(
    (event) => {
      // Fired on press rather than press-in: the tap has committed by then, so
      // a scroll that begins on top of a row never buzzes.
      if (haptic !== "none") fire(haptic)
      onPress?.(event)
    },
    [haptic, onPress],
  )

  const opacity = progress.interpolate({ inputRange: [0, 1], outputRange: [1, activeOpacity] })

  const animatedStyle = {
    opacity,
    transform:
      mayAnimate && scale !== 1
        ? [{ scale: progress.interpolate({ inputRange: [0, 1], outputRange: [1, scale] }) }]
        : [],
  }

  return (
    <AnimatedPressable
      onPressIn={disabled ? undefined : handlePressIn}
      onPressOut={disabled ? undefined : handlePressOut}
      onPress={disabled ? undefined : handlePress}
      disabled={disabled}
      style={[style, animatedStyle]}
      {...rest}
    >
      {children}
    </AnimatedPressable>
  )
}
