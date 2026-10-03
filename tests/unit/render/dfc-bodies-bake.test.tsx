import sharp from "sharp";
import { beforeAll, describe, expect, it, vi } from "vitest";
import type { CardPreviewData } from "@/components/cards/card-preview";
import { COLOR_INDICATOR, COLOR_INDICATOR_FILLS } from "@/lib/cards/color-indicator";
import { backPreviewData, frontPreviewData } from "@/lib/cards/faces";
import { DFC_ICON_RIDER, DFC_REVERSE_PT, getFrameProfile } from "@/lib/cards/template-layout";
import { frameAssetPathsFor } from "@/lib/render/card-image";

// ---------------------------------------------------------------------------
// TODO 5.1a on REAL bakes, at HD and at the 750 px default: the transform
// bodies draw what the prints put on a face — the icon rider in the well
// (CC's bounds 5.94 / 5.05 / 7.34 × 5.24 %, keyed by the family's glyph for
// the face's role), the name from 16.7 %W on a face with the icon at the
// left (the prints' 249–252 px), the back's P/T in the front's grey tab in
// #777 ending where the prints' digits end (1389–1392 px) and only when the
// back prints one, no cost on a back, white name and type ink there, the
// colour-indicator dot (Ø 3.5 %W at 9.3 / 59.0 %, the type line from
// 13.4 %W) on a coloured back and none on a colourless one, the dark plate's
// white digits, and no P/T or dot on the land back. The masters live in the
// frames bucket (never in git): the bake is served a flat mid-grey card, a
// dark plate and a stand-in rider (a white square), so the text, the dot and
// the rider are the only marks on it. frameAssetPathsFor lists the rider and
// the dark plate for the face drawn, so Vercel's cold lambda preloads them.
// The preview half: tests/unit/components/dfc-bodies-preview.test.tsx.
// ---------------------------------------------------------------------------

const stand = vi.hoisted(() => ({ grey: "", plate: "", rider: "", black: "" }));

vi.mock("@/lib/render/card-frames", async (importOriginal) => {
  const real = await importOriginal<typeof import("@/lib/render/card-frames")>();
  return {
    ...real,
    preloadFrame: async () => {},
    preloadFrameAssets: async () => {},
    getFrameDataUrl: () => stand.grey,
    getPlateDataUrlForPath: () => stand.plate,
    getFrameOverlayDataUrl: () => stand.rider,
    getFrameAssetDataUrl: () => null,
  };
});

const BG = 128;

async function solid(v: number, w = 16, h = 16): Promise<string> {
  const png = await sharp({ create: { width: w, height: h, channels: 4, background: { r: v, g: v, b: v, alpha: 1 } } })
    .png()
    .toBuffer();
  return `data:image/png;base64,${png.toString("base64")}`;
}

beforeAll(async () => {
  stand.grey = await solid(BG);
  stand.plate = await solid(40, 64, 32);
  stand.rider = await solid(255, 32, 32);
  stand.black = await solid(0);
});

type Back = {
  title: string;
  cost: string;
  card_type: "creature" | "enchantment" | "land";
  supertype: string | null;
  subtypes: string[];
  rules_text: string;
  power: string | null;
  toughness: string | null;
  frame_style: { template: "m15dfcback" | "m15dfcbackleft" | "m15dfclandback" };
  color_identity: ("white" | "blue" | "black" | "red" | "green" | "colorless")[];
};
const BACK: Back = {
  title: "Insectile Aberration",
  cost: "",
  card_type: "creature",
  supertype: null,
  subtypes: ["Human", "Insect"],
  rules_text: "Flying",
  power: "3",
  toughness: "2",
  frame_style: { template: "m15dfcback" },
  color_identity: ["blue"],
};

function transform(over: Partial<CardPreviewData> = {}, back: Partial<Back> | null = {}): CardPreviewData {
  return {
    title: "HHHH",
    cost: "{U}",
    cardType: "creature",
    supertype: null,
    subtypes: ["Human", "Wizard"],
    rarity: "common",
    colorIdentity: ["blue"],
    rulesText: "Flying",
    flavorText: null,
    power: "1",
    toughness: "1",
    loyalty: null,
    defense: null,
    artistCredit: null,
    artUrl: null,
    artPosition: {},
    frameStyle: { template: "m15dfcfront", finish: "regular" },
    setIconUrl: stand.black,
    setIconCode: null,
    backFace: back === null ? null : { ...BACK, ...back },
    faceContent: null,
    watermark: null,
    ...over,
  } as unknown as CardPreviewData;
}

type Baked = { rgb: Buffer; lum: Float32Array; w: number; h: number };

async function bake(card: CardPreviewData, preset: "hd" | "default"): Promise<Baked> {
  const { renderCardImage } = await import("@/lib/render/card-image");
  const png = Buffer.from(await (await renderCardImage(card, preset, { brandMark: false, watermarkText: null })).arrayBuffer());
  const { data, info } = await sharp(png).removeAlpha().raw().toBuffer({ resolveWithObject: true });
  const lum = new Float32Array(info.width * info.height);
  for (let i = 0; i < lum.length; i += 1) lum[i] = 0.299 * data[i * 3] + 0.587 * data[i * 3 + 1] + 0.114 * data[i * 3 + 2];
  return { rgb: data, lum, w: info.width, h: info.height };
}

type Box = { x0: number; y0: number; x1: number; y1: number };

function inkBox(b: Baked, area: Box, hit: (l: number, i: number) => boolean): Box | null {
  let x0 = Infinity;
  let y0 = Infinity;
  let x1 = -1;
  let y1 = -1;
  for (let y = Math.max(0, Math.floor(area.y0)); y < Math.min(b.h, area.y1); y += 1) {
    for (let x = Math.max(0, Math.floor(area.x0)); x < Math.min(b.w, area.x1); x += 1) {
      const i = y * b.w + x;
      if (!hit(b.lum[i], i)) continue;
      x0 = Math.min(x0, x);
      y0 = Math.min(y0, y);
      x1 = Math.max(x1, x + 1);
      y1 = Math.max(y1, y + 1);
    }
  }
  return x1 < 0 ? null : { x0, y0, x1, y1 };
}

const dark = (l: number) => l < 60;
const white = (l: number) => l > 200;
/** The reverse P/T's grey (#777 = 119) against the mid-grey card (128):
 *  anti-aliased edges fall between — the solid ink. */
const reverseGrey = (l: number) => l < 123 && l > 100;

const PRESETS = [
  ["hd", 1],
  ["default", 0.5],
] as const;

const PCT = (b: Baked, xPct: number, yPct: number) => ({ x: (xPct / 100) * b.w, y: (yPct / 100) * b.h });
/** The left icon well's box (the name starts at 246 px, outside it). */
const WELL = (s: number): Box => ({ x0: 0, x1: 240 * s, y0: 0, y1: 300 * s });
/** The longest run of white pixels across the middle row of `rect`: the
 *  stand-in rider is a solid white square (110 px at HD), a name's letters
 *  are not. */
function whiteRun(b: Baked, rect: { topPct: number; leftPct: number; widthPct: number; heightPct: number }, s: number): number {
  const y = Math.round(((rect.topPct + rect.heightPct / 2) / 100) * b.h);
  let best = 0;
  let run = 0;
  for (let x = 0; x < 300 * s; x += 1) {
    run = white(b.lum[y * b.w + x]) ? run + 1 : 0;
    best = Math.max(best, run);
  }
  return best;
}

describe("the transform bodies on real bakes (TODO 5.1a)", () => {
  it("frameAssetPathsFor: the rider and the dark plate for the face drawn — the front's icon and M15's plate, the back's dark plate (no rider on the ▼ back), the 2016–22 back's rider", () => {
    const card = transform();
    const front = frontPreviewData(card);
    expect(frameAssetPathsFor(front)).toEqual(["/frames/m15/pt/u.png", "/frames/dfcicon/default.png"]);
    const back = backPreviewData(card)!;
    expect(frameAssetPathsFor(back)).toEqual(["/frames/m15dfcback/pt/u.png"]);
    const left = backPreviewData(transform({ frameStyle: { template: "m15dfcfront", finish: "regular", dfcIcon: "sunmoon" } }, { frame_style: { template: "m15dfcbackleft" } }))!;
    expect(frameAssetPathsFor(left)).toEqual(["/frames/m15dfcback/pt/u.png", "/frames/dfcicon/moon.png"]);
    // The front's rider follows the family: the sun for the sun / moon pair.
    const sunFront = frontPreviewData(transform({ frameStyle: { template: "m15dfcfront", finish: "regular", dfcIcon: "sunmoon" } }));
    expect(frameAssetPathsFor(sunFront)).toContain("/frames/dfcicon/sun.png");
    // A back that prints no P/T: no plate.
    const aura = backPreviewData(transform({}, { card_type: "enchantment", power: null, toughness: null, subtypes: ["Aura"] }))!;
    expect(frameAssetPathsFor(aura)).toEqual([]);
    // The land back: no plate for a creature-shaped back either (no slot).
    const landBack = backPreviewData(transform({ frameStyle: { template: "m15dfclandfront", finish: "regular" }, cardType: "land", cost: null }, { frame_style: { template: "m15dfclandback" } }))!;
    expect(frameAssetPathsFor(landBack)).toEqual([]);
  });

  it.each(PRESETS)("@%s: the front — the rider in CC's well bounds, the name from the prints' 249–252 px, the back's P/T in #777 ending at 1389–1392 px", async (preset, s) => {
    const b = await bake(frontPreviewData(transform()), preset);
    // The rider (a white stand-in square) fills the slot's rect exactly.
    const r = DFC_ICON_RIDER.rect;
    const rider = inkBox(b, WELL(s), white)!;
    expect(rider, "rider drawn").not.toBeNull();
    expect(Math.abs(rider.x0 - (r.leftPct / 100) * b.w)).toBeLessThanOrEqual(1);
    expect(Math.abs(rider.x1 - ((r.leftPct + r.widthPct) / 100) * b.w)).toBeLessThanOrEqual(1);
    expect(Math.abs(rider.y0 - (r.topPct / 100) * b.h)).toBeLessThanOrEqual(1);
    expect(Math.abs(rider.y1 - ((r.topPct + r.heightPct) / 100) * b.h)).toBeLessThanOrEqual(1);
    // The name: its first ink column at 249–252 px (HD) — the band starts at
    // 16.7 %W (250.5) and an H's stem has next to no side bearing.
    const name = inkBox(b, { x0: 230 * s, x1: 900 * s, y0: 100 * s, y1: 230 * s }, dark)!;
    expect(name, "name drawn").not.toBeNull();
    expect(name.x0 / s).toBeGreaterThanOrEqual(249 - 1 / s);
    expect(name.x0 / s).toBeLessThanOrEqual(252 + 1 / s);
    // The reverse P/T "3/2": grey, in the tab's rows (the prints' caps
    // 1782–1825), ending at 1389–1392.
    const slot = DFC_REVERSE_PT.rect;
    const tab = { x0: 1100 * s, x1: 1500 * s, y0: (slot.topPct / 100) * b.h - 20 * s, y1: ((slot.topPct + slot.heightPct) / 100) * b.h + 20 * s };
    const pt = inkBox(b, tab, reverseGrey)!;
    expect(pt, "reverse P/T drawn").not.toBeNull();
    expect(pt.x1 / s).toBeGreaterThanOrEqual(1389 - 1 / s);
    expect(pt.x1 / s).toBeLessThanOrEqual(1392 + 1 / s);
    expect(pt.y0 / s).toBeGreaterThanOrEqual(1770);
    expect(pt.y1 / s).toBeLessThanOrEqual(1840);
    // The cost is drawn on the front (a pip's dark ink at the band's right).
    const cost = inkBox(b, { x0: 1250 * s, x1: 1420 * s, y0: 100 * s, y1: 230 * s }, dark);
    expect(cost, "cost drawn").not.toBeNull();
  }, 90_000);

  it.each(PRESETS)("@%s: the tab prints EMPTY when the back prints no P/T (owner decision Q7), the rider still drawn", async (preset, s) => {
    const aura = transform({}, { card_type: "enchantment", power: null, toughness: null, subtypes: ["Aura"] });
    const b = await bake(frontPreviewData(aura), preset);
    const slot = DFC_REVERSE_PT.rect;
    const tab = { x0: 1100 * s, x1: 1500 * s, y0: (slot.topPct / 100) * b.h, y1: ((slot.topPct + slot.heightPct) / 100) * b.h };
    expect(inkBox(b, tab, reverseGrey)).toBeNull();
    expect(inkBox(b, WELL(s), white)).not.toBeNull();
    // …and with no back face at all (the creator before 5.2): the rider's
    // family is unknown, so nothing is drawn over the master's own ▲, and
    // no reverse P/T.
    const alone = await bake(frontPreviewData(transform({}, null)), preset);
    expect(inkBox(alone, WELL(s), white)).toBeNull();
    expect(inkBox(alone, tab, reverseGrey)).toBeNull();
  }, 90_000);

  it.each(PRESETS)("@%s: the ▼ back — no cost, white name from M15's 8.5 %%, the dot at 9.3 / 59.0 %% with the type line from 13.4 %%W, white digits on the dark plate, no rider", async (preset, s) => {
    const b = await bake(backPreviewData(transform({}, { title: "HHHH" }))!, preset);
    // No rider on the ▼ back (its ▼ is in the master): no solid white run
    // across the rider's rows at the left well (the white name's letters
    // have gaps); and no cost pips.
    expect(whiteRun(b, DFC_ICON_RIDER.rect, s)).toBeLessThan(60 * s);
    const name = inkBox(b, { x0: 100 * s, x1: 900 * s, y0: 100 * s, y1: 230 * s }, white)!;
    expect(name, "white name").not.toBeNull();
    expect(name.x0 / s).toBeGreaterThanOrEqual(126);
    expect(name.x0 / s).toBeLessThanOrEqual(136);
    expect(inkBox(b, { x0: 1100 * s, x1: 1420 * s, y0: 100 * s, y1: 230 * s }, dark)).toBeNull();
    // The dot: the blue fill (#0e68ab) centred on 9.3 / 59.0 %, Ø 3.5 %W;
    // its dark outline just outside.
    const blue = (_: number, i: number) => Math.abs(b.rgb[i * 3] - 14) < 30 && Math.abs(b.rgb[i * 3 + 1] - 104) < 30 && Math.abs(b.rgb[i * 3 + 2] - 171) < 30;
    const dot = inkBox(b, { x0: 60 * s, x1: 260 * s, y0: 1150 * s, y1: 1330 * s }, blue)!;
    expect(dot, "dot drawn").not.toBeNull();
    const centre = PCT(b, COLOR_INDICATOR.centre.xPct, COLOR_INDICATOR.centre.yPct);
    expect(Math.abs((dot.x0 + dot.x1) / 2 - centre.x)).toBeLessThanOrEqual(2);
    expect(Math.abs((dot.y0 + dot.y1) / 2 - centre.y)).toBeLessThanOrEqual(2);
    expect(Math.abs(dot.x1 - dot.x0 - (COLOR_INDICATOR.diameterPct / 100) * b.w)).toBeLessThanOrEqual(3);
    // The type line's white ink starts past the dot, at 13.4 %W (201 px) —
    // the prints' 200–204.
    const typeArea = { x0: 185 * s, x1: 900 * s, y0: 1190 * s, y1: 1300 * s };
    const type = inkBox(b, typeArea, white)!;
    expect(type, "type line").not.toBeNull();
    expect(type.x0 / s).toBeGreaterThanOrEqual(199);
    expect(type.x0 / s).toBeLessThanOrEqual(206);
    // The digits: white on the (stand-in) dark plate, in M15's digit box.
    const pt = getFrameProfile("m15dfcback").pt!;
    const digits = inkBox(b, { x0: (pt.rect.leftPct / 100) * b.w, x1: ((pt.rect.leftPct + pt.rect.widthPct) / 100) * b.w, y0: (pt.rect.topPct / 100) * b.h - 10 * s, y1: ((pt.rect.topPct + pt.rect.heightPct) / 100) * b.h + 10 * s }, white);
    expect(digits, "white digits").not.toBeNull();
    expect(getFrameProfile("m15dfcback").hideCost).toBe(true);
  }, 90_000);

  it.each(PRESETS)("@%s: the 2016–22 back draws the family's back glyph in its left well and the name from 16.7 %%W; a two-colour back splits the dot, first colour top-left", async (preset, s) => {
    const card = transform(
      { colorIdentity: ["white", "blue"], frameStyle: { template: "m15dfcfront", finish: "regular", dfcIcon: "sunmoon" } },
      { title: "HHHH", frame_style: { template: "m15dfcbackleft" }, color_identity: ["white", "blue"] },
    );
    const b = await bake(backPreviewData(card)!, preset);
    const r = DFC_ICON_RIDER.rect;
    const rider = inkBox(b, WELL(s), white)!;
    expect(rider, "rider drawn").not.toBeNull();
    expect(Math.abs(rider.x0 - (r.leftPct / 100) * b.w)).toBeLessThanOrEqual(1);
    const name = inkBox(b, { x0: 230 * s, x1: 900 * s, y0: 100 * s, y1: 230 * s }, white)!;
    expect(name.x0 / s).toBeGreaterThanOrEqual(249 - 1 / s);
    expect(name.x0 / s).toBeLessThanOrEqual(252 + 1 / s);
    // White top-left, blue bottom-right.
    const centre = PCT(b, COLOR_INDICATOR.centre.xPct, COLOR_INDICATOR.centre.yPct);
    const off = (COLOR_INDICATOR.diameterPct / 100) * b.w * 0.25;
    const at = (dx: number, dy: number) => {
      const i = Math.round(centre.y + dy) * b.w + Math.round(centre.x + dx);
      return [b.rgb[i * 3], b.rgb[i * 3 + 1], b.rgb[i * 3 + 2]];
    };
    const [wr, wg, wb] = at(-off, -off);
    expect(wr).toBeGreaterThan(230);
    expect(wg).toBeGreaterThan(230);
    expect(wb).toBeGreaterThan(220);
    const [br, bg, bb] = at(off, off);
    expect(Math.abs(br - 14)).toBeLessThan(30);
    expect(Math.abs(bg - 104)).toBeLessThan(30);
    expect(Math.abs(bb - 171)).toBeLessThan(30);
    expect(COLOR_INDICATOR_FILLS.white).toBe("#f9faf4");
  }, 90_000);

  it.each(PRESETS)("@%s: a colourless (artifact stand-in) back draws no dot; the land back no P/T, no dot and dark band ink", async (preset, s) => {
    const colourless = backPreviewData(transform({ colorIdentity: ["colorless"] }, { title: "HHHH", color_identity: ["colorless"], supertype: "Artifact" }))!;
    const c = await bake(colourless, preset);
    expect(inkBox(c, { x0: 60 * s, x1: 260 * s, y0: 1150 * s, y1: 1330 * s }, (l) => l < 30)).toBeNull();
    const typeC = inkBox(c, { x0: 100 * s, x1: 900 * s, y0: 1190 * s, y1: 1300 * s }, white)!;
    // No indent without the dot: the type line from M15's 8.5 %.
    expect(typeC.x0 / s).toBeLessThan(150);
    const land = transform(
      { frameStyle: { template: "m15dfclandfront", finish: "regular" }, cardType: "land", cost: null, subtypes: [] },
      { title: "HHHH", card_type: "land", power: "9", toughness: "7", frame_style: { template: "m15dfclandback" } },
    );
    const l = await bake(backPreviewData(land)!, preset);
    const pt = getFrameProfile("m15dfcback").pt!;
    expect(inkBox(l, { x0: (pt.plateRect!.leftPct / 100) * l.w, x1: l.w, y0: (pt.plateRect!.topPct / 100) * l.h, y1: l.h }, white)).toBeNull();
    expect(inkBox(l, { x0: 60 * s, x1: 260 * s, y0: 1150 * s, y1: 1330 * s }, (lum) => lum < 30)).toBeNull();
    // Dark name ink on the land back (FIN #31's light bars).
    expect(inkBox(l, { x0: 100 * s, x1: 900 * s, y0: 100 * s, y1: 230 * s }, dark)).not.toBeNull();
    expect(inkBox(l, { x0: 100 * s, x1: 900 * s, y0: 100 * s, y1: 230 * s }, white)).toBeNull();
    // …and the land front's tab prints the creature back's 9/7.
    const front = await bake(frontPreviewData(transform({ frameStyle: { template: "m15dfclandfront", finish: "regular" }, cardType: "land", cost: null }, { power: "9", toughness: "7" })), preset);
    const slot = DFC_REVERSE_PT.rect;
    expect(inkBox(front, { x0: 1100 * s, x1: 1500 * s, y0: (slot.topPct / 100) * front.h, y1: ((slot.topPct + slot.heightPct) / 100) * front.h }, reverseGrey)).not.toBeNull();
  }, 120_000);
});
