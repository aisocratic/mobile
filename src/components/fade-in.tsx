import React, { useEffect, useRef } from "react"
import { Animated, Easing, type ViewStyle } from "react-native"

import { useMayAnimate } from "@/lib/reduce-motion"
import { motion, staggerDelay } from "@/theme"

/**
 * Entrance animation: fade up into place, once, on mount.
 *
 * Used to stagger a screen's content in rather than having it appear all at
 * once — the thing that makes a native screen feel composed instead of dumped.
 * Give siblings increasing `delay` values and they arrive in reading order, or
 * pass `index` and let `staggerDelay` space them on the shared rhythm.
 *
 * Reduce Motion short-circuits the whole thing: children render at their final
 * position with no animation and no frame of invisibility. That last part
 * matters — a naive implementation starts at `opacity: 0` and waits for the
 * accessibility answer, which makes "reduce motion" mean "content flashes in
 * late", the opposite of the request. See `src/lib/reduce-motion.ts`.
 */
export type FadeInProps = {
  children: React.ReactNode
  /** Milliseconds before this element starts. Stagger siblings with it. */
  delay?: number
  /** Row position, converted to a delay on the app's shared stagger rhythm. */
  index?: number
  duration?: number
  /** Points to travel upward while fading in. 0 fades in place. */
  offset?: number
  style?: ViewStyle
}

export function FadeIn({
  children,
  delay,
  index,
  duration = motion.entrance,
  offset = 14,
  style,
}: FadeInProps) {
  const mayAnimate = useMayAnimate()
  const progress = useRef(new Animated.Value(0)).current

  const startAfter = delay ?? (index === undefined ? 0 : staggerDelay(index))

  useEffect(() => {
    if (!mayAnimate) return
    const animation = Animated.timing(progress, {
      toValue: 1,
      duration,
      delay: startAfter,
      // Decelerating: quick to commit, slow to settle. A linear fade reads as
      // a cross-dissolve; this reads as something arriving.
      easing: Easing.out(Easing.cubic),
      useNativeDriver: true,
    })
    animation.start()
    return () => animation.stop()
  }, [mayAnimate, progress, startAfter, duration])

  if (!mayAnimate) return <Animated.View style={style}>{children}</Animated.View>

  return (
    <Animated.View
      style={[
        style,
        {
          opacity: progress,
          transform: [
            {
              translateY: progress.interpolate({
                inputRange: [0, 1],
                outputRange: [offset, 0],
              }),
            },
          ],
        },
      ]}
    >
      {children}
    </Animated.View>
  )
}
