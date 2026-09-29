import sharp from "sharp";
import { beforeAll, describe, expect, it, vi } from "vitest";
import type { CardPreviewData } from "@/components/cards/card-preview";
import { SET_SYMBOL_BOX_PCT } from "@/lib/cards/typography";
import { getFrameProfile } from "@/lib/cards/template-layout";

// ---------------------------------------------------------------------------
// TODO 4.49 (b) on REAL bakes, at HD and at the 750 px default: the 2014–19
// text-box token (m15tokentext / m15tokenartifacttext) prints its rules in
// dark ink in the box below the pill — ONE line centred (TDOM #2 "Vigilance",
// TM19 #1), two or more from the box's left (TWAR #6, TXLN #7) — with no
// scrim, the type line on the prints' 1500 px baseline and the set symbol
// centred on the re-cut pill (70.48 %H). The masters live in the frames
// bucket (never in git): the bake is served a flat mid-grey card and a white
// plate, so the dark text is the only mark in the box. The preview half is
// pinned in tests/unit/components/token-text-box-preview.test.tsx.
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
    title: "Knight",
    cost: null,
    cardType: "token",
    supertype: "Creature",
    subtypes: ["Knight"],
    rarity: "common",
    colorIdentity: ["white"],
    rulesText: "Vigilance",
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
const PRESETS = [
  ["hd", 1],
  ["default", 0.5],
] as const;
const TEMPLATES = ["m15tokentext", "m15tokenartifacttext"] as const;
const CASES = TEMPLATES.flatMap((t) => PRESETS.map(([p, s]) => [t, p, s] as const));

/** The rules rect in px, the P/T plate's corner left out (its digits are dark too). */
function rulesArea(template: string, b: Baked): Box {
  const r = getFrameProfile(template).rules.rect;
  return {
    x0: (r.leftPct / 100) * b.w,
    x1: ((r.leftPct + r.widthPct) / 100) * b.w,
    y0: (r.topPct / 100) * b.h,
    y1: ((r.topPct + r.heightPct) / 100) * b.h,
  };
}

describe("the 2014–19 text-box token on real bakes (TODO 4.49 (b))", () => {
  it.each(CASES)("%s @%s: ONE line of rules is centred in the box, in dark ink, on no scrim", async (template, preset, s) => {
    const b = await bake(token(template), preset);
    const area = rulesArea(template, b);
    const plateTop = (getFrameProfile(template).pt!.plateRect!.topPct / 100) * b.h;
    const ink = inkBox(b, { ...area, y1: Math.min(area.y1, plateTop) }, dark)!;
    expect(ink, "rules drawn").not.toBeNull();
    // Centred on the box: "Vigilance" centres at 750 px (the prints' TDOM #2
    // at 752, TM19 #1 at 752.5), not from the box's left (≈ 131).
    const centre = (ink.x0 + ink.x1) / 2;
    expect(Math.abs(centre - 750 * s)).toBeLessThanOrEqual(3 * s + 1);
    expect(ink.x0).toBeGreaterThan(500 * s);
    // …and centred in the box vertically (the prints' ink 1719–1783).
    expect(Math.abs((ink.y0 + ink.y1) / 2 - 1750 * s)).toBeLessThanOrEqual(8 * s + 1);
    // No scrim: the box beside the text is the frame's own grey.
    for (const x of [200, 400, 1100, 1300]) {
      expect(b.lum[Math.round(1640 * s) * b.w + Math.round(x * s)], `x ${x}`).toBeCloseTo(BG, 0);
    }
  }, 60_000);

  it.each(CASES)("%s @%s: five lines start at the box's left, one below the other", async (template, preset, s) => {
    const text = "Flying\nVigilance\nLifelink\nWhenever this creature attacks, create a 1/1 white Soldier creature token.";
    const b = await bake(token(template, { rulesText: text, power: null, toughness: null }), preset);
    const bands = inkBands(b, rulesArea(template, b), dark);
    expect(bands).toHaveLength(5);
    // Every line from the box's left + its 2 px padding (131 px at HD; the
    // prints' multi-line ink from x 130–132), within its first glyph's bearing.
    for (const band of bands) {
      expect(band.x0).toBeGreaterThanOrEqual(129 * s - 1);
      expect(band.x0).toBeLessThanOrEqual(142 * s + 1);
    }
  }, 60_000);

  it.each(CASES)("%s @%s: the type line on the prints' baseline, the symbol centred on the re-cut pill", async (template, preset, s) => {
    const b = await bake(token(template), preset);
    // "Token" (no descender): its ink ends on the baseline — 1500 px at HD
    // (twelve text-box prints: 1498–1505, mean 1501.6), ±3.
    const word = inkBox(b, { x0: 120 * s, x1: 330 * s, y0: 1400 * s, y1: 1560 * s }, dark)!;
    expect(word, "type line drawn").not.toBeNull();
    expect(Math.abs(word.y1 - 1500 * s)).toBeLessThanOrEqual(3 * s + 0.5);
    expect(word.x0).toBeGreaterThanOrEqual(126 * s - 1);
    expect(word.x0).toBeLessThanOrEqual(132 * s + 1);
    // An uploaded icon fills M15's 86 px box, right edge 92.13 %W, centred
    // on 70.48 %H (CC's 67.43 moved down with the band).
    const icon = inkBox(b, { x0: 1150 * s, x1: b.w, y0: 1400 * s, y1: 1560 * s }, black)!;
    expect(icon, "symbol drawn").not.toBeNull();
    const side = SET_SYMBOL_BOX_PCT * b.w;
    expect(Math.abs(icon.x1 - 0.9213 * b.w)).toBeLessThanOrEqual(1);
    expect(Math.abs(icon.x1 - icon.x0 - side)).toBeLessThanOrEqual(1);
    expect(Math.abs((icon.y0 + icon.y1) / 2 - 0.7048 * b.h)).toBeLessThanOrEqual(1);
  }, 60_000);
});
