/**
 * Row shapes for the tables this app reads, transcribed from the live
 * PostgREST schema at api.aisocratic.org. Only the columns the app selects are
 * listed — the real tables are much wider.
 */

export type EventHost = {
  name: string | null
  bio?: string | null
  api_id?: string | null
  avatar_url?: string | null
  twitter_handle?: string | null
  linkedin_handle?: string | null
}

export type EventRow = {
  id: string
  slug: string | null
  title: string | null
  summary: string | null
  content: string | null
  url: string | null
  start_at: string | null
  end_at: string | null
  timezone: string | null
  city: string | null
  country: string | null
  venue: string | null
  is_virtual: boolean | null
  organizer: string | null
  /** jsonb array of Luma host objects. */
  hosts: EventHost[] | null
  tags: string[] | null
  guest_count: number | null
  cover_url: string | null
  cover_url_medium: string | null
  cover_url_thumb: string | null
  image_url: string | null
  blog_post_slug: string | null
}

export type BlogPostRow = {
  id: string
  slug: string
  title: string | null
  summary: string | null
  teaser: string | null
  content: string | null
  cover_image: string | null
  cover_image_medium: string | null
  cover_image_thumb: string | null
  authors: string[] | null
  categories: string[] | null
  reading_time_minutes: number | null
  published_at: string | null
  view_count: number | null
  like_count: number | null
}

/** The `updates` table backs the website's news feed. */
export type NewsRow = {
  id: string
  slug: string | null
  title: string | null
  summary: string | null
  teaser: string | null
  content: string | null
  link: string | null
  type: string | null
  cover_image: string | null
  cover_image_medium: string | null
  categories: string[] | null
  authors: string[] | null
  reading_time_minutes: number | null
  published_at: string | null
  comment_count: number | null
  like_count: number | null
}

export type MemberRow = {
  id: string
  slug: string | null
  user_id: string | null
  name: string | null
  first_name: string | null
  last_name: string | null
  organization: string | null
  role: string | null
  location: string | null
  bio_summary: string | null
  summary: string | null
  linkedin: string | null
  linkedin_headline: string | null
  profile_picture_url: string | null
  expertise: string[] | null
  event_approved_count: number | null
  event_checked_in_count: number | null
  public_profile: boolean | null
}

/** How you and another member overlapped at a given event. */
export type ConnectionRole = "host" | "guest"

export type SharedEvent = {
  eventId: string
  title: string | null
  startAt: string | null
  city: string | null
  /** Your role at that event. */
  myRole: ConnectionRole
  /** Their role at that event. */
  theirRole: ConnectionRole
}

export type Connection = {
  /** event_users.id — stable identity for the person across events. */
  id: string
  name: string | null
  email: string | null
  avatarUrl: string | null
  company: string | null
  title: string | null
  location: string | null
  linkedinUrl: string | null
  /** Set when this person has claimed an account on the site. */
  userId: string | null
  memberId: string | null
  sharedEvents: SharedEvent[]
}
