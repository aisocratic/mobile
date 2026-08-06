import { isVideoUrl } from "./media"

describe("isVideoUrl", () => {
  it("is false for null, undefined and empty — production data is full of them", () => {
    expect(isVideoUrl(null)).toBe(false)
    expect(isVideoUrl(undefined)).toBe(false)
    expect(isVideoUrl("")).toBe(false)
    expect(isVideoUrl("   ")).toBe(false)
  })

  it("recognises the playable video extensions", () => {
    expect(isVideoUrl("https://cdn.example.com/clip.mp4")).toBe(true)
    expect(isVideoUrl("https://cdn.example.com/clip.m4v")).toBe(true)
    expect(isVideoUrl("https://cdn.example.com/clip.mov")).toBe(true)
    expect(isVideoUrl("https://cdn.example.com/clip.webm")).toBe(true)
    expect(isVideoUrl("https://cdn.example.com/stream.m3u8")).toBe(true)
  })

  it("is case-insensitive, the way filenames from a CMS are", () => {
    expect(isVideoUrl("https://cdn.example.com/CLIP.MP4")).toBe(true)
  })

  it("ignores query strings and fragments", () => {
    expect(isVideoUrl("https://cdn.example.com/clip.mp4?token=abc#t=12")).toBe(true)
    expect(isVideoUrl("https://cdn.example.com/page?video=clip.mp4")).toBe(false)
  })

  it("works on site-relative paths, which news covers use", () => {
    expect(isVideoUrl("/media/launch.mp4")).toBe(true)
    expect(isVideoUrl("/media/launch.jpg")).toBe(false)
  })

  it("is false for images and extension-less URLs", () => {
    expect(isVideoUrl("https://cdn.example.com/cover.jpg")).toBe(false)
    expect(isVideoUrl("https://cdn.example.com/cover.png")).toBe(false)
    expect(isVideoUrl("https://www.youtube.com/watch")).toBe(false)
    expect(isVideoUrl("https://example.com/")).toBe(false)
  })
})
