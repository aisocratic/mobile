import { Redirect } from "expo-router"
import React from "react"

/**
 * Entry point. AuthGate in the root layout bounces to (auth) when there's no
 * session, so unconditionally aiming at the tabs is safe.
 */
export default function Index() {
  return <Redirect href="/(tabs)/events" />
}
