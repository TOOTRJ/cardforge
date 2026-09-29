import sharp from "sharp";
import { beforeAll, describe, expect, it, vi } from "vitest";
import type { CardPreviewData } from "@/components/cards/card-preview";
import { SET_SYMBOL_BOX_PCT } from "@/lib/cards/typography";
import { getFrameProfile } from "@/lib/cards/template-layout";

// ---------------------------------------------------------------------------
// TODO 4.48 / 4.50 on REAL bakes, at HD and at the 750 px default: the
// full-art token prints its name, type line, set symbol, rules and P/T where
// the M20+ prints do — 63 prints measured on their Scryfall PNGs (1500 ×
// 2100, 2026-09-29; medians, HD px):
//   name baseline 190 (all heights);
//   type line: baseline 1797 / 1496 / 1261 (textless / regular / tall), from
//     x 129;
//   set symbol centred on 1775 / 1476 / 1241.5, right edge 92.13 %W;
//   P/T digits centred on y 1925, on M15's plate box (88.48 %H);
//   rules: ONE line centred on the box, two or more from its left; none on
//     the textless height (its `textless` flag keeps the type line).
// The masters live in the frames bucket (never in git): the bake is served a
// flat mid-grey card and a white plate, so the ink is the only mark. The
// preview half is tests/unit/components/m20-token-preview.test.tsx.
// ---------------------------------------------------------------------------

const stand = vi.hoisted(() => ({ grey: "", white: "", black: "" }));

vi.mock("@/lib/render/card-frames", async (importOriginal) => {
  const real = await importOriginal<typeof import("@/lib/render/card-frames")>();
  return {
    ...real,
    preloadFrame: async () => {},
    preloadFrameAssets: async () => {},
    getFrameDataUrl: () => stand.grey,
    getPlateDataUrlForPath: () => stand.white,
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
  stand.white = await solid(255, 64, 32);
  stand.black = await solid(0);
});

function token(template: string, over: Partial<CardPreviewData> = {}): CardPreviewData {
  return {
    title: "Soldier",
    cost: null,
    cardType: "token",
    supertype: "Creature",
    subtypes: ["Soldier"],
    rarity: "common",
    colorIdentity: ["white"],
    rulesText: "Flying",
    flavorText: null,
    power: "2",
    toughness: "2",
    loyalty: null,
    defense: null,
    artistCredit: null,
    artUrl: null,
    artPosition: {},
    frameStyle: { template, finish: "regular" },
    setIconUrl: stand.black,
    setIconCode: null,
    backFace: null,
    faceContent: null,
    watermark: null,
    ...over,
  } as unknown as CardPreviewData;
}

type Baked = { lum: Float32Array; w: number; h: number };

async function bake(card: CardPreviewData, preset: "hd" | "default"): Promise<Baked> {
  const { renderCardImage } = await import("@/lib/render/card-image");
  const png = Buffer.from(await (await renderCardImage(card, preset, { brandMark: false, watermarkText: null })).arrayBuffer());
  const { data, info } = await sharp(png).removeAlpha().raw().toBuffer({ resolveWithObject: true });
  const lum = new Float32Array(info.width * info.height);
  for (let i = 0; i < lum.length; i += 1) lum[i] = 0.299 * data[i * 3] + 0.587 * data[i * 3 + 1] + 0.114 * data[i * 3 + 2];
  return { lum, w: info.width, h: info.height };
}

type Box = { x0: number; y0: number; x1: number; y1: number };

function inkBox(b: Baked, area: Box, hit: (l: number) => boolean): Box | null {
  let x0 = Infinity;
  let y0 = Infinity;
  let x1 = -1;
  let y1 = -1;
  for (let y = Math.max(0, Math.floor(area.y0)); y < Math.min(b.h, area.y1); y += 1) {
    for (let x = Math.max(0, Math.floor(area.x0)); x < Math.min(b.w, area.x1); x += 1) {
      if (!hit(b.lum[y * b.w + x])) continue;
      x0 = Math.min(x0, x);
      y0 = Math.min(y0, y);
      x1 = Math.max(x1, x + 1);
      y1 = Math.max(y1, y + 1);
    }
  }
  return x1 < 0 ? null : { x0, y0, x1, y1 };
}

/** Rows of `area` holding ink, grouped into bands (a line of text each). */
function inkBands(b: Baked, area: Box, hit: (l: number) => boolean): { y0: number; y1: number; x0: number }[] {
  const bands: { y0: number; y1: number; x0: number }[] = [];
  for (let y = Math.floor(area.y0); y < area.y1; y += 1) {
    let x0 = -1;
    for (let x = Math.floor(area.x0); x < area.x1; x += 1) {
      if (hit(b.lum[y * b.w + x])) {
        x0 = x;
        break;
      }
    }
    if (x0 < 0) continue;
    const last = bands[bands.length - 1];
    if (last && y - last.y1 <= 2) {
      last.y1 = y + 1;
      last.x0 = Math.min(last.x0, x0);
    } else bands.push({ y0: y, y1: y + 1, x0 });
  }
  return bands;
}

const dark = (l: number) => l < 60;
const black = (l: number) => l < 8;
const light = (l: number) => l > 200;
const white = (l: number) => l > 250;

/** The prints' medians (HD px) per height — see the header. */
const PRINT = {
  m20token: { type: 1797, symbol: 1775 },
  m20tokentext: { type: 1496, symbol: 1476 },
  m20tokentall: { type: 1261, symbol: 1241.5 },
} as const;
const HEIGHT_OF: Record<string, keyof typeof PRINT> = {
  m20token: "m20token",
  m20tokenartifact: "m20token",
  m20tokentext: "m20tokentext",
  m20tokenartifacttext: "m20tokentext",
  m20tokentall: "m20tokentall",
  m20tokenartifacttall: "m20tokentall",
};
const PRESETS = [
  ["hd", 1],
  ["default", 0.5],
] as const;
const TEMPLATES = Object.keys(HEIGHT_OF);
const CASES = TEMPLATES.flatMap((t) => PRESETS.map(([p, s]) => [t, p, s] as const));
/** HD ±2, and ±1.5 of the 750 bake's own px (its whole-px rounding). */
const tol = (s: number) => (s === 1 ? 2 : 1.5);

function rulesArea(template: string, b: Baked): Box {
  const r = getFrameProfile(template).rules.rect;
  return {
    x0: (r.leftPct / 100) * b.w,
    x1: ((r.leftPct + r.widthPct) / 100) * b.w,
    y0: (r.topPct / 100) * b.h,
    y1: ((r.topPct + r.heightPct) / 100) * b.h,
  };
}

describe("the full-art token on real bakes (TODO 4.48 / 4.50)", () => {
  it.each(CASES)("%s @%s: the name, type line and set symbol where the M20 prints put them", async (template, preset, s) => {
    const b = await bake(token(template), preset);
    const at = PRINT[HEIGHT_OF[template]];
    // The name: dark on the plain white pill, white on an artifact's silver
    // one — its ink ends on the prints' baseline, 190 px ("Soldier": no
    // descender), centred on the card.
    const nameInk = template.includes("artifact") ? light : dark;
    const name = inkBox(b, { x0: 120 * s, x1: 1380 * s, y0: 100 * s, y1: 225 * s }, nameInk)!;
    expect(name, "name drawn").not.toBeNull();
    expect(Math.abs(name.y1 - 190 * s)).toBeLessThanOrEqual(tol(s));
    expect(Math.abs((name.x0 + name.x1) / 2 - 750 * s)).toBeLessThanOrEqual(3 * s + 1);
    // The type line: "Token" (no descender) from x 129, on the baseline.
    const word = inkBox(b, { x0: 115 * s, x1: 330 * s, y0: (at.type - 90) * s, y1: (at.type + 30) * s }, dark)!;
    expect(word, "type line drawn").not.toBeNull();
    expect(Math.abs(word.y1 - at.type * s)).toBeLessThanOrEqual(tol(s));
    expect(Math.abs(word.x0 - 129 * s)).toBeLessThanOrEqual(3 * s + 1);
    // An uploaded icon fills M15's 86 px box, right edge 92.13 %W, centred
    // where the prints centre their symbols.
    const icon = inkBox(b, { x0: 1150 * s, x1: b.w, y0: (at.symbol - 80) * s, y1: (at.symbol + 80) * s }, black)!;
    expect(icon, "symbol drawn").not.toBeNull();
    expect(Math.abs(icon.x1 - 0.9213 * b.w)).toBeLessThanOrEqual(1);
    expect(Math.abs(icon.x1 - icon.x0 - SET_SYMBOL_BOX_PCT * b.w)).toBeLessThanOrEqual(1);
    expect(Math.abs((icon.y0 + icon.y1) / 2 - at.symbol * s)).toBeLessThanOrEqual(s === 1 ? 1 : 1);
  }, 60_000);

  it.each(CASES)("%s @%s: the P/T on M15's plate box, the digits where the prints set them", async (template, preset, s) => {
    const b = await bake(token(template, { rulesText: null }), preset);
    const plate = getFrameProfile(template).pt!.plateRect!;
    const box = inkBox(b, { x0: 1000 * s, y0: 1780 * s, x1: 1500 * s, y1: 2100 * s }, white)!;
    expect(box, "plate drawn").not.toBeNull();
    expect(Math.abs(box.x0 - (plate.leftPct / 100) * b.w)).toBeLessThanOrEqual(1);
    expect(Math.abs(box.y0 - (plate.topPct / 100) * b.h)).toBeLessThanOrEqual(1);
    // The digits' ink box centres on the prints' 1290.5 × 1925 (63 prints),
    // 3.5 px above where M15's value box sets them.
    const digits = inkBox(b, { x0: 1150 * s, y0: 1870 * s, x1: 1420 * s, y1: 2000 * s }, dark)!;
    expect(digits, "digits drawn").not.toBeNull();
    expect(Math.abs((digits.y0 + digits.y1) / 2 - 1925 * s)).toBeLessThanOrEqual(s === 1 ? 2.5 : 1.5);
    expect(Math.abs((digits.x0 + digits.x1) / 2 - 1290.5 * s)).toBeLessThanOrEqual(s === 1 ? 2.5 : 1.5);
  }, 60_000);

  it.each(CASES)("%s @%s: rules — none without a box, ONE line centred, several from the left", async (template, preset, s) => {
    const one = await bake(token(template), preset);
    const textless = HEIGHT_OF[template] === "m20token";
    if (textless) {
      // The textless height draws no rules (the card keeps them): nothing
      // dark on the art between the name and the type pill.
      expect(inkBox(one, { x0: 100 * s, x1: 1400 * s, y0: 300 * s, y1: 1680 * s }, dark), "no rules").toBeNull();
      return;
    }
    const area = rulesArea(template, one);
    const plateTop = (getFrameProfile(template).pt!.plateRect!.topPct / 100) * one.h;
    const ink = inkBox(one, { ...area, y1: Math.min(area.y1, plateTop) }, dark)!;
    expect(ink, "rules drawn").not.toBeNull();
    // "Flying" centred on the box (the prints' single lines centre on x
    // ≈ 753 on 11 prints), in the box's middle.
    expect(Math.abs((ink.x0 + ink.x1) / 2 - 750 * s)).toBeLessThanOrEqual(4 * s + 1);
    expect(ink.x0).toBeGreaterThan(500 * s);
    const middle = (area.y0 + area.y1) / 2;
    expect(Math.abs((ink.y0 + ink.y1) / 2 - middle)).toBeLessThanOrEqual(20 * s);
    const text = "Flying\nVigilance\nWhenever this creature attacks, create a 1/1 white Soldier creature token.";
    const many = await bake(token(template, { rulesText: text, power: null, toughness: null }), preset);
    const bands = inkBands(many, rulesArea(template, many), dark);
    // Three paragraphs, the last wrapping (two lines in the regular box,
    // where the text steps down to fit; three at 76 px in the tall one).
    expect(bands.length, JSON.stringify(bands)).toBeGreaterThanOrEqual(4);
    for (const band of bands) {
      expect(band.x0).toBeGreaterThanOrEqual(129 * s - 1);
      expect(band.x0).toBeLessThanOrEqual(142 * s + 1);
    }
  }, 60_000);

  it.each(PRESETS)("names white on a dark pill, dark on the white one (@%s)", async (preset, s) => {
    for (const [template, colour, hit] of [
      ["m20token", "blue", light],
      ["m20tokentext", "black", light],
      ["m20tokentall", "white", dark],
      ["m20tokenartifact", "white", light],
    ] as const) {
      const b = await bake(token(template, { colorIdentity: [colour] }), preset);
      expect(inkBox(b, { x0: 400 * s, x1: 1100 * s, y0: 100 * s, y1: 225 * s }, hit), `${template} ${colour}`).not.toBeNull();
    }
  }, 60_000);
});
