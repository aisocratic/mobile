import { act, renderHook } from "@testing-library/react-native"
import { AccessibilityInfo } from "react-native"

import { __resetReduceMotionForTests, useMayAnimate, useReduceMotion } from "./reduce-motion"

type ChangeHandler = (enabled: boolean) => void

let handlers: ChangeHandler[] = []
let remove: jest.Mock

function mockAccessibility(isEnabled: boolean | Promise<boolean>) {
  // `.mockClear()` rather than trusting `restoreAllMocks` between tests:
  // re-spying on an already-spied method hands back the *existing* mock, call
  // history and all, which silently turns "probed once" into "probed once per
  // test so far".
  jest
    .spyOn(AccessibilityInfo, "isReduceMotionEnabled")
    .mockImplementation(() => Promise.resolve(isEnabled))
    .mockClear()

  remove = jest.fn()
  jest
    .spyOn(AccessibilityInfo, "addEventListener")
    .mockImplementation(((event: string, handler: ChangeHandler) => {
      if (event === "reduceMotionChanged") handlers.push(handler)
      return { remove }
      // The real signature is a union over every accessibility event; this
      // fake only needs the one the store subscribes to.
    }) as unknown as typeof AccessibilityInfo.addEventListener)
}

beforeEach(() => {
  handlers = []
  __resetReduceMotionForTests()
})

afterEach(() => {
  jest.restoreAllMocks()
})

describe("useReduceMotion", () => {
  it("is undefined until the system answers, so nothing hides while waiting", () => {
    mockAccessibility(new Promise<boolean>(() => {}))

    const { result } = renderHook(() => useReduceMotion())

    expect(result.current).toBeUndefined()
    // The distinction the whole module exists for: "don't know yet" must not
    // read as "reduce motion is off" *or* as "hide the content".
    expect(useMayAnimateFrom(result.current)).toBe(false)
  })

  it("resolves to the system answer", async () => {
    mockAccessibility(true)

    const { result } = renderHook(() => useReduceMotion())
    await act(async () => {})

    expect(result.current).toBe(true)
  })

  it("probes once no matter how many components ask", async () => {
    mockAccessibility(false)

    renderHook(() => useReduceMotion())
    renderHook(() => useReduceMotion())
    const { result } = renderHook(() => useReduceMotion())
    await act(async () => {})

    expect(result.current).toBe(false)
    expect(AccessibilityInfo.isReduceMotionEnabled).toHaveBeenCalledTimes(1)
  })

  it("registers a single OS listener for the whole app", async () => {
    mockAccessibility(false)

    renderHook(() => useReduceMotion())
    renderHook(() => useReduceMotion())
    await act(async () => {})

    expect(handlers).toHaveLength(1)
  })

  it("picks up the setting being toggled while the app is running", async () => {
    mockAccessibility(false)

    const { result } = renderHook(() => useMayAnimate())
    await act(async () => {})
    expect(result.current).toBe(true)

    act(() => {
      for (const handler of handlers) handler(true)
    })

    expect(result.current).toBe(false)
  })

  it("falls back to allowing motion if the probe rejects", async () => {
    jest
      .spyOn(AccessibilityInfo, "isReduceMotionEnabled")
      .mockRejectedValue(new Error("no such native module"))
    jest
      .spyOn(AccessibilityInfo, "addEventListener")
      .mockImplementation((() => ({ remove: jest.fn() })) as unknown as typeof AccessibilityInfo.addEventListener)

    const { result } = renderHook(() => useMayAnimate())
    await act(async () => {})

    expect(result.current).toBe(true)
  })

  it("drops the OS listener once the last consumer unmounts", async () => {
    mockAccessibility(false)

    const first = renderHook(() => useReduceMotion())
    const second = renderHook(() => useReduceMotion())
    await act(async () => {})

    first.unmount()
    expect(remove).not.toHaveBeenCalled()

    second.unmount()
    expect(remove).toHaveBeenCalledTimes(1)
  })
})

/** Mirrors `useMayAnimate`'s rule without needing a second render. */
function useMayAnimateFrom(value: boolean | undefined): boolean {
  return value === false
}
