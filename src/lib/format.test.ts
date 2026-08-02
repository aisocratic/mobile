import {
  excerpt,
  isUpcoming,
  linkedinUrl,
  normalizeLinkedIn,
  organizerName,
  timeAgo,
} from "./format"

describe("organizerName", () => {
  // events.organizer is a JSON *string*, not jsonb — the one column shape in
  // the schema that reliably trips people up.
  it("pulls the name out of the JSON string form", () => {
    expect(organizerName('{"name":"AI Socratic","slug":"aisocratic"}')).toBe("AI Socratic")
  })

  it("passes through a plain string unchanged", () => {
    expect(organizerName("AI Socratic")).toBe("AI Socratic")
  })

  it("returns null when absent", () => {
    expect(organizerName(null)).toBeNull()
    expect(organizerName(undefined)).toBeNull()
  })
})

describe("excerpt", () => {
  it("strips markdown and collapses whitespace", () => {
    expect(excerpt("## Heading\n\nSome **bold** text  here")).toBe("Heading Some bold text here")
  })

  it("keeps link text and drops the target", () => {
    expect(excerpt("Read [the paper](https://example.com/x) now")).toBe("Read the paper now")
  })

  it("removes fenced code and html", () => {
    expect(excerpt("Before ```js\nconst a = 1\n``` <b>after</b>")).toBe("Before after")
  })

  it("truncates with an ellipsis", () => {
    expect(excerpt("a".repeat(200), 10)).toBe(`${"a".repeat(10)}…`)
  })

  it("returns an empty string for null content", () => {
    expect(excerpt(null)).toBe("")
  })
})

describe("linkedinUrl", () => {
  it("expands a bare handle", () => {
    expect(linkedinUrl("federicoulfo")).toBe("https://www.linkedin.com/in/federicoulfo")
  })

  it("expands the /in/ form used in events.hosts", () => {
    expect(linkedinUrl("/in/federicoulfo")).toBe("https://www.linkedin.com/in/federicoulfo")
  })

  it("leaves a full url alone", () => {
    const url = "https://www.linkedin.com/in/someone"
    expect(linkedinUrl(url)).toBe(url)
  })
})

describe("normalizeLinkedIn", () => {
  it("expands a bare handle typed into the profile editor", () => {
    expect(normalizeLinkedIn("federicoulfo")).toBe("https://www.linkedin.com/in/federicoulfo")
  })

  it("adds the scheme to a pasted path without doubling the domain", () => {
    expect(normalizeLinkedIn("linkedin.com/in/federicoulfo")).toBe(
      "https://linkedin.com/in/federicoulfo",
    )
    expect(normalizeLinkedIn("www.linkedin.com/company/aisocratic")).toBe(
      "https://linkedin.com/company/aisocratic",
    )
  })

  it("keeps a full url and drops a trailing slash", () => {
    expect(normalizeLinkedIn("https://www.linkedin.com/in/someone/")).toBe(
      "https://www.linkedin.com/in/someone",
    )
  })

  it("treats blank input as cleared", () => {
    expect(normalizeLinkedIn("   ")).toBeNull()
    expect(normalizeLinkedIn(null)).toBeNull()
  })
})

describe("isUpcoming", () => {
  it("is true for the future and false for the past", () => {
    expect(isUpcoming(new Date(Date.now() + 86_400_000).toISOString())).toBe(true)
    expect(isUpcoming(new Date(Date.now() - 86_400_000).toISOString())).toBe(false)
  })

  it("is false for missing or unparseable dates", () => {
    expect(isUpcoming(null)).toBe(false)
    expect(isUpcoming("not a date")).toBe(false)
  })
})

describe("timeAgo", () => {
  it("picks the largest fitting unit", () => {
    expect(timeAgo(new Date(Date.now() - 30_000).toISOString())).toBe("just now")
    expect(timeAgo(new Date(Date.now() - 5 * 60_000).toISOString())).toBe("5m ago")
    expect(timeAgo(new Date(Date.now() - 3 * 86_400_000).toISOString())).toBe("3d ago")
  })

  it("returns an empty string for null", () => {
    expect(timeAgo(null)).toBe("")
  })
})
