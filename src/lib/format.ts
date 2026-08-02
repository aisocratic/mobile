/** Date, text and link helpers shared across screens. */

export function parseDate(value: string | null | undefined): Date | null {
  if (!value) return null
  const d = new Date(value)
  return Number.isNaN(d.getTime()) ? null : d
}

export function formatEventDate(value: string | null | undefined): string {
  const d = parseDate(value)
  if (!d) return "Date TBA"
  return d.toLocaleDateString(undefined, {
    weekday: "short",
    month: "short",
    day: "numeric",
    year: d.getFullYear() === new Date().getFullYear() ? undefined : "numeric",
  })
}

export function formatEventTime(value: string | null | undefined): string | null {
  const d = parseDate(value)
  if (!d) return null
  return d.toLocaleTimeString(undefined, { hour: "numeric", minute: "2-digit" })
}

export function formatDay(value: string | null | undefined): string {
  const d = parseDate(value)
  if (!d) return ""
  return d.toLocaleDateString(undefined, { month: "short", day: "numeric", year: "numeric" })
}

/** "3d ago", "2mo ago" — compact relative time for feeds. */
export function timeAgo(value: string | null | undefined): string {
  const d = parseDate(value)
  if (!d) return ""
  const secs = Math.round((Date.now() - d.getTime()) / 1000)
  if (secs < 60) return "just now"

  const units: [number, string][] = [
    [60, "m"],
    [3600, "h"],
    [86400, "d"],
    [604800, "w"],
    [2592000, "mo"],
    [31536000, "y"],
  ]

  let best = units[0]
  for (const u of units) if (secs >= u[0]) best = u
  return `${Math.floor(secs / best[0])}${best[1]} ago`
}

export function isUpcoming(startAt: string | null | undefined): boolean {
  const d = parseDate(startAt)
  return !!d && d.getTime() >= Date.now()
}

/** Strip markdown/HTML down to a plain-text preview line. */
export function excerpt(source: string | null | undefined, max = 160): string {
  if (!source) return ""
  const text = source
    .replace(/```[\s\S]*?```/g, " ")
    .replace(/<[^>]+>/g, " ")
    .replace(/!\[[^\]]*\]\([^)]*\)/g, " ")
    .replace(/\[([^\]]*)\]\([^)]*\)/g, "$1")
    .replace(/[#>*_`~-]/g, " ")
    .replace(/\s+/g, " ")
    .trim()

  return text.length > max ? `${text.slice(0, max).trimEnd()}…` : text
}

export function displayName(...parts: (string | null | undefined)[]): string {
  const name = parts.find((p) => p && p.trim())
  return name?.trim() ?? "Unnamed"
}

/** events.organizer is stored as a JSON string, not jsonb. */
export function organizerName(raw: string | null | undefined): string | null {
  if (!raw) return null
  try {
    const parsed = JSON.parse(raw) as { name?: string }
    return parsed.name ?? null
  } catch {
    return raw
  }
}

export function linkedinUrl(handle: string | null | undefined): string | null {
  if (!handle) return null
  if (handle.startsWith("http")) return handle
  return `https://www.linkedin.com${handle.startsWith("/") ? "" : "/in/"}${handle}`
}

/**
 * `linkedinUrl` expands handles the *schema* stores. This one takes whatever a
 * member types into the profile editor — a full URL, a pasted `linkedin.com/…`
 * path with no scheme, or a bare handle — and normalises it to a real URL.
 */
export function normalizeLinkedIn(value: string | null | undefined): string | null {
  const input = value?.trim().replace(/\/+$/, "")
  if (!input) return null
  if (/^https?:\/\//i.test(input)) return input
  if (/^(www\.)?linkedin\.com\//i.test(input)) return `https://${input.replace(/^www\./i, "")}`
  return linkedinUrl(input.replace(/^\/+/, ""))
}
