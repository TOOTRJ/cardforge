// Synthesized small caps (TextSlot.smallCaps, TODO 4.53): the runs both
// renderers draw and the fit measures (lib/cards/small-caps.ts).
import { readFileSync } from "node:fs";
import path from "node:path";
import { describe, expect, it } from "vitest";
import { smallCapsRuns, smallCapsWidthEm } from "@/lib/cards/small-caps";
import { SMALL_CAPS_ADVANCE_UNITS } from "@/lib/cards/small-caps-metrics";
import {
  computeFontMetrics,
  computeSmallCapsMetrics,
  renderFontMetricsModule,
  renderSmallCapsMetricsModule,
} from "@/scripts/lib/font-metrics.mjs";
import { getFrameProfile } from "@/lib/cards/template-layout";
import { cardGlyphFields, unrenderableCharacters } from "@/lib/validation/card-glyphs";
import { FRAME_TEMPLATE_VALUES } from "@/types/card";

const OPTS = { smallCapEm: 0.78, letterSpacingEm: 0.035, face: "display" as const };
const texts = (line: string) => smallCapsRuns(line, OPTS).map((r) => `${r.small ? "s" : "C"}:${r.text}${r.gapBeforeEm ? "+gap" : ""}`);

describe("smallCapsRuns", () => {
  it("splits a name into capital and small-capital runs, a word's gap on its first run", () => {
    expect(texts("Eldrazi Scion")).toEqual(["C:E", "s:LDRAZI", "C:S+gap", "s:CION"]);
    expect(texts("thopter")).toEqual(["s:THOPTER"]);
    expect(texts("SERVO 2.0")).toEqual(["C:SERVO", "C:2.0+gap"]);
    expect(texts("Ral’s Kraken-Bot")).toEqual(["C:R", "s:AL", "C:’", "s:S", "C:K+gap", "s:RAKEN", "C:-B", "s:OT"]);
  });

  it("reads a typed space and displayLine's no-break space alike", () => {
    expect(texts("Elf Warrior")).toEqual(texts("Elf Warrior"));
  });

  it("draws a decomposed accent on its own letter, never in a run of its own", () => {
    // "e" + U+0301 is "é", one small letter, as the composed character is.
    expect(texts("Eléonore")).toEqual(texts("Eléonore"));
    expect(texts("Eléonore")).toEqual(["C:E", "s:LÉONORE"]);
    // A mark with no composed form stays in its letter's run.
    const runs = smallCapsRuns("Ax́y", OPTS);
    expect(runs.map((r) => r.text)).toEqual(["A", "X́Y"]);
  });

  it("is as wide as its runs, their gaps and the pairs kerned between them — the width the fit measures", () => {
    const line = "Goblin & Kobold — Pact";
    const runs = smallCapsRuns(line, OPTS);
    const sum = runs.reduce((em, r) => em + r.gapBeforeEm + r.kernBeforeEm + r.widthEm, 0);
    expect(smallCapsWidthEm(line, OPTS)).toBeCloseTo(sum, 10);
  });
});

describe("the creator's glyph check on a small-caps name", () => {
  // Beleren Bold has "ƒ" and not "Ƒ": a small-caps name draws the capital.
  const values = (template: string) =>
    ({
      title: "ƒungus",
      supertype: "Creature",
      subtypes_text: "Fungus",
      rules_text: "",
      flavor_text: "",
      power: "1",
      toughness: "1",
      loyalty: "",
      defense: "",
      artist_credit: "",
      footer_text: "",
      saga_intro: "",
      frame_style: { template },
      has_back_face: false,
      back_face: { title: "", supertype: "", subtypes_text: "", rules_text: "", flavor_text: "", power: "", toughness: "", loyalty: "", defense: "" },
    }) as const;
  const nameField = (template: string) => cardGlyphFields(values(template)).find((f) => f.label === "Name")!;

  it("judges the arch token's name by the capitals it draws", () => {
    expect(nameField("m15token").uppercase).toBe(true);
    expect(unrenderableCharacters("ƒungus", "display", { uppercase: true })).toEqual(["ƒ"]);
    // …and every other name as typed.
    expect(nameField("m20token").uppercase).toBeFalsy();
    expect(unrenderableCharacters("ƒungus", "display")).toEqual([]);
  });
});

describe("TextSlot.smallCaps", () => {
  it("is set on the four 2014–19 arch token names alone (every other name as typed)", () => {
    const withSmallCaps = (FRAME_TEMPLATE_VALUES as readonly string[]).filter((t) => getFrameProfile(t).title.smallCaps);
    expect(withSmallCaps.sort()).toEqual(["m15token", "m15tokenartifact", "m15tokenartifacttext", "m15tokentext"]);
    for (const t of FRAME_TEMPLATE_VALUES) {
      const p = getFrameProfile(t);
      expect(p.type.smallCaps, `${t} type line`).toBeUndefined();
      expect(p.secondFace?.title.smallCaps, `${t} second face`).toBeUndefined();
    }
  });
});

describe("the kerning (owner Round 65)", () => {
  const UPM = 2048;
  it("is generated from the display face: lib/cards/small-caps-metrics.ts is what the generator writes", () => {
    const source = renderSmallCapsMetricsModule(computeSmallCapsMetrics(process.cwd()));
    expect(readFileSync(path.join(process.cwd(), "lib/cards/small-caps-metrics.ts"), "utf8")).toBe(source);
  });

  it("measures a run by its kerned advances — a pair that tightens inside a run, a capital the line tables don't list", () => {
    const run = (line: string) => smallCapsRuns(line, { ...OPTS, letterSpacingEm: 0 });
    // "-W" kerns −405 units: the run is that much narrower than its bare advances.
    const dash = run("Long-Winded").find((r) => r.text === "-W")!;
    expect(dash.widthEm).toBeCloseTo((SMALL_CAPS_ADVANCE_UNITS["-"] + SMALL_CAPS_ADVANCE_UNITS.W - 405) / UPM, 10);
    // Æ's own advance (1628 units), never the line tables' 1 em guess.
    expect(run("Æ")[0].widthEm).toBeCloseTo(1628 / UPM, 10);
    expect(run("Œ")[0].widthEm).toBeCloseTo(SMALL_CAPS_ADVANCE_UNITS["Œ"] / UPM, 10);
  });

  it("kerns a capital and the small letter after it across their runs, at the small size", () => {
    const [w, arrior] = smallCapsRuns("Warrior", OPTS);
    expect(w.kernBeforeEm).toBe(0);
    expect(arrior.kernBeforeEm).toBeCloseTo((-451 / UPM) * 0.78, 10);
    const [, ampire] = smallCapsRuns("Vampire", OPTS);
    expect(ampire.kernBeforeEm).toBeCloseTo((-451 / UPM) * 0.78, 10);
    // Never across a word's gap.
    const runs = smallCapsRuns("Cat Dragon", OPTS);
    expect(runs[2].gapBeforeEm).toBeGreaterThan(0);
    expect(runs[2].kernBeforeEm).toBe(0);
    // The width the fit measures counts it.
    const sum = smallCapsRuns("Warrior", OPTS).reduce((em, r) => em + r.gapBeforeEm + r.kernBeforeEm + r.widthEm, 0);
    expect(smallCapsWidthEm("Warrior", OPTS)).toBeCloseTo(sum, 10);
  });

  it("leaves the line tables every other slot reads as they were", () => {
    expect(readFileSync(path.join(process.cwd(), "lib/cards/font-metrics.ts"), "utf8")).toBe(
      renderFontMetricsModule(computeFontMetrics(process.cwd())),
    );
  });
});
