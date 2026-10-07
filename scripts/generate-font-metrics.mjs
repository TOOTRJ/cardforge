// ---------------------------------------------------------------------------
// Regenerate lib/cards/font-metrics.ts — the card faces' metric tables
// (advances, side bearings, kerning pairs, hhea, the body faces' ink), read
// from the committed fonts (TODO 3.20 / 4.8.0; the rules are in
// scripts/lib/font-metrics.mjs). Run after a font file changes or a face is
// added to FONT_METRIC_FACES:
//
//   node scripts/generate-font-metrics.mjs           write the module
//   node scripts/generate-font-metrics.mjs --check   exit 1 if it would change
//
// tests/unit/cards/font-metrics.test.ts fails until the module matches.
// ---------------------------------------------------------------------------

import { readFileSync, writeFileSync } from "node:fs";
import path from "node:path";
import { computeFontMetrics, renderFontMetricsModule } from "./lib/font-metrics.mjs";

const out = path.resolve("lib/cards/font-metrics.ts");
const metrics = computeFontMetrics(process.cwd());
const source = renderFontMetricsModule(metrics);
const rel = path.relative(process.cwd(), out);

if (process.argv.includes("--check")) {
  let current = "";
  try {
    current = readFileSync(out, "utf8");
  } catch {
    // Missing counts as stale.
  }
  if (current !== source) {
    console.error(`${rel} is stale: run node scripts/generate-font-metrics.mjs`);
    process.exit(1);
  }
  console.log(`${rel}: up to date`);
} else {
  writeFileSync(out, source);
  console.log(`${rel}: ${Object.keys(metrics.line).length} faces`);
}
