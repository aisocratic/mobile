import { Redirect } from "expo-router"
import React from "react"

import { homeRoute } from "@/features"

/**
 * Entry point. AuthGate in the root layout bounces to (auth) when there's no
 * session, so unconditionally aiming at the tabs is safe.
 *
 * The destination follows the feature flags rather than naming a tab, so
 * switching one off can never land the app on a screen it doesn't ship.
 */
export default function Index() {
  return <Redirect href={homeRoute()} />
}
