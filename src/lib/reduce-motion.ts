import { useSyncExternalStore } from "react"
import { AccessibilityInfo } from "react-native"

/**
 * "Is Reduce Motion on?", as one shared subscription.
 *
 * Every animated component in the app needs this answer, and the obvious
 * implementation — call `AccessibilityInfo.isReduceMotionEnabled()` from a
 * `useEffect` in each one — asks the same question once per mounted element.
 * A list of 30 staggered rows fired 30 native round-trips to learn one boolean.
 * Here the probe happens once for the whole app and the result is cached.
 *
 * It also listens for `reduceMotionChanged`, so toggling the setting in
 * Settings.app takes effect in a running app rather than at the next cold
 * start. The one-shot probe never could.
 *
 * The value is `undefined` until the first answer arrives. That distinction
 * matters and callers must respect it: treat "don't know yet" as "don't
 * animate, but don't hide anything either". A component that starts at
 * `opacity: 0` while waiting turns "reduce motion" into "content flashes in
 * late", which is the opposite of what was asked for.
 */
type Listener = () => void

let enabled: boolean | undefined
let probed = false
const listeners = new Set<Listener>()
let osSubscription: { remove: () => void } | null = null

function set(value: boolean) {
  if (enabled === value) return
  enabled = value
  for (const listener of listeners) listener()
}

function subscribe(listener: Listener): () => void {
  listeners.add(listener)

  if (listeners.size === 1) {
    // Optional-chained because the accessibility module is a native one, and a
    // test renderer or an unusual host may not provide the whole surface. A
    // missing listener costs live updates, not correctness.
    osSubscription = AccessibilityInfo.addEventListener?.("reduceMotionChanged", set) ?? null

    if (!probed) {
      probed = true
      AccessibilityInfo.isReduceMotionEnabled()
        .then(set)
        .catch(() => set(false))
    }
  }

  return () => {
    listeners.delete(listener)
    if (listeners.size === 0) {
      osSubscription?.remove()
      osSubscription = null
    }
  }
}

const snapshot = () => enabled

export function useReduceMotion(): boolean | undefined {
  return useSyncExternalStore(subscribe, snapshot, snapshot)
}

/**
 * True only once the system has actually said "no". Reads at call sites as
 * "may I animate?", which keeps the `undefined` case from being forgotten.
 */
export function useMayAnimate(): boolean {
  return useReduceMotion() === false
}

/** Test seam: forget the cached answer so the next subscriber probes again. */
export function __resetReduceMotionForTests() {
  enabled = undefined
  probed = false
  listeners.clear()
  osSubscription?.remove()
  osSubscription = null
}
