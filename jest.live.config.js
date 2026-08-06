/**
 * Jest config for LIVE integration tests against production infrastructure
 * (the Buzz relay + Supabase). Deliberately not part of the default suite:
 * `jest.config.js` matches `*.test.ts(x)` while these files are named
 * `*.livetest.ts`, so `npx jest` never picks them up and this config never
 * picks up the unit suite.
 *
 * Run:  npx jest -c jest.live.config.js --runInBand
 *
 * See scripts/dm-app.livetest.ts for the credentials it needs.
 */
const base = require("./jest.config.js")

module.exports = {
  ...base,
  testMatch: ["**/*.livetest.ts"],
  setupFilesAfterEnv: [...base.setupFilesAfterEnv, "<rootDir>/jest.live.setup.ts"],
  // Live network calls: account creation, joins, NIP-42 AUTH, publishes,
  // relay backfills.
  testTimeout: 180_000,
  maxWorkers: 1,
  // The app keeps live sockets and supabase auto-refresh timers; the test
  // tears its own state down but must not hang the runner on a stray handle.
  forceExit: true,
}
