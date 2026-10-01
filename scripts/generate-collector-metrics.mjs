// ---------------------------------------------------------------------------
// Regenerate lib/cards/collector-metrics.ts — the collector face's advances
// and the line metrics of the faces the collector line is set in, read from
// the committed fonts (see scripts/lib/collector-metrics.mjs). Run after
// scripts/build-collector-font.mjs:
//
//   node scripts/generate-collector-metrics.mjs
//
// tests/unit/cards/collector-metrics.test.ts fails until the table matches.
// ---------------------------------------------------------------------------

import { writeFileSync } from "node:fs";
import path from "node:path";
import { computeCollectorMetrics, renderCollectorMetricsModule } from "./lib/collector-metrics.mjs";

const out = path.resolve("lib/cards/collector-metrics.ts");
const metrics = computeCollectorMetrics(process.cwd());
writeFileSync(out, renderCollectorMetricsModule(metrics));
console.log(`${path.relative(process.cwd(), out)}: ${metrics.advances.length} glyphs, ${Object.keys(metrics.faces).length} faces`);
