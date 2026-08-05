import { LinearGradient } from "expo-linear-gradient"
import React from "react"
import { StyleSheet, View } from "react-native"

import { ChromaticText } from "@/components/chromatic-text"
import { FadeIn } from "@/components/fade-in"
import { Txt } from "@/components/ui"
import { CTA_VIDEO } from "@/media/assets"
import { VideoBackground } from "@/components/video-background"
import { layout } from "@/theme"

/**
 * The masthead at the top of the Events list — same family as `FeedMasthead`,
 * dialed for a tab that is browsed rather than read every day.
 *
 * Deliberately not identical to the Feed's: a touch shorter (events is a list
 * of rows, not a hero-first feed), a warmer scrim tying the band to the amber
 * accent events use elsewhere, and the video sits a shade dimmer since there's
 * no featured story competing for the same contrast budget below it.
 *
 * Shares the CTA loop with Feed rather than the 404 hero for the same reason
 * Feed does: this mounts every time the tab opens, and 266 KB is cheap enough
 * to pay for that.
 */
export function EventsMasthead() {
  return (
    <View style={{ height: 156, overflow: "hidden" }}>
      <VideoBackground
        asset={CTA_VIDEO}
        opacity={0.45}
        overlay={
          <LinearGradient
            colors={["rgba(20,12,2,0.6)", "rgba(20,12,2,0.4)", "rgba(10,10,10,0.88)"]}
            style={StyleSheet.absoluteFill}
          />
        }
      />

      <View
        style={{
          flex: 1,
          justifyContent: "flex-end",
          paddingHorizontal: layout.gutter,
          paddingBottom: 18,
          gap: 4,
        }}
      >
        <FadeIn delay={60}>
          <ChromaticText variant="display" textStyle={{ fontSize: 28, lineHeight: 33 }}>
            Events
          </ChromaticText>
        </FadeIn>
        <FadeIn delay={150}>
          <Txt
            variant="body"
            style={{ color: "rgba(255,255,255,0.7)", fontSize: 14, lineHeight: 19 }}
          >
            Talks, meetups, and socratic salons — in person and online.
          </Txt>
        </FadeIn>
      </View>
    </View>
  )
}
