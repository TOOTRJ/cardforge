import { readFileSync } from "node:fs";
import path from "node:path";
import { describe, expect, it } from "vitest";
import { computeCollectorMetrics, renderCollectorMetricsModule } from "@/scripts/lib/collector-metrics.mjs";
import { COLLECTOR_ADVANCES, COLLECTOR_BULLET_BOX, COLLECTOR_FACES, COLLECTOR_UNITS_PER_EM } from "@/lib/cards/collector-metrics";
import { MPLANTIN_LINE_METRICS } from "@/lib/cards/rules-metrics";

// ---------------------------------------------------------------------------
// TODO 4.9b — lib/cards/collector-metrics.ts is GENERATED from the committed
// fonts (scripts/generate-collector-metrics.mjs); this keeps the table in
// step with them: regenerate after rebuilding the collector face.
// ---------------------------------------------------------------------------

const ROOT = process.cwd();

describe("collector-metrics.ts matches the committed fonts", () => {
  const metrics = computeCollectorMetrics(ROOT);

  it("is byte-for-byte what the generator writes", () => {
    expect(readFileSync(path.join(ROOT, "lib/cards/collector-metrics.ts"), "utf8")).toBe(renderCollectorMetricsModule(metrics));
  });

  it("holds every glyph of the subset face, and no other", () => {
    expect(metrics.unitsPerEm).toBe(COLLECTOR_UNITS_PER_EM);
    expect(Object.keys(COLLECTOR_ADVANCES).sort().join("")).toBe(" -/0123456789ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz†•");
    for (const [cp, adv] of metrics.advances) expect(COLLECTOR_ADVANCES[String.fromCodePoint(cp)]).toBe(adv);
    expect(COLLECTOR_BULLET_BOX).toEqual(metrics.bullet);
  });

  it("the three faces' line metrics are the fonts' hhea — MPlantin's the rules layout's own", () => {
    expect(COLLECTOR_FACES.collector).toMatchObject({ unitsPerEm: 1000, ascent: 0.968, descent: 0.251, lineGap: 0, capHeight: 0.7 });
    expect(COLLECTOR_FACES.display.ascent).toBeCloseTo(1917 / 2048, 4);
    expect(COLLECTOR_FACES.display.descent).toBeCloseTo(552 / 2048, 4);
    expect(COLLECTOR_FACES.body.ascent).toBe(MPLANTIN_LINE_METRICS.regular.ascent);
    expect(COLLECTOR_FACES.body.descent).toBe(MPLANTIN_LINE_METRICS.regular.descent);
    expect(COLLECTOR_FACES.body.lineGap).toBeCloseTo(0.15, 6);
  });
});
