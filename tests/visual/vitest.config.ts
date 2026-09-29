import { defineConfig } from "vitest/config";
import path from "node:path";

// ---------------------------------------------------------------------------
// Vitest config for the visual-regression bake (TODO 7.1) — NOT part of
// `npm run test:unit` (the root config only includes tests/unit). Run it
// through scripts/visual-regression.mjs (`npm run test:visual`), which fetches
// the frames, starts one process per shard and gates the merged hashes; a
// bare `vitest run -c tests/visual/vitest.config.ts` bakes shard 0/1 without
// the gate.
// ---------------------------------------------------------------------------

const ROOT = path.resolve(__dirname, "../..");

export default defineConfig({
  root: ROOT,
  test: {
    environment: "node",
    include: ["tests/visual/**/*.visual.ts"],
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
