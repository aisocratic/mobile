import { act, fireEvent, render, screen } from "@testing-library/react-native"
import React from "react"
import { AccessibilityInfo } from "react-native"

import { __resetReduceMotionForTests } from "@/lib/reduce-motion"

import { InlineVideo } from "./inline-video"

/** The stateful fakes recorded by the expo-video mock in jest.setup.ts. */
type FakePlayer = {
  source: unknown
  loop: boolean
  muted: boolean
  playing: boolean
  audioMixingMode: string
  play: jest.Mock
  pause: jest.Mock
}

const { __videoPlayers } = jest.requireMock("expo-video") as { __videoPlayers: FakePlayer[] }

const URI = "https://cdn.example.com/clip.mp4"

function lastPlayer(): FakePlayer {
  return __videoPlayers[__videoPlayers.length - 1]
}

function mockReduceMotion(enabled: boolean) {
  jest.spyOn(AccessibilityInfo, "isReduceMotionEnabled").mockResolvedValue(enabled)
  jest
    .spyOn(AccessibilityInfo, "addEventListener")
    .mockImplementation((() => ({
      remove: jest.fn(),
    })) as unknown as typeof AccessibilityInfo.addEventListener)
}

beforeEach(() => {
  __videoPlayers.length = 0
  __resetReduceMotionForTests()
})

afterEach(() => {
  jest.restoreAllMocks()
})

describe("InlineVideo", () => {
  it("renders nothing for a missing uri with no poster — nulls must not crash", async () => {
    mockReduceMotion(false)
    render(<InlineVideo uri={null} />)
    await act(async () => {})

    expect(screen.toJSON()).toBeNull()
  })

  it("falls back to the poster alone when the uri is null, and never sources a player", async () => {
    mockReduceMotion(false)
    render(<InlineVideo uri={undefined} poster="https://cdn.example.com/still.jpg" />)
    await act(async () => {})

    expect(screen.getByTestId("inline-video")).toBeOnTheScreen()
    expect(__videoPlayers.every((p) => p.source === null)).toBe(true)
    expect(screen.queryByLabelText("Play video")).toBeNull()
  })

  it("autoplays muted and looping once the system allows motion", async () => {
    mockReduceMotion(false)
    render(<InlineVideo uri={URI} />)
    await act(async () => {})

    const player = lastPlayer()
    expect(player.source).toBe(URI)
    expect(player.muted).toBe(true)
    expect(player.loop).toBe(true)
    expect(player.audioMixingMode).toBe("mixWithOthers")
    expect(player.play).toHaveBeenCalled()
  })

  it("stays a paused poster with a play control under Reduce Motion, fetching nothing", async () => {
    mockReduceMotion(true)
    render(<InlineVideo uri={URI} />)
    await act(async () => {})

    expect(screen.getByLabelText("Play video")).toBeOnTheScreen()
    // The gate is about not spending the bytes, not just not moving: no player
    // ever receives the uri until the reader asks.
    expect(__videoPlayers.every((p) => p.source === null)).toBe(true)
  })

  it("plays on demand under Reduce Motion — the gate blocks autoplay, not the reader", async () => {
    mockReduceMotion(true)
    render(<InlineVideo uri={URI} />)
    await act(async () => {})

    fireEvent.press(screen.getByLabelText("Play video"))

    const player = lastPlayer()
    expect(player.source).toBe(URI)
    expect(player.play).toHaveBeenCalled()
    expect(screen.getByLabelText("Pause video")).toBeOnTheScreen()
  })

  it("pauses on tap while playing, and offers play again", async () => {
    mockReduceMotion(false)
    render(<InlineVideo uri={URI} />)
    await act(async () => {})

    fireEvent.press(screen.getByLabelText("Pause video"))

    expect(lastPlayer().pause).toHaveBeenCalled()
    expect(screen.getByLabelText("Play video")).toBeOnTheScreen()
  })

  it("names what it plays when given a label", async () => {
    mockReduceMotion(true)
    render(<InlineVideo uri={URI} label="Launch day" />)
    await act(async () => {})

    expect(screen.getByLabelText("Play video: Launch day")).toBeOnTheScreen()
  })

  it("stays muted until the reader asks for sound", async () => {
    mockReduceMotion(false)
    render(<InlineVideo uri={URI} />)
    await act(async () => {})

    expect(lastPlayer().muted).toBe(true)
    fireEvent.press(screen.getByLabelText("Unmute"))
    expect(lastPlayer().muted).toBe(false)
  })

  it("offers no tap surface when not interactive — the parent card owns the tap", async () => {
    mockReduceMotion(true)
    render(<InlineVideo uri={URI} interactive={false} />)
    await act(async () => {})

    // The cover is deliberately hidden from assistive tech — the card that
    // wraps it carries the label — so the query must opt into hidden elements.
    expect(screen.getByTestId("inline-video", { includeHiddenElements: true })).toBeOnTheScreen()
    expect(screen.queryByLabelText("Play video")).toBeNull()
  })

  it("still autoplays a non-interactive clip when motion is allowed", async () => {
    mockReduceMotion(false)
    render(<InlineVideo uri={URI} interactive={false} />)
    await act(async () => {})

    const player = lastPlayer()
    expect(player.source).toBe(URI)
    expect(player.play).toHaveBeenCalled()
  })
})
