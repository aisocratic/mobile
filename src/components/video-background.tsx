import { Image } from "expo-image"
import { useVideoPlayer, VideoView, type VideoPlayerStatus } from "expo-video"
import React, { useEffect, useRef, useState } from "react"
import { AccessibilityInfo, Animated, StyleSheet, View, type ViewStyle } from "react-native"

import { AUTOPLAY_BUDGET_BYTES, type VideoAsset } from "@/media/assets"

/**
 * A looping, muted background video — the same treatment the website gives its
 * 404 hero and homepage CTA.
 *
 * Decorative by definition: it carries no information, so it is hidden from
 * assistive tech entirely and every failure mode degrades to the poster still
 * rather than to a black rectangle.
 *
 * Three things it refuses to do naively, because a background video is the
 * easiest way to make an app feel expensive and behave cheaply:
 *
 *  - **Never black.** The poster paints first and the video cross-fades in only
 *    once the player reports `readyToPlay`. A cold network on a hero screen
 *    should look like a photograph, not like a crash.
 *  - **Reduce Motion is honoured.** Someone who has asked the system to stop
 *    animating things has asked for exactly this. They get the still, and no
 *    video is downloaded at all — the request is never made.
 *  - **Weight is a decision.** Anything over `AUTOPLAY_BUDGET_BYTES` waits for
 *    `settleMs` before it starts loading, so passing through a screen costs
 *    nothing and only staying on it spends the megabytes. The 404 loop is
 *    7.4 MB; that is not something to fetch because a screen flashed past.
 */
export type VideoBackgroundProps = {
  asset: VideoAsset
  /** Dimmed toward the background so foreground text stays legible. */
  overlay?: React.ReactNode
  /** 0–1. The website plays its CTA loop at 0.4 behind copy. */
  opacity?: number
  style?: ViewStyle
  /**
   * How long a heavy asset must stay on screen before it earns its download.
   * Ignored for assets under the budget, which start immediately.
   */
  settleMs?: number
  /** Pause playback (e.g. the screen lost focus). Frees the decoder. */
  paused?: boolean
}

export function VideoBackground({
  asset,
  overlay,
  opacity = 1,
  style,
  settleMs = 600,
  paused = false,
}: VideoBackgroundProps) {
  const heavy = asset.bytes > AUTOPLAY_BUDGET_BYTES

  // `undefined` means "still asking the system". Rendering video during that
  // window would start a download we might be about to decide against, so the
  // source stays null until the answer is in.
  const [reduceMotion, setReduceMotion] = useState<boolean | undefined>(undefined)
  const [settled, setSettled] = useState(!heavy)
  const [ready, setReady] = useState(false)

  const fade = useRef(new Animated.Value(0)).current

  useEffect(() => {
    let active = true
    AccessibilityInfo.isReduceMotionEnabled()
      .then((enabled) => {
        if (active) setReduceMotion(enabled)
      })
      // A device that won't answer gets motion — the same default as the web,
      // where the query simply doesn't match.
      .catch(() => {
        if (active) setReduceMotion(false)
      })

    const sub = AccessibilityInfo.addEventListener("reduceMotionChanged", setReduceMotion)
    return () => {
      active = false
      sub.remove()
    }
  }, [])

  useEffect(() => {
    if (!heavy || settled) return
    const timer = setTimeout(() => setSettled(true), settleMs)
    return () => clearTimeout(timer)
  }, [heavy, settled, settleMs])

  const wanted = reduceMotion === false && settled
  const player = useVideoPlayer(wanted ? asset.uri : null, (p) => {
    p.loop = true
    p.muted = true
    // Decorative loops must never duck the user's podcast.
    p.audioMixingMode = "mixWithOthers"
    p.play()
  })

  // Cross-fade rather than cut: a hard swap from poster to first frame reads as
  // a flicker even when both images are nearly identical.
  useEffect(() => {
    if (!player) return
    const sub = player.addListener("statusChange", ({ status }: { status: VideoPlayerStatus }) => {
      if (status === "readyToPlay") setReady(true)
      // `error` deliberately leaves `ready` false, which keeps the poster up.
    })
    return () => sub.remove()
  }, [player])

  useEffect(() => {
    if (!ready) return
    Animated.timing(fade, {
      toValue: 1,
      duration: 700,
      useNativeDriver: true,
    }).start()
  }, [ready, fade])

  useEffect(() => {
    if (!player || !ready) return
    if (paused) player.pause()
    else player.play()
  }, [player, ready, paused])

  return (
    <View
      style={[StyleSheet.absoluteFill, { overflow: "hidden" }, style]}
      // Decorative: it says nothing a screen reader should read, and it must
      // not become a stop on the focus path to the buttons in front of it.
      accessibilityElementsHidden
      importantForAccessibility="no-hide-descendants"
      pointerEvents="none"
    >
      <Image
        source={{ uri: asset.poster }}
        style={[StyleSheet.absoluteFill, { opacity }]}
        contentFit="cover"
        // The poster is the fallback for every failure below it, so it is worth
        // keeping on disk between launches.
        cachePolicy="memory-disk"
        transition={300}
      />

      {wanted ? (
        <Animated.View style={[StyleSheet.absoluteFill, { opacity: Animated.multiply(fade, opacity) }]}>
          <VideoView
            player={player}
            style={StyleSheet.absoluteFill}
            contentFit="cover"
            nativeControls={false}
            // `allowsFullscreen` is deprecated in expo-video 3; this is its
            // replacement. Decorative footage has nothing to go fullscreen for.
            fullscreenOptions={{ enable: false }}
            allowsPictureInPicture={false}
          />
        </Animated.View>
      ) : null}

      {overlay}
    </View>
  )
}
