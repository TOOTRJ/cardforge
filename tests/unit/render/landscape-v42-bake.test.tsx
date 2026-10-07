import sharp from "sharp";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import type { CardPreviewData } from "@/components/cards/card-preview";
import { buildTypeLine } from "@/lib/cards/card-display";
import { fitTypeLineBand } from "@/lib/cards/render-tiers";
import { getFrameProfile, type Rect } from "@/lib/cards/template-layout";
import { renderCardImage, type RenderPreset } from "@/lib/render/card-image";
import { bucketKeysOf, bucketMaster, haveBucketMasters, serveBucketMasters, type ServedBucketMasters } from "@/tests/stubs/bucket-masters";
import { serveStandInFrames, type StandInFrames } from "@/tests/stubs/stand-in-frames";

// ---------------------------------------------------------------------------
// Layout v42 (TODO 4.21b) on REAL bakes, at HD (2100 × 1500) and at the
// 1050 px default: split and battle on their Card Conjurer masters, every
// number measured on the prints (Scryfall PNGs turned clockwise at 2100 ×
// 1500, each bar registered by correlation; lib/cards/template-layout.ts
// "The landscape layouts") —
//   • battle: the name starts right of the icon (TODO 3.28) on the prints'
//     baseline, the cost ends where the prints' last disc does relative to
//     the pill, the type line and its baseline, the defense as the value
//     alone in the shield the master paints, the rules clear of that shield
//     on every battle;
//   • split: both halves set alike (the right half an unturned measured
//     second face), at the prints' own sizes — a 76 px name, a 53 px type
//     line, 68 px pips, a 48 px symbol;
//   • both: the artist credit turned down the left border, the brand mark in
//     the bottom border.
// The first two blocks bake on flat stand-in masters (tests/stubs/
// stand-in-frames.ts: the text, pips and marks are the only ink), so they
// run everywhere; the last bakes the REAL bucket masters (FRAMES_BUILD_DIR,
// else .frames-build; CI fetches them) for what only the master can show —
// the border under the marks, the painted shield, the colourless frame's
// see-through bars.
// ---------------------------------------------------------------------------

const battle = getFrameProfile("battle");
const split = getFrameProfile("split");
const TONE = 128;
const HD_W = 2100;
/** A flat picture in the stand-in master's own tone. The battle's art runs
 *  under its whole frame (the stand-in's window is the card's interior), so
 *  a battle bake's only marks are then its text, pips and value, as on the
 *  stand-in's opaque parts. */
let toneArt = "";
async function flatArt(rgb: readonly number[]): Promise<string> {
  const png = await sharp({ create: { width: 800, height: 600, channels: 3, background: { r: rgb[0], g: rgb[1], b: rgb[2] } } }).png().toBuffer();
  return `data:image/png;base64,${png.toString("base64")}`;
}

function battleCard(over: Partial<CardPreviewData> = {}): CardPreviewData {
  return {
    title: "Invasion of Tarkir",
    cost: "{1}{R}",
    cardType: "battle",
    supertype: null,
    subtypes: ["Siege"],
    rarity: "mythic",
    colorIdentity: ["red"],
    rulesText: "When this Siege enters, reveal any number of Dragon cards from your hand.",
    flavorText: null,
    power: null,
    toughness: null,
    loyalty: null,
    defense: "5",
    artistCredit: "Darren Tan",
    artUrl: toneArt,
    artPosition: {},
    frameStyle: { template: "battle", finish: "regular" },
    setIconUrl: null,
    setIconCode: null,
    backFace: null,
    faceContent: null,
    watermark: null,
    ...over,
  } as unknown as CardPreviewData;
}

function splitCard(over: Partial<CardPreviewData> = {}, back: Record<string, unknown> = {}): CardPreviewData {
  return {
    title: "Probe",
    cost: "{2}{R}",
    cardType: "sorcery",
    supertype: null,
    subtypes: [],
    rarity: "uncommon",
    colorIdentity: ["red"],
    rulesText: "Discard a card, then draw two cards.",
    flavorText: null,
    power: null,
    toughness: null,
    loyalty: null,
    defense: null,
    artistCredit: "Probe Artist",
    artUrl: null,
    artPosition: {},
    frameStyle: { template: "split", finish: "regular" },
    setIconUrl: null,
    setIconCode: null,
    backFace: { title: "Probe", cost: "{2}{R}", card_type: "sorcery", rules_text: "Discard a card, then draw two cards.", ...back },
    faceContent: null,
    watermark: null,
    ...over,
  } as unknown as CardPreviewData;
}

type Raw = { data: Buffer; w: number; h: number };
async function bake(data: CardPreviewData, preset: RenderPreset, brandMark = false): Promise<Raw> {
  const res = await renderCardImage(data, preset, { brandMark, watermarkText: null });
  const { data: raw, info } = await sharp(Buffer.from(await res.arrayBuffer())).removeAlpha().raw().toBuffer({ resolveWithObject: true });
  return { data: raw, w: info.width, h: info.height };
}
const px = (r: Raw, x: number, y: number) => {
  const i = (y * r.w + x) * 3;
  return [r.data[i], r.data[i + 1], r.data[i + 2]];
};
const sum = (c: number[]) => c[0] + c[1] + c[2];
const isDark = (c: number[]) => sum(c) < 150;
const isLight = (c: number[]) => sum(c) > 620;
/** Not the stand-in's flat tone (text, a pip's disc, its outline or shadow). */
const isMark = (c: number[]) => Math.abs(c[0] - TONE) + Math.abs(c[1] - TONE) + Math.abs(c[2] - TONE) > 60;

type Box = { x0: number; x1: number; y0: number; y1: number };
/** A box given in HD px, in the bake's own px. */
const hd = (r: Raw, x0: number, x1: number, y0: number, y1: number): Box => {
  const k = r.w / HD_W;
  return { x0: x0 * k, x1: x1 * k, y0: y0 * k, y1: y1 * k };
};
const ofRect = (r: Raw, rect: Rect): Box => ({
  x0: (rect.leftPct / 100) * r.w,
  x1: ((rect.leftPct + rect.widthPct) / 100) * r.w,
  y0: (rect.topPct / 100) * r.h,
  y1: ((rect.topPct + rect.heightPct) / 100) * r.h,
});
/** The bounding box, in HD px, of the pixels inside `box` that satisfy
 *  `pred` — null when there are none. */
function inkBox(r: Raw, box: Box, pred: (c: number[]) => boolean): Box | null {
  const k = r.w / HD_W;
  let x0 = Infinity;
  let x1 = -Infinity;
  let y0 = Infinity;
  let y1 = -Infinity;
  for (let y = Math.max(0, Math.ceil(box.y0)); y < Math.min(r.h, Math.floor(box.y1)); y += 1) {
    for (let x = Math.max(0, Math.ceil(box.x0)); x < Math.min(r.w, Math.floor(box.x1)); x += 1) {
      if (!pred(px(r, x, y))) continue;
      if (x < x0) x0 = x;
      if (x > x1) x1 = x;
      if (y < y0) y0 = y;
      if (y > y1) y1 = y;
    }
  }
  return Number.isFinite(x0) ? { x0: x0 / k, x1: (x1 + 1) / k, y0: y0 / k, y1: (y1 + 1) / k } : null;
}
/** A text line's baseline in HD px: the last row holding ≥ 35 % of the
 *  most-inked row's dark pixels (the letters' bodies, no descender). */
function baselineOf(r: Raw, box: Box): number {
  const k = r.w / HD_W;
  const counts: number[] = [];
  const top = Math.ceil(box.y0);
  for (let y = top; y < Math.floor(box.y1); y += 1) {
    let n = 0;
    for (let x = Math.ceil(box.x0); x < Math.floor(box.x1); x += 1) if (isDark(px(r, x, y))) n += 1;
    counts.push(n);
  }
  const max = Math.max(...counts);
  expect(max, "the line has ink").toBeGreaterThan(0);
  let last = 0;
  counts.forEach((n, i) => {
    if (n >= max * 0.35) last = i;
  });
  return (top + last + 1) / k;
}
/** Bounding box (HD px) of the pixels two bakes differ at. */
function diffBox(a: Raw, b: Raw, within?: Box): Box | null {
  const k = a.w / HD_W;
  let x0 = Infinity;
  let x1 = -Infinity;
  let y0 = Infinity;
  let y1 = -Infinity;
  const box = within ?? { x0: 0, x1: a.w, y0: 0, y1: a.h };
  for (let y = Math.max(0, Math.ceil(box.y0)); y < Math.min(a.h, Math.floor(box.y1)); y += 1) {
    for (let x = Math.max(0, Math.ceil(box.x0)); x < Math.min(a.w, Math.floor(box.x1)); x += 1) {
      const [p, q] = [px(a, x, y), px(b, x, y)];
      if (Math.abs(p[0] - q[0]) <= 24 && Math.abs(p[1] - q[1]) <= 24 && Math.abs(p[2] - q[2]) <= 24) continue;
      if (x < x0) x0 = x;
      if (x > x1) x1 = x;
      if (y < y0) y0 = y;
      if (y > y1) y1 = y;
    }
  }
  return Number.isFinite(x0) ? { x0: x0 / k, x1: (x1 + 1) / k, y0: y0 / k, y1: (y1 + 1) / k } : null;
}
/** A tolerance in HD px: `at` on the HD bake, one px more on the default
 *  (half-size) one, whose every px is two. */
const tol = (preset: RenderPreset, at: number) => (preset === "hd" ? at : at + 1.5);
const PRESETS = ["hd", "default"] as const;

describe("layout v42 — the battle on real bakes (HD and the 1050 px default)", () => {
  let frames: StandInFrames;
  beforeAll(async () => {
    toneArt = await flatArt([TONE, TONE, TONE]);
    frames = await serveStandInFrames([{ template: "battle", keys: ["r", "c"], tone: TONE }]);
  }, 60_000);
  afterAll(() => frames.restore());

  it("is a landscape bake on a 2100 × 1500 master", async () => {
    const r = await bake(battleCard(), "hd");
    expect([r.w, r.h]).toEqual([2100, 1500]);
    const small = await bake(battleCard(), "default");
    expect([small.w, small.h]).toEqual([1050, 750]);
    expect(frames.fetched).toContain("battle/r.png");
  }, 120_000);

  it.each(PRESETS)("starts the name right of the icon, 23 px into the pill, on the prints' baseline — at %s (TODO 3.28)", async (preset) => {
    const r = await bake(battleCard({ cost: null }), preset);
    // The pill's face is 375–1967 × 76–181 px; the icon's ring ends at 362.
    const ink = inkBox(r, hd(r, 300, 1960, 80, 180), isDark)!;
    // The nine MOM prints start their names 396–398 px in (the MSE profile's
    // rect began 269 px in: the first letters sat under the ornament).
    expect(ink.x0, `the name's first ink column ${ink.x0}`).toBeGreaterThanOrEqual(392);
    expect(ink.x0).toBeLessThanOrEqual(392 + tol(preset, 9));
    // …and set their baseline on 158.4 px (157.4–159.3).
    const baseline = baselineOf(r, hd(r, 392, 1100, 84, 180));
    expect(Math.abs(baseline - 158.4), `the name's baseline ${baseline}`).toBeLessThanOrEqual(tol(preset, 1.5));
  }, 120_000);

  it.each(PRESETS)("tracks the name like M15's: 'Invasion of Tarkir' is the prints' 632 px wide — at %s", async (preset) => {
    const r = await bake(battleCard({ cost: null }), preset);
    const ink = inkBox(r, hd(r, 380, 1960, 84, 180), isDark)!;
    // MOM #149 prints it 632 px wide at the same cap height; untracked, an
    // 80 px Beleren sets it 615 (the family's names carry 0.01 em).
    expect(battle.title.letterSpacingEm).toBe(0.01);
    expect(Math.abs(ink.x1 - ink.x0 - 632), `the name is ${ink.x1 - ink.x0} px wide`).toBeLessThanOrEqual(tol(preset, 6));
    expect(ink.x1 - ink.x0).toBeGreaterThan(620);
  }, 120_000);

  it.each(PRESETS)("ends the cost 24 px before the pill's face does and centres the discs on it — at %s", async (preset) => {
    const r = await bake(battleCard(), preset);
    // The pips are the only marks right of the name.
    const pips = inkBox(r, hd(r, 1500, 2030, 70, 190), isMark)!;
    // The prints' last disc ends 24 px before the pill's face (1967 px):
    // 1942–1943 px on this master.
    expect(Math.abs(pips.x1 - 1942.3), `the last disc ends at ${pips.x1}`).toBeLessThanOrEqual(tol(preset, 2));
    // Two discs at the family's 72.75 px (+ their drop shadow).
    expect(pips.x1 - pips.x0).toBeGreaterThan(150);
    expect(pips.x1 - pips.x0).toBeLessThan(166);
    // Centred on the pill's face (rows 76–181: 128.75 px), as the prints'
    // discs are (128.5–129.3) — the shadow hangs a few px below.
    const centre = (pips.y0 + pips.y1) / 2;
    expect(Math.abs(centre - 128.75), `the discs' centre ${centre}`).toBeLessThanOrEqual(tol(preset, 3.5));
  }, 120_000);

  it.each(PRESETS)("sets the type line from 272 px on the prints' baseline, 77 px below the bar's top — at %s", async (preset) => {
    const r = await bake(battleCard(), preset);
    const bar = ofRect(r, battle.type.rect);
    const ink = inkBox(r, { ...bar, x1: bar.x0 + 900 * (r.w / HD_W) }, isDark)!;
    // "Battle — Siege": the prints' 271.2–272.2 px.
    expect(ink.x0).toBeGreaterThanOrEqual(268);
    expect(ink.x0).toBeLessThanOrEqual(268 + tol(preset, 8));
    // The bar's face starts at 875 px on the master (the pack's 871, moved
    // 4 px down onto the prints): the baseline 76.9 px below it.
    const baseline = baselineOf(r, { ...bar, x1: bar.x0 + 900 * (r.w / HD_W) });
    expect(Math.abs(baseline - (875 + 76.9)), `the type line's baseline ${baseline}`).toBeLessThanOrEqual(tol(preset, 1.5));
  }, 120_000);

  it.each(PRESETS)("draws the defense as the value alone, white, where the prints centre their digit — no disc, no outline — at %s", async (preset) => {
    const none = await bake(battleCard({ defense: null }), preset);
    const five = await bake(battleCard({ defense: "5" }), preset);
    const digit = diffBox(none, five)!;
    const shield = battle.defense!.paintedRect!;
    const [sx, sy] = [(shield.leftPct / 100) * HD_W, (shield.topPct / 100) * 1500];
    // 81 px right of the shield's left point and 82 px below its top one
    // (1962 / 1386 px on the master): the prints' digit, nine MOM battles.
    expect(Math.abs((digit.x0 + digit.x1) / 2 - (sx + 81)), `digit centre x ${(digit.x0 + digit.x1) / 2}`).toBeLessThanOrEqual(tol(preset, 3));
    expect(Math.abs((digit.y0 + digit.y1) / 2 - (sy + 82)), `digit centre y ${(digit.y0 + digit.y1) / 2}`).toBeLessThanOrEqual(tol(preset, 3));
    // 57–58 px tall on the prints (78 px Beleren digits).
    expect(digit.y1 - digit.y0).toBeGreaterThan(52);
    expect(digit.y1 - digit.y0).toBeLessThan(63);
    // Nothing but the digit: a box as narrow as it (the drawn disc was 128
    // px wide), every changed pixel LIGHTER than the master (white ink).
    expect(digit.x1 - digit.x0).toBeLessThan(50);
    const k = five.w / HD_W;
    let darker = 0;
    for (let y = Math.floor(digit.y0 * k); y < Math.ceil(digit.y1 * k); y += 1) {
      for (let x = Math.floor(digit.x0 * k); x < Math.ceil(digit.x1 * k); x += 1) {
        if (sum(px(five, x, y)) < sum(px(none, x, y)) - 72) darker += 1;
      }
    }
    expect(darker).toBe(0);
  }, 120_000);

  it.each(PRESETS)("keeps the rules text out of the painted shield on a battle WITH and WITHOUT a defense — at %s", async (preset) => {
    const text =
      "When this Siege enters, search your library and/or graveyard for a non-Human creature card with mana value X or less and put it onto the battlefield. If you search your library this way, shuffle. Then each player draws a card and discards a card at random, twice.";
    for (const defense of ["5", null]) {
      const r = await bake(battleCard({ rulesText: text, defense }), preset);
      // The text reaches the shield's rows…
      const rules = ofRect(r, battle.rules.rect);
      const all = inkBox(r, rules, isDark)!;
      expect(all.y1, `defense ${defense}: the text's last row`).toBeGreaterThan(1304 + 20);
      // …and no line's ink enters the shield (the value, when drawn, is white).
      expect(inkBox(r, ofRect(r, battle.defense!.paintedRect!), isDark), `defense ${defense}`).toBeNull();
    }
  }, 240_000);

  it.each(PRESETS)("centres a short rules text in the text box, as the prints centre theirs — at %s", async (preset) => {
    // One line in the 414 px box: its ink sits on the box's middle, not under
    // the type bar (the MSE profile set the block from the box's top).
    const r = await bake(battleCard({ rulesText: "Draw a card, then discard a card." }), preset);
    const k = r.w / HD_W;
    const box = ofRect(r, battle.rules.rect);
    const text = inkBox(r, box, isDark)!;
    expect(text).not.toBeNull();
    const centre = (text.y0 + text.y1) / 2;
    expect(Math.abs(centre - (box.y0 + box.y1) / 2 / k), `the line's centre ${centre}`).toBeLessThanOrEqual(tol(preset, 8));
    // …and it starts at the box's left edge (the prints' lines start 272–275 px in).
    expect(Math.abs(text.x0 - 273), `the line starts ${text.x0}`).toBeLessThanOrEqual(tol(preset, 4));
  }, 120_000);

  it.each(PRESETS)("turns the artist credit down the left border: a tall line 97 px from the top, centred 78 px in — at %s", async (preset) => {
    const credited = await bake(battleCard({ artistCredit: "Darren Tan" }), preset);
    // The credit is the only light ink left of the art (x < 160 px).
    const line = inkBox(credited, hd(credited, 0, 160, 0, 1500), isLight)!;
    expect(line).not.toBeNull();
    // M15's footer line, turned a quarter turn clockwise with the card: the
    // prints' second border line is centred 75–79 px from the left edge and
    // starts 97–99 px down (MH2 #123, TSR #186, MOM #149).
    expect(line.x1).toBeLessThan(110);
    expect(line.x0).toBeGreaterThan(50);
    expect(Math.abs((line.x0 + line.x1) / 2 - 78), `the credit's centre ${(line.x0 + line.x1) / 2}`).toBeLessThanOrEqual(tol(preset, 4));
    expect(Math.abs(line.y0 - 98), `the credit starts at ${line.y0}`).toBeLessThanOrEqual(tol(preset, 4));
    // A turned line: far taller than wide ("ART: DARREN TAN").
    expect(line.y1 - line.y0).toBeGreaterThan((line.x1 - line.x0) * 5);
    // The band the profile declares holds it.
    const band = ofRect(credited, battle.footer!.rect);
    const k = credited.w / HD_W;
    expect(line.x0).toBeGreaterThanOrEqual(band.x0 / k - 3);
    expect(line.x1).toBeLessThanOrEqual(band.x1 / k + 3);
    expect(line.y0).toBeGreaterThanOrEqual(band.y0 / k - 3);
    expect(line.y1).toBeLessThanOrEqual(band.y1 / k + 3);
  }, 120_000);

  it.each(PRESETS)("centres the brand mark's ink in the 54 px bottom border, clear of the shield — at %s", async (preset) => {
    const off = await bake(battleCard(), preset, false);
    const on = await bake(battleCard(), preset, true);
    const mark = diffBox(off, on)!;
    // The border is 1446–1500 px on the master: the ink's centre on 1473.
    expect(mark.y0).toBeGreaterThanOrEqual(1446);
    expect(mark.y1).toBeLessThanOrEqual(1500);
    expect(Math.abs((mark.y0 + mark.y1) / 2 - 1473), `the mark's centre ${(mark.y0 + mark.y1) / 2}`).toBeLessThanOrEqual(tol(preset, 2));
    // Its right end short of the shield's left point (1881 px).
    expect(mark.x1).toBeLessThan(1881 - 8);
    expect(mark.x1).toBeGreaterThan(1840);
  }, 120_000);
});

describe("layout v42 — split on real bakes (HD and the 1050 px default)", () => {
  let frames: StandInFrames;
  beforeAll(async () => {
    frames = await serveStandInFrames([{ template: "split", keys: ["r"], tone: TONE }]);
  }, 60_000);
  afterAll(() => frames.restore());

  /** The two halves' bar rows, and each half's columns (HD px). */
  const NAME_ROWS = [108, 206] as const;
  const TYPE_ROWS = [816, 884] as const;
  const LEFT = [185, 1040] as const;
  const RIGHT = [1151, 2006] as const;
  const HALF_DX = 966;

  it.each(PRESETS)("sets both halves ALIKE: the same name, type line and cost land 966 px apart on the same rows — at %s", async (preset) => {
    const r = await bake(splitCard(), preset);
    // (The type line's columns stop short of the set symbol, which only the
    // left half draws — TODO 3.9.)
    for (const [label, rows, pred, width] of [
      ["name", NAME_ROWS, isDark, 855],
      ["type line", TYPE_ROWS, isDark, 600],
      ["name bar (name + pips)", NAME_ROWS, isMark, 855],
    ] as const) {
      const l = inkBox(r, hd(r, LEFT[0], LEFT[0] + width, rows[0], rows[1]), pred)!;
      const rt = inkBox(r, hd(r, RIGHT[0], RIGHT[0] + width, rows[0], rows[1]), pred)!;
      expect(l, label).not.toBeNull();
      expect(rt, label).not.toBeNull();
      expect(Math.abs(rt.x0 - l.x0 - HALF_DX), `${label}: left edges ${l.x0} / ${rt.x0}`).toBeLessThanOrEqual(tol(preset, 1.5));
      expect(Math.abs(rt.x1 - l.x1 - HALF_DX), `${label}: right edges ${l.x1} / ${rt.x1}`).toBeLessThanOrEqual(tol(preset, 1.5));
      expect(Math.abs(rt.y0 - l.y0), `${label}: top rows`).toBeLessThanOrEqual(tol(preset, 1));
      expect(Math.abs(rt.y1 - l.y1), `${label}: bottom rows`).toBeLessThanOrEqual(tol(preset, 1));
    }
  }, 120_000);

  it.each(PRESETS)("sets the names on the prints' baseline (183 px) and the type lines on theirs (868 px), from 30 / 25 px past the bars' left ends — at %s", async (preset) => {
    const r = await bake(splitCard({ cost: null }, { cost: null }), preset);
    for (const [half, cols] of [["left", LEFT], ["right", RIGHT]] as const) {
      const name = inkBox(r, hd(r, cols[0], cols[1], NAME_ROWS[0], NAME_ROWS[1]), isDark)!;
      // The bar's face starts 189 / 1155 px in; the prints' names 30–32 px
      // past it.
      const barLeft = half === "left" ? 189 : 1155;
      expect(name.x0 - barLeft, `${half} name starts ${name.x0}`).toBeGreaterThanOrEqual(26);
      expect(name.x0 - barLeft).toBeLessThanOrEqual(26 + tol(preset, 8));
      const nameBase = baselineOf(r, hd(r, cols[0], cols[1], NAME_ROWS[0], NAME_ROWS[1]));
      expect(Math.abs(nameBase - 182.7), `${half} name baseline ${nameBase}`).toBeLessThanOrEqual(tol(preset, 1.5));
      const typeBase = baselineOf(r, hd(r, cols[0], cols[1], TYPE_ROWS[0], TYPE_ROWS[1]));
      expect(Math.abs(typeBase - 867.9), `${half} type baseline ${typeBase}`).toBeLessThanOrEqual(tol(preset, 1.5));
    }
  }, 120_000);

  it.each(PRESETS)("prints the type line at 53 px — 'Sorcery' is the prints' 177 px wide, not Card Conjurer's 60 px (201) — at %s", async (preset) => {
    const r = await bake(splitCard(), preset);
    for (const cols of [LEFT, RIGHT]) {
      const type = inkBox(r, hd(r, cols[0], cols[0] + 500, TYPE_ROWS[0], TYPE_ROWS[1]), isDark)!;
      expect(Math.abs(type.x1 - type.x0 - 177), `'Sorcery' is ${type.x1 - type.x0} px wide`).toBeLessThanOrEqual(tol(preset, 3));
    }
  }, 120_000);

  it.each(PRESETS)("draws 68 px pips ending 19 px before each bar's face does, centred on the bar — at %s", async (preset) => {
    const r = await bake(splitCard(), preset);
    for (const [half, cols, end] of [["left", LEFT, 1019], ["right", RIGHT, 1985]] as const) {
      const pips = inkBox(r, hd(r, cols[0] + 500, cols[1], NAME_ROWS[0] - 6, NAME_ROWS[1] + 6), isMark)!;
      expect(Math.abs(pips.x1 - end), `${half}: the last disc ends at ${pips.x1}`).toBeLessThanOrEqual(tol(preset, 2));
      // Two 68 px discs and their shadow: 148 px (the family's 72.75 px
      // discs would take 159).
      expect(pips.x1 - pips.x0).toBeGreaterThan(140);
      expect(pips.x1 - pips.x0).toBeLessThan(154);
      const centre = (pips.y0 + pips.y1) / 2;
      expect(Math.abs(centre - 157), `${half}: the discs' centre ${centre}`).toBeLessThanOrEqual(tol(preset, 4));
    }
  }, 120_000);

  it.each(PRESETS)("fits a long name on EITHER half the same way: it stops a gap before its cost, on both — at %s", async (preset) => {
    const long = "Incongruous Reconsideration of Everything";
    const r = await bake(splitCard({ title: long, cost: "{4}{R}{R}" }, { title: long, cost: "{4}{R}{R}" }), preset);
    const boxes = [LEFT, RIGHT].map((cols) => inkBox(r, hd(r, cols[0], cols[1], NAME_ROWS[0], NAME_ROWS[1]), isDark)!);
    // The same fit on both halves.
    expect(Math.abs(boxes[1].x0 - boxes[0].x0 - HALF_DX)).toBeLessThanOrEqual(tol(preset, 1.5));
    expect(Math.abs(boxes[1].x1 - boxes[0].x1 - HALF_DX)).toBeLessThanOrEqual(tol(preset, 1.5));
    for (const [i, cols] of [LEFT, RIGHT].entries()) {
      // The name's dark ink ends before the three discs begin (three 68 px
      // discs end at the cost's right end: they start ≈ 225 px before it).
      const costLeft = (i === 0 ? 1019 : 1985) - 225;
      const name = inkBox(r, hd(r, cols[0], costLeft - 2, NAME_ROWS[0], NAME_ROWS[1]), isDark)!;
      const pips = inkBox(r, hd(r, costLeft - 12, cols[1], NAME_ROWS[0] - 6, NAME_ROWS[1] + 6), isMark)!;
      expect(pips.x0 - name.x1, `half ${i}: the name ends ${name.x1}, the cost starts ${pips.x0}`).toBeGreaterThanOrEqual(8);
      // …and the long name was SHRUNK or cut, not left to run under them.
      expect(name.x1).toBeLessThan(costLeft);
    }
  }, 120_000);

  it.each(PRESETS)("fits a long type line on EITHER half to its own bar: shrunk as the shared fit says, never clipped at full size — at %s", async (preset) => {
    // The right half is an unturned second face: its type line goes through
    // fitTypeLineBand as the front's does (no set symbol to make room for —
    // TODO 3.9 — so its room is the whole band less the band's gap).
    const subtypes = ["Arcane", "Trap", "Adventure"];
    const text = buildTypeLine({ cardType: "sorcery", supertype: null, subtypes });
    const slot = split.secondFace!.type;
    const fit = fitTypeLineBand({ layout: { type: slot }, text, symbolWidthPct: null, orientation: "landscape" });
    // The line is wider than its bar at 53 px, and fits it whole a little smaller.
    expect(fit.sizePct / slot.sizePct).toBeLessThan(0.95);
    expect(fit.sizePct / slot.sizePct).toBeGreaterThan(0.85);
    expect(fit.text).toBe(text);
    const short = await bake(splitCard(), preset);
    const long = await bake(splitCard({ subtypes }, { subtypes }), preset);
    const k = short.w / HD_W;
    /** The first word's ink width (HD px): the columns from the first inked
     *  one to the first gap of 8 HD px — "Sorcery", before its space. */
    const firstWord = (r: Raw, cols: readonly [number, number]): number => {
      const box = hd(r, cols[0], cols[1], TYPE_ROWS[0], TYPE_ROWS[1]);
      let start = -1;
      let last = -1;
      for (let x = Math.ceil(box.x0); x < Math.floor(box.x1); x += 1) {
        let ink = false;
        // (Any ink, a thin stroke's antialiased edge included: at the 1050 px
        // bake a y's tail never reaches isDark, and the word would end early.)
        for (let y = Math.ceil(box.y0); y < Math.floor(box.y1) && !ink; y += 1) ink = sum(px(r, x, y)) < 3 * TONE - 90;
        if (ink) {
          if (start < 0) start = x;
          last = x;
        } else if (start >= 0 && x - last >= 8 * k) break;
      }
      expect(start, "the line has ink").toBeGreaterThanOrEqual(0);
      return (last + 1 - start) / k;
    };
    const full = { left: firstWord(short, LEFT), right: firstWord(short, RIGHT) };
    // "Sorcery" at 53 px: the prints' 177 px (the test above), a few px of
    // antialiasing wider by this looser reading.
    for (const w of [full.left, full.right]) expect(Math.abs(w - 179), `'Sorcery' is ${w} px wide`).toBeLessThanOrEqual(6);
    const shrunk = { left: firstWord(long, LEFT) / full.left, right: firstWord(long, RIGHT) / full.right };
    // The right half's line is drawn at the shared fit's size…
    expect(Math.abs(shrunk.right - fit.sizePct / slot.sizePct), `the right half's letters are ${shrunk.right.toFixed(3)} of full size, the fit says ${(fit.sizePct / slot.sizePct).toFixed(3)}`).toBeLessThanOrEqual(preset === "hd" ? 0.025 : 0.045);
    // …the left half's a little smaller still (its set symbol takes room)…
    expect(shrunk.left).toBeLessThan(shrunk.right);
    expect(shrunk.left).toBeGreaterThan(0.78);
    // …and each line is whole inside its own slot: from the slot's left edge,
    // never past its right one, with its last word drawn (the right half's
    // line is as wide as the fit measured it, less its headroom).
    for (const [half, cols, s] of [["left", LEFT, split.type], ["right", RIGHT, slot]] as const) {
      const line = inkBox(long, hd(long, cols[0], cols[1] - (half === "left" ? 80 : 0), TYPE_ROWS[0], TYPE_ROWS[1]), isDark)!;
      const rect = ofRect(long, s.rect);
      expect(line.x0 - rect.x0 / k, `${half}: the line starts ${line.x0}`).toBeGreaterThanOrEqual(-1);
      expect(line.x1, `${half}: the line ends ${line.x1}`).toBeLessThanOrEqual(rect.x1 / k + tol(preset, 1));
    }
    const right = inkBox(long, hd(long, RIGHT[0], RIGHT[1], TYPE_ROWS[0], TYPE_ROWS[1]), isDark)!;
    expect(right.x1 - right.x0, `the right half's line is ${right.x1 - right.x0} px wide`).toBeGreaterThan((fit.widthPct ?? 0) * HD_W * 0.93);
  }, 240_000);

  it.each(PRESETS)("draws the set symbol on the left half's type bar only, its ink 48 px tall whatever the glyph — at %s", async (preset) => {
    const plain = await bake(splitCard(), preset);
    for (const code of ["mh2", "tsr"]) {
      const withSet = await bake(splitCard({ setIconCode: code }), preset);
      const symbol = diffBox(plain, withSet)!;
      // On the left half's type bar, its right edge where the cost's is.
      expect(symbol.x0, code).toBeGreaterThan(LEFT[0] + 500);
      expect(Math.abs(symbol.x1 - 1019), `${code}: the symbol ends at ${symbol.x1}`).toBeLessThanOrEqual(tol(preset, 6));
      expect(symbol.y0, code).toBeGreaterThanOrEqual(TYPE_ROWS[0] - 6);
      expect(symbol.y1, code).toBeLessThanOrEqual(TYPE_ROWS[1] + 6);
      // The default mark it replaces fills the same 48 px box: the diff's
      // height is the taller of the two — 48 px, a few px of antialiasing.
      expect(symbol.y1 - symbol.y0, `${code}: ${symbol.y1 - symbol.y0} px tall`).toBeGreaterThan(40);
      expect(symbol.y1 - symbol.y0, code).toBeLessThanOrEqual(52 + tol(preset, 0));
      // Nothing changes on the right half (TODO 3.9: it draws no symbol).
      expect(diffBox(plain, withSet, hd(plain, 1100, 2100, 0, 1500)), code).toBeNull();
    }
  }, 240_000);

  it.each(PRESETS)("centres each half's rules block in its box and starts its lines at the box's edge — at %s", async (preset) => {
    const r = await bake(splitCard(), preset);
    const k = r.w / HD_W;
    for (const [half, rect] of [["left", split.rules.rect], ["right", split.secondFace!.rules.rect]] as const) {
      const box = ofRect(r, rect);
      const text = inkBox(r, box, isDark)!;
      // The prints' lines start 17.7–18.3 px inside the paper: the rect's
      // own left edge (a glyph's side bearing in).
      expect(text.x0 - box.x0 / k, `${half}: the text starts ${text.x0}`).toBeGreaterThanOrEqual(-1);
      expect(text.x0 - box.x0 / k).toBeLessThanOrEqual(tol(preset, 8));
      // Two short lines, centred in the 499 px box (the prints' ink is
      // centred on 1178.5 px ± 2).
      const centre = (text.y0 + text.y1) / 2;
      expect(Math.abs(centre - (box.y0 + box.y1) / 2 / k), `${half}: the block's centre ${centre}`).toBeLessThanOrEqual(tol(preset, 8));
    }
  }, 120_000);

  it.each(PRESETS)("turns the artist credit down the left border and centres the brand mark in the 57 px bottom border — at %s", async (preset) => {
    const credited = await bake(splitCard({ artistCredit: "Deruchenko Alexander" }), preset);
    // The credit is the only light ink in the collector border (x < 149 px).
    const line = inkBox(credited, hd(credited, 0, 149, 0, 1500), isLight)!;
    expect(line).not.toBeNull();
    expect(line.x1).toBeLessThan(110);
    expect(Math.abs((line.x0 + line.x1) / 2 - 78)).toBeLessThanOrEqual(tol(preset, 4));
    expect(Math.abs(line.y0 - 98)).toBeLessThanOrEqual(tol(preset, 4));
    expect(line.y1 - line.y0).toBeGreaterThan((line.x1 - line.x0) * 5);
    // The 149 px collector border holds it (the left half's body starts there).
    expect(line.x1).toBeLessThan(149);
    const mark = diffBox(await bake(splitCard(), preset, false), await bake(splitCard(), preset, true))!;
    // The border is 1443–1500 px: the ink's centre on 1471.5.
    expect(mark.y0).toBeGreaterThanOrEqual(1443);
    expect(mark.y1).toBeLessThanOrEqual(1500);
    expect(Math.abs((mark.y0 + mark.y1) / 2 - 1471.5)).toBeLessThanOrEqual(tol(preset, 2));
    // Under the right half, inside its body (to 2035 px).
    expect(mark.x0).toBeGreaterThan(1115);
    expect(mark.x1).toBeLessThan(2035);
  }, 240_000);
});

// ---------------------------------------------------------------------------
// What only the REAL masters can show.
// ---------------------------------------------------------------------------
const REAL_KEYS = [...bucketKeysOf("battle"), ...bucketKeysOf("split")];
const haveReal = REAL_KEYS.length === 14 && haveBucketMasters(REAL_KEYS);

describe.skipIf(!haveReal)("layout v42 — on the real Card Conjurer masters (set FRAMES_BUILD_DIR if skipped)", () => {
  let served: ServedBucketMasters;
  beforeAll(() => {
    served = serveBucketMasters(REAL_KEYS);
  });
  afterAll(() => served.restore());

  const lum = (c: number[]) => 0.299 * c[0] + 0.587 * c[1] + 0.114 * c[2];

  it.each(["battle", "split"] as const)("%s: the brand mark and the turned artist credit sit on the master's black border — every pixel under them", async (template) => {
    const card = template === "battle" ? battleCard : splitCard;
    const bare = await bake(card({ artistCredit: "Probe Artist" }), "hd", false);
    const marked = await bake(card({ artistCredit: "Probe Artist" }), "hd", true);
    // The mark is what the brandMark flag adds; the credit is the light ink
    // down the left border.
    const mark = diffBox(bare, marked)!;
    const credit = inkBox(bare, hd(bare, 0, 140, 0, 1500), isLight)!;
    expect(mark).not.toBeNull();
    expect(credit).not.toBeNull();
    expect(credit.y1 - credit.y0).toBeGreaterThan(200);
    // The master itself, under each: opaque border black, every pixel, on
    // every colour (the MSE battle had no border at all).
    for (const key of ["w", "u", "b", "r", "g", "c", "m"]) {
      const { data, info } = await sharp(bucketMaster(`${template}/${key}.png`)!).ensureAlpha().raw().toBuffer({ resolveWithObject: true });
      expect([info.width, info.height]).toEqual([2100, 1500]);
      for (const [what, box] of [["the brand mark", mark], ["the artist credit", credit]] as const) {
        let off = 0;
        for (let y = Math.floor(box.y0); y < Math.ceil(box.y1); y += 1) {
          for (let x = Math.floor(box.x0); x < Math.ceil(box.x1); x += 1) {
            const i = (y * info.width + x) * 4;
            if (data[i + 3] !== 255 || data[i] + data[i + 1] + data[i + 2] > 24) off += 1;
          }
        }
        expect(off, `${what} on ${template}/${key}: px that are not border black`).toBe(0);
      }
    }
  }, 240_000);

  it("battle: the defense is a white digit on the black of the shield the master paints", async () => {
    const none = await bake(battleCard({ defense: null }), "hd");
    const five = await bake(battleCard({ defense: "5" }), "hd");
    const digit = diffBox(none, five)!;
    // The digit's whole box is black on the master (the shield's interior)…
    for (let y = Math.floor(digit.y0); y < Math.ceil(digit.y1); y += 1) {
      for (let x = Math.floor(digit.x0); x < Math.ceil(digit.x1); x += 1) expect(lum(px(none, x, y)), `${x},${y}`).toBeLessThan(40);
    }
    // …and the digit is white on it.
    expect(inkBox(five, { x0: digit.x0, x1: digit.x1, y0: digit.y0, y1: digit.y1 }, isLight)).not.toBeNull();
    // The shield is in the bake with no defense at all: silver rim pixels
    // inside the painted rect, on a battle that draws no value.
    const shield = ofRect(none, battle.defense!.paintedRect!);
    expect(inkBox(none, shield, (c) => sum(c) > 450)).not.toBeNull();
  }, 120_000);

  it("battle/c: the art shows through the translucent pill, type bar and text box as ONE picture; a colour master's are solid", async () => {
    const [red, blue] = [await flatArt([200, 30, 30]), await flatArt([30, 30, 200])];
    const text = "When this Siege enters, exile target nonland permanent.";
    const c = async (artUrl: string) => bake(battleCard({ colorIdentity: [], cost: "{5}", artUrl, rulesText: text }), "hd");
    const r = async (artUrl: string) => bake(battleCard({ artUrl, rulesText: text }), "hd");
    const [cRed, cBlue, rRed, rBlue] = [await c(red), await c(blue), await r(red), await r(blue)];
    // A spot inside each translucent part, clear of the text: the name
    // pill's right half (below the cost's row), the type bar's middle, the
    // text box's lower left.
    const spots = [
      [1500, 170],
      [1200, 962],
      [600, 1400],
    ] as const;
    for (const [x, y] of spots) {
      const [a, b] = [px(cRed, x, y), px(cBlue, x, y)];
      expect(Math.abs(a[0] - b[0]) + Math.abs(a[2] - b[2]), `c at ${x},${y}`).toBeGreaterThan(40);
      const [p, q] = [px(rRed, x, y), px(rBlue, x, y)];
      expect(Math.abs(p[0] - q[0]) + Math.abs(p[2] - q[2]), `r at ${x},${y}`).toBeLessThan(6);
    }
    // In the window itself both show the art.
    const [w1, w2] = [px(rRed, 1000, 500), px(rBlue, 1000, 500)];
    expect(Math.abs(w1[0] - w2[0]) + Math.abs(w1[2] - w2[2])).toBeGreaterThan(200);
    // ONE picture: a flat art leaves no seam where the window's crop meets
    // the art under the frame — the column through the text box's left edge
    // and the row through its bottom are the art's own colour on both sides
    // of the box's outline, through the see-through body.
    const sliver = px(cRed, 2030, 1410); // between the shield and the border
    expect(sliver[0]).toBeGreaterThan(150);
    expect(sliver[2]).toBeLessThan(80);
  }, 240_000);

  it("split: each half's window shows its own art, and nothing of the other's", async () => {
    const [red, blue] = [await flatArt([200, 30, 30]), await flatArt([30, 30, 200])];
    const r = await bake(splitCard({ artUrl: red }, { art_url: blue }), "hd");
    // The windows are 204–1017 and 1171–1983 × 239–795 px on the master.
    for (const [x, want] of [[300, "red"], [900, "red"], [1300, "blue"], [1900, "blue"]] as const) {
      const c = px(r, x, 500);
      if (want === "red") expect(c[0] - c[2], `x ${x}`).toBeGreaterThan(120);
      else expect(c[2] - c[0], `x ${x}`).toBeGreaterThan(120);
    }
    // The art fills each window to its edges: no #101015 strip inside it
    // (the MSE profile left 21 px of root at the top of both windows).
    for (const [x0, x1] of [[206, 1015], [1173, 1981]] as const) {
      for (const y of [241, 400, 793]) {
        for (const x of [x0, Math.round((x0 + x1) / 2), x1]) {
          const c = px(r, x, y);
          expect(Math.max(c[0], c[2]), `${x},${y}`).toBeGreaterThan(150);
        }
      }
    }
  }, 120_000);

  it.each(["battle", "split"] as const)("%s: a square (print) bake fills its four corners with the border's black", async (template) => {
    const card = template === "battle" ? battleCard() : splitCard();
    const res = await renderCardImage(card, "hd", { brandMark: false, watermarkText: null, corners: "square" });
    const { data, info } = await sharp(Buffer.from(await res.arrayBuffer())).ensureAlpha().raw().toBuffer({ resolveWithObject: true });
    for (const [x, y] of [[0, 0], [info.width - 1, 0], [0, info.height - 1], [info.width - 1, info.height - 1], [3, 3]] as const) {
      const i = (y * info.width + x) * 4;
      expect([data[i], data[i + 1], data[i + 2], data[i + 3]], `${template} ${x},${y}`).toEqual([0, 0, 0, 255]);
    }
  }, 120_000);
});
