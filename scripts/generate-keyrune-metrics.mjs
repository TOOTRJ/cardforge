// ---------------------------------------------------------------------------
// Regenerate lib/cards/keyrune-metrics.ts — each Keyrune set glyph's advance
// and ink box, read from the installed keyrune package (see
// scripts/lib/keyrune-metrics.mjs). Run after upgrading keyrune:
//
//   node scripts/generate-keyrune-metrics.mjs
//
// tests/unit/cards/keyrune-metrics.test.ts fails until the table matches.
// ---------------------------------------------------------------------------

import { writeFileSync } from "node:fs";
import path from "node:path";
import { computeKeyruneMetrics, renderKeyruneMetricsModule } from "./lib/keyrune-metrics.mjs";

const out = path.resolve("lib/cards/keyrune-metrics.ts");
const metrics = computeKeyruneMetrics(process.cwd());
writeFileSync(out, renderKeyruneMetricsModule(metrics));
console.log(
  `${path.relative(process.cwd(), out)}: keyrune ${metrics.version}, ${metrics.codes.length} set codes, ${metrics.glyphs.length} glyphs`,
);
