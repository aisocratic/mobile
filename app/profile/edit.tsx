import { useRouter } from "expo-router"
import type { User } from "@/lib/api"
import React, { useCallback, useEffect, useMemo, useRef, useState } from "react"
import { KeyboardAvoidingView, Platform, ScrollView, View } from "react-native"

import { fire } from "@/components/touchable"
import { Avatar, Button, Field, Muted, Screen, Txt } from "@/components/ui"
import { normalizeLinkedIn } from "@/lib/format"
import { useAuth, type Profile } from "@/store/auth"
import { layout, usePalette } from "@/theme"

type Form = {
  full_name: string
  job_title: string
  organization: string
  location: string
  bio: string
  linkedin_url: string
}

const FIELDS = [
  "full_name",
  "job_title",
  "organization",
  "location",
  "bio",
  "linkedin_url",
] as const

const BIO_MAX = 600

/**
 * The profile row is the source of truth, with auth metadata behind it — a
 * member who signed up in the app has no row until this screen writes one.
 */
function seed(profile: Profile | null, user: User | null): Form {
  return {
    full_name: profile?.full_name ?? (user?.user_metadata?.full_name as string | undefined) ?? "",
    job_title: profile?.job_title ?? "",
    organization: profile?.organization ?? "",
    location: profile?.location ?? "",
    bio: profile?.bio ?? "",
    linkedin_url: profile?.linkedin_url ?? "",
  }
}

function blank(value: string): string | null {
  const trimmed = value.trim()
  return trimmed ? trimmed : null
}

export default function EditProfileScreen() {
  const p = usePalette()
  const router = useRouter()
  const { user, profile, updateProfile } = useAuth()

  const [saving, setSaving] = useState(false)
  const [error, setError] = useState<string | null>(null)

  const saved = useMemo(() => seed(profile, user), [profile, user])
  const [form, setForm] = useState<Form>(saved)
  const edited = useRef(false)

  // The profile row loads asynchronously, so it can land after this screen
  // mounts. Re-seed until the member types something of their own.
  useEffect(() => {
    if (!edited.current) setForm(saved)
  }, [saved])

  const set = <K extends keyof Form>(key: K) => (value: string) => {
    edited.current = true
    setForm((prev) => ({ ...prev, [key]: value }))
  }

  const avatar =
    profile?.avatar_url ?? (user?.user_metadata?.avatar_url as string | undefined) ?? null

  const dirty = useMemo(
    () => FIELDS.some((key) => form[key].trim() !== saved[key].trim()),
    [form, saved],
  )

  // Deep-linking straight here leaves nothing to go back to.
  const close = useCallback(() => {
    if (router.canGoBack()) router.back()
    else router.replace("/(tabs)/profile")
  }, [router])

  const save = useCallback(async () => {
    if (!form.full_name.trim()) {
      setError("Add your name so members can recognise you.")
      return
    }

    setSaving(true)
    setError(null)
    try {
      await updateProfile({
        full_name: form.full_name.trim(),
        job_title: blank(form.job_title),
        organization: blank(form.organization),
        location: blank(form.location),
        bio: blank(form.bio),
        linkedin_url: normalizeLinkedIn(form.linkedin_url),
      })
      fire("success")
      close()
    } catch (e) {
      fire("error")
      setError(e instanceof Error ? e.message : "Could not save your profile.")
    } finally {
      setSaving(false)
    }
  }, [form, updateProfile, close])

  return (
    <Screen>
      <KeyboardAvoidingView
        style={{ flex: 1 }}
        behavior={Platform.OS === "ios" ? "padding" : undefined}
      >
        <ScrollView
          contentContainerStyle={{ padding: layout.gutter, gap: 20, paddingBottom: 48 }}
          keyboardShouldPersistTaps="handled"
        >
          <View style={{ alignItems: "center", gap: 8 }}>
            <Avatar uri={avatar} name={form.full_name || null} size={72} />
            <Muted>{user?.email}</Muted>
          </View>

          <View style={{ gap: 14 }}>
            <Field
              label="Full name"
              value={form.full_name}
              onChangeText={set("full_name")}
              placeholder="Ada Lovelace"
              autoCapitalize="words"
              textContentType="name"
              autoComplete="name"
            />

            <Field
              label="Role"
              value={form.job_title}
              onChangeText={set("job_title")}
              placeholder="Research engineer"
              autoCapitalize="sentences"
              textContentType="jobTitle"
            />

            <Field
              label="Organization"
              value={form.organization}
              onChangeText={set("organization")}
              placeholder="Where you work"
              autoCapitalize="words"
              textContentType="organizationName"
            />

            <Field
              label="Location"
              value={form.location}
              onChangeText={set("location")}
              placeholder="London, UK"
              autoCapitalize="words"
            />

            <View style={{ gap: 4 }}>
              <Field
                label="Bio"
                value={form.bio}
                onChangeText={(text) => set("bio")(text.slice(0, BIO_MAX))}
                placeholder="What you're working on, and what you'd like to talk about."
                multiline
                numberOfLines={5}
                maxLength={BIO_MAX}
                style={{ minHeight: 120, textAlignVertical: "top", paddingTop: 13 }}
              />
              <Muted style={{ textAlign: "right" }}>
                {form.bio.length}/{BIO_MAX}
              </Muted>
            </View>

            <Field
              label="LinkedIn"
              value={form.linkedin_url}
              onChangeText={set("linkedin_url")}
              placeholder="linkedin.com/in/you"
              autoCapitalize="none"
              autoCorrect={false}
              keyboardType="url"
              textContentType="URL"
            />
          </View>

          {error ? (
            <Txt variant="caption" color={p.danger}>
              {error}
            </Txt>
          ) : null}

          <View style={{ gap: 10 }}>
            <Button label="Save changes" onPress={save} loading={saving} disabled={!dirty} />
            <Button
              label="Cancel"
              variant="ghost"
              onPress={close}
              disabled={saving}
            />
          </View>

          <Muted style={{ textAlign: "center" }}>
            Your name, role and bio are visible to other members on aisocratic.org.
          </Muted>
        </ScrollView>
      </KeyboardAvoidingView>
    </Screen>
  )
}
