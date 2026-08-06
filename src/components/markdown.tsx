import { Image } from "expo-image"
import * as WebBrowser from "expo-web-browser"
import React, { useMemo } from "react"
import { StyleSheet, Text, View } from "react-native"


import { InlineVideo } from "@/components/inline-video"
import { isVideoUrl } from "@/lib/media"
import { layout, usePalette } from "@/theme"

/**
 * A small, dependency-free markdown renderer.
 *
 * Content in `blog_posts.content` / `updates.content` is authored markdown with
 * occasional inline HTML. We deliberately render a readable subset — headings,
 * paragraphs, lists, quotes, code, images, videos, rules and inline
 * emphasis/links — rather than pulling in a full markdown+HTML stack for a
 * reading view.
 */

type Block =
  | { kind: "heading"; level: number; text: string }
  | { kind: "paragraph"; text: string }
  | { kind: "bullet"; items: string[] }
  | { kind: "ordered"; items: string[] }
  | { kind: "quote"; text: string }
  | { kind: "code"; text: string }
  | { kind: "image"; uri: string; alt: string }
  | { kind: "video"; uri: string }
  | { kind: "rule" }

function stripHtml(input: string): string {
  return input
    .replace(/<br\s*\/?>/gi, "\n")
    .replace(/<\/p>/gi, "\n\n")
    .replace(/<[^>]+>/g, "")
}

function parse(markdown: string): Block[] {
  const blocks: Block[] = []

  // A `<video src>` (with or without a nested `<source>`) would be erased by
  // stripHtml below — lift the src out first so it survives as a bare URL line
  // and becomes a video block.
  const withVideoSrcs = markdown
    .replace(/\r\n/g, "\n")
    .replace(/<video\b[^>]*>[\s\S]*?<\/video>|<video\b[^>]*\/?>/gi, (tag) => {
      const src = tag.match(/src\s*=\s*["']([^"']+)["']/i)
      return src ? `\n\n${src[1]}\n\n` : "\n"
    })

  const lines = stripHtml(withVideoSrcs).split("\n")

  let i = 0
  while (i < lines.length) {
    const line = lines[i]

    // Fenced code
    if (/^\s*```/.test(line)) {
      const body: string[] = []
      i++
      while (i < lines.length && !/^\s*```/.test(lines[i])) body.push(lines[i++])
      i++
      blocks.push({ kind: "code", text: body.join("\n") })
      continue
    }

    if (!line.trim()) {
      i++
      continue
    }

    if (/^\s*(-{3,}|\*{3,}|_{3,})\s*$/.test(line)) {
      blocks.push({ kind: "rule" })
      i++
      continue
    }

    // Authors embed clips with image syntax — `![demo](clip.mp4)` — because
    // markdown has no video syntax of its own. Route those to the player.
    const image = line.match(/^\s*!\[([^\]]*)\]\(([^)\s]+)/)
    if (image) {
      blocks.push(
        isVideoUrl(image[2])
          ? { kind: "video", uri: image[2] }
          : { kind: "image", alt: image[1], uri: image[2] },
      )
      i++
      continue
    }

    // A video URL standing alone on a line plays inline rather than printing
    // as text nobody can watch.
    const bare = line.trim()
    if (/^https?:\/\/\S+$/.test(bare) && isVideoUrl(bare)) {
      blocks.push({ kind: "video", uri: bare })
      i++
      continue
    }

    // An editor leaves a bare "#" behind when a heading is deleted; several
    // live posts open with one. Text-less, it renders as a literal "#".
    if (/^#{1,6}\s*$/.test(line.trim())) {
      i++
      continue
    }

    const heading = line.match(/^(#{1,6})\s+(.*)$/)
    if (heading) {
      blocks.push({ kind: "heading", level: heading[1].length, text: heading[2].trim() })
      i++
      continue
    }

    if (/^\s*>\s?/.test(line)) {
      const body: string[] = []
      while (i < lines.length && /^\s*>\s?/.test(lines[i])) {
        body.push(lines[i].replace(/^\s*>\s?/, ""))
        i++
      }
      blocks.push({ kind: "quote", text: body.join(" ").trim() })
      continue
    }

    if (/^\s*[-*+]\s+/.test(line)) {
      const items: string[] = []
      while (i < lines.length && /^\s*[-*+]\s+/.test(lines[i])) {
        items.push(lines[i].replace(/^\s*[-*+]\s+/, "").trim())
        i++
      }
      blocks.push({ kind: "bullet", items })
      continue
    }

    if (/^\s*\d+[.)]\s+/.test(line)) {
      const items: string[] = []
      while (i < lines.length && /^\s*\d+[.)]\s+/.test(lines[i])) {
        items.push(lines[i].replace(/^\s*\d+[.)]\s+/, "").trim())
        i++
      }
      blocks.push({ kind: "ordered", items })
      continue
    }

    // Paragraph: consume until a blank line or the start of another block.
    // Single newlines are kept as line breaks rather than joined with a space.
    // Strict markdown would join, but event bodies arrive from Luma as plain
    // text where the newline *is* the structure — an agenda ("6:00 PM Welcome"
    // / "7:00 PM Dialogues") joined into one run-on paragraph is unreadable,
    // while web-authored blog paragraphs are one source line each and never
    // notice the difference.
    const body: string[] = []
    while (
      i < lines.length &&
      lines[i].trim() &&
      !/^\s*(#{1,6}\s|>|[-*+]\s|\d+[.)]\s|```)/.test(lines[i])
    ) {
      body.push(lines[i].trim())
      i++
    }
    if (body.length) blocks.push({ kind: "paragraph", text: body.join("\n") })
  }

  return blocks
}

/** Inline emphasis, code and links. */
function Inline({ text, size = 16 }: { text: string; size?: number }) {
  const p = usePalette()

  const parts = useMemo(() => {
    const pattern =
      /(\[[^\]]+\]\([^)]+\))|(\*\*[^*]+\*\*)|(__[^_]+__)|(\*[^*\n]+\*)|(_[^_\n]+_)|(`[^`]+`)/g
    const out: React.ReactNode[] = []
    let last = 0
    let m: RegExpExecArray | null
    let key = 0

    while ((m = pattern.exec(text))) {
      if (m.index > last) out.push(text.slice(last, m.index))
      const token = m[0]

      if (token.startsWith("[")) {
        const link = token.match(/^\[([^\]]+)\]\(([^)]+)\)$/)
        if (link) {
          out.push(
            <Text
              key={`l${key++}`}
              style={{ color: p.accent, textDecorationLine: "underline" }}
              onPress={() => void WebBrowser.openBrowserAsync(link[2])}
            >
              {link[1]}
            </Text>,
          )
        }
      } else if (token.startsWith("**") || token.startsWith("__")) {
        out.push(
          <Text key={`b${key++}`} style={{ fontWeight: "700" }}>
            {token.slice(2, -2)}
          </Text>,
        )
      } else if (token.startsWith("`")) {
        out.push(
          <Text
            key={`c${key++}`}
            style={{ fontFamily: "Menlo", fontSize: size - 2, color: p.accent }}
          >
            {token.slice(1, -1)}
          </Text>,
        )
      } else {
        out.push(
          <Text key={`i${key++}`} style={{ fontStyle: "italic" }}>
            {token.slice(1, -1)}
          </Text>,
        )
      }
      last = m.index + token.length
    }

    if (last < text.length) out.push(text.slice(last))
    return out
  }, [text, p.accent, size])

  return (
    <Text style={{ color: p.text, fontSize: size, lineHeight: size * 1.6 }}>
      {parts}
    </Text>
  )
}

export function Markdown({ content }: { content: string | null | undefined }) {
  const p = usePalette()
  const blocks = useMemo(() => (content ? parse(content) : []), [content])

  if (!blocks.length) return null

  return (
    <View style={{ gap: 16 }}>
      {blocks.map((b, idx) => {
        switch (b.kind) {
          case "heading": {
            const size = b.level <= 1 ? 26 : b.level === 2 ? 22 : 18
            return (
              <Text
                key={idx}
                style={{
                  color: p.text,
                  fontSize: size,
                  fontWeight: "700",
                  letterSpacing: -0.4,
                  marginTop: idx === 0 ? 0 : 8,
                }}
              >
                {b.text.replace(/[*_`]/g, "")}
              </Text>
            )
          }
          case "paragraph":
            return <Inline key={idx} text={b.text} />
          case "bullet":
          case "ordered":
            return (
              <View key={idx} style={{ gap: 8, paddingLeft: 4 }}>
                {b.items.map((item, j) => (
                  <View key={j} style={{ flexDirection: "row", gap: 10 }}>
                    <Text style={{ color: p.muted, fontSize: 16, lineHeight: 26 }}>
                      {b.kind === "bullet" ? "•" : `${j + 1}.`}
                    </Text>
                    <View style={{ flex: 1 }}>
                      <Inline text={item} />
                    </View>
                  </View>
                ))}
              </View>
            )
          case "quote":
            return (
              <View
                key={idx}
                style={{
                  borderLeftWidth: 3,
                  borderLeftColor: p.accent,
                  paddingLeft: 14,
                  paddingVertical: 2,
                }}
              >
                <Inline text={b.text} />
              </View>
            )
          case "code":
            return (
              <View
                key={idx}
                style={{
                  backgroundColor: p.input,
                  borderRadius: layout.radiusSmall,
                  padding: 14,
                  borderWidth: StyleSheet.hairlineWidth,
                  borderColor: p.border,
                }}
              >
                <Text style={{ fontFamily: "Menlo", fontSize: 13, color: p.text }}>{b.text}</Text>
              </View>
            )
          case "image":
            return (
              <Image
                key={idx}
                source={{ uri: b.uri }}
                style={{
                  width: "100%",
                  aspectRatio: 16 / 9,
                  borderRadius: layout.radiusSmall,
                  backgroundColor: p.input,
                }}
                contentFit="cover"
                transition={150}
              />
            )
          case "video":
            return <InlineVideo key={idx} uri={b.uri} />
          case "rule":
            return (
              <View
                key={idx}
                style={{ height: StyleSheet.hairlineWidth, backgroundColor: p.border }}
              />
            )
        }
      })}
    </View>
  )
}
