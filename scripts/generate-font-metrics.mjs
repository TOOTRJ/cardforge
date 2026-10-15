// ---------------------------------------------------------------------------
// Regenerate lib/cards/font-metrics.ts — the card faces' metric tables
// (advances, side bearings, kerning pairs, hhea, the body faces' ink), read
// from the committed fonts (TODO 3.20 / 4.8.0; the rules are in
// scripts/lib/font-metrics.mjs) — and lib/cards/small-caps-metrics.ts, the
// display face's tables for a synthesized small-caps name (TODO 4.53). Run
// after a font file changes or a face is added to FONT_METRIC_FACES:
//
//   node scripts/generate-font-metrics.mjs           write the modules
//   node scripts/generate-font-metrics.mjs --check   exit 1 if one would change
//
// tests/unit/cards/font-metrics.test.ts and tests/unit/cards/small-caps.test.ts
// fail until the modules match.
// ---------------------------------------------------------------------------

import { readFileSync, writeFileSync } from "node:fs";
import path from "node:path";
import {
  computeFontMetrics,
  computeSmallCapsMetrics,
  renderFontMetricsModule,
  renderSmallCapsMetricsModule,
} from "./lib/font-metrics.mjs";

const metrics = computeFontMetrics(process.cwd());
const smallCaps = computeSmallCapsMetrics(process.cwd());
const modules = [
  [path.resolve("lib/cards/font-metrics.ts"), renderFontMetricsModule(metrics), `${Object.keys(metrics.line).length} faces`],
  [
    path.resolve("lib/cards/small-caps-metrics.ts"),
    renderSmallCapsMetricsModule(smallCaps),
    `${Object.keys(smallCaps.advanceUnits).length} characters, ${Object.keys(smallCaps.kerning).length} kerned left characters`,
  ],
];

let stale = false;
for (const [out, source, summary] of modules) {
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
      stale = true;
    } else console.log(`${rel}: up to date`);
  } else {
    writeFileSync(out, source);
    console.log(`${rel}: ${summary}`);
  }
}
if (stale) process.exit(1);
