import { coverUri, coverVideo } from "./blog"

// These tests exercise the pure cover helpers; no query ever runs. The mock
// exists so importing blog.ts doesn't construct a real Supabase client.
jest.mock("@/lib/api", () => ({
  SITE_URL: "https://aisocratic.org",
  api: { from: jest.fn() },
}))

type Covers = {
  cover_image: string | null
  cover_image_medium: string | null
  cover_image_thumb: string | null
}

function covers(overrides: Partial<Covers> = {}): Covers {
  return {
    cover_image: null,
    cover_image_medium: null,
    cover_image_thumb: null,
    ...overrides,
  }
}

describe("coverVideo", () => {
  it("is null for missing, empty and image covers", () => {
    expect(coverVideo(covers())).toBeNull()
    expect(coverVideo(covers({ cover_image: "" }))).toBeNull()
    expect(coverVideo(covers({ cover_image: "https://cdn.example.com/cover.jpg" }))).toBeNull()
  })

  it("returns the clip when a cover column holds a video", () => {
    expect(coverVideo(covers({ cover_image: "https://cdn.example.com/essay.mp4" }))).toBe(
      "https://cdn.example.com/essay.mp4",
    )
  })
})

describe("coverUri", () => {
  it("skips a video cover and falls through to the next real still", () => {
    const post = covers({
      cover_image: "https://cdn.example.com/essay.mp4",
      cover_image_medium: "https://cdn.example.com/essay-medium.jpg",
    })
    expect(coverUri(post, "full")).toBe("https://cdn.example.com/essay-medium.jpg")
  })

  it("is null rather than a video URL when the clip is the only media", () => {
    expect(coverUri(covers({ cover_image: "https://cdn.example.com/essay.mp4" }), "full")).toBeNull()
  })
})
