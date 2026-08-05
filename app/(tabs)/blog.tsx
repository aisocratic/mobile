import React from "react"

import { StoryStream } from "@/components/story-stream"

/**
 * The blog, whole: essays and the monthly digests. No masthead — the video
 * belongs to Feed, the app's front door, and repeating it here would spend
 * its arrival on every tab.
 */
export default function BlogScreen() {
  return <StoryStream source="blog" />
}
