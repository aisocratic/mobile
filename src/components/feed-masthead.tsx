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
 * The masthead at the top of the Feed.
 *
 * This is the one piece of the redesign a signed-in member sees every single
 * time they open the app, which is why the motion lives here rather than only
 * on the welcome screen — that screen is beautiful and almost nobody sees it
 * twice.
 *
 * It reuses the homepage CTA loop rather than the 404 hero on purpose: 266 KB
 * against 7.4 MB, for something that mounts on every cold start. The 404 loop
 * is reserved for the welcome screen, where it plays once and earns its weight.
 */
export function FeedMasthead() {
  return (
    <View style={{ height: 168, overflow: "hidden" }}>
      <VideoBackground
        asset={CTA_VIDEO}
        opacity={0.55}
        overlay={
          <LinearGradient
            colors={["rgba(10,10,10,0.55)", "rgba(10,10,10,0.35)", "rgba(10,10,10,0.85)"]}
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
          <ChromaticText variant="display" textStyle={{ fontSize: 30, lineHeight: 35 }}>
            AI Socratic
          </ChromaticText>
        </FadeIn>
        <FadeIn delay={150}>
          <Txt
            variant="body"
            style={{ color: "rgba(255,255,255,0.7)", fontSize: 14, lineHeight: 19 }}
          >
            What actually matters in AI, without the noise.
          </Txt>
        </FadeIn>
      </View>
    </View>
  )
}
