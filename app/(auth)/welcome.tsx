import { Ionicons } from "@expo/vector-icons"
import { Image } from "expo-image"
import { LinearGradient } from "expo-linear-gradient"
import { useRouter } from "expo-router"
import React from "react"
import { Pressable, View } from "react-native"
import { useSafeAreaInsets } from "react-native-safe-area-context"

import { Button, Screen, Txt } from "@/components/ui"
import { brand, layout, useIsDark, usePalette } from "@/theme"

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

export default function Welcome() {
  const p = usePalette()
  const isDark = useIsDark()
  const insets = useSafeAreaInsets()
  const router = useRouter()

  return (
    <Screen>
      <LinearGradient
        colors={
          isDark
            ? ["#1A1206", "#0A0A0A", "#0A0A0A"]
            : ["#FEF3C7", "#FFFFFF", "#FFFFFF"]
        }
        style={{ position: "absolute", top: 0, left: 0, right: 0, height: 420 }}
      />

      <View
        style={{
          flex: 1,
          paddingTop: insets.top + 48,
          paddingBottom: insets.bottom + 24,
          paddingHorizontal: layout.gutter + 4,
        }}
      >
        <Image
          source={
            isDark
              ? require("../../assets/ai-socratic-logo-dark.png")
              : require("../../assets/ai-socratic-logo-light.png")
          }
          style={{ width: 210, height: 60 }}
          contentFit="contain"
        />

        <Txt variant="display" style={{ marginTop: 28, fontSize: 34, lineHeight: 40 }}>
          The AI community for{"\n"}human flourishing.
        </Txt>

        <Txt variant="body" color={p.muted} style={{ marginTop: 12, lineHeight: 22, fontSize: 16 }}>
          Engineers, researchers and founders thinking out loud together. No fees, no pitch decks.
        </Txt>

        <View style={{ gap: 20, marginTop: 40, flex: 1 }}>
          {HIGHLIGHTS.map((h) => (
            <View key={h.title} style={{ flexDirection: "row", gap: 14, alignItems: "flex-start" }}>
              <View
                style={{
                  width: 38,
                  height: 38,
                  borderRadius: 12,
                  backgroundColor: `${brand.amber}1F`,
                  alignItems: "center",
                  justifyContent: "center",
                }}
              >
                <Ionicons name={h.icon} size={19} color={p.accent} />
              </View>
              <View style={{ flex: 1, gap: 2 }}>
                <Txt variant="heading">{h.title}</Txt>
                <Txt variant="body" color={p.muted} style={{ lineHeight: 20 }}>
                  {h.body}
                </Txt>
              </View>
            </View>
          ))}
        </View>

        <View style={{ gap: 8 }}>
          <Button label="Create an account" onPress={() => router.push("/(auth)/sign-up")} />
          <Pressable
            accessibilityRole="button"
            onPress={() => router.push("/(auth)/sign-in")}
            style={{ paddingVertical: 12, alignItems: "center" }}
          >
            <Txt variant="body" color={p.muted}>
              Already a member? <Txt color={p.accent}>Sign in</Txt>
            </Txt>
          </Pressable>

          {/* AuthGate reaches this screen with replace(), so there's no back
              stack out of it — without this, signed-out users are trapped. */}
          <Pressable
            accessibilityRole="button"
            onPress={() => router.replace("/(tabs)/events")}
            style={({ pressed }) => ({
              paddingVertical: 12,
              alignItems: "center",
              opacity: pressed ? 0.6 : 1,
            })}
          >
            <Txt variant="body" color={p.muted}>
              Not now — browse events
            </Txt>
          </Pressable>
        </View>
      </View>
    </Screen>
  )
}
