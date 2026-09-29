import sharp from "sharp";
import { beforeAll, describe, expect, it, vi } from "vitest";
import type { CardPreviewData } from "@/components/cards/card-preview";
import { plateInkRect } from "@/lib/cards/plate-ink";
import { SET_SYMBOL_BOX_PCT } from "@/lib/cards/typography";
import { getFrameProfile } from "@/lib/cards/template-layout";

// ---------------------------------------------------------------------------
// TODO 4.49 (a) + (d) on REAL bakes, at HD and at the 750 px default: the
// 2014–19 token frames (m15token / m15tokenartifact) print the P/T on M15's
// plate, the type line left-aligned from 8.54 %W, and the set symbol
// right-anchored at 92.13 %W, centred on 84.39 %H — where the prints put
// them (TDOM #3, TM19 #6, TBFZ #1, TKLD #2, TC18 #7 …; Scryfall PNGs at
// 1500 × 2100). Until layout v33 the value sat on the band's edge with no
// plate (MSE's 88.6–94.8 %H rect: the digits ran into the black border) and
// the type line and symbol were centred together.
//
// The masters live in the frames bucket (never in git): the bake is served a
// flat mid-grey card and a WHITE plate, so the plate, the dark digits, the
// dark type line and an uploaded BLACK icon are the only marks in their
// bands. The preview half is pinned in
// tests/unit/components/token-frame-preview.test.tsx.
// ---------------------------------------------------------------------------

const stand = vi.hoisted(() => ({ grey: "", white: "", black: "", plates: [] as string[] }));

vi.mock("@/lib/render/card-frames", async (importOriginal) => {
  const real = await importOriginal<typeof import("@/lib/render/card-frames")>();
  return {
    ...real,
    preloadFrame: async () => {},
    preloadFrameAssets: async () => {},
    getFrameDataUrl: () => stand.grey,
    getPlateDataUrlForPath: (pathTemplate: string, colorKey: string) => {
      stand.plates.push(real.plateAssetPath(pathTemplate, colorKey));
      return stand.white;
    },
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
    rulesText: null,
    flavorText: null,
    power: "1",
    toughness: "1",
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

/** Bounding box (px, x1/y1 exclusive) of the pixels in [x0,x1)×[y0,y1) that
 *  pass `hit`, or null. */
function inkBox(b: Baked, area: Box, hit: (l: number) => boolean): Box | null {
  let x0 = Infinity;
  let y0 = Infinity;
  let x1 = -1;
  let y1 = -1;
  for (let y = Math.max(0, area.y0); y < Math.min(b.h, area.y1); y += 1) {
    for (let x = Math.max(0, area.x0); x < Math.min(b.w, area.x1); x += 1) {
      if (!hit(b.lum[y * b.w + x])) continue;
      x0 = Math.min(x0, x);
      y0 = Math.min(y0, y);
      x1 = Math.max(x1, x + 1);
      y1 = Math.max(y1, y + 1);
    }
  }
  return x1 < 0 ? null : { x0, y0, x1, y1 };
}

const dark = (l: number) => l < 60;
/** The uploaded icon's pure black, darker than the type line's ink
 *  (INK_DARK, luminance ≈ 19). */
const black = (l: number) => l < 8;
const white = (l: number) => l > 200;

const TEMPLATES = ["m15token", "m15tokenartifact"] as const;
const PRESETS = [
  ["hd", 1],
  ["default", 0.5],
] as const;

describe("2014–19 token frame on real bakes (TODO 4.49 (a) + (d))", () => {
  it.each(TEMPLATES.flatMap((t) => PRESETS.map(([p, s]) => [t, p, s] as const)))(
    "%s @%s: the P/T sits on M15's plate, where the prints put it",
    async (template, preset, s) => {
      const b = await bake(token(template, { power: "10", toughness: "10" }), preset);
      const pt = getFrameProfile(template).pt!;
      const plate = pt.plateRect!;
      // The plate: drawn over exactly CC's box (75.73 / 88.48 / 18.8 × 7.33 %).
      const box = inkBox(b, { x0: 1000 * s, y0: 1780 * s, x1: 1500 * s, y1: 2100 * s }, white)!;
      expect(box, "plate drawn").not.toBeNull();
      expect(Math.abs(box.x0 - (plate.leftPct / 100) * b.w)).toBeLessThanOrEqual(1);
      expect(Math.abs(box.x1 - ((plate.leftPct + plate.widthPct) / 100) * b.w)).toBeLessThanOrEqual(1);
      expect(Math.abs(box.y0 - (plate.topPct / 100) * b.h)).toBeLessThanOrEqual(1);
      expect(Math.abs(box.y1 - ((plate.topPct + plate.heightPct) / 100) * b.h)).toBeLessThanOrEqual(1);
      // The digits: dark ink on the plate's face, centred where fifteen
      // 2014–19 token prints centre theirs (1291 × 1930 px at HD, ±3).
      const digits = inkBox(b, box, dark)!;
      expect(digits, "digits drawn").not.toBeNull();
      expect(Math.abs((digits.x0 + digits.x1) / 2 - 1291 * s)).toBeLessThanOrEqual(3 * s + 0.5);
      expect(Math.abs((digits.y0 + digits.y1) / 2 - 1930 * s)).toBeLessThanOrEqual(3 * s + 0.5);
      // …inside the face's ink span and the plate master's body (its ink,
      // lib/cards/plate-ink.ts), not on the band's edge: the old slot's
      // digits ran into the black border at ~1948 px, off any plate.
      expect(digits.x0).toBeGreaterThanOrEqual((pt.inkSpanPct!.leftPct / 100) * b.w - 1);
      expect(digits.x1).toBeLessThanOrEqual((pt.inkSpanPct!.rightPct / 100) * b.w + 1);
      const body = plateInkRect(pt.plateAssetPathTemplate!, plate)!;
      expect(digits.y0).toBeGreaterThan((body.topPct / 100) * b.h);
      expect(digits.y1).toBeLessThan(((body.topPct + body.heightPct) / 100) * b.h);
    },
    60_000,
  );

  it("draws M15's plates: the colour's on the token, the artifact set on the artifact token", async () => {
    stand.plates.length = 0;
    await bake(token("m15token", { colorIdentity: ["blue"] }), "default");
    await bake(token("m15tokenartifact", { colorIdentity: [] }), "default");
    await bake(token("m15tokenartifact", { colorIdentity: ["blue"] }), "default");
    expect(stand.plates).toEqual(["/frames/m15/pt/u.png", "/frames/m15artifact/pt/c.png", "/frames/m15artifact/pt/u.png"]);
  }, 60_000);

  it("draws no plate on a token with no P/T (a Treasure)", async () => {
    const b = await bake(token("m15tokenartifact", { power: null, toughness: null, colorIdentity: [] }), "hd");
    expect(inkBox(b, { x0: 1000, y0: 1780, x1: 1500, y1: 2100 }, white)).toBeNull();
  }, 60_000);

  it.each(TEMPLATES.flatMap((t) => PRESETS.map(([p, s]) => [t, p, s] as const)))(
    "%s @%s: the type line starts at x 8.54 and the symbol is right-anchored at x 92.13, centred on y 84.39 (card percent)",
    async (template, preset, s) => {
      const b = await bake(token(template, { supertype: "Token Creature", cardType: null }), preset);
      const p = getFrameProfile(template);
      const band = p.type.rect;
      const y0 = Math.floor((band.topPct / 100) * b.h) - 10 * s;
      const y1 = Math.ceil(((band.topPct + band.heightPct) / 100) * b.h) + 10 * s;
      // The type line: its first ink (the T's stem, a few px of side bearing
      // in) at 8.54 %W — 128 px at HD; the prints' T starts at 122–126.
      const line = inkBox(b, { x0: 0, y0, x1: 1150 * s, y1 }, dark)!;
      expect(line, "type line drawn").not.toBeNull();
      const left = (band.leftPct / 100) * b.w;
      expect(line.x0).toBeGreaterThanOrEqual(left - 1);
      expect(line.x0).toBeLessThanOrEqual(left + 4 * s);
      // The symbol: an uploaded icon fills M15's 86 px box, its right edge on
      // 92.13 %W and its centre on 84.39 %H (the TDOM #3 print: DOM's ink at
      // 1315–1382 px).
      const icon = inkBox(b, { x0: 1150 * s, y0, x1: b.w, y1 }, black)!;
      expect(icon, "symbol drawn").not.toBeNull();
      const side = SET_SYMBOL_BOX_PCT * b.w;
      expect(Math.abs(icon.x1 - 0.9213 * b.w)).toBeLessThanOrEqual(1);
      expect(Math.abs(icon.x1 - icon.x0 - side)).toBeLessThanOrEqual(1);
      expect(Math.abs((icon.y0 + icon.y1) / 2 - 0.8439 * b.h)).toBeLessThanOrEqual(1);
      expect(Math.abs(icon.y1 - icon.y0 - side)).toBeLessThanOrEqual(1);
      // …and the line stays clear of it.
      expect(line.x1).toBeLessThan(icon.x0);
    },
    60_000,
  );

  it("shrinks a long type line to end the print's gap before the symbol, not under it", async () => {
    const card = (supertype: string) => token("m15token", { supertype, cardType: null, subtypes: ["Construct"] });
    const band = getFrameProfile("m15token").type.rect;
    const y0 = Math.floor((band.topPct / 100) * 2100) - 10;
    const y1 = Math.ceil(((band.topPct + band.heightPct) / 100) * 2100) + 10;
    // At the full 68 px it would run ~1,470 px, past the symbol.
    const long = await bake(card("Token Legendary Artifact Creature"), "hd");
    const icon = inkBox(long, { x0: 1150, y0, x1: 1500, y1 }, black)!;
    const line = inkBox(long, { x0: 0, y0, x1: 1500, y1 }, (l) => l >= 8 && l < 60)!;
    // Shrunk from 8.54 %W into the measured room, which ends 19.5 px
    // (1.3 %W) short of the icon; the measure is an upper bound (advances
    // rounded up, 1.5 % headroom), so the ink ends a little earlier.
    expect(line.x0).toBeLessThanOrEqual(132);
    expect(line.x1).toBeLessThanOrEqual(icon.x0 - 19);
    expect(line.x1).toBeGreaterThan(icon.x0 - 19 - 0.1 * (icon.x0 - 19 - 128));
  }, 60_000);
});
