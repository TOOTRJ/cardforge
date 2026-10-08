import { readFileSync } from "node:fs";
import path from "node:path";
// @ts-expect-error -- opentype.js (a dev dependency) ships no type declarations.
import opentype from "opentype.js";
import { describe, expect, it } from "vitest";
import { displayTextEm, displayTextWidthEm, kernWidening } from "@/lib/cards/display-metrics";
import { BODY_FACE_METRICS, BODY_GLYPH_INK, BODY_INK_PER_MILLE, LINE_FACE_METRICS } from "@/lib/cards/font-metrics";
import { slotLineEm } from "@/lib/cards/render-tiers";
import { MPLANTIN_LINE_METRICS, rulesTextWidthEm } from "@/lib/cards/rules-metrics";
import { STAT_GLYPHS, STAT_KERNING, fitStatSizePct, statInkEm, statWidthEm } from "@/lib/cards/stat-fit";
import { getFrameProfile } from "@/lib/cards/template-layout";
import { fitTitleBand } from "@/lib/cards/title-band";
import { TYPE_FACES } from "@/lib/cards/type-faces";
import { FONT_METRIC_FACES, computeFontMetrics, renderFontMetricsModule } from "@/scripts/lib/font-metrics.mjs";

// ---------------------------------------------------------------------------
// TODO 3.20 / 4.8.0 — lib/cards/font-metrics.ts is GENERATED from the
// committed TTFs (scripts/generate-font-metrics.mjs), one entry per face.
// Until 4.8.0 the same numbers were kept by hand in display-metrics.ts,
// stat-fit.ts and rules-metrics.ts. Three things are held here:
//
//   1. the module is byte-for-byte what the generator writes today (a font
//      file changes → this fails until it is regenerated);
//   2. what it generates EQUALS the hand-kept tables it replaced — a frozen
//      copy of them as they stood on main (fixtures/font-metrics-hand-kept
//      .json, extracted from the three modules at 17b0fd2d): the refactor
//      moved no number, so it moves no pixel;
//   3. the fits take a FACE: the display face measures as it always did, and
//      the body face — what a profile may now set a type line, a name or a
//      stat in — measures with MPlantin's own advances.
//
// (Each table is ALSO held to its TTF entry by entry, as before, by
// display-metrics.test.ts, stat-fit.test.ts, rules-metrics.test.ts and
// rules-side-ink.test.ts, which now read the generated tables.)
// ---------------------------------------------------------------------------

const ROOT = process.cwd();
const HAND = JSON.parse(readFileSync(path.join(ROOT, "tests/unit/cards/fixtures/font-metrics-hand-kept.json"), "utf8")) as {
  display: { unitsPerEm: number; asciiAdvanceUnits: number[]; extraAdvanceUnits: Record<string, number>; kernWidening: Record<string, string> };
  displayBaseline: { ascender: number; descender: number; unitsPerEm: number };
  stat: { unitsPerEm: number; glyphs: Record<string, number[]>; kerning: Record<string, number> };
  rules: {
    regularAscii: number[];
    italicAscii: number[];
    regularExtra: Record<string, number>;
    italicExtra: Record<string, number>;
    regularLatin: number[];
    italicLatin: number[];
    lineMetrics: { regular: { ascent: number; descent: number }; italic: { ascent: number; descent: number } };
    inkPerMille: Record<string, number[]>;
    glyphInk: [string, number, number][];
    sideInkRegular: Record<string, number[]>;
    sideInkItalic: Record<string, number[]>;
  };
};

type Font = {
  unitsPerEm: number;
  hasChar(ch: string): boolean;
  charToGlyph(ch: string): { advanceWidth: number };
  getAdvanceWidth(text: string, fontSize: number, options?: { kerning?: boolean }): number;
};
const parse = (file: string): Font => {
  const buf = readFileSync(path.join(ROOT, file));
  return opentype.parse(buf.buffer.slice(buf.byteOffset, buf.byteOffset + buf.byteLength));
};

describe("lib/cards/font-metrics.ts is generated", () => {
  const metrics = computeFontMetrics(ROOT);

  it("is byte-for-byte what scripts/generate-font-metrics.mjs writes from the committed fonts", () => {
    expect(readFileSync(path.join(ROOT, "lib/cards/font-metrics.ts"), "utf8")).toBe(renderFontMetricsModule(metrics));
  });

  it("covers the faces a slot can be set in, from the TTFs both renderers draw", () => {
    expect(FONT_METRIC_FACES).toEqual({
      display: "public/fonts/Beleren-Bold.ttf",
      body: "public/fonts/mplantin.ttf",
      bodyItalic: "public/fonts/mplantin-italic.ttf",
    });
    expect(Object.keys(LINE_FACE_METRICS)).toEqual(["display", "body", "bodyItalic"]);
    for (const [id, file] of Object.entries(FONT_METRIC_FACES)) expect(LINE_FACE_METRICS[id as keyof typeof LINE_FACE_METRICS].file).toBe(file);
    // The bake's MPlantin (node_modules/mana-font) is the same bytes as the
    // public copy the tables are read from.
    expect(readFileSync(path.join(ROOT, "node_modules/mana-font/fonts/mplantin.ttf")).equals(readFileSync(path.join(ROOT, "public/fonts/mplantin.ttf")))).toBe(true);
    for (const face of Object.values(TYPE_FACES)) expect(face.metrics).toBe(LINE_FACE_METRICS[face.metricsId]);
  });
});

describe("the generator reproduces the hand-kept tables it replaced", () => {
  const display = LINE_FACE_METRICS.display;
  const body = LINE_FACE_METRICS.body;
  const italic = LINE_FACE_METRICS.bodyItalic;

  it("display-metrics.ts: Beleren Bold's advances, punctuation and widening pairs", () => {
    expect(display.unitsPerEm).toBe(HAND.display.unitsPerEm);
    expect([...display.asciiAdvanceUnits]).toEqual(HAND.display.asciiAdvanceUnits);
    expect(display.extraAdvanceUnits).toEqual(HAND.display.extraAdvanceUnits);
    expect(display.kernWidening).toEqual(HAND.display.kernWidening);
    expect(Object.values(HAND.display.kernWidening).join(" ").split(" ").length).toBeGreaterThan(200);
  });

  it("template-layout.ts: the display face's hhea (the baseline constant)", () => {
    expect([display.ascender, display.descender, display.unitsPerEm]).toEqual([HAND.displayBaseline.ascender, HAND.displayBaseline.descender, HAND.displayBaseline.unitsPerEm]);
    expect([display.ascender, display.descender, display.unitsPerEm]).toEqual([1917, 552, 2048]);
  });

  it("stat-fit.ts: every stat glyph's advance and bearings, and the kerning between stat characters — in the same order", () => {
    expect(HAND.stat.unitsPerEm).toBe(display.unitsPerEm);
    expect(STAT_GLYPHS).toEqual(HAND.stat.glyphs);
    expect(STAT_KERNING).toEqual(HAND.stat.kerning);
    expect(Object.keys(STAT_GLYPHS)).toEqual(Object.keys(HAND.stat.glyphs));
    expect(Object.keys(STAT_KERNING)).toEqual(Object.keys(HAND.stat.kerning));
    expect(Object.keys(STAT_GLYPHS)).toHaveLength(101);
    expect(Object.keys(STAT_KERNING)).toHaveLength(77);
  });

  it("rules-metrics.ts: both MPlantin masters' advances through Latin Extended-A, their line box, ink and side ink", () => {
    expect([...body.asciiAdvanceUnits]).toEqual(HAND.rules.regularAscii);
    expect([...italic.asciiAdvanceUnits]).toEqual(HAND.rules.italicAscii);
    expect(BODY_FACE_METRICS.regular.extraAdvancePerMille).toEqual(HAND.rules.regularExtra);
    expect(BODY_FACE_METRICS.italic.extraAdvancePerMille).toEqual(HAND.rules.italicExtra);
    expect([...BODY_FACE_METRICS.regular.latinAdvancePerMille]).toEqual(HAND.rules.regularLatin);
    expect([...BODY_FACE_METRICS.italic.latinAdvancePerMille]).toEqual(HAND.rules.italicLatin);
    expect(MPLANTIN_LINE_METRICS).toEqual(HAND.rules.lineMetrics);
    expect(BODY_INK_PER_MILLE).toEqual(HAND.rules.inkPerMille);
    // The grouped glyph ink: the same groups, in the same order, with the
    // same characters in the same order.
    expect(BODY_GLYPH_INK.map((group) => [...group])).toEqual(HAND.rules.glyphInk);
    expect(BODY_FACE_METRICS.regular.sideInkPerMille).toEqual(HAND.rules.sideInkRegular);
    expect(BODY_FACE_METRICS.italic.sideInkPerMille).toEqual(HAND.rules.sideInkItalic);
  });
});

describe("the fits take a face", () => {
  const beleren = parse("public/fonts/Beleren-Bold.ttf");
  const mplantin = parse("public/fonts/mplantin.ttf");
  const ASCII = Array.from({ length: 0x7f - 0x20 }, (_, i) => String.fromCharCode(0x20 + i));

  it("with no face named, every measure is the display face's (what each returned before)", () => {
    for (const text of ["Miner the Miner, Damned Delver", "Legendary Sorcery — Arcane Lesson", "Ry", "WWWW", "ñandú", "漢"]) {
      expect(displayTextWidthEm(text), text).toBe(displayTextWidthEm(text, { face: "display" }));
      expect(displayTextEm(text), text).toBe(displayTextEm(text, "display"));
    }
    expect(kernWidening("Ry")).toBe(309);
    expect(kernWidening("Ry", "display")).toBe(309);
    for (const value of ["10/10", "*/*+1", "40/40", "X/X"]) {
      expect(statWidthEm(value), value).toBe(statWidthEm(value, "display"));
      expect(statInkEm(value), value).toEqual(statInkEm(value, "display"));
    }
  });

  it("the body face measures a line with MPlantin's own advances: no kerning, its accented letters' own widths", () => {
    for (const ch of ASCII) {
      const advance = mplantin.charToGlyph(ch).advanceWidth / mplantin.unitsPerEm;
      expect(displayTextWidthEm(ch, { face: "body" }), JSON.stringify(ch)).toBeCloseTo(advance, 9);
      expect(displayTextEm(ch, "body"), JSON.stringify(ch)).toBeCloseTo(advance, 9);
    }
    // A line is its letters' sum — MPlantin kerns nothing, so the upper
    // bound and the advances agree, and both equal the rules layout's.
    const line = "Summon Elder Dragon Legend";
    expect(displayTextEm(line, "body")).toBeCloseTo(mplantin.getAdvanceWidth(line, 1, { kerning: false }), 9);
    expect(displayTextEm(line, "body")).toBeCloseTo(rulesTextWidthEm(line), 9);
    expect(displayTextWidthEm(line, { face: "body" })).toBeCloseTo(rulesTextWidthEm(line), 9);
    expect(kernWidening("Ry", "body")).toBe(0);
    expect(Object.keys(LINE_FACE_METRICS.body.kernWidening)).toHaveLength(0);
    expect(Object.keys(LINE_FACE_METRICS.body.statKerning)).toHaveLength(0);
    // Not Beleren Bold's width (per em MPlantin's lower case is the wider).
    expect(displayTextEm(line, "body")).not.toBe(displayTextEm(line, "display"));
    expect(displayTextEm(line, "display")).toBeGreaterThanOrEqual(beleren.getAdvanceWidth(line, 1, { kerning: true }) - 1e-9);
    // An accented letter is the face's OWN glyph (the italic's ě is not e),
    // and one the face lacks falls back to its base letter.
    expect(displayTextWidthEm("é", { face: "body" })).toBeCloseTo(rulesTextWidthEm("é"), 9);
    expect(displayTextWidthEm("ě", { face: "bodyItalic" })).toBeCloseTo(0.423, 9);
    expect(displayTextWidthEm("Ā", { face: "body" })).toBe(displayTextWidthEm("A", { face: "body" }));
  });

  it("a slot's `font` reaches the measured fits: a body type line and name fit by MPlantin's widths", () => {
    const m15 = getFrameProfile("m15");
    const line = "Legendary Artifact Creature — Phyrexian Praetor";
    expect(slotLineEm(line, m15.type)).toBe(displayTextEm(line, "display"));
    expect(slotLineEm(line, { ...m15.type, font: "body" })).toBe(displayTextEm(line, "body"));
    expect(slotLineEm(line, { ...m15.type, font: "body" })).not.toBe(slotLineEm(line, m15.type));
    // A name long enough to shrink (above the floor) fills the SAME room in
    // either face — so its size is the room over the name's width in the
    // slot's own face.
    const name = "Vinnie 'Goldfang' Lupo, the Gilded Enforcer";
    const display = fitTitleBand(m15, name, "{2}{B}{R}")!;
    const body = fitTitleBand({ ...m15, title: { ...m15.title, font: "body" } }, name, "{2}{B}{R}")!;
    expect(display.sizePct).toBeLessThan(m15.title.sizePct);
    expect(body.sizePct).toBeLessThan(m15.title.sizePct);
    expect(body.sizePct).not.toBe(display.sizePct);
    // (To the fit's own rounding of a size.)
    expect(body.sizePct * displayTextWidthEm(name, { face: "body" })).toBeCloseTo(display.sizePct * displayTextWidthEm(name), 3);
  });

  it("a stat slot's `font` reaches the stat fit: the value's ink in that face", () => {
    const pt = getFrameProfile("m15").pt!;
    expect(statWidthEm("10/10", "body")).toBeCloseTo(rulesTextWidthEm("10/10"), 9);
    expect(statWidthEm("10/10", "body")).not.toBe(statWidthEm("10/10"));
    // MPlantin kerns nothing: a value's ink is its advances less its end
    // glyphs' bearings, centred — the same in both renderers.
    const [first, last] = [LINE_FACE_METRICS.body.statGlyphs["1"], LINE_FACE_METRICS.body.statGlyphs["0"]];
    const ink = statInkEm("10/10", "body");
    expect(ink.left + ink.right).toBeCloseTo(statWidthEm("10/10", "body") - (first[1] + last[2]) / 1000, 9);
    // A value that must shrink fits by its ink in the slot's face; the
    // default is the display face's fit, unchanged.
    const wide = "100/100";
    expect(fitStatSizePct(pt, wide)).toBe(fitStatSizePct({ ...pt, font: "display" }, wide));
    expect(fitStatSizePct(pt, wide)).toBeLessThan(pt.sizePct);
    expect(fitStatSizePct({ ...pt, font: "body" }, wide)).not.toBe(fitStatSizePct(pt, wide));
    // A character the face has no glyph for counts a full em of ITS units.
    expect(statWidthEm("龍", "body")).toBe(1);
    expect(statWidthEm("龍")).toBe(1);
  });
});
