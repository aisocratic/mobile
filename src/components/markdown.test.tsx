import { act, render, screen } from "@testing-library/react-native"
import React from "react"
import { ScrollView } from "react-native"

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

  describe("tables", () => {
    it("renders a pipe table as cells inside a horizontal ScrollView", () => {
      render(
        <Markdown
          content={"| Model | Score |\n|---|---|\n| Claude | 92 |\n| GPT | 88 |"}
        />,
      )

      expect(screen.getByText("Model")).toBeOnTheScreen()
      expect(screen.getByText("Score")).toBeOnTheScreen()
      expect(screen.getByText("Claude")).toBeOnTheScreen()
      expect(screen.getByText("88")).toBeOnTheScreen()
      // No raw pipe syntax leaks through.
      expect(screen.queryByText(/\|/)).toBeNull()
      // Wide tables scroll sideways instead of crushing the layout.
      const scroll = screen.UNSAFE_getByType(ScrollView)
      expect(scroll.props.horizontal).toBe(true)
    })

    it("respects column alignment from the separator row", () => {
      render(
        <Markdown content={"| Left | Middle | Right |\n|:---|:---:|---:|\n| a | b | c |"} />,
      )

      expect(screen.getByText("a")).toHaveStyle({ textAlign: "left" })
      expect(screen.getByText("b")).toHaveStyle({ textAlign: "center" })
      expect(screen.getByText("c")).toHaveStyle({ textAlign: "right" })
    })

    it("renders inline markdown inside cells", () => {
      render(
        <Markdown
          content={"| Name | Notes |\n|---|---|\n| **bold** | [site](https://example.com) and `code` |"}
        />,
      )

      expect(screen.getByText("bold")).toHaveStyle({ fontWeight: "700" })
      expect(screen.getByText("site")).toHaveStyle({ textDecorationLine: "underline" })
      expect(screen.getByText("code")).toBeOnTheScreen()
    })

    it("pads short body rows to the header width", () => {
      render(<Markdown content={"| A | B |\n|---|---|\n| only |"} />)

      expect(screen.getByText("only")).toBeOnTheScreen()
      expect(screen.queryByText(/\|/)).toBeNull()
    })

    it("falls back to text when there is no separator row", () => {
      render(<Markdown content={"| A | B |\n| 1 | 2 |"} />)

      expect(screen.getByText("| A | B |\n| 1 | 2 |")).toBeOnTheScreen()
    })

    it("falls back to text when the separator width does not match the header", () => {
      render(<Markdown content={"| A | B | C |\n|---|---|\n| 1 | 2 | 3 |"} />)

      expect(screen.getByText(/\| A \| B \| C \|/)).toBeOnTheScreen()
      expect(screen.queryByText("A")).toBeNull()
    })
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
