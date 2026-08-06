/**
 * Environment for live tests. Loads the real app env from `.env` (Metro would
 * have inlined these; jest does not), so `src/lib/api.ts` and
 * `src/chat/nostr.ts` see the same configuration the shipped app does.
 * Must run before jest.setup.ts's `||=` defaults would fill in fakes — it
 * doesn't (setup files run in order, base first), so we overwrite instead.
 */
import { readFileSync } from "node:fs"
import { join } from "node:path"

try {
  const raw = readFileSync(join(__dirname, ".env"), "utf8")
  for (const line of raw.split("\n")) {
    const m = /^([A-Z0-9_]+)=(.*)$/.exec(line.trim())
    if (m && m[2]) process.env[m[1]] = m[2]
  }
} catch {
  /* no .env: the test will fail loudly on missing config instead */
}
