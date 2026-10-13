import { defineConfig } from "vitest/config";
import path from "node:path";

// ---------------------------------------------------------------------------
// Vitest config for the BAKE half of the preview ⇄ bake parity suite (TODO
// 3.11) — NOT part of `npm run test:unit` (the root config only includes
// tests/unit). Run it through scripts/parity.mjs (`npm run test:parity`),
// which fetches the frames, bakes in shards and then starts the browser
// half (tests/parity/playwright.config.ts).
// ---------------------------------------------------------------------------

const ROOT = path.resolve(__dirname, "../..");

export default defineConfig({
  root: ROOT,
  test: {
    environment: "node",
    include: ["tests/parity/**/*.parity.ts"],
    exclude: ["node_modules", ".next/**"],
    // One file, one long test: the whole shard bakes inside it.
    testTimeout: 30 * 60_000,
    hookTimeout: 5 * 60_000,
    fileParallelism: false,
  },
  resolve: {
    alias: {
      "@": ROOT,
      "server-only": path.resolve(ROOT, "tests/stubs/server-only.ts"),
    },
  },
});
