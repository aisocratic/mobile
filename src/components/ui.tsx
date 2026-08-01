import { Ionicons } from "@expo/vector-icons"
import { Image } from "expo-image"
import React from "react"
import {
  ActivityIndicator,
  Pressable,
  ScrollView,
  StyleSheet,
  Text,
  TextInput,
  type TextInputProps,
  type TextProps,
  View,
  type ViewProps,
} from "react-native"

import { layout, usePalette, type as typeScale } from "@/theme"

/* ------------------------------------------------------------------ text */

type Variant = keyof typeof typeScale

export function Txt({
  variant = "body",
  color,
  style,
  ...rest
}: TextProps & { variant?: Variant; color?: string }) {
  const p = usePalette()
  return <Text style={[typeScale[variant], { color: color ?? p.text }, style]} {...rest} />
}

export function Muted({ style, ...rest }: TextProps & { variant?: Variant }) {
  const p = usePalette()
  return <Txt variant="caption" color={p.muted} style={style} {...rest} />
}

/* ---------------------------------------------------------------- layout */

export function Screen({ style, ...rest }: ViewProps) {
  const p = usePalette()
  return <View style={[{ flex: 1, backgroundColor: p.background }, style]} {...rest} />
}

export function Card({ style, ...rest }: ViewProps) {
  const p = usePalette()
  return (
    <View
      style={[
        {
          backgroundColor: p.elevated,
          borderColor: p.border,
          borderWidth: StyleSheet.hairlineWidth,
          borderRadius: layout.radius,
          padding: 16,
        },
        style,
      ]}
      {...rest}
    />
  )
}

export function Divider() {
  const p = usePalette()
  return <View style={{ height: StyleSheet.hairlineWidth, backgroundColor: p.border }} />
}

/* --------------------------------------------------------------- buttons */

export function Button({
  label,
  onPress,
  loading,
  disabled,
  variant = "primary",
  icon,
  style,
}: {
  label: string
  onPress?: () => void
  loading?: boolean
  disabled?: boolean
  variant?: "primary" | "secondary" | "ghost"
  icon?: keyof typeof Ionicons.glyphMap
  style?: ViewProps["style"]
}) {
  const p = usePalette()
  const isPrimary = variant === "primary"
  const isGhost = variant === "ghost"

  const bg = isPrimary ? p.primary : isGhost ? "transparent" : p.input
  const fg = isPrimary ? p.primaryText : p.text
  const off = disabled || loading

  return (
    <Pressable
      accessibilityRole="button"
      accessibilityState={{ disabled: !!off, busy: !!loading }}
      onPress={off ? undefined : onPress}
      style={({ pressed }) => [
        {
          backgroundColor: bg,
          borderRadius: layout.radiusSmall,
          paddingVertical: 14,
          paddingHorizontal: 18,
          flexDirection: "row",
          alignItems: "center",
          justifyContent: "center",
          gap: 8,
          opacity: off ? 0.5 : pressed ? 0.8 : 1,
          borderWidth: isGhost ? StyleSheet.hairlineWidth : 0,
          borderColor: p.border,
        },
        style,
      ]}
    >
      {loading ? (
        <ActivityIndicator color={fg} size="small" />
      ) : (
        <>
          {icon ? <Ionicons name={icon} size={18} color={fg} /> : null}
          <Txt variant="heading" color={fg}>
            {label}
          </Txt>
        </>
      )}
    </Pressable>
  )
}

/* ----------------------------------------------------------------- input */

export function Field({
  label,
  error,
  style,
  ...rest
}: TextInputProps & { label?: string; error?: string | null }) {
  const p = usePalette()
  return (
    <View style={{ gap: 6 }}>
      {label ? (
        <Txt variant="label" color={p.muted}>
          {label}
        </Txt>
      ) : null}
      <TextInput
        placeholderTextColor={p.muted}
        style={[
          {
            backgroundColor: p.input,
            borderRadius: layout.radiusSmall,
            borderWidth: StyleSheet.hairlineWidth,
            borderColor: error ? p.danger : p.border,
            paddingHorizontal: 14,
            paddingVertical: 13,
            fontSize: 16,
            color: p.text,
          },
          style,
        ]}
        {...rest}
      />
      {error ? (
        <Txt variant="caption" color={p.danger}>
          {error}
        </Txt>
      ) : null}
    </View>
  )
}

/* ----------------------------------------------------------------- chips */

export function Chip({ label, tone }: { label: string; tone?: "accent" | "muted" }) {
  const p = usePalette()
  const accent = tone === "accent"
  return (
    <View
      style={{
        paddingHorizontal: 10,
        paddingVertical: 4,
        borderRadius: layout.radiusPill,
        backgroundColor: accent ? `${p.accent}22` : p.input,
        borderWidth: StyleSheet.hairlineWidth,
        borderColor: accent ? `${p.accent}55` : p.border,
      }}
    >
      <Txt variant="caption" color={accent ? p.accent : p.muted}>
        {label}
      </Txt>
    </View>
  )
}

export function SegmentedControl<T extends string>({
  options,
  value,
  onChange,
}: {
  options: { value: T; label: string }[]
  value: T
  onChange: (v: T) => void
}) {
  const p = usePalette()
  return (
    <ScrollView
      horizontal
      showsHorizontalScrollIndicator={false}
      contentContainerStyle={{ gap: 8, paddingHorizontal: layout.gutter }}
    >
      {options.map((o) => {
        const active = o.value === value
        return (
          <Pressable
            key={o.value}
            accessibilityRole="tab"
            accessibilityState={{ selected: active }}
            onPress={() => onChange(o.value)}
            style={{
              paddingHorizontal: 14,
              paddingVertical: 8,
              borderRadius: layout.radiusPill,
              backgroundColor: active ? p.primary : p.input,
              borderWidth: StyleSheet.hairlineWidth,
              borderColor: active ? p.primary : p.border,
            }}
          >
            <Txt variant="label" color={active ? p.primaryText : p.muted}>
              {o.label}
            </Txt>
          </Pressable>
        )
      })}
    </ScrollView>
  )
}

/* ---------------------------------------------------------------- avatar */

export function Avatar({
  uri,
  name,
  size = 44,
}: {
  uri?: string | null
  name?: string | null
  size?: number
}) {
  const p = usePalette()
  const initials = (name ?? "?")
    .split(/\s+/)
    .filter(Boolean)
    .slice(0, 2)
    .map((w) => w[0]?.toUpperCase())
    .join("")

  if (uri) {
    return (
      <Image
        source={{ uri }}
        style={{ width: size, height: size, borderRadius: size / 2, backgroundColor: p.input }}
        contentFit="cover"
        transition={150}
      />
    )
  }

  return (
    <View
      style={{
        width: size,
        height: size,
        borderRadius: size / 2,
        backgroundColor: p.input,
        alignItems: "center",
        justifyContent: "center",
        borderWidth: StyleSheet.hairlineWidth,
        borderColor: p.border,
      }}
    >
      <Txt variant="label" color={p.muted}>
        {initials || "?"}
      </Txt>
    </View>
  )
}

/* --------------------------------------------------------------- states */

export function Loading({ label }: { label?: string }) {
  const p = usePalette()
  return (
    <View style={{ flex: 1, alignItems: "center", justifyContent: "center", gap: 12, padding: 40 }}>
      <ActivityIndicator color={p.accent} />
      {label ? <Muted>{label}</Muted> : null}
    </View>
  )
}

export function EmptyState({
  icon = "sparkles-outline",
  title,
  body,
  action,
}: {
  icon?: keyof typeof Ionicons.glyphMap
  title: string
  body?: string
  action?: React.ReactNode
}) {
  const p = usePalette()
  return (
    <View style={{ alignItems: "center", gap: 10, paddingVertical: 56, paddingHorizontal: 32 }}>
      <Ionicons name={icon} size={34} color={p.muted} />
      <Txt variant="heading" style={{ textAlign: "center" }}>
        {title}
      </Txt>
      {body ? (
        <Txt variant="body" color={p.muted} style={{ textAlign: "center", lineHeight: 21 }}>
          {body}
        </Txt>
      ) : null}
      {action ? <View style={{ marginTop: 8 }}>{action}</View> : null}
    </View>
  )
}

export function ErrorState({ error, onRetry }: { error: unknown; onRetry?: () => void }) {
  const message = error instanceof Error ? error.message : "Something went wrong."
  return (
    <EmptyState
      icon="cloud-offline-outline"
      title="Couldn't load that"
      body={message}
      action={onRetry ? <Button label="Try again" variant="secondary" onPress={onRetry} /> : null}
    />
  )
}
