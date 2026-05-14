import { defineConfig, devices } from "@playwright/test";

// ---------------------------------------------------------------------------
// Playwright config for end-to-end smoke tests (Phase 11 chunk 16).
//
// Runs against a live `npm run dev` server (started automatically via
// `webServer`). The default config targets chromium for speed; other
// projects (firefox, webkit, mobile) can be added by extending the
// `projects` array.
//
// Local setup notes (one-time):
//   1. `npx playwright install chromium`
//      Downloads the browser binary. Required before the first run.
//   2. Optional — for auth/create/import tests, populate `.env.local`
//      with NEXT_PUBLIC_SUPABASE_URL + NEXT_PUBLIC_SUPABASE_ANON_KEY
//      pointing at a test Supabase project. The marketing smoke test
//      runs without these.
// ---------------------------------------------------------------------------

export default defineConfig({
  testDir: "tests/e2e",
  // E2E suite is small; serial keeps logs readable.
  fullyParallel: false,
  workers: 1,
  reporter: process.env.CI ? "github" : "list",
  // Two retries on CI to absorb the occasional flake from network or
  // dev-server warm-up; none locally so a real failure surfaces fast.
  retries: process.env.CI ? 2 : 0,
  use: {
    baseURL: "http://localhost:3000",
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
    command: "npm run dev",
    url: "http://localhost:3000",
    reuseExistingServer: !process.env.CI,
    timeout: 120_000,
    // Surface dev-server output in the Playwright report so failures
    // include the relevant Next.js logs.
    stdout: "pipe",
    stderr: "pipe",
  },
});
