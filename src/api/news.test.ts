import { newsImage, newsVideo, type NewsItem } from "./news"

// These tests exercise the pure media helpers; no query ever runs. The mock
// exists so importing news.ts doesn't construct a real Supabase client.
jest.mock("@/lib/api", () => ({
  SITE_URL: "https://aisocratic.org",
  api: { from: jest.fn() },
}))

function item(overrides: Partial<NewsItem> = {}): NewsItem {
  return {
    id: "1",
    slug: null,
    title: null,
    summary: null,
    teaser: null,
    content: null,
    link: null,
    type: null,
    cover_image: null,
    cover_image_medium: null,
    cover_image_thumb: null,
    categories: null,
    authors: null,
    reading_time_minutes: null,
    published_at: null,
    comment_count: null,
    like_count: null,
    view_count: null,
    ...overrides,
  }
}

describe("newsVideo", () => {
  it("is null when every cover is a still or missing", () => {
    expect(newsVideo(item())).toBeNull()
    expect(newsVideo(item({ cover_image: "https://cdn.example.com/cover.jpg" }))).toBeNull()
  })

  it("finds a clip in any cover column", () => {
    expect(newsVideo(item({ cover_image: "https://cdn.example.com/launch.mp4" }))).toBe(
      "https://cdn.example.com/launch.mp4",
    )
    expect(newsVideo(item({ cover_image_medium: "https://cdn.example.com/launch.webm" }))).toBe(
      "https://cdn.example.com/launch.webm",
    )
  })

  it("absolutises site-relative video paths like the image helper does", () => {
    expect(newsVideo(item({ cover_image: "/media/launch.mp4" }))).toBe(
      "https://aisocratic.org/media/launch.mp4",
    )
  })
})

describe("newsImage", () => {
  it("skips a video cover and falls through to the next real still", () => {
    const row = item({
      cover_image: "https://cdn.example.com/launch.mp4",
      cover_image_medium: "https://cdn.example.com/launch-medium.jpg",
    })
    expect(newsImage(row, "large")).toBe("https://cdn.example.com/launch-medium.jpg")
  })

  it("is null rather than a video URL when the clip is the only media", () => {
    expect(newsImage(item({ cover_image: "https://cdn.example.com/launch.mp4" }))).toBeNull()
  })

  it("still resolves ordinary image covers", () => {
    expect(newsImage(item({ cover_image: "https://cdn.example.com/cover.jpg" }))).toBe(
      "https://cdn.example.com/cover.jpg",
    )
  })
})
