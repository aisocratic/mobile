import React, { useEffect, useRef, useState } from "react"
import { AccessibilityInfo, Animated, type ViewStyle } from "react-native"

/**
 * Entrance animation: fade up into place, once, on mount.
 *
 * Used to stagger a screen's content in rather than having it appear all at
 * once — the thing that makes a native screen feel composed instead of dumped.
 * Give siblings increasing `delay` values and they arrive in reading order.
 *
 * Reduce Motion short-circuits the whole thing: children render at their final
 * position with no animation and no frame of invisibility. That last part
 * matters — a naive implementation starts at `opacity: 0` and waits for the
 * accessibility answer, which makes "reduce motion" mean "content flashes in
 * late", the opposite of the request.
 */
export type FadeInProps = {
  children: React.ReactNode
  /** Milliseconds before this element starts. Stagger siblings with it. */
  delay?: number
  duration?: number
  /** Points to travel upward while fading in. 0 fades in place. */
  offset?: number
  style?: ViewStyle
}

export function FadeIn({
  children,
  delay = 0,
  duration = 520,
  offset = 14,
  style,
}: FadeInProps) {
  // `undefined` until the system answers. Nothing animates in that window, and
  // nothing is hidden either — see the note above.
  const [reduceMotion, setReduceMotion] = useState<boolean | undefined>(undefined)

  const progress = useRef(new Animated.Value(0)).current

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
    if (reduceMotion !== false) return
    const animation = Animated.timing(progress, {
      toValue: 1,
      duration,
      delay,
      useNativeDriver: true,
    })
    animation.start()
    return () => animation.stop()
  }, [reduceMotion, progress, delay, duration])

  if (reduceMotion !== false) return <Animated.View style={style}>{children}</Animated.View>

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
