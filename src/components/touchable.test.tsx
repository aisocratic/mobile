import { fireEvent, render, screen } from "@testing-library/react-native"
import * as Haptics from "expo-haptics"
import React from "react"
import { StyleSheet, Text } from "react-native"

import { Touchable } from "./touchable"

/**
 * This suite is about presses and haptics, not about the motion gate — and the
 * real gate resolves its accessibility probe on a microtask, which lands a
 * state update after the test body has finished and trips React's act()
 * warning. Pinning it keeps the output clean and the renders synchronous;
 * `src/lib/reduce-motion.test.ts` covers the real thing.
 */
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

function flatten(style: unknown) {
  return StyleSheet.flatten(style as never) ?? {}
}

describe("Touchable", () => {
  it("calls onPress", () => {
    const onPress = jest.fn()
    render(
      <Touchable accessibilityRole="button" accessibilityLabel="Open" onPress={onPress}>
        <Text>Open</Text>
      </Touchable>,
    )

    fireEvent.press(screen.getByRole("button", { name: "Open" }))

    expect(onPress).toHaveBeenCalledTimes(1)
  })

  it("does not call onPress when disabled", () => {
    const onPress = jest.fn()
    render(
      <Touchable accessibilityRole="button" accessibilityLabel="Open" onPress={onPress} disabled>
        <Text>Open</Text>
      </Touchable>,
    )

    fireEvent.press(screen.getByRole("button", { name: "Open" }))

    expect(onPress).not.toHaveBeenCalled()
  })

  /**
   * The regression that motivated animating the pressable itself rather than a
   * view inside it: a `flex: 1` primary button in a row shrank to the width of
   * its label, because the layout style landed on the inner box while the
   * pressable sitting in the flex row still sized itself to its content.
   */
  it("puts layout style on the pressable, not on an inner view", () => {
    render(
      <Touchable accessibilityRole="button" accessibilityLabel="Register" style={{ flex: 1 }}>
        <Text>Register</Text>
      </Touchable>,
    )

    expect(flatten(screen.getByRole("button").props.style)).toMatchObject({ flex: 1 })
  })

  describe("haptics", () => {
    it("stays silent by default, so navigation rows don't buzz", () => {
      render(
        <Touchable accessibilityRole="button" accessibilityLabel="Row">
          <Text>Row</Text>
        </Touchable>,
      )

      fireEvent.press(screen.getByRole("button"))

      expect(Haptics.impactAsync).not.toHaveBeenCalled()
      expect(Haptics.selectionAsync).not.toHaveBeenCalled()
      expect(Haptics.notificationAsync).not.toHaveBeenCalled()
    })

    it("fires the requested feedback on press", () => {
      render(
        <Touchable accessibilityRole="button" accessibilityLabel="Send" haptic="light">
          <Text>Send</Text>
        </Touchable>,
      )

      fireEvent.press(screen.getByRole("button"))

      expect(Haptics.impactAsync).toHaveBeenCalledWith(Haptics.ImpactFeedbackStyle.Light)
    })

    it("fires on press rather than press-in, so a scroll that starts on a row is silent", () => {
      render(
        <Touchable accessibilityRole="button" accessibilityLabel="Send" haptic="light">
          <Text>Send</Text>
        </Touchable>,
      )

      fireEvent(screen.getByRole("button"), "pressIn")
      expect(Haptics.impactAsync).not.toHaveBeenCalled()

      fireEvent.press(screen.getByRole("button"))
      expect(Haptics.impactAsync).toHaveBeenCalledTimes(1)
    })

    it("stays silent when disabled", () => {
      render(
        <Touchable accessibilityRole="button" accessibilityLabel="Send" haptic="light" disabled>
          <Text>Send</Text>
        </Touchable>,
      )

      fireEvent.press(screen.getByRole("button"))

      expect(Haptics.impactAsync).not.toHaveBeenCalled()
    })
  })
})
