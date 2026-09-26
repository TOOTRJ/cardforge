import { readFileSync } from "node:fs";
import path from "node:path";
import { describe, expect, it } from "vitest";
import { computeCoverage, renderCoverageModule } from "@/scripts/lib/glyph-coverage.mjs";
import { NOTO_SANS_GOOGLE_RANGES } from "@/lib/render/noto-fallback-ranges";

// lib/render/glyph-coverage.ts is generated from the committed font files
// (scripts/build-glyph-coverage.mjs). If a bake font or the Noto fallback
// changes, the creator's "may not show on the card image" warnings must change
// with it — regenerate when this fails.

const ROOT = path.resolve(__dirname, "../../..");

describe("glyph coverage table", () => {
  it("matches the fonts the bake registers", () => {
    const expected = renderCoverageModule(computeCoverage(ROOT, NOTO_SANS_GOOGLE_RANGES));
    expect(readFileSync(path.join(ROOT, "lib/render/glyph-coverage.ts"), "utf8")).toBe(expected);
  });
});
