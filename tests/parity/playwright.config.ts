import path from "node:path";
import { defineConfig, devices } from "@playwright/test";
import { PARITY_FRAME_ORIGIN, PARITY_PORT, PARITY_SIZES, PARITY_STORAGE_ORIGIN } from "./shared";

// ---------------------------------------------------------------------------
// Playwright config for the BROWSER half of the preview ⇄ bake parity suite
// (TODO 3.11) — not the e2e suite (playwright.config.ts): no database, no
// account, no .env.e2e. Run through scripts/parity.mjs (`npm run
// test:parity`), which bakes first.
//
// The suite starts its OWN dev server on its own port with
// PARITY_HARNESS=1 — the one switch that makes app/dev/parity a route
// (next.config.ts) — and with storage and frames pointed at hosts that do
// not exist: the spec answers those requests from local files and refuses
// every other outside request, so the run reads no network.
// ---------------------------------------------------------------------------

const ROOT = path.resolve(__dirname, "../..");

const chromium = {
  ...devices["Desktop Chrome"],
  launchOptions: {
    // Greyscale anti-aliasing and unhinted glyphs on every platform: the
    // bake's rasteriser has neither LCD stripes nor hinting.
    args: ["--disable-lcd-text", "--font-render-hinting=none", "--force-color-profile=srgb"],
  },
};

export default defineConfig({
  testDir: __dirname,
  outputDir: path.join(ROOT, "tmp/parity/playwright"),
  // The first case of a run waits for Turbopack to compile the page.
  timeout: 90_000,
  // Within a project the cases run in order on one page; the two size
  // projects each take a worker.
  fullyParallel: false,
  workers: 2,
  // No retries: a case that passes only sometimes is a finding, not noise.
  retries: 0,
  reporter: process.env.CI ? [["github"], ["list"]] : "list",
  use: {
    baseURL: `http://localhost:${PARITY_PORT}`,
    trace: "off",
  },
  projects: [
    // setup → the two sizes side by side → report (a `teardown`: it runs
    // after them whether they passed or not, and writes the report).
    { name: "setup", testMatch: /setup\.parity\.spec\.ts$/, teardown: "report", use: chromium },
    ...PARITY_SIZES.map((size) => ({
      name: size.name,
      testMatch: /preview\.parity\.spec\.ts$/,
      dependencies: ["setup"],
      use: chromium,
    })),
    { name: "report", testMatch: /report\.parity\.spec\.ts$/, use: chromium },
  ],
  webServer: {
    command: `node node_modules/next/dist/bin/next dev --port ${PARITY_PORT}`,
    cwd: ROOT,
    // Up = the server answers at all; that /dev/parity is a route of it is
    // the setup project's test (a clear failure instead of a start timeout).
    url: `http://localhost:${PARITY_PORT}/api/version`,
    // Never a developer's own server: it would not have the harness route.
    reuseExistingServer: false,
    timeout: 180_000,
    env: {
      ...(process.env as Record<string, string>),
      PARITY_HARNESS: "1",
      // Explicit values beat .env.local inside the spawned server: the
      // harness never talks to a real Supabase project.
      NEXT_PUBLIC_SUPABASE_URL: PARITY_STORAGE_ORIGIN,
      NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY: "",
      SUPABASE_SECRET_KEY: "",
      NEXT_PUBLIC_FRAME_ORIGIN: PARITY_FRAME_ORIGIN,
      NEXT_PUBLIC_BILLING_ENABLED: "",
      NEXT_TELEMETRY_DISABLED: "1",
    },
    stdout: "pipe",
    stderr: "pipe",
  },
});
