// ---------------------------------------------------------------------------
// Regenerate lib/render/glyph-coverage.ts — the characters a card bake can
// draw, read from the committed font files (see scripts/lib/glyph-coverage.mjs).
// Run after changing any bake font or public/fonts/NotoSans-Fallback.ttf:
//
//   node scripts/build-glyph-coverage.mjs
//
// (Node ≥ 22.18 — it imports the generated .ts range table directly.)
// ---------------------------------------------------------------------------

import { writeFileSync } from "node:fs";
import path from "node:path";
import { computeCoverage, renderCoverageModule } from "./lib/glyph-coverage.mjs";
import { NOTO_SANS_GOOGLE_RANGES } from "../lib/render/noto-fallback-ranges.ts";

const out = path.resolve("lib/render/glyph-coverage.ts");
const coverage = computeCoverage(process.cwd(), NOTO_SANS_GOOGLE_RANGES);
writeFileSync(out, renderCoverageModule(coverage));
console.log(
  `${path.relative(process.cwd(), out)}: display ${coverage.display.length} ranges, body ${coverage.body.length} ranges`,
);
