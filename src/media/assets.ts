/**
 * The website's own motion and image assets, reused here.
 *
 * These are the same files aisocratic.org serves — not re-cut copies — so the
 * app and the site stay visually identical without a second asset pipeline.
 * Both origins are public CDNs (no signing, no auth), which is what makes them
 * safe to stream from a client bundle.
 *
 * Mirrored from the website repo:
 *   404 hero      components/not-found-screen.tsx  (hardcoded CloudFront URL)
 *   home CTA      lib/media/cta-video.ts           (R2 keys + R2_PUBLIC_BASE_URL)
 *
 * If the site moves an asset, this file is the one place to follow it. The URLs
 * are duplicated rather than fetched because a config round trip before the
 * first frame would defeat the point of a background video.
 */

/** R2_PUBLIC_BASE_URL in the website's env. Public bucket, no credentials. */
const R2 = "https://pub-7a2c36ac409a4be0a469be59c0e02fd6.r2.dev"

export type VideoAsset = {
  /** What to stream. Prefer the smallest encode that still looks right. */
  uri: string
  /**
   * A still frame shown until the first video frame is ready — and shown
   * *instead* of it under Reduce Motion or on a metered connection.
   *
   * Not optional by design. A background video with no poster renders a black
   * rectangle for as long as the network takes, which on a hero screen reads as
   * a broken app rather than a loading one.
   */
  poster: string
  /** Bytes, measured from the CDN. Used to decide what is safe to autoplay. */
  bytes: number
}

/**
 * The 404 hero loop — the one the site plays full-viewport behind its 404.
 *
 * 7.4 MB, and there is no smaller cut of it: the site only ever serves this to
 * desktop-ish viewports on a page nobody plans to visit. That weight is the
 * reason `VideoBackground` treats it as poster-first and only upgrades to
 * motion once it has actually loaded.
 */
export const HERO_VIDEO: VideoAsset = {
  uri: "https://d8j0ntlcm91z4.cloudfront.net/user_38xzZboKViGWJOttwIXH07lWA1P/hf_20260801_001207_ec20d138-aa45-4b2b-ab8c-bdc71607f240.mp4",
  // The CloudFront asset ships no poster, so the CTA still stands in. Both are
  // dark, warm-toned and abstract, so it reads as intentional rather than as a
  // mismatched placeholder.
  poster: `${R2}/blog-assets/fundraising/cta-background-poster.jpg`,
  bytes: 7_390_977,
}

/**
 * The homepage CTA loop, in its mobile encode.
 *
 * The website picks between a desktop H.264 cut and this one with a
 * `media`-scoped <source>; a phone is unambiguously the small viewport, so the
 * app just takes the mobile cut. 266 KB against 907 KB, for a video that plays
 * at 40% opacity behind text.
 */
export const CTA_VIDEO: VideoAsset = {
  uri: `${R2}/blog-assets/fundraising/cta-background-mobile.mp4`,
  poster: `${R2}/blog-assets/fundraising/cta-background-poster.jpg`,
  bytes: 265_732,
}

/**
 * Above this, a background video is a considered download rather than a free
 * flourish, and `VideoBackground` will not start it until the screen has been
 * on-screen long enough to mean the user is actually there.
 *
 * 1 MB is roughly "a large photo": the CTA loop sits comfortably under it, the
 * 404 loop is seven times over.
 */
export const AUTOPLAY_BUDGET_BYTES = 1_000_000
