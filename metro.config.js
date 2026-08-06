// eslint-disable-next-line @typescript-eslint/no-var-requires
const { getDefaultConfig } = require("expo/metro-config")

const config = getDefaultConfig(__dirname)

// Package-exports resolution stays off. It was originally forced by
// @supabase/supabase-js (whose browser/node conditional exports Metro picked
// badly); that dependency is gone, but src/chat/protocol.ts was built on flat
// @noble/@scure files precisely so the flag never matters, and flipping a
// global resolver switch is bundle-wide risk with nothing to buy.
config.resolver.unstable_enablePackageExports = false

module.exports = config
