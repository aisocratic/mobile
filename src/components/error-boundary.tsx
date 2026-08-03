import type { ErrorBoundaryProps } from "expo-router"
import React, { useEffect } from "react"

import { ErrorState, Screen } from "@/components/ui"
import { lightPalette, usePalette, type Palette } from "@/theme"

/**
 * `usePalette` only reads `useColorScheme`, so today it works with nothing
 * mounted above it. But this component can end up rendered in place of
 * `app/_layout.tsx` itself — expo-router swaps in the whole route's
 * `ErrorBoundary` export when that route throws, so a crash inside
 * `RootLayout` means `GestureHandlerRootView`, `SafeAreaProvider`,
 * `QueryClientProvider` and `AuthProvider` never mounted at all. If theme.ts
 * ever grows a context dependency, that would turn a real bug into a second,
 * unrecoverable crash inside the screen whose one job is to survive crashes.
 * The try/catch is cheap insurance against that; a hardcoded palette beats no
 * screen. For the same reason, never reach for provider-backed hooks here
 * (useAuth, useSafeAreaInsets, useQuery, ...) no matter how tempting.
 */
function useSafePalette(): Palette {
  try {
    return usePalette()
  } catch {
    return lightPalette
  }
}

/**
 * Shared fallback for every `ErrorBoundary` export in the app (root layout,
 * tabs layout, ...). expo-router hands us the thrown `error` and a `retry`
 * that clears the boundary's state and re-renders the guarded subtree — it
 * does not remount the app or reset any state that lived above the boundary,
 * so this is "try that render again", not "restart".
 *
 * Kept to one file so every crash in the app reads the same, on-brand way
 * instead of whichever raw redbox or blank screen React or the OS happens to
 * show.
 */
export function AppErrorBoundary({ error, retry }: ErrorBoundaryProps) {
  const p = useSafePalette()

  useEffect(() => {
    // React's own default error-dialog handler already does this in dev, but
    // relies on internals of the current React/RN error-boundary machinery
    // that owe us nothing across versions. This build is going to a handful
    // of testers who can attach a device console but can't attach a
    // debugger, so log explicitly and don't depend on it. The stack trace
    // belongs here, not in the UI below — noise to a tester, useful to us.
    console.error(error)
  }, [error])

  return (
    <Screen style={{ justifyContent: "center", backgroundColor: p.background }}>
      <ErrorState
        error={error}
        onRetry={() => {
          void retry()
        }}
      />
    </Screen>
  )
}

// Re-exported so a route file can do `export { ErrorBoundary } from
// "@/components/error-boundary"` and satisfy expo-router's convention (it
// looks for a named export literally called `ErrorBoundary`) without every
// route needing its own copy of this component.
export { AppErrorBoundary as ErrorBoundary }
