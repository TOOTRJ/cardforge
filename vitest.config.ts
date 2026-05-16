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
      reporter: ["text", "html"],
    },
  },
  resolve: {
    alias: {
      "@": path.resolve(__dirname, "."),
    },
  },
});
