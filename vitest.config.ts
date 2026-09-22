import { defineConfig } from "vitest/config";
import path from "node:path";

// ---------------------------------------------------------------------------
// Vitest config for unit tests (Phase 11 chunk 16).
//
// Scope:
//   - tests/unit/**/*.test.{ts,tsx} — pure-function tests for lib/
//     helpers (validation, scryfall mappers, mana-cost tokenizer).
//   - Integration / e2e tests live under tests/e2e and run via
//     Playwright (playwright.config.ts).
//
// Environment: `node` is the default — sufficient for the current unit
// suite. When component tests join later, individual files can opt into
// `happy-dom` via `// @vitest-environment happy-dom` at the file top.
// ---------------------------------------------------------------------------

export default defineConfig({
  test: {
    environment: "node",
    include: ["tests/unit/**/*.test.{ts,tsx}"],
    // Playwright tests live alongside but are NOT vitest-runnable; the
    // e2e runner picks them up via its own glob.
    exclude: ["node_modules", "tests/e2e/**", ".next/**"],
    coverage: {
      provider: "v8",
      include: ["lib/**", "components/**"],
      exclude: [
        "**/*.test.ts",
        "**/*.test.tsx",
        "lib/supabase/**",
        "lib/render/**",
      ],
      reporter: ["text", "html", "lcov", "json-summary"],
      // Floors, not targets: a few points under the 2026-09-22 baseline of
      // the areas that guard money and auth, so a PR that deletes their
      // tests (or adds a large untested surface there) fails `test:coverage`
      // in CI. Raise them as coverage grows; never lower without saying why.
      thresholds: {
        "lib/billing/**": { lines: 75, functions: 65 },
        "lib/stripe/**": { lines: 85, functions: 80 },
        "lib/auth/**": { lines: 80 },
        "lib/seo/**": { lines: 95 },
        "lib/ai/**": { lines: 25 },
      },
    },
  },
  resolve: {
    alias: {
      "@": path.resolve(__dirname, "."),
      // `server-only` is a Next.js build-time guard with no standalone package
      // to resolve under vitest; stub it so server modules (e.g.
      // lib/stripe/config.ts) remain unit-testable.
      "server-only": path.resolve(__dirname, "tests/stubs/server-only.ts"),
    },
  },
});
