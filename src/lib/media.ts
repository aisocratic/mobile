/**
 * "Is this URL a video?", answered the only way the data allows: by extension.
 *
 * Nothing in `updates` or `blog_posts` marks a media URL as video versus
 * image — a clip simply arrives in `cover_image` or in a markdown body as a
 * bare .mp4 link. The extension check is deliberately conservative: only
 * formats expo-video can actually play on both platforms count, so anything
 * unrecognised keeps falling through the existing image paths.
 */
const VIDEO_EXTENSIONS = new Set(["mp4", "m4v", "mov", "webm", "m3u8"])

export function isVideoUrl(url: string | null | undefined): boolean {
  if (!url) return false
  // Query strings and fragments (`clip.mp4?token=…#t=12`) are not part of the
  // filename.
  const path = url.trim().split(/[?#]/)[0]
  const dot = path.lastIndexOf(".")
  if (dot === -1) return false
  return VIDEO_EXTENSIONS.has(path.slice(dot + 1).toLowerCase())
}
