import { fireEvent, render, screen } from "@testing-library/react-native"
import React from "react"
import { AccessibilityInfo } from "react-native"

import { useCommunityMembers, type CommunityMember } from "@/api/people"
import { PeopleList } from "./people-list"

/**
 * `useCommunityMembers` is the only thing this segment gets from `@/api/people`
 * that talks to the network; `filterCommunityMembers`/`matchesMemberSearch` are
 * pure and already covered in `src/api/people.test.ts`, so they're kept real
 * here rather than re-faked — that way the search-field test below exercises
 * the actual filter, not a stand-in for it.
 */
jest.mock("@/api/people", () => {
  const actual = jest.requireActual("@/api/people")
  return { ...actual, useCommunityMembers: jest.fn() }
})

const mockUseCommunityMembers = useCommunityMembers as jest.Mock

// FadeIn (see src/components/fade-in.tsx) renders children fully visible,
// with no animation, whenever Reduce Motion reads as anything other than
// `false` — including its initial `undefined` state, before this promise
// resolves. Resolving it to `true` here keeps that branch selected for the
// component's whole lifetime, so rows never pass through the animated
// (briefly-invisible) path no matter when the promise settles relative to
// a given assertion. That's what makes these renders deterministic.
beforeEach(() => {
  jest.spyOn(AccessibilityInfo, "isReduceMotionEnabled").mockResolvedValue(true)
})

afterEach(() => {
  jest.restoreAllMocks()
})

function member(overrides: Partial<CommunityMember> & { id: string; fullName: string }): CommunityMember {
  return {
    avatarUrl: null,
    jobTitle: null,
    organization: null,
    location: null,
    isMember: false,
    ...overrides,
  }
}

const ALICE = member({
  id: "alice-1",
  fullName: "Alice Nguyen",
  jobTitle: "Engineer",
  organization: "Acme Corp",
  location: "Berlin",
})

const BOB = member({
  id: "bob-1",
  fullName: "Bob Vance",
  jobTitle: "Sales",
  organization: "Vance Refrigeration",
  location: "Scranton",
})

type QueryResult = {
  data: CommunityMember[] | undefined
  isPending: boolean
  isFetching: boolean
  error: Error | null
  refetch: () => void
}

function queryResult(overrides: Partial<QueryResult> = {}): QueryResult {
  return {
    data: undefined,
    isPending: false,
    isFetching: false,
    error: null,
    refetch: jest.fn(),
    ...overrides,
  }
}

describe("PeopleList", () => {
  it("renders each member's name and their title · organization subtitle", async () => {
    mockUseCommunityMembers.mockReturnValue(queryResult({ data: [ALICE, BOB] }))

    render(<PeopleList onOpen={jest.fn()} />)

    expect(await screen.findByText("Alice Nguyen")).toBeOnTheScreen()
    expect(screen.getByText("Engineer · Acme Corp")).toBeOnTheScreen()
    expect(screen.getByText("Bob Vance")).toBeOnTheScreen()
    expect(screen.getByText("Sales · Vance Refrigeration")).toBeOnTheScreen()
  })

  it("calls onOpen with the tapped member's id", async () => {
    mockUseCommunityMembers.mockReturnValue(queryResult({ data: [ALICE, BOB] }))
    const onOpen = jest.fn()

    render(<PeopleList onOpen={onOpen} />)
    await screen.findByText("Alice Nguyen")

    fireEvent.press(screen.getByRole("button", { name: "Bob Vance" }))

    expect(onOpen).toHaveBeenCalledWith("bob-1")
    expect(onOpen).toHaveBeenCalledTimes(1)
  })

  it("filters the visible rows as the search field changes", async () => {
    mockUseCommunityMembers.mockReturnValue(queryResult({ data: [ALICE, BOB] }))

    render(<PeopleList onOpen={jest.fn()} />)
    await screen.findByText("Alice Nguyen")
    expect(screen.getByText("Bob Vance")).toBeOnTheScreen()

    fireEvent.changeText(
      screen.getByPlaceholderText("Search name, company or location"),
      "vance",
    )

    expect(screen.queryByText("Alice Nguyen")).toBeNull()
    expect(screen.getByText("Bob Vance")).toBeOnTheScreen()
  })

  it("renders the loader while the query is pending", async () => {
    mockUseCommunityMembers.mockReturnValue(queryResult({ isPending: true }))

    render(<PeopleList onOpen={jest.fn()} />)

    expect(await screen.findByText("Finding people…")).toBeOnTheScreen()
  })

  it("renders the error state with a working retry", async () => {
    const refetch = jest.fn()
    mockUseCommunityMembers.mockReturnValue(
      queryResult({ error: new Error("Could not reach the server"), refetch }),
    )

    render(<PeopleList onOpen={jest.fn()} />)

    expect(await screen.findByText("Couldn't load that")).toBeOnTheScreen()
    expect(screen.getByText("Could not reach the server")).toBeOnTheScreen()

    fireEvent.press(screen.getByText("Try again"))

    expect(refetch).toHaveBeenCalledTimes(1)
  })

  it("shows the empty-directory state when there are no members at all", async () => {
    mockUseCommunityMembers.mockReturnValue(queryResult({ data: [] }))

    render(<PeopleList onOpen={jest.fn()} />)

    expect(await screen.findByText("No one here yet")).toBeOnTheScreen()
    expect(screen.queryByText("No matches")).toBeNull()
  })

  it("shows a distinct no-match state when a search matches nobody", async () => {
    mockUseCommunityMembers.mockReturnValue(queryResult({ data: [ALICE, BOB] }))

    render(<PeopleList onOpen={jest.fn()} />)
    await screen.findByText("Alice Nguyen")

    fireEvent.changeText(
      screen.getByPlaceholderText("Search name, company or location"),
      "nobody-matches-this",
    )

    expect(await screen.findByText("No matches")).toBeOnTheScreen()
    expect(screen.queryByText("No one here yet")).toBeNull()
  })
})
