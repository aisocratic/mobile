import { Image } from "expo-image"
import * as WebBrowser from "expo-web-browser"
import React, { useMemo } from "react"
import { ScrollView, StyleSheet, Text, View } from "react-native"


import { layout, space, usePalette } from "@/theme"

/**
 * A small, dependency-free markdown renderer.
 *
 * Content in `blog_posts.content` / `updates.content` is authored markdown with
 * occasional inline HTML. We deliberately render a readable subset — headings,
 * paragraphs, lists, quotes, code, images, rules and inline emphasis/links —
 * rather than pulling in a full markdown+HTML stack for a reading view.
 */

type Align = "left" | "center" | "right" | null

type Block =
  | { kind: "heading"; level: number; text: string }
  | { kind: "paragraph"; text: string }
  | { kind: "bullet"; items: string[] }
  | { kind: "ordered"; items: string[] }
  | { kind: "quote"; text: string }
  | { kind: "code"; text: string }
  | { kind: "image"; uri: string; alt: string }
  | { kind: "rule" }
  | { kind: "table"; align: Align[]; header: string[]; rows: string[][] }

function stripHtml(input: string): string {
  return input
    .replace(/<br\s*\/?>/gi, "\n")
    .replace(/<\/p>/gi, "\n\n")
    .replace(/<[^>]+>/g, "")
}

/**
 * One table row split into trimmed cells. Outer pipes are optional in GFM, so
 * `| a | b |` and `a | b` both yield two cells. `\|` escapes a literal pipe.
 */
function splitRow(line: string): string[] {
  return line
    .trim()
    .replace(/\\\|/g, "\u0000")
    .replace(/^\|/, "")
    .replace(/\|$/, "")
    .split("|")
    .map((cell) => cell.trim().replace(/\u0000/g, "|"))
}

/**
 * Reads a `|---|:---:|` separator line into per-column alignments, or null if
 * the line is not a separator. `null` alignment means "unspecified" (left).
 */
function tableSeparator(line: string | undefined): Align[] | null {
  if (!line || !line.includes("|")) return null
  const cells = splitRow(line)
  if (!cells.length || !cells.every((c) => /^:?-+:?$/.test(c))) return null
  return cells.map((c) => {
    const left = c.startsWith(":")
    const right = c.endsWith(":")
    if (left && right) return "center"
    if (right) return "right"
    if (left) return "left"
    return null
  })
}

/** True when `lines[i]` opens a well-formed table (header + matching separator). */
function tableStartAt(lines: string[], i: number): boolean {
  if (!lines[i]?.includes("|")) return false
  const align = tableSeparator(lines[i + 1])
  return align !== null && align.length === splitRow(lines[i]).length
}

/**
 * Parses a GFM pipe table at `lines[i]`. Returns null unless the header row is
 * followed by a separator with the same column count — a lone pipey line or a
 * mismatched separator is not a table and falls through to paragraph text.
 * Body rows are normalised to the header width (short rows padded, long rows
 * truncated), which is what GFM renderers do.
 */
function tableAt(lines: string[], i: number): { block: Block; next: number } | null {
  if (!tableStartAt(lines, i)) return null
  const header = splitRow(lines[i])
  const align = tableSeparator(lines[i + 1]) as Align[]

  const rows: string[][] = []
  let j = i + 2
  while (j < lines.length && lines[j].trim() && lines[j].includes("|")) {
    const cells = splitRow(lines[j])
    while (cells.length < header.length) cells.push("")
    rows.push(cells.slice(0, header.length))
    j++
  }

  return { block: { kind: "table", header, align, rows }, next: j }
}

function parse(markdown: string): Block[] {
  const blocks: Block[] = []
  const lines = stripHtml(markdown.replace(/\r\n/g, "\n")).split("\n")

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

    const image = line.match(/^\s*!\[([^\]]*)\]\(([^)\s]+)/)
    if (image) {
      blocks.push({ kind: "image", alt: image[1], uri: image[2] })
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

    const table = tableAt(lines, i)
    if (table) {
      blocks.push(table.block)
      i = table.next
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
      !/^\s*(#{1,6}\s|>|[-*+]\s|\d+[.)]\s|```)/.test(lines[i]) &&
      !tableStartAt(lines, i)
    ) {
      body.push(lines[i].trim())
      i++
    }
    if (body.length) blocks.push({ kind: "paragraph", text: body.join("\n") })
  }

  return blocks
}

/** Inline emphasis, code and links. */
function Inline({
  text,
  size = 16,
  bold = false,
  align,
}: {
  text: string
  size?: number
  bold?: boolean
  align?: "left" | "center" | "right"
}) {
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
    <Text
      style={{
        color: p.text,
        fontSize: size,
        lineHeight: size * 1.6,
        fontWeight: bold ? "600" : undefined,
        textAlign: align,
      }}
    >
      {parts}
    </Text>
  )
}

/** Cell text length with inline markup stripped, for column width estimation. */
function plainLength(text: string): number {
  return text
    .replace(/\[([^\]]+)\]\([^)]+\)/g, "$1")
    .replace(/[*_`]/g, "").length
}

/**
 * A pipe table. Columns get a fixed width estimated from their longest cell so
 * rows stay aligned, and the whole grid lives in a horizontal ScrollView so a
 * wide table scrolls instead of crushing the screen layout. Long cells wrap
 * once they hit the per-column cap.
 */
function TableBlock({ block }: { block: Extract<Block, { kind: "table" }> }) {
  const p = usePalette()

  const widths = useMemo(
    () =>
      block.header.map((h, c) => {
        const longest = Math.max(plainLength(h), ...block.rows.map((r) => plainLength(r[c] ?? "")))
        return Math.min(Math.max(longest * 8, 56), 224) + space.md * 2
      }),
    [block],
  )

  const cellStyle = (c: number) => ({
    width: widths[c],
    paddingVertical: space.sm,
    paddingHorizontal: space.md,
  })

  return (
    <ScrollView horizontal showsHorizontalScrollIndicator={false}>
      <View
        style={{
          borderWidth: StyleSheet.hairlineWidth,
          borderColor: p.border,
          borderRadius: layout.radiusSmall,
          overflow: "hidden",
        }}
      >
        <View style={{ flexDirection: "row", backgroundColor: p.input }}>
          {block.header.map((cell, c) => (
            <View key={c} style={cellStyle(c)}>
              <Inline text={cell} size={14} bold align={block.align[c] ?? "left"} />
            </View>
          ))}
        </View>
        {block.rows.map((row, r) => (
          <View
            key={r}
            style={{
              flexDirection: "row",
              borderTopWidth: StyleSheet.hairlineWidth,
              borderTopColor: p.border,
            }}
          >
            {row.map((cell, c) => (
              <View key={c} style={cellStyle(c)}>
                <Inline text={cell} size={14} align={block.align[c] ?? "left"} />
              </View>
            ))}
          </View>
        ))}
      </View>
    </ScrollView>
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
          case "table":
            return <TableBlock key={idx} block={b} />
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
