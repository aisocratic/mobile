import { Ionicons } from "@expo/vector-icons"
import React, { useState } from "react"
import { Pressable, ScrollView, Share, StyleSheet, View } from "react-native"

import { Button, Card, Muted, Txt } from "@/components/ui"
import { formatEventDate } from "@/lib/format"
import { layout, usePalette } from "@/theme"

import { INVITE_LIMITS, useCreateInvite, type ChatInvite } from "./index"

/**
 * Mint an invite and hand it to someone.
 *
 * The relay authorizes this by role — owner or admin — and refuses everyone
 * else with a 403. That check is deliberately left to the server: this screen
 * is reachable by any member, and a member who isn't an admin gets the relay's
 * own answer instead of a button that mysteriously isn't there.
 *
 * Two things shape the layout:
 *
 *  - **The code is shown exactly once.** `POST /api/invites` returns it and no
 *    endpoint reads it back, so the result is a hand-off surface — share it
 *    now — rather than a record to come back to.
 *  - **Unlimited uses is a choice, never a default.** Omitting `max_uses` is
 *    how Buzz spells unlimited, so a careless implementation gets it by
 *    accident. Here it is one option among four, spelled out, and the default
 *    is a single use.
 */

/* --------------------------------------------------------------- choices */

const EXPIRY_CHOICES = [
  { label: "1 hour", ttlSecs: 60 * 60 },
  { label: "24 hours", ttlSecs: 24 * 60 * 60 },
  { label: "7 days", ttlSecs: 7 * 24 * 60 * 60 },
  { label: "30 days", ttlSecs: INVITE_LIMITS.maxTtlSecs },
]

const USES_CHOICES: { label: string; maxUses: number | null }[] = [
  { label: "1 person", maxUses: 1 },
  { label: "10 people", maxUses: 10 },
  { label: "50 people", maxUses: 50 },
  { label: "No limit", maxUses: null },
]

function Options<T>({
  label,
  hint,
  options,
  isSelected,
  onSelect,
  disabled,
}: {
  label: string
  hint?: string
  options: { label: string; value: T }[]
  isSelected: (value: T) => boolean
  onSelect: (value: T) => void
  disabled?: boolean
}) {
  const p = usePalette()

  return (
    <View style={{ gap: 8 }}>
      <Txt variant="label" color={p.muted}>
        {label}
      </Txt>
      <View style={{ flexDirection: "row", flexWrap: "wrap", gap: 8 }}>
        {options.map((option) => {
          const active = isSelected(option.value)
          return (
            <Pressable
              key={option.label}
              accessibilityRole="radio"
              accessibilityState={{ selected: active, disabled: !!disabled }}
              onPress={disabled ? undefined : () => onSelect(option.value)}
              style={{
                paddingHorizontal: 14,
                paddingVertical: 9,
                borderRadius: layout.radiusPill,
                backgroundColor: active ? p.primary : p.input,
                borderWidth: StyleSheet.hairlineWidth,
                borderColor: active ? p.primary : p.border,
                opacity: disabled ? 0.5 : 1,
              }}
            >
              <Txt variant="label" color={active ? p.primaryText : p.muted}>
                {option.label}
              </Txt>
            </Pressable>
          )
        })}
      </View>
      {hint ? <Muted style={{ lineHeight: 17 }}>{hint}</Muted> : null}
    </View>
  )
}

/* ---------------------------------------------------------------- result */

/** Epoch seconds -> the same date format the rest of the app uses. */
function expiryLabel(expiresAt: number): string {
  return formatEventDate(new Date(expiresAt * 1000).toISOString())
}

function usesLabel(invite: ChatInvite): string {
  if (invite.maxUses === null) return "Unlimited uses"
  return invite.maxUses === 1 ? "Single use" : `Up to ${invite.maxUses} uses`
}

function InviteResult({
  invite,
  onCreateAnother,
}: {
  invite: ChatInvite
  onCreateAnother: () => void
}) {
  const p = usePalette()

  // The landing page carries the code, so the message is the link plus enough
  // context that it doesn't read as a phishing attempt from a stranger.
  const share = () => {
    const message = [
      "You're invited to the AI Socratic community chat.",
      "",
      invite.url,
      "",
      `Invite code: ${invite.code}`,
      "In the app: Chat tab → paste the code → Join community.",
    ].join("\n")

    void Share.share({ message, url: invite.url }).catch(() => {
      /* the sheet was dismissed, or there is nothing to share to */
    })
  }

  return (
    <View style={{ gap: 18 }}>
      <View style={{ alignItems: "center", gap: 8, paddingTop: 4 }}>
        <Ionicons name="checkmark-circle" size={34} color={p.success} />
        <Txt variant="title" style={{ textAlign: "center" }}>
          Invite ready
        </Txt>
        <Txt variant="body" color={p.muted} style={{ textAlign: "center", lineHeight: 21 }}>
          Send this now — the community shows the code once and can&apos;t show it again.
        </Txt>
      </View>

      <Card style={{ gap: 12 }}>
        <View style={{ gap: 6 }}>
          <Txt variant="label" color={p.muted}>
            Invite code
          </Txt>
          {/* Selectable so a long-press copy works without a clipboard
              dependency; the share sheet covers the common path. */}
          <Txt selectable variant="body" style={{ lineHeight: 22 }}>
            {invite.code}
          </Txt>
        </View>

        <View style={{ height: StyleSheet.hairlineWidth, backgroundColor: p.border }} />

        <View style={{ gap: 6 }}>
          <Txt variant="label" color={p.muted}>
            Link
          </Txt>
          <Txt selectable variant="body" color={p.accent} style={{ lineHeight: 20 }}>
            {invite.url}
          </Txt>
        </View>

        <View style={{ flexDirection: "row", alignItems: "center", gap: 12, flexWrap: "wrap" }}>
          <View style={{ flexDirection: "row", alignItems: "center", gap: 5 }}>
            <Ionicons name="time-outline" size={13} color={p.muted} />
            <Muted>Expires {expiryLabel(invite.expiresAt)}</Muted>
          </View>
          <View style={{ flexDirection: "row", alignItems: "center", gap: 5 }}>
            <Ionicons name="people-outline" size={13} color={p.muted} />
            <Muted>{usesLabel(invite)}</Muted>
          </View>
        </View>
      </Card>

      <Button label="Share invite" icon="share-outline" onPress={share} />
      <Button
        label="Create another"
        icon="add-outline"
        variant="secondary"
        onPress={onCreateAnother}
      />

      <Muted style={{ lineHeight: 18 }}>
        Anyone holding this code can join until it expires or runs out of uses. Treat it like a
        door key, not a public link.
      </Muted>
    </View>
  )
}

/* --------------------------------------------------------------- screen */

export function InvitePeople({ relayUrl }: { relayUrl: string }) {
  const p = usePalette()
  const [ttlSecs, setTtlSecs] = useState(EXPIRY_CHOICES[2].ttlSecs)
  const [maxUses, setMaxUses] = useState<number | null>(USES_CHOICES[0].maxUses)
  const { create, invite, creating, error, reset } = useCreateInvite()

  const host = relayUrl.replace(/^wss?:\/\//, "")

  return (
    <ScrollView
      contentContainerStyle={{ padding: layout.gutter, gap: 20, paddingBottom: 48 }}
      keyboardShouldPersistTaps="handled"
    >
      {invite ? (
        <InviteResult invite={invite} onCreateAnother={reset} />
      ) : (
        <>
          <View style={{ alignItems: "center", gap: 10, paddingTop: 8 }}>
            <Ionicons name="person-add-outline" size={34} color={p.accent} />
            <Txt variant="title" style={{ textAlign: "center" }}>
              Invite someone
            </Txt>
            <Txt variant="body" color={p.muted} style={{ textAlign: "center", lineHeight: 21 }}>
              {host} is a private community. An invite code lets one person — or a set number of
              people — join it and start reading and posting.
            </Txt>
          </View>

          <Options
            label="Expires after"
            options={EXPIRY_CHOICES.map((c) => ({ label: c.label, value: c.ttlSecs }))}
            isSelected={(value) => value === ttlSecs}
            onSelect={setTtlSecs}
            disabled={creating}
          />

          <Options
            label="Can be used by"
            hint="A code with no limit stays usable by anyone who sees it until it expires."
            options={USES_CHOICES.map((c) => ({ label: c.label, value: c.maxUses }))}
            isSelected={(value) => value === maxUses}
            onSelect={setMaxUses}
            disabled={creating}
          />

          {error ? (
            <Txt variant="body" color={p.danger} style={{ lineHeight: 20 }}>
              {error}
            </Txt>
          ) : null}

          <Button
            label={creating ? "Creating…" : "Create invite"}
            icon="ticket-outline"
            loading={creating}
            disabled={creating}
            onPress={() => void create({ ttlSecs, maxUses })}
          />

          <Muted style={{ lineHeight: 18 }}>
            The request is signed with your chat key (NIP-98). Only community owners and admins can
            create invites — if that isn&apos;t you, the community will say so.
          </Muted>
        </>
      )}
    </ScrollView>
  )
}
