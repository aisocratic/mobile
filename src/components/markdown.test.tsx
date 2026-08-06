import { act, render, screen } from "@testing-library/react-native"
import React from "react"

import { Markdown } from "./markdown"

describe("Markdown", () => {
  /**
   * Regression: event bodies arrive from Luma as plain text where a single
   * newline *is* the structure. Joined with spaces, an agenda became one
   * run-on paragraph — "Agenda 6:00 PM Welcome 7:00 PM Dialogues".
   */
  it("keeps single newlines as line breaks inside a paragraph", () => {
    render(<Markdown content={"Agenda\n6:00 PM Welcome\n7:00 PM Dialogues"} />)

    const text = screen.getByText(/Agenda/)
    expect(text.props.children).toContain("Agenda\n6:00 PM Welcome\n7:00 PM Dialogues")
  })

  it("still separates paragraphs on blank lines", () => {
    render(<Markdown content={"First thought.\n\nSecond thought."} />)

    expect(screen.getByText("First thought.")).toBeOnTheScreen()
    expect(screen.getByText("Second thought.")).toBeOnTheScreen()
  })

  /**
   * Regression: several live posts open with a bare "#" left behind by the
   * editor. It has no heading text, so it must render as nothing — not as a
   * literal "#" above the title.
   */
  it("drops a bare # with no heading text", () => {
    render(<Markdown content={"#\n\nThe actual opening line."} />)

    expect(screen.queryByText("#")).toBeNull()
    expect(screen.getByText("The actual opening line.")).toBeOnTheScreen()
  })

  it("renders a real heading", () => {
    render(<Markdown content={"# The Open-Weight AI War"} />)

    expect(screen.getByText("The Open-Weight AI War")).toBeOnTheScreen()
  })

  /**
   * Markdown has no video syntax, so clips arrive three ways: image syntax
   * pointing at a video file, a bare URL on its own line, or an inline HTML
   * `<video>` tag. All three must reach the player, and plain images must not.
   */
  it("routes image syntax with a video URL to the video player", async () => {
    render(<Markdown content={"![demo](https://cdn.example.com/demo.mp4)"} />)
    await act(async () => {})

    expect(screen.getByTestId("inline-video")).toBeOnTheScreen()
  })

  it("plays a bare video URL standing alone on a line", async () => {
    const url = "https://cdn.example.com/launch.mp4"
    render(<Markdown content={`Watch the launch:\n\n${url}\n\nMore below.`} />)
    await act(async () => {})

    expect(screen.getByTestId("inline-video")).toBeOnTheScreen()
    // The URL plays; it must not also print as a paragraph of text.
    expect(screen.queryByText(url)).toBeNull()
  })

  it("lifts the src out of an inline <video> tag before HTML is stripped", async () => {
    render(
      <Markdown
        content={'Before.\n<video controls src="https://cdn.example.com/clip.mp4"></video>\nAfter.'}
      />,
    )
    await act(async () => {})

    expect(screen.getByTestId("inline-video")).toBeOnTheScreen()
    expect(screen.getByText("Before.")).toBeOnTheScreen()
    expect(screen.getByText("After.")).toBeOnTheScreen()
  })

  it("leaves ordinary images as images", async () => {
    render(<Markdown content={"![photo](https://cdn.example.com/cover.jpg)"} />)
    await act(async () => {})

    expect(screen.queryByTestId("inline-video")).toBeNull()
  })
})
