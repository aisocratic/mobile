import { render, screen } from "@testing-library/react-native"
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
})
