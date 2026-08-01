// eslint-disable-next-line @typescript-eslint/no-var-requires
const { getDefaultConfig } = require("expo/metro-config")

const config = getDefaultConfig(__dirname)

// @supabase/supabase-js ships browser/node conditional exports that Metro's
// package-exports resolution picks badly under the new architecture.
config.resolver.unstable_enablePackageExports = false

module.exports = config
