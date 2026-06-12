import { existsSync, readFileSync } from "node:fs";
import { defineConfig, devices } from "@playwright/test";

// ---------------------------------------------------------------------------
// Playwright config for end-to-end smoke tests (Phase 11 chunk 16).
//
// Two modes:
//
//   • With .env.e2e present (see .env.e2e.example + tests/README.md): the
//     suite spins up its OWN dev server on port 3100 pointed at the LOCAL
//     Supabase stack (`supabase start`), with the seeded test user. All
//     specs run, including the auth/create/import/pricing ones. Your
//     normal :3000 dev server and the real project are untouched.
//
//   • Without it: unchanged legacy behavior — port 3000, marketing + a11y
//     smoke only; cred-gated specs skip.
//
// Local setup notes (one-time):
//   1. `npx playwright install chromium`
//   2. `supabase start` (needs a container runtime), then
//      `cp .env.e2e.example .env.e2e`, fill the two keys from
//      `supabase status`, and run `node scripts/seed-e2e.mjs`.
// ---------------------------------------------------------------------------

function loadE2eEnv(): Record<string, string> {
  if (!existsSync(".env.e2e")) return {};
  const env: Record<string, string> = {};
  for (const line of readFileSync(".env.e2e", "utf8").split("\n")) {
    if (line.trim().startsWith("#")) continue;
    const match = /^\s*([A-Za-z_][A-Za-z0-9_]*)\s*=\s*(.*?)\s*$/.exec(line);
    if (!match) continue;
    env[match[1]] = match[2].replace(/^["']|["']$/g, "");
  }
  return env;
}

const e2eEnv = loadE2eEnv();
const hasE2eEnv = Object.keys(e2eEnv).length > 0;

// Spec processes read the gating vars (SUPABASE_E2E_USER_*,
// NEXT_PUBLIC_BILLING_ENABLED) from their own environment — inject them
// here, letting anything already set in the shell win.
for (const [key, value] of Object.entries(e2eEnv)) {
  process.env[key] ??= value;
}

// A dedicated port in e2e mode so a developer's prod-pointed :3000 server
// is never reused by mistake.
const PORT = hasE2eEnv ? 3100 : 3000;

export default defineConfig({
  testDir: "tests/e2e",
  // First hits compile each route under the dev server (Turbopack), and the
  // create-card flow bakes a Satori render on save — 30s is too tight cold.
  timeout: 60_000,
  // E2E suite is small; serial keeps logs readable.
  fullyParallel: false,
  workers: 1,
  reporter: process.env.CI ? "github" : "list",
  // Two retries on CI to absorb the occasional flake from network or
  // dev-server warm-up; none locally so a real failure surfaces fast.
  retries: process.env.CI ? 2 : 0,
  use: {
    baseURL: `http://localhost:${PORT}`,
    trace: "on-first-retry",
    // Force a fresh context per test so a logged-in state from one
    // test doesn't bleed into the next.
    storageState: undefined,
  },
  projects: [
    {
      name: "chromium",
      use: { ...devices["Desktop Chrome"] },
    },
  ],
  webServer: {
    command: hasE2eEnv ? `next dev --port ${PORT}` : "npm run dev",
    url: `http://localhost:${PORT}`,
    reuseExistingServer: !process.env.CI,
    timeout: 120_000,
    // Explicit env wins over .env.local inside the spawned Next server, so
    // e2e mode cleanly overrides the Supabase URL/keys without touching
    // the developer's env files.
    env: { ...process.env, ...e2eEnv } as Record<string, string>,
    // Surface dev-server output in the Playwright report so failures
    // include the relevant Next.js logs.
    stdout: "pipe",
    stderr: "pipe",
  },
});
