import { Ionicons } from "@expo/vector-icons"
import { Image } from "expo-image"
import { LinearGradient } from "expo-linear-gradient"
import { useRouter } from "expo-router"
import React from "react"
import { Pressable, StyleSheet, View } from "react-native"
import { useSafeAreaInsets } from "react-native-safe-area-context"

import { ChromaticText } from "@/components/chromatic-text"
import { FadeIn } from "@/components/fade-in"
import { Button, Txt } from "@/components/ui"
import { homeRoute } from "@/features"
import { HERO_VIDEO } from "@/media/assets"
import { VideoBackground } from "@/components/video-background"
import { Touchable } from "@/components/touchable"
import { brand, layout, space } from "@/theme"

const HIGHLIGHTS: { icon: keyof typeof Ionicons.glyphMap; title: string; body: string }[] = [
  {
    icon: "calendar-outline",
    title: "Events in 15+ cities",
    body: "Socratic dinners, workshops and demo nights near you.",
  },
  {
    icon: "flash-outline",
    title: "News & essays",
    body: "What actually matters in AI, without the noise.",
  },
  {
    icon: "people-outline",
    title: "Your connections",
    body: "Everyone you've met at an AI Socratic event, in one place.",
  },
]

/**
 * The first screen anyone sees, built on the same loop the website plays behind
 * its 404 — full-bleed motion, a scrim, and type sitting on top of it.
 *
 * The palette is pinned to dark regardless of the device's theme, exactly as
 * the website pins its 404 chrome with `logoVariant="dark"`. The footage is
 * dark at every frame, so a light-mode phone rendering charcoal text over it
 * would be unreadable. This is the one screen in the app that isn't
 * theme-reactive, and it is deliberate.
 */
export default function Welcome() {
  const insets = useSafeAreaInsets()
  const router = useRouter()

  return (
    <View style={{ flex: 1, backgroundColor: "#0A0A0A" }}>
      <VideoBackground
        asset={HERO_VIDEO}
        overlay={
          // Two stacked scrims. The vertical one buys legibility for the copy;
          // the flat one keeps the brightest frames of the loop from washing
          // out the buttons at the bottom.
          <>
            <LinearGradient
              colors={["rgba(10,10,10,0.35)", "rgba(10,10,10,0.75)", "rgba(10,10,10,0.96)"]}
              locations={[0, 0.45, 1]}
              style={StyleSheet.absoluteFill}
            />
            <View style={[StyleSheet.absoluteFill, { backgroundColor: "rgba(10,10,10,0.15)" }]} />
          </>
        }
      />

      <View
        style={{
          flex: 1,
          paddingTop: insets.top + 48,
          paddingBottom: insets.bottom + 24,
          paddingHorizontal: layout.gutter + 4,
        }}
      >
        <FadeIn delay={80}>
          <Image
            source={require("../../assets/ai-socratic-logo-dark.png")}
            style={{ width: 210, height: 60 }}
            contentFit="contain"
          />
        </FadeIn>

        <FadeIn delay={180}>
          <ChromaticText
            variant="display"
            style={{ marginTop: 28 }}
            textStyle={{ fontSize: 34, lineHeight: 40 }}
            intensity={2.1}
          >
            {"The AI community for\nhuman flourishing."}
          </ChromaticText>
        </FadeIn>

        <FadeIn delay={260}>
          <Txt
            variant="body"
            style={{ marginTop: 12, lineHeight: 22, fontSize: 16, color: "rgba(255,255,255,0.72)" }}
          >
            Engineers, researchers and founders thinking out loud together. No fees, no pitch decks.
          </Txt>
        </FadeIn>

        <View style={{ gap: 20, marginTop: 40, flex: 1 }}>
          {HIGHLIGHTS.map((h, i) => (
            <FadeIn key={h.title} delay={360 + i * 90}>
              <View style={{ flexDirection: "row", gap: 14, alignItems: "flex-start" }}>
                <View
                  style={{
                    width: 38,
                    height: 38,
                    borderRadius: 12,
                    backgroundColor: `${brand.amber}2E`,
                    alignItems: "center",
                    justifyContent: "center",
                  }}
                >
                  <Ionicons name={h.icon} size={19} color={brand.amber} />
                </View>
                <View style={{ flex: 1, gap: 2 }}>
                  <Txt variant="heading" style={{ color: "#FFFFFF" }}>
                    {h.title}
                  </Txt>
                  <Txt variant="body" style={{ color: "rgba(255,255,255,0.66)" }}>
                    {h.body}
                  </Txt>
                </View>
              </View>
            </FadeIn>
          ))}
        </View>

        <FadeIn delay={660} style={{ gap: 8 }}>
          <Button label="Create an account" onPress={() => router.push("/(auth)/sign-up")} />
          <Pressable
            accessibilityRole="button"
            onPress={() => router.push("/(auth)/sign-in")}
            style={{ paddingVertical: 12, alignItems: "center" }}
          >
            <Txt variant="body" style={{ color: "rgba(255,255,255,0.66)" }}>
              Already a member? <Txt style={{ color: brand.amber }}>Sign in</Txt>
            </Txt>
          </Pressable>

          {/* AuthGate reaches this screen with replace(), so there's no back
              stack out of it — without this, signed-out users are trapped.
              Follows the feature flags rather than naming a tab. */}
          <Touchable
            accessibilityRole="button"
            onPress={() => router.replace(homeRoute())}
            activeOpacity={0.6}
            style={{ paddingVertical: space.md, alignItems: "center" }}
          >
            <Txt variant="body" style={{ color: "rgba(255,255,255,0.5)" }}>
              Not now — browse events
            </Txt>
          </Touchable>
        </FadeIn>
      </View>
    </View>
  )
}
