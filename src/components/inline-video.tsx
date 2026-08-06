import { Ionicons } from "@expo/vector-icons"
import { Image } from "expo-image"
import { useVideoPlayer, VideoView, type VideoPlayerStatus } from "expo-video"
import React, { useEffect, useState } from "react"
import {
  ActivityIndicator,
  StyleSheet,
  View,
  type StyleProp,
  type ViewStyle,
} from "react-native"

import { Touchable } from "@/components/touchable"
import { useMayAnimate } from "@/lib/reduce-motion"
import { layout, motion, space, usePalette } from "@/theme"

/**
 * A video that is *content* — a story cover that happens to be a clip, an .mp4
 * embedded in a markdown body — as opposed to `VideoBackground`, which is
 * decoration and hides itself from assistive tech entirely.
 *
 * The defaults are the boring, correct ones:
 *
 *  - **Contained, never fullscreen-jacking.** It renders in its own 16:9 box
 *    with no native chrome; tapping it toggles play/pause rather than taking
 *    over the screen.
 *  - **Reduce Motion is a gate, not a suggestion.** Autoplay (muted, looping)
 *    only happens once the system has said motion is fine. Under Reduce Motion
 *    — or while the answer is still unknown — the poster sits still behind an
 *    explicit play control, and no video bytes are fetched until it is used.
 *  - **Nulls are normal.** Production rows are full of missing URLs: no `uri`
 *    means the poster alone, and no poster either means nothing at all.
 *    Playback errors keep the poster up rather than showing a black box.
 *  - **Muted until asked.** Inline video must never duck the reader's podcast;
 *    a small toggle unmutes on request.
 */
export type InlineVideoProps = {
  uri: string | null | undefined
  /** Still shown before the first frame, and instead of it while paused. */
  poster?: string | null
  /** What the play control says it plays, e.g. the story title. */
  label?: string | null
  aspectRatio?: number
  /**
   * Interactive by default: the surface itself is the play/pause toggle. Turn
   * off when the video sits inside an element that already owns the tap (a
   * feed card), where it behaves like a cover image that happens to move.
   */
  interactive?: boolean
  style?: StyleProp<ViewStyle>
}

export function InlineVideo({
  uri,
  poster,
  label,
  aspectRatio = 16 / 9,
  interactive = true,
  style,
}: InlineVideoProps) {
  const p = usePalette()
  const mayAutoplay = useMayAnimate()

  const source = uri?.trim() || null

  // "none" until the reader has said something; autoplay only fills that gap,
  // and only while the system allows motion. An explicit tap always wins over
  // the accessibility default in both directions.
  const [intent, setIntent] = useState<"none" | "play" | "pause">("none")
  const wantsPlay = intent === "none" ? mayAutoplay : intent === "play"

  // Once playback has ever been wanted the player keeps its source, so pausing
  // doesn't throw away the download or the current frame. Until then the
  // source stays null and nothing is fetched.
  const [started, setStarted] = useState(false)
  useEffect(() => {
    if (wantsPlay && source) setStarted(true)
  }, [wantsPlay, source])

  const [ready, setReady] = useState(false)
  const [failed, setFailed] = useState(false)
  const [muted, setMuted] = useState(true)

  const player = useVideoPlayer(started ? source : null, (pl) => {
    pl.loop = true
    pl.muted = true
    // Inline clips must never duck whatever the reader is listening to.
    pl.audioMixingMode = "mixWithOthers"
  })

  useEffect(() => {
    if (!player) return
    const sub = player.addListener("statusChange", ({ status }: { status: VideoPlayerStatus }) => {
      if (status === "readyToPlay") setReady(true)
      // `error` keeps `ready` false, which keeps the poster up instead of a
      // black rectangle.
      if (status === "error") setFailed(true)
    })
    return () => sub.remove()
  }, [player])

  useEffect(() => {
    if (!player || !started) return
    if (wantsPlay) player.play()
    else player.pause()
  }, [player, started, wantsPlay])

  useEffect(() => {
    if (player) player.muted = muted
  }, [player, muted])

  // Nothing to show at all — common in production data, and not a crash.
  if (!source && !poster) return null

  const playable = !!source && !failed
  const showPlayControl = playable && !wantsPlay
  const showSpinner = playable && wantsPlay && started && !ready

  const a11yLabel = `${wantsPlay ? "Pause" : "Play"} video${label ? `: ${label}` : ""}`

  const box: ViewStyle = {
    width: "100%",
    aspectRatio,
    borderRadius: layout.radiusSmall,
    overflow: "hidden",
    backgroundColor: p.input,
  }

  const body = (
    <>
      {started ? (
        <VideoView
          player={player}
          style={StyleSheet.absoluteFill}
          contentFit="cover"
          nativeControls={false}
          fullscreenOptions={{ enable: false }}
          allowsPictureInPicture={false}
        />
      ) : null}

      {/* The poster paints first and stays until the first real frame. */}
      {!ready && poster ? (
        <Image
          source={{ uri: poster }}
          style={StyleSheet.absoluteFill}
          contentFit="cover"
          cachePolicy="memory-disk"
          transition={motion.image}
        />
      ) : null}

      {showPlayControl || showSpinner ? (
        <View
          pointerEvents="none"
          style={[StyleSheet.absoluteFill, { alignItems: "center", justifyContent: "center" }]}
        >
          <View
            style={{
              width: 52,
              height: 52,
              borderRadius: layout.radiusPill,
              backgroundColor: "rgba(0,0,0,0.45)",
              alignItems: "center",
              justifyContent: "center",
            }}
          >
            {showSpinner ? (
              <ActivityIndicator color="#FFFFFF" />
            ) : (
              // Nudged right so the triangle reads as centred.
              <Ionicons name="play" size={24} color="#FFFFFF" style={{ marginLeft: space.hair }} />
            )}
          </View>
        </View>
      ) : null}
    </>
  )

  if (!interactive) {
    // Inside a card the tap belongs to the card; this is a cover that moves.
    return (
      <View
        testID="inline-video"
        style={[box, style]}
        pointerEvents="none"
        importantForAccessibility="no-hide-descendants"
        accessibilityElementsHidden
      >
        {body}
      </View>
    )
  }

  return (
    <Touchable
      testID="inline-video"
      accessibilityRole="button"
      accessibilityLabel={a11yLabel}
      // A full-width video shrinking under the finger reads as the screen
      // flinching; the opacity dip alone is acknowledgement enough.
      scale={1}
      disabled={!playable}
      onPress={() => setIntent(wantsPlay ? "pause" : "play")}
      style={[box, style]}
    >
      {body}

      {/* Muted is the default; sound is opt-in per video. */}
      {playable && started ? (
        <Touchable
          accessibilityRole="button"
          accessibilityLabel={muted ? "Unmute" : "Mute"}
          scale={1}
          onPress={() => setMuted((m) => !m)}
          style={{
            position: "absolute",
            right: space.sm,
            bottom: space.sm,
            width: 30,
            height: 30,
            borderRadius: layout.radiusPill,
            backgroundColor: "rgba(0,0,0,0.45)",
            alignItems: "center",
            justifyContent: "center",
          }}
        >
          <Ionicons name={muted ? "volume-mute" : "volume-high"} size={15} color="#FFFFFF" />
        </Touchable>
      ) : null}
    </Touchable>
  )
}
