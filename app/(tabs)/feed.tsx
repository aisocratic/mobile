import React from "react"

import { FeedMasthead } from "@/components/feed-masthead"
import { StoryStream } from "@/components/story-stream"

/**
 * Feed is the news: what happened, newest first. Essays live one tab over in
 * Blog — mixing the two behind a source filter buried the news the moment a
 * long-form post outdated it.
 */
export default function FeedScreen() {
  return <StoryStream source="news" masthead={<FeedMasthead />} />
}
