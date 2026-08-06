import { fireEvent, render, screen } from "@testing-library/react-native"
import * as Haptics from "expo-haptics"
import React from "react"
import { StyleSheet } from "react-native"

import { darkPalette, layout, lightPalette, ThemeProvider } from "@/theme"
import { Button, Field, SegmentedControl, segmentScrollTarget } from "./ui"

// See the note in touchable.test.tsx: the real motion gate resolves on a
// microtask and would land a state update after the test body finishes.
jest.mock("@/lib/reduce-motion", () => ({
  useMayAnimate: () => true,
  useReduceMotion: () => false,
}))

jest.mock("expo-haptics", () => ({
  selectionAsync: jest.fn(async () => undefined),
  impactAsync: jest.fn(async () => undefined),
  notificationAsync: jest.fn(async () => undefined),
  ImpactFeedbackStyle: { Light: "light", Medium: "medium" },
  NotificationFeedbackType: { Success: "success" },
}))

afterEach(() => {
  jest.clearAllMocks()
})

function flatten(style: unknown): Record<string, unknown> {
  return (StyleSheet.flatten(style as never) ?? {}) as Record<string, unknown>
}

const OPTIONS = [
  { value: "all", label: "All" },
  { value: "news", label: "News" },
  { value: "blog", label: "Blog" },
]

describe("SegmentedControl", () => {
  it("reports the selected option to accessibility", () => {
    render(<SegmentedControl options={OPTIONS} value="news" onChange={jest.fn()} />)

    expect(screen.getByRole("tab", { name: "News" }).props.accessibilityState).toMatchObject({
      selected: true,
    })
    expect(screen.getByRole("tab", { name: "All" }).props.accessibilityState).toMatchObject({
      selected: false,
    })
  })

  it("calls onChange with the tapped option", () => {
    const onChange = jest.fn()
    render(<SegmentedControl options={OPTIONS} value="all" onChange={onChange} />)

    fireEvent.press(screen.getByRole("tab", { name: "Blog" }))

    expect(onChange).toHaveBeenCalledWith("blog")
  })

  it("gives moving the selection a haptic, the way the platform control does", () => {
    render(<SegmentedControl options={OPTIONS} value="all" onChange={jest.fn()} />)

    fireEvent.press(screen.getByRole("tab", { name: "Blog" }))

    expect(Haptics.selectionAsync).toHaveBeenCalledTimes(1)
  })

  it("stays silent when you tap the option already selected", () => {
    const onChange = jest.fn()
    render(<SegmentedControl options={OPTIONS} value="all" onChange={onChange} />)

    fireEvent.press(screen.getByRole("tab", { name: "All" }))

    expect(Haptics.selectionAsync).not.toHaveBeenCalled()
    // Still reported: the screen decides whether re-selecting means anything.
    expect(onChange).toHaveBeenCalledWith("all")
  })

  /**
   * Regression: selecting a chip must not change its width, or every sibling
   * shifts. Selection is colour-only — the box (padding, border width) and the
   * label's font metrics have to be identical in both states.
   */
  it("gives selected and idle chips the same box and font metrics", () => {
    render(<SegmentedControl options={OPTIONS} value="news" onChange={jest.fn()} />)

    const box = (name: string) => {
      const { paddingHorizontal, paddingVertical, borderWidth } = flatten(
        screen.getByRole("tab", { name }).props.style,
      )
      return { paddingHorizontal, paddingVertical, borderWidth }
    }
    const font = (label: string) => {
      const { fontSize, fontWeight, letterSpacing } = flatten(
        screen.getByText(label).props.style,
      )
      return { fontSize, fontWeight, letterSpacing }
    }

    expect(box("News")).toEqual(box("All"))
    expect(font("News")).toEqual(font("All"))
  })
})

/**
 * The other half of the no-layout-shift guarantee: the row only auto-scrolls
 * when the selected chip is actually clipped by an edge. Unconditional
 * scrolling here was the bug — every tap snapped the row to a new offset.
 */
describe("segmentScrollTarget", () => {
  const VIEWPORT = 400

  it("leaves the row alone when the chip is already fully visible", () => {
    expect(segmentScrollTarget({ x: 100, width: 80, height: 32 }, 0, VIEWPORT)).toBeNull()
    // Exactly on the margin still counts as visible.
    expect(
      segmentScrollTarget({ x: layout.gutter, width: VIEWPORT - layout.gutter * 2, height: 32 }, 0, VIEWPORT),
    ).toBeNull()
  })

  it("scrolls the minimum distance to rescue a chip clipped on the right", () => {
    expect(segmentScrollTarget({ x: 360, width: 80, height: 32 }, 0, VIEWPORT)).toBe(
      360 + 80 + layout.gutter - VIEWPORT,
    )
  })

  it("scrolls the minimum distance to rescue a chip clipped on the left", () => {
    expect(segmentScrollTarget({ x: 100, width: 80, height: 32 }, 200, VIEWPORT)).toBe(
      100 - layout.gutter,
    )
  })

  it("clamps to the row start rather than overscrolling past it", () => {
    expect(segmentScrollTarget({ x: 10, width: 60, height: 32 }, 200, VIEWPORT)).toBe(0)
  })
})

describe("Field", () => {
  it("shows the accent ring while focused and drops it on blur", () => {
    render(<Field placeholder="Search" />)
    const input = screen.getByPlaceholderText("Search")

    expect(flatten(input.props.style).borderColor).toBe(lightPalette.border)

    fireEvent(input, "focus")
    expect(flatten(input.props.style).borderColor).toBe(lightPalette.accent)

    fireEvent(input, "blur")
    expect(flatten(input.props.style).borderColor).toBe(lightPalette.border)
  })

  /**
   * Regression: `onFocus`/`onBlur` have to be pulled out of the spread props.
   * Left in, `{...rest}` re-applies the caller's handler over the internal one
   * and the focus ring never lights up — while the caller's handler keeps
   * working, so the bug looks like "the ring is broken", not "props are lost".
   */
  it("keeps the caller's own focus handlers working", () => {
    const onFocus = jest.fn()
    const onBlur = jest.fn()
    render(<Field placeholder="Search" onFocus={onFocus} onBlur={onBlur} />)
    const input = screen.getByPlaceholderText("Search")

    fireEvent(input, "focus")
    expect(onFocus).toHaveBeenCalledTimes(1)
    expect(flatten(input.props.style).borderColor).toBe(lightPalette.accent)

    fireEvent(input, "blur")
    expect(onBlur).toHaveBeenCalledTimes(1)
  })

  it("shows the error colour ahead of the focus ring", () => {
    render(<Field placeholder="Email" error="That address looks wrong" />)
    const input = screen.getByPlaceholderText("Email")

    fireEvent(input, "focus")

    expect(flatten(input.props.style).borderColor).toBe(lightPalette.danger)
    expect(screen.getByText("That address looks wrong")).toBeOnTheScreen()
  })
})

describe("Button", () => {
  it("marks itself busy and ignores presses while loading", () => {
    const onPress = jest.fn()
    render(<Button label="Save" loading onPress={onPress} />)

    fireEvent.press(screen.getByRole("button"))

    expect(onPress).not.toHaveBeenCalled()
    expect(screen.getByRole("button").props.accessibilityState).toMatchObject({ busy: true })
  })
})

describe("ThemeProvider", () => {
  it("hands the dark palette to everything below it", () => {
    // `useColorScheme` is what the provider subscribes to; the palette every
    // component reads is the context value, so this is the whole contract.
    jest.spyOn(require("react-native"), "useColorScheme").mockReturnValue("dark")

    render(
      <ThemeProvider>
        <Field placeholder="Search" />
      </ThemeProvider>,
    )

    expect(flatten(screen.getByPlaceholderText("Search").props.style).backgroundColor).toBe(
      darkPalette.input,
    )
  })
})
