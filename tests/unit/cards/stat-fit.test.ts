import { readFileSync } from "node:fs";
import { join } from "node:path";
// @ts-expect-error -- opentype.js (a devDependency) ships no types; the test reads glyph metrics and kerning only.
import * as opentype from "opentype.js";
import { describe, expect, it } from "vitest";
import {
  fitStatSizePct,
  STAT_GLYPHS,
  STAT_KERNING,
  statInkEm,
  statInkSpan,
  statLayoutChanged,
  statsShrink,
  statWidthEm,
  type StatScopeCard,
} from "@/lib/cards/stat-fit";
import { getFrameProfile, type StatSlot } from "@/lib/cards/template-layout";
import { RULES_TEXT, ptToPct } from "@/lib/cards/typography";
import { FRAME_TEMPLATE_VALUES, type FrameTemplate } from "@/types/card";

// ---------------------------------------------------------------------------
// Stat values shrink to fit the face they print on (TODO 3.18, 4.31): a value
// whose ink stays on its face keeps the profile size EXACTLY (its bake stays
// byte-identical), a wider one shrinks until it fits. The HD card is 1500 px
// wide (2100 landscape).
// ---------------------------------------------------------------------------

const HD = 1500;
const pt = (template: FrameTemplate) => getFrameProfile(template).pt!;
const m15 = pt("m15");
const alpha = pt("agclassic");
const battle = getFrameProfile("battle").defense!;
const loyalty = getFrameProfile("m15pw").loyalty!;
const flipBack = getFrameProfile("flip").secondFace!.pt!;

const keeps = (slot: StatSlot, value: string, upsideDown = false) =>
  fitStatSizePct(slot, value, "portrait", upsideDown) === slot.sizePct;

/** Where the value's ink ends up at the size it prints (HD px), in whichever
 *  renderer reaches further on each side. */
function inkPx(slot: StatSlot, value: string, orientation: "portrait" | "landscape" = "portrait", upsideDown = false) {
  const width = orientation === "landscape" ? 2100 : HD;
  const size = fitStatSizePct(slot, value, orientation, upsideDown) * width;
  const centre = ((slot.rect.leftPct + slot.rect.widthPct / 2) / 100) * width;
  const ink = statInkEm(value);
  const [left, right] = upsideDown ? [ink.right, ink.left] : [ink.left, ink.right];
  return { left: centre - left * size, right: centre + right * size };
}

function spanPx(slot: StatSlot, orientation: "portrait" | "landscape" = "portrait") {
  const width = orientation === "landscape" ? 2100 : HD;
  const span = statInkSpan(slot);
  return { left: span.left * width, right: span.right * width };
}

describe("Beleren Bold metrics", () => {
  const buf = readFileSync(join(process.cwd(), "public/fonts/Beleren-Bold.ttf"));
  const font = opentype.parse(buf.buffer.slice(buf.byteOffset, buf.byteOffset + buf.byteLength));

  it("glyph advances and side bearings match public/fonts/Beleren-Bold.ttf, the CardDisplay face both renderers draw", () => {
    expect(font.unitsPerEm).toBe(2048);
    for (const [ch, [advance, lsb, rsb]] of Object.entries(STAT_GLYPHS)) {
      const glyph = font.charToGlyph(ch);
      expect(glyph.index, ch).not.toBe(0);
      expect(glyph.advanceWidth, ch).toBe(advance);
      const m = glyph.getMetrics();
      const inkless = !Number.isFinite(m.xMin);
      expect(inkless ? 0 : m.xMin, ch).toBe(lsb);
      expect(inkless ? 0 : advance - m.xMax, ch).toBe(rsb);
    }
  });

  it("the kerning table is every non-zero GPOS pair between stat characters, both renderers' kerning", () => {
    const chars = [..."0123456789+-*/Xx½∞−–—×."];
    for (const a of chars) {
      for (const b of chars) {
        const kern = font.getKerningValue(font.charToGlyph(a), font.charToGlyph(b));
        expect(STAT_KERNING[a + b] ?? 0, a + b).toBe(kern);
      }
    }
    for (const pair of Object.keys(STAT_KERNING)) {
      expect([...pair].every((ch) => chars.includes(ch)), pair).toBe(true);
    }
  });

  it("counts an unknown character as a full em with no bearings (shrinks rather than overflows)", () => {
    expect(statWidthEm("龍")).toBe(1);
    expect(statInkEm("龍")).toEqual({ left: 0.5, right: 0.5 });
    expect(statWidthEm("10/10")).toBeCloseTo((921 + 1269 + 847 + 921 + 1269) / 2048, 10);
  });
});

describe("statInkEm — where each renderer inks a value", () => {
  it("Satori inks from its UNKERNED box's left edge: `40/40` (the `/4` pair pulls in −271) reaches further left", () => {
    const advance = 1165 + 1269 + 847 + 1165 + 1269;
    const ink = statInkEm("40/40");
    // Left: Satori's half advance box less the `4`'s bearing. Right: the
    // browser's centred kerned run reaches further than Satori's, which ends
    // 271 units short of the box.
    expect(ink.left).toBeCloseTo((advance / 2 - 20) / 2048, 10);
    expect(ink.right).toBeCloseTo(((advance - 271) / 2 - 91) / 2048, 10);
    expect(ink.left).toBeGreaterThan(ink.right);
  });

  it("a positive pair widens the ink past the advance box (`1/` +90)", () => {
    const advance = 1113 + 1269 + 921 + 847 + 1113 + 1269 + 921;
    const ink = statInkEm("*+1/*+1");
    expect(ink.right).toBeCloseTo((advance + 90 - advance / 2 - 102) / 2048, 10);
    // `*` overhangs its own advance box (lsb −70).
    expect(ink.left).toBeCloseTo((advance / 2 + 90 / 2 + 70) / 2048, 10);
  });
});

describe("fitStatSizePct", () => {
  it.each(["1/1", "4/4", "10/10", "15/15", "20/20", "40/40", "60/60", "80/80", "88/88", "99/99", "*/*", "*/1+*", "X/6", "X/X+1", "+4/+4"])(
    "M15 %s stays on the plate's face: the profile size, unchanged",
    (value) => {
      expect(fitStatSizePct(m15, value)).toBe(m15.sizePct);
    },
  );

  it.each(["100/100", "*+1/*+1", "1000/1000"])("M15 %s runs off the plate's face and shrinks onto it", (value) => {
    expect(fitStatSizePct(m15, value)).toBeLessThan(m15.sizePct);
    const ink = inkPx(m15, value);
    const span = spanPx(m15);
    expect(ink.left).toBeGreaterThanOrEqual(span.left - 1e-6);
    expect(ink.right).toBeLessThanOrEqual(span.right + 1e-6);
  });

  it("Alpha: two-digit values keep their size; *+1/*+1 ends inside the pinstripe (1404 px)", () => {
    for (const value of ["10/10", "20/20", "60/60", "80/80", "90/90"]) expect(keeps(alpha, value), value).toBe(true);
    expect(fitStatSizePct(alpha, "*+1/*+1")).toBeLessThan(alpha.sizePct);
    expect(inkPx(alpha, "*+1/*+1").right).toBeLessThanOrEqual(1404 + 1e-6);
    // At full size it used to run across the pinstripe into the black border.
    const centre = ((alpha.rect.leftPct + alpha.rect.widthPct / 2) / 100) * HD;
    expect(centre + statInkEm("*+1/*+1").right * alpha.sizePct * HD).toBeGreaterThan(1420);
  });

  it("Dragon Wing: 10/10–18/18 fit the plate's face (wider than MSE's field); 20/20 reaches the outline", () => {
    const dragon = pt("tarkirdragon");
    for (const value of ["10/10", "12/12", "16/16", "18/18"]) expect(keeps(dragon, value), value).toBe(true);
    expect(fitStatSizePct(dragon, "20/20")).toBeLessThan(dragon.sizePct);
  });

  it("Ghostfire and Retro: values on their wide ribbon / strip keep their size", () => {
    for (const value of ["20/20", "40/40", "50/50", "99/99"]) expect(keeps(pt("tarkirghostfire"), value), value).toBe(true);
    for (const value of ["100/100", "*+1/*+1"]) expect(keeps(pt("retro"), value), value).toBe(true);
  });

  it("Modern: 100/100 would print over the plate's bevel and shrinks onto its face", () => {
    const modern = pt("modern");
    expect(keeps(modern, "99/99")).toBe(true);
    expect(fitStatSizePct(modern, "100/100")).toBeLessThan(modern.sizePct);
    expect(inkPx(modern, "100/100").right).toBeLessThanOrEqual(1373 + 1e-6);
  });

  it("Battle defense fits the drawn badge, not the whole rect", () => {
    for (const value of ["15", "100", "999"]) expect(fitStatSizePct(battle, value, "landscape"), value).toBe(battle.sizePct);
    expect(fitStatSizePct(battle, "1000", "landscape")).toBeLessThan(battle.sizePct);
    const badge = spanPx(battle, "landscape");
    expect(badge.right - badge.left).toBeCloseTo((battle.rect.widthPct / 100) * 2100 * 0.76, 6);
    expect(inkPx(battle, "1000", "landscape").right).toBeLessThanOrEqual(badge.right + 1e-6);
  });

  it("planeswalker loyalty fits the shield's dark face: three digits keep their size, four shrink", () => {
    expect(keeps(loyalty, "10")).toBe(true);
    expect(keeps(loyalty, "100")).toBe(true);
    // Inside the 210 px rect, but over the shield's silver rim.
    expect(fitStatSizePct(loyalty, "1000")).toBeLessThan(loyalty.sizePct);
    expect(fitStatSizePct(loyalty, "10000")).toBeLessThan(fitStatSizePct(loyalty, "1000"));
  });

  it("a flip card's upside-down second face mirrors where the ink sits", () => {
    expect(keeps(flipBack, "20/20", true)).toBe(true);
    expect(fitStatSizePct(flipBack, "100/100", "portrait", true)).toBeLessThan(flipBack.sizePct);
    // A lopsided span: `40/40` reaches further left upright (Satori's
    // unkerned box), so it fits a span with room on the left only upright.
    const ink = statInkEm("40/40");
    const size = 0.05;
    const lopsided: StatSlot = {
      rect: { topPct: 0, leftPct: 40, widthPct: 20, heightPct: 5 },
      sizePct: size,
      colorHex: "#000",
      inkSpanPct: { leftPct: 50 - ink.left * size * 100 - 0.01, rightPct: 50 + ink.left * size * 100 - 0.2 },
    };
    expect(keeps(lopsided, "40/40")).toBe(true);
    expect(keeps(lopsided, "40/40", true)).toBe(false);
  });

  it("the profile's valueDxEm nudge moves the ink with it", () => {
    const nudged: StatSlot = { ...m15, valueDxEm: 0.1 };
    expect(keeps(m15, "88/88")).toBe(true);
    expect(keeps(nudged, "88/88")).toBe(false);
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
});

describe("measured ink spans (HD px, on the digits' rows)", () => {
  // Measured on HD bakes of every colour key: a plate's face up to its bevel
  // or outline, a strip up to its pinstripe / bevel shading.
  it.each<[FrameTemplate, "pt" | "loyalty" | "secondFace", number, number]>([
    ["m15", "pt", 1185, 1395.4],
    // Card Conjurer's borderless plate (4.32), 274 × 140 at 1146/1861 px.
    ["m15borderless", "pt", 1188, 1394],
    ["m15borderlessartifact", "pt", 1188, 1394],
    ["agclassic", "pt", 1236, 1404],
    ["alphaland", "pt", 1236, 1404],
    ["m15pw", "loyalty", 1239, 1389],
    ["retro", "pt", 1125, 1410],
    ["modern", "pt", 1143, 1373],
    ["flip", "pt", 1235.4, 1403],
    ["flip", "secondFace", 104, 257.5],
    ["tarkirdragon", "pt", 1193, 1388],
    ["tarkirdraconic", "pt", 1187, 1398],
    ["tarkirghostfire", "pt", 1153, 1404],
  ])("%s %s: %d–%d px", (template, which, left, right) => {
    const profile = getFrameProfile(template);
    const slot = which === "secondFace" ? profile.secondFace!.pt! : profile[which]!;
    const span = spanPx(slot);
    expect(span.left).toBeCloseTo(left, 0);
    expect(span.right).toBeCloseTo(right, 0);
    const centre = ((slot.rect.leftPct + slot.rect.widthPct / 2) / 100) * HD;
    expect(centre).toBeGreaterThan(span.left);
    expect(centre).toBeLessThan(span.right);
  });

  it("a second face's span lies inside its rect (a fitted value never overflows it, which only StatBake centres)", () => {
    for (const template of FRAME_TEMPLATE_VALUES) {
      const slot = getFrameProfile(template).secondFace?.pt;
      if (!slot) continue;
      const span = statInkSpan(slot);
      expect(span.left, template).toBeGreaterThanOrEqual(slot.rect.leftPct / 100);
      expect(span.right, template).toBeLessThanOrEqual((slot.rect.leftPct + slot.rect.widthPct) / 100);
    }
  });

  it("every template on the M15 plate shares its span", () => {
    for (const template of FRAME_TEMPLATE_VALUES) {
      const slot = getFrameProfile(template).pt;
      // The borderless pack's plates are their own shape (checked above).
      if (!slot?.plateAssetPathTemplate?.match(/^\/frames\/m15(?!borderless)[a-z]*\/pt\//)) continue;
      expect(slot.inkSpanPct, template).toEqual(m15.inkSpanPct);
    }
  });
});

describe("statsShrink / statLayoutChanged — the card-row scope", () => {
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
    for (const card of [
      row({}),
      row({ power: "20", toughness: "20", frame_style: { template: "m15artifact" } }),
      row({ power: "20", toughness: "20", frame_style: { template: "agclassic" } }),
      row({ power: "12", toughness: "12", frame_style: { template: "tarkirdragon" } }),
      row({ power: "12", toughness: "12", frame_style: { template: "tarkirghostfire" } }),
    ]) {
      expect(statsShrink(card)).toBe(false);
      expect(statLayoutChanged(card)).toBe(false);
    }
  });

  it("is true when a printed stat shrinks", () => {
    for (const card of [
      row({ power: "100", toughness: "100" }),
      row({ power: "*+1", toughness: "*+1", frame_style: { template: "agclassic" } }),
      row({ card_type: "planeswalker", power: null, toughness: null, loyalty: "1000", frame_style: { template: "m15pw" } }),
      row({ card_type: "battle", power: null, toughness: null, defense: "1000", frame_style: { template: "battle" } }),
    ]) {
      expect(statsShrink(card)).toBe(true);
      expect(statLayoutChanged(card)).toBe(true);
    }
  });

  it("covers a value wider than its rect: it now prints on one line, centred", () => {
    // Wrapped after its slash.
    const wraps = row({ power: "X", toughness: "X+1" });
    expect(statsShrink(wraps)).toBe(false);
    expect(statLayoutChanged(wraps)).toBe(true);
    const retro = row({ power: "*+1", toughness: "*+1", frame_style: { template: "retro" } });
    expect(statsShrink(retro)).toBe(false);
    expect(statLayoutChanged(retro)).toBe(true);
    // No break: ran off the rect's right edge only.
    expect(statsShrink(row({ power: "40", toughness: "40" }))).toBe(false);
    expect(statLayoutChanged(row({ power: "40", toughness: "40" }))).toBe(true);
    // 20/20 is 202.6 px on M15's 205 px rect: untouched.
    expect(statLayoutChanged(row({ power: "20", toughness: "20" }))).toBe(false);
  });

  it("covers every Draconic card that prints a P/T (its new plate), and no other Draconic card", () => {
    const draconic = { frame_style: { template: "tarkirdraconic" } };
    expect(statLayoutChanged(row({ ...draconic }))).toBe(true);
    expect(statLayoutChanged(row({ ...draconic, card_type: "instant" }))).toBe(false);
    expect(statLayoutChanged(row({ ...draconic, power: null, toughness: null }))).toBe(false);
    expect(statLayoutChanged(row({ ...draconic, card_type: "artifact", subtypes: ["Vehicle"] }))).toBe(true);
  });

  it("judges only what the bake prints", () => {
    // An instant's P/T and a creature's loyalty are never drawn.
    expect(statLayoutChanged(row({ card_type: "instant", power: "100", toughness: "100" }))).toBe(false);
    expect(statLayoutChanged(row({ loyalty: "10000" }))).toBe(false);
    // A Vehicle prints its P/T; a missing side prints as an em dash.
    expect(statsShrink(row({ card_type: "artifact", subtypes: ["Vehicle"], power: "100", toughness: "100" }))).toBe(true);
    expect(statsShrink(row({ power: "10000", toughness: null }))).toBe(true);
  });

  it("reads the template the card is drawn on ({} and retired values draw m15)", () => {
    expect(statsShrink(row({ frame_style: {}, power: "100", toughness: "100" }))).toBe(true);
    expect(statLayoutChanged(row({ frame_style: null, power: "X", toughness: "X+1" }))).toBe(true);
    expect(statLayoutChanged(row({ frame_style: { template: "regular" }, power: "1", toughness: "1" }))).toBe(false);
  });

  it("covers a flip card's second-face P/T", () => {
    const flip = { frame_style: { template: "flip" }, power: "2", toughness: "2" };
    expect(statLayoutChanged(row({ ...flip, back_face: { power: "3", toughness: "3" } }))).toBe(false);
    expect(statsShrink(row({ ...flip, back_face: { power: "100", toughness: "100" } }))).toBe(true);
    // Only flip frames print a second-face P/T.
    expect(statLayoutChanged(row({ back_face: { power: "100", toughness: "100" } }))).toBe(false);
  });

  it("can't judge a row missing a column it reads → affected", () => {
    for (const column of ["frame_style", "card_type", "subtypes", "power", "toughness", "loyalty", "defense", "back_face"] as const) {
      const card = row({});
      delete card[column];
      expect(statLayoutChanged(card), column).toBe(true);
    }
  });
});
