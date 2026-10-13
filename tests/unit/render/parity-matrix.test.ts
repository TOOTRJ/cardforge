import { readFileSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import { rowToPreviewData } from "@/lib/cards/bake-core";
import { normalizeFrameTemplate } from "@/lib/cards/card-display";
import { backPreviewData } from "@/lib/cards/faces";
import { getFrameProfile } from "@/lib/cards/template-layout";
import { parityCases, parityFileName } from "@/tests/parity/cases";
import { parityRegions } from "@/tests/parity/regions";
import { PARITY_SIZES } from "@/tests/parity/shared";
import { KNOWN_DIFFERENCES, LIMITS, type BaselineFile } from "@/tests/parity/thresholds";

// ---------------------------------------------------------------------------
// The preview ⇄ bake parity matrix (tests/parity/cases.ts, TODO 3.11) and its
// committed baseline. CI's "Preview parity" job draws the matrix in both
// renderers and compares them (scripts/parity.mjs); these fast checks fail
// `npm run test:unit` as soon as the matrix no longer resolves against
// tests/visual/matrix.ts, the baseline no longer matches the matrix, or a
// known difference stops describing anything.
// ---------------------------------------------------------------------------

const cases = parityCases();
const baseline = JSON.parse(readFileSync(join(process.cwd(), "tests/parity/baseline.json"), "utf8")) as BaselineFile;

/** The regions a case is compared in (as tests/parity/bake.parity.ts). */
function regionNames(c: (typeof cases)[number]): string[] {
  const front = rowToPreviewData(c.row);
  const drawn = c.face === "back" ? backPreviewData(front) : front;
  if (!drawn) throw new Error(`${c.id}: no such face`);
  return parityRegions(getFrameProfile(normalizeFrameTemplate(drawn.frameStyle?.template, drawn))).map((r) => r.name);
}

describe("the parity matrix", () => {
  it("resolves every pick against the visual matrix, with unique ids and file names", () => {
    expect(cases.length).toBeGreaterThanOrEqual(30);
    expect(new Set(cases.map((c) => c.id)).size).toBe(cases.length);
    expect(new Set(cases.map((c) => parityFileName(c.id))).size).toBe(cases.length);
    for (const c of cases) expect(c.why.length, c.id).toBeGreaterThan(10);
  });

  it("holds the features that have drifted between the renderers before", () => {
    const has = (test: (c: (typeof cases)[number]) => boolean) => cases.some(test);
    const style = (c: (typeof cases)[number]) => (c.row.frame_style ?? {}) as Record<string, unknown>;
    const template = (c: (typeof cases)[number]) => String(style(c).template);
    for (const t of ["m15", "m15pw", "saga", "split", "aftermath", "adventure", "flip", "battle", "m15dfcfront", "m15mdfcfront", "m15tokentext", "emblem", "agclassic", "retro", "modern", "m15borderless", "fullartland", "m15textless"]) {
      expect(has((c) => template(c) === t), `a ${t} case`).toBe(true);
    }
    expect(has((c) => c.face === "back"), "a back face").toBe(true);
    expect(has((c) => style(c).finish === "foil") && has((c) => style(c).finish === "etched"), "foil and etched").toBe(true);
    expect(has((c) => style(c).crown === true && style(c).twoColor === true && Boolean(style(c).stamp)), "crown + pair + stamp").toBe(true);
    expect(has((c) => Boolean(style(c).collector)), "the collector line").toBe(true);
    expect(has((c) => style(c).rulesAlign === "center"), "centred rules").toBe(true);
    expect(has((c) => (c.row.art_position as { focalX?: number } | null)?.focalX === 0), "art at focal 0 with zoom").toBe(true);
    expect(has((c) => c.art === "tagged-jpeg") && has((c) => c.art === "uploaded-jpeg"), "the EXIF orientation-6 photo, stored and uploaded").toBe(true);
    // Every symbol kind of layout v49 in one cost and one rules box.
    const symbols = cases.find((c) => c.id.endsWith("@symbols"));
    for (const code of ["{W/U}", "{2/B}", "{R/P}", "{G/U/P}", "{S}", "{C}", "{X}"]) expect(symbols?.row.cost, code).toContain(code);
    for (const code of ["{T}", "{Q}", "{E}", "{W/U}", "{R/P}", "{S}"]) expect(symbols?.row.rules_text, code).toContain(code);
  });

  it("every case has named regions, and the profile's own text slots among them", () => {
    for (const c of cases) {
      const names = regionNames(c);
      for (const name of ["title", "art", "type", "footer"]) expect(names, `${c.id}: ${name}`).toContain(name);
      expect(new Set(names).size, c.id).toBe(names.length);
    }
  });
});

describe("tests/parity/baseline.json", () => {
  it("has a linux section (CI's platform) for exactly the matrix, region for region", () => {
    const linux = baseline.platforms.linux;
    expect(linux, "CI runs on linux: record it from the `parity-baseline` artifact").toBeDefined();
    const expected = cases.flatMap((c) => PARITY_SIZES.map((size) => `${c.id}@${size.name}`)).sort();
    for (const [platform, section] of Object.entries(baseline.platforms)) {
      expect(Object.keys(section.cases).sort(), `${platform}: re-record with npm run test:parity -- --update`).toEqual(expected);
    }
    for (const c of cases) {
      const names = regionNames(c).sort();
      for (const size of PARITY_SIZES) {
        expect(Object.keys(linux.cases[`${c.id}@${size.name}`].regions).sort(), `${c.id}@${size.name}`).toEqual(names);
      }
    }
  });

  it("records no offset or difference over a limit that no known difference names", () => {
    for (const [platform, section] of Object.entries(baseline.platforms)) {
      for (const [key, recorded] of Object.entries(section.cases)) {
        const at = key.lastIndexOf("@");
        const id = key.slice(0, at);
        const size = key.slice(at + 1) as "750" | "hd";
        const limits = LIMITS[size];
        for (const [region, [dx, dy, mad, hot]] of Object.entries(recorded.regions)) {
          const over: [string, number, number][] = [];
          if (Math.abs(dx) > limits.shift) over.push(["dx", dx, limits.shift]);
          if (Math.abs(dy) > limits.shift) over.push(["dy", dy, limits.shift]);
          if (mad > limits.mad) over.push(["mad", mad, limits.mad]);
          if (hot > limits.hot) over.push(["hot", hot, limits.hot]);
          for (const [metric, value] of over) {
            const known = KNOWN_DIFFERENCES.some(
              (k) => k.size === size && k.metric === metric && k.regions.includes(region) && k.cases.test(id) && value >= k.min && value <= k.max,
            );
            expect(known, `${platform} ${key} ${region}: ${metric} ${value} is over the limit and unnamed`).toBe(true);
          }
        }
        expect(recorded.card[0], `${platform} ${key}: card mad`).toBeLessThanOrEqual(limits.cardMad);
      }
    }
  });
});

describe("KNOWN_DIFFERENCES", () => {
  it("each is described, bounded, and still recorded somewhere on CI's platform", () => {
    const linux = baseline.platforms.linux.cases;
    expect(new Set(KNOWN_DIFFERENCES.map((k) => k.name)).size).toBe(KNOWN_DIFFERENCES.length);
    for (const k of KNOWN_DIFFERENCES) {
      expect(k.why.length, `${k.name}: say what differs and why`).toBeGreaterThan(60);
      expect(k.min, k.name).toBeLessThanOrEqual(k.max);
      const limits = LIMITS[k.size];
      const overLimit = (value: number) =>
        k.metric === "dx" || k.metric === "dy" ? Math.abs(value) > limits.shift : value > limits[k.metric];
      const needed = Object.entries(linux).some(([key, recorded]) => {
        const at = key.lastIndexOf("@");
        if (key.slice(at + 1) !== k.size || !k.cases.test(key.slice(0, at))) return false;
        if (k.metric === "cardMad") return overLimit(recorded.card[0]);
        if (k.metric === "tileMad") return false;
        const index = { dx: 0, dy: 1, mad: 2, hot: 3 }[k.metric];
        return k.regions.some((region) => {
          const value = recorded.regions[region]?.[index];
          return value !== undefined && overLimit(value) && value >= k.min && value <= k.max;
        });
      });
      // (A worst-tile difference is checked by the run itself: the baseline
      // holds tiles as steps, not values.)
      if (k.metric !== "tileMad") expect(needed, `${k.name}: nothing recorded needs it any more — strike it`).toBe(true);
    }
  });
});
