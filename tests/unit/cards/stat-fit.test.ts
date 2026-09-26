import { readFileSync } from "node:fs";
import { join } from "node:path";
// @ts-expect-error -- opentype.js (a devDependency) ships no types; the test reads unitsPerEm and advance widths only.
import * as opentype from "opentype.js";
import { describe, expect, it } from "vitest";
import {
  fitStatSizePct,
  STAT_ADVANCES,
  statFitWidth,
  statsShrink,
  statWidthEm,
  type StatScopeCard,
} from "@/lib/cards/stat-fit";
import { getFrameProfile, type StatSlot } from "@/lib/cards/template-layout";
import { RULES_TEXT, ptToPct } from "@/lib/cards/typography";
import { FRAME_TEMPLATE_VALUES } from "@/types/card";

// ---------------------------------------------------------------------------
// Stat values shrink to fit their box (TODO 3.18, 4.31): a value that fits
// keeps the profile size EXACTLY (its bake stays byte-identical), a wider one
// shrinks until it fits. The HD card is 1500 px wide.
// ---------------------------------------------------------------------------

const HD = 1500;
const m15 = getFrameProfile("m15").pt!;
const alpha = getFrameProfile("agclassic").pt!;
const battle = getFrameProfile("battle").defense!;
const loyalty = getFrameProfile("m15pw").loyalty!;

/** The value's laid-out width at the size it prints, in HD px. */
const printedPx = (slot: StatSlot, value: string, orientation: "portrait" | "landscape" = "portrait") =>
  statWidthEm(value) * fitStatSizePct(slot, value, orientation) * (orientation === "landscape" ? 2100 : HD);

describe("advance widths", () => {
  it("match public/fonts/Beleren-Bold.ttf, the CardDisplay face both renderers draw", () => {
    const buf = readFileSync(join(process.cwd(), "public/fonts/Beleren-Bold.ttf"));
    const font = opentype.parse(buf.buffer.slice(buf.byteOffset, buf.byteOffset + buf.byteLength));
    expect(font.unitsPerEm).toBe(2048);
    for (const [ch, advance] of Object.entries(STAT_ADVANCES)) {
      const glyph = font.charToGlyph(ch);
      expect(glyph.index, ch).not.toBe(0);
      expect(glyph.advanceWidth, ch).toBe(advance);
    }
  });

  it("counts an unknown character as a full em (shrinks rather than overflows)", () => {
    expect(statWidthEm("龍")).toBe(1);
    expect(statWidthEm("10/10")).toBeCloseTo((921 + 1269 + 847 + 921 + 1269) / 2048, 10);
  });
});

describe("fitStatSizePct", () => {
  it.each(["1/1", "4/4", "10/10", "15/15", "20/20", "*/*", "*/1+*", "X/6"])(
    "M15 %s fits: the profile size, unchanged",
    (value) => {
      expect(fitStatSizePct(m15, value)).toBe(m15.sizePct);
    },
  );

  it.each(["100/100", "*+1/*+1", "X/X+1"])("M15 %s is wider than the plate's box and shrinks into it", (value) => {
    const size = fitStatSizePct(m15, value);
    expect(size).toBeLessThan(m15.sizePct);
    expect(printedPx(m15, value)).toBeLessThanOrEqual(statFitWidth(m15) * HD + 1e-6);
  });

  it("Alpha: 10/10 and 20/20 keep their size; *+1/*+1 ends inside the pinstripe (~1404 px)", () => {
    expect(fitStatSizePct(alpha, "10/10")).toBe(alpha.sizePct);
    expect(fitStatSizePct(alpha, "20/20")).toBe(alpha.sizePct);
    expect(fitStatSizePct(alpha, "*+1/*+1")).toBeLessThan(alpha.sizePct);
    // Centred on the rect's middle (1320 px), so its right edge is half its width past it.
    const centre = ((alpha.rect.leftPct + alpha.rect.widthPct / 2) / 100) * HD;
    expect(centre + printedPx(alpha, "*+1/*+1") / 2).toBeLessThanOrEqual(1404 + 1e-6);
    // It used to print across the pinstripe, into the black border.
    expect(centre + (statWidthEm("*+1/*+1") * alpha.sizePct * HD) / 2).toBeGreaterThan(1420);
  });

  it("Battle defense fits the drawn badge, not the whole rect", () => {
    expect(fitStatSizePct(battle, "15", "landscape")).toBe(battle.sizePct);
    expect(fitStatSizePct(battle, "100", "landscape")).toBe(battle.sizePct);
    expect(fitStatSizePct(battle, "1000", "landscape")).toBeLessThan(battle.sizePct);
    const badgePx = (battle.rect.widthPct / 100) * 2100 * 0.76;
    expect(printedPx(battle, "1000", "landscape")).toBeLessThanOrEqual(badgePx + 1e-6);
  });

  it("planeswalker loyalty fits the shield: three digits keep their size, five shrink", () => {
    expect(fitStatSizePct(loyalty, "10")).toBe(loyalty.sizePct);
    expect(fitStatSizePct(loyalty, "100")).toBe(loyalty.sizePct);
    expect(fitStatSizePct(loyalty, "10000")).toBeLessThan(loyalty.sizePct);
  });

  it("shrinks monotonically with length and never below the hard floor", () => {
    let last = Number.POSITIVE_INFINITY;
    for (const value of ["9/9", "99/99", "999/999", "9999/9999", "99999999/99999999"]) {
      const size = fitStatSizePct(m15, value);
      expect(size).toBeLessThanOrEqual(last);
      expect(size).toBeGreaterThanOrEqual(ptToPct(RULES_TEXT.hardFloorPt) - 1e-12);
      last = size;
    }
    expect(fitStatSizePct(battle, "9".repeat(16), "landscape")).toBeCloseTo(ptToPct(RULES_TEXT.hardFloorPt, "landscape"), 12);
  });

  it("no profile lets a value print wider than its rect (it would wrap after a slash)", () => {
    for (const template of FRAME_TEMPLATE_VALUES) {
      const profile = getFrameProfile(template);
      for (const slot of [profile.pt, profile.loyalty, profile.defense, profile.secondFace?.pt]) {
        if (!slot) continue;
        expect(statFitWidth(slot), template).toBeLessThanOrEqual(slot.rect.widthPct / 100);
      }
    }
  });
});

describe("statsShrink — the card-row scope predicate", () => {
  const row = (over: Partial<StatScopeCard>): StatScopeCard => ({
    frame_style: { template: "m15" },
    card_type: "creature",
    subtypes: [],
    power: "4",
    toughness: "4",
    loyalty: null,
    defense: null,
    back_face: null,
    ...over,
  });

  it("is false for every stat that fits (the bake is byte-identical)", () => {
    expect(statsShrink(row({}))).toBe(false);
    expect(statsShrink(row({ power: "20", toughness: "20", frame_style: { template: "m15artifact" } }))).toBe(false);
    expect(statsShrink(row({ power: "20", toughness: "20", frame_style: { template: "agclassic" } }))).toBe(false);
  });

  it("is true when a printed stat is wider than its box", () => {
    expect(statsShrink(row({ power: "100", toughness: "100" }))).toBe(true);
    expect(statsShrink(row({ power: "*+1", toughness: "*+1", frame_style: { template: "agclassic" } }))).toBe(true);
    expect(statsShrink(row({ card_type: "planeswalker", power: null, toughness: null, loyalty: "10000", frame_style: { template: "m15pw" } }))).toBe(true);
    expect(statsShrink(row({ card_type: "battle", power: null, toughness: null, defense: "1000", frame_style: { template: "battle" } }))).toBe(true);
  });

  it("judges only what the bake prints", () => {
    // An instant's P/T and a creature's loyalty are never drawn.
    expect(statsShrink(row({ card_type: "instant", power: "100", toughness: "100" }))).toBe(false);
    expect(statsShrink(row({ loyalty: "10000" }))).toBe(false);
    // A Vehicle prints its P/T; a missing side prints as an em dash.
    expect(statsShrink(row({ card_type: "artifact", subtypes: ["Vehicle"], power: "100", toughness: "100" }))).toBe(true);
    expect(statsShrink(row({ power: "10000", toughness: null }))).toBe(true);
  });

  it("reads the template the card is drawn on ({} and retired values draw m15)", () => {
    expect(statsShrink(row({ frame_style: {}, power: "100", toughness: "100" }))).toBe(true);
    expect(statsShrink(row({ frame_style: null, power: "X", toughness: "X+1" }))).toBe(true);
    expect(statsShrink(row({ frame_style: { template: "regular" }, power: "1", toughness: "1" }))).toBe(false);
  });

  it("covers a flip card's second-face P/T", () => {
    const flip = { frame_style: { template: "flip" }, power: "2", toughness: "2" };
    expect(statsShrink(row({ ...flip, back_face: { power: "3", toughness: "3" } }))).toBe(false);
    expect(statsShrink(row({ ...flip, back_face: { power: "100", toughness: "100" } }))).toBe(true);
    // Only flip frames print a second-face P/T.
    expect(statsShrink(row({ back_face: { power: "100", toughness: "100" } }))).toBe(false);
  });
});
