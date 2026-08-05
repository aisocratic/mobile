import { LinearGradient } from "expo-linear-gradient"
import { useRouter } from "expo-router"
import React from "react"
import { StyleSheet, View } from "react-native"

import { ChromaticText } from "@/components/chromatic-text"
import { FadeIn } from "@/components/fade-in"
import { Button, Txt } from "@/components/ui"
import { isEnabled } from "@/features"
import { CTA_VIDEO } from "@/media/assets"
import { VideoBackground } from "@/components/video-background"
import { layout } from "@/theme"

/**
 * The "Let's connect and build together" band, ported from the bottom of
 * aisocratic.org's homepage — same loop, same 40% opacity, same stacked
 * gradient over it.
 *
 * It sits at the end of a scroll rather than in the middle of one, which is
 * what makes the video affordable: the mobile encode is 266 KB, and it only
 * starts once someone has scrolled far enough to mount this.
 */
export function CommunityCta() {
  const router = useRouter()

  return (
    <View style={{ height: 320, marginTop: 32, overflow: "hidden" }}>
      <VideoBackground
        asset={CTA_VIDEO}
        // The website plays this at opacity-40 behind its copy. Matching it
        // keeps the two surfaces recognisably the same moment.
        opacity={0.4}
        overlay={
          <LinearGradient
            colors={["rgba(0,0,0,0.60)", "rgba(0,0,0,0.40)", "rgba(0,0,0,0.70)"]}
            style={StyleSheet.absoluteFill}
          />
        }
      />

      <View
        style={{
          flex: 1,
          justifyContent: "center",
          paddingHorizontal: layout.gutter + 4,
          gap: 14,
        }}
      >
        <FadeIn delay={60}>
          <ChromaticText
            variant="display"
            textStyle={{ fontSize: 26, lineHeight: 32, textAlign: "center" }}
            intensity={1.5}
          >
            {"Let's connect and build together"}
          </ChromaticText>
        </FadeIn>

        <FadeIn delay={140}>
          <Txt
            variant="body"
            style={{ color: "rgba(255,255,255,0.76)", textAlign: "center" }}
          >
            A global network of AI builders shaping the future together. Start a chapter, contribute
            to research, or find the people near you.
          </Txt>
        </FadeIn>

        <FadeIn delay={220} style={{ marginTop: 6 }}>
          <Button
            label={isEnabled("events") ? "Find an event near you" : "Explore the community"}
            icon="calendar-outline"
            onPress={() =>
              router.push(isEnabled("events") ? "/(tabs)/events" : "/(tabs)/profile")
            }
          />
        </FadeIn>
      </View>
    </View>
  )
}
