import { readFileSync } from "node:fs";
import { join } from "node:path";
import fontkit from "@pdf-lib/fontkit";
import sharp from "sharp";
import { beforeAll, describe, expect, it, vi } from "vitest";
import type { CardPreviewData } from "@/components/cards/card-preview";
import { displayLine } from "@/lib/cards/card-display";
import { SET_SYMBOL_BOX_PCT, TITLE_SIZE_PCT } from "@/lib/cards/typography";
import { getFrameProfile } from "@/lib/cards/template-layout";

// ---------------------------------------------------------------------------
// TODO 4.52 on REAL bakes, at HD and at the 750 px default: the emblem frame
// prints the source's name white on the title bar at the prints' baseline,
// "Emblem" on the type bar at theirs, ONE rules line centred where the prints
// centre it and two or more from the box's left, the set symbol in CC's box,
// and no cost or P/T whatever the card holds. The print numbers are Scryfall
// PNGs of TFDN #24 / #25, TBLB #30, TDSK #17 and TFRA #16 at 1500 × 2100
// (HD px): name ink ends 189, "Emblem" 1495, one line's ink 1715–1780
// centred at 751–753, two lines from x 132. The master lives in the frames
// bucket (never in git): the bake is served a flat mid-grey card and a white
// plate, so the text is the only mark on it. The preview half:
// tests/unit/components/emblem-preview.test.tsx.
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

function emblem(over: Partial<CardPreviewData> = {}): CardPreviewData {
  return {
    title: "Kaito, Bane of Nightmares",
    cost: null,
    cardType: "emblem",
    supertype: null,
    subtypes: [],
    rarity: "common",
    colorIdentity: ["colorless"],
    rulesText: "Ninjas you control get +1/+1.",
    flavorText: null,
    power: null,
    toughness: null,
    loyalty: null,
    defense: null,
    artistCredit: null,
    artUrl: null,
    artPosition: {},
    frameStyle: { template: "emblem", finish: "regular" },
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

/** The last row of `area` whose ink count is at least `frac` of the fullest
 *  row's — a line's baseline, past the anti-aliased fringe (the prints were
 *  measured the same way, at 30 %). */
function lastSolidRow(b: Baked, area: Box, hit: (l: number) => boolean, frac = 0.3): number {
  const counts: number[] = [];
  for (let y = Math.floor(area.y0); y < area.y1; y += 1) {
    let n = 0;
    for (let x = Math.floor(area.x0); x < area.x1; x += 1) if (hit(b.lum[y * b.w + x])) n += 1;
    counts.push(n);
  }
  const max = Math.max(...counts);
  let last = -1;
  counts.forEach((n, i) => {
    if (n >= max * frac) last = i;
  });
  return Math.floor(area.y0) + last;
}

const dark = (l: number) => l < 60;
const black = (l: number) => l < 8;
const white = (l: number) => l > 200;

const PRESETS = [
  ["hd", 1],
  ["default", 0.5],
] as const;

/** The rules box in px. */
function rulesArea(b: Baked): Box {
  const r = getFrameProfile("emblem").rules.rect;
  return {
    x0: (r.leftPct / 100) * b.w,
    x1: ((r.leftPct + r.widthPct) / 100) * b.w,
    y0: (r.topPct / 100) * b.h,
    y1: ((r.topPct + r.heightPct) / 100) * b.h,
  };
}

describe("the emblem frame on real bakes (TODO 4.52)", () => {
  it.each(PRESETS)("@%s: the name white and centred on the bar, on the prints' baseline", async (preset, s) => {
    const b = await bake(emblem({ title: "EMBLEM" }), preset);
    // A flat-bottomed probe: its last solid row is the baseline — the
    // prints' name ink ends at 189 px at HD on all five, ±2.
    const area = { x0: 150 * s, x1: 1350 * s, y0: 100 * s, y1: 240 * s };
    const name = inkBox(b, area, white)!;
    expect(name, "name drawn").not.toBeNull();
    expect(Math.abs(lastSolidRow(b, area, white) - 189 * s)).toBeLessThanOrEqual(2 * s + 0.5);
    expect(Math.abs((name.x0 + name.x1) / 2 - 750 * s)).toBeLessThanOrEqual(3 * s + 1);
  }, 60_000);

  it.each(PRESETS)("@%s: \"Emblem\" on the type bar, from 8.54 %%W, on the prints' baseline; the symbol in CC's box", async (preset, s) => {
    const b = await bake(emblem(), preset);
    // "Emblem" (no descender): its ink ends 1495 on the prints, ±2.
    const typeArea = { x0: 110 * s, x1: 700 * s, y0: 1420 * s, y1: 1530 * s };
    const word = inkBox(b, typeArea, dark)!;
    expect(word, "type line drawn").not.toBeNull();
    expect(Math.abs(lastSolidRow(b, typeArea, dark) - 1495 * s)).toBeLessThanOrEqual(2 * s + 0.5);
    // The prints' "E" starts at 133–134 px.
    expect(Math.abs(word.x0 - 133 * s)).toBeLessThanOrEqual(3 * s + 0.5);
    // "Emblem" is one word ~230 px wide — no supertype, no "Token".
    expect(word.x1 - word.x0).toBeLessThan(260 * s);
    // An uploaded icon fills M15's 86 px box: right edge 92.13 %W, centred
    // on 70.43 %H (CC's setSymbolBounds; the FDN print's symbol 1483.5).
    const icon = inkBox(b, { x0: 1150 * s, x1: b.w, y0: 1400 * s, y1: 1560 * s }, black)!;
    expect(icon, "symbol drawn").not.toBeNull();
    const side = SET_SYMBOL_BOX_PCT * b.w;
    expect(Math.abs(icon.x1 - 0.9213 * b.w)).toBeLessThanOrEqual(1);
    expect(Math.abs(icon.x1 - icon.x0 - side)).toBeLessThanOrEqual(1);
    expect(Math.abs((icon.y0 + icon.y1) / 2 - 0.7043 * b.h)).toBeLessThanOrEqual(1);
  }, 60_000);

  it.each(PRESETS)("@%s: ONE line of rules centred where the prints centre it (TDSK #17)", async (preset, s) => {
    const b = await bake(emblem(), preset);
    const ink = inkBox(b, rulesArea(b), dark)!;
    expect(ink, "rules drawn").not.toBeNull();
    // TDSK #17 "Ninjas you control get +1/+1.": ink x 263–1239, 1715–1780.
    expect(Math.abs((ink.x0 + ink.x1) / 2 - 751 * s)).toBeLessThanOrEqual(4 * s + 1);
    expect(Math.abs(ink.y0 - 1715 * s)).toBeLessThanOrEqual(3 * s + 0.5);
    expect(Math.abs(ink.y1 - 1780 * s)).toBeLessThanOrEqual(3 * s + 0.5);
  }, 60_000);

  it.each(PRESETS)("@%s: two or more lines start at the box's left (TBLB #30, TFDN #24)", async (preset, s) => {
    const kaito = "Whenever a player casts a spell, you create a 2/1 blue Ninja creature token.";
    const b = await bake(emblem({ title: "Kaito, Cunning Infiltrator", rulesText: kaito }), preset);
    const bands = inkBands(b, rulesArea(b), dark);
    // The print's three lines: 1640–1706, 1715–1778, 1788–1839.
    expect(bands).toHaveLength(3);
    for (const [band, top] of bands.map((band, i) => [band, [1640, 1715, 1788][i]] as const)) {
      expect(Math.abs(band.y0 - top * s), `line at ${top}`).toBeLessThanOrEqual(3 * s + 0.5);
      // From the box's left + its 2 px (the prints' ink from x 131–133).
      expect(band.x0).toBeGreaterThanOrEqual(129 * s - 1);
      expect(band.x0).toBeLessThanOrEqual(137 * s + 1);
    }
  }, 60_000);

  it.each(PRESETS)("@%s: no cost pips and no P/T plate, whatever the card holds", async (preset, s) => {
    const b = await bake(emblem({ cost: "{2}{U}{U}", power: "2", toughness: "1" }), preset);
    // The title bar right of the name and the corner where a plate would sit
    // stay the flat stand-in: nothing is drawn there.
    const pips = inkBox(b, { x0: 1250 * s, x1: 1440 * s, y0: 100 * s, y1: 230 * s }, (l) => Math.abs(l - BG) > 20);
    expect(pips, "no cost").toBeNull();
    const plate = inkBox(b, { x0: 1100 * s, x1: 1440 * s, y0: 1800 * s, y1: 1990 * s }, white);
    expect(plate, "no P/T plate").toBeNull();
  }, 60_000);
});

// ---------------------------------------------------------------------------
// A CENTRED display line sits where the browser centres it (alignedText in
// lib/render/card-image.tsx): Satori sizes the text node from each glyph's
// own advance but draws the run kerned, so without the bake's negative
// margin a centred band centred a box wider than the ink and the line sat
// HALF ITS KERNING left of the preview's (20 px on an HD "Astronomy Tower"
// token name). The browser centres the KERNED advance box: the ink spans
// lsb(first glyph) … advance − rsb(last glyph), on the band's centre. Pinned
// on the git "alphatoken" frame until TODO 4.54 retired it; here on the
// emblem's centred name (the token frames centre theirs the same way, on
// the same slot fields). No code profile centres a TYPE line any more — the
// retired frame's was the only one — so that half of alignedText (the room
// left beside an inline set symbol) has no bake to pin until one does.
// ---------------------------------------------------------------------------

describe("a centred display line (bake): the emblem's name", () => {
  const W = 1500;
  const beleren = fontkit.create(readFileSync(join(process.cwd(), "public/fonts/Beleren-Bold.ttf")));
  const TITLE = getFrameProfile("emblem").title;
  const fontPx = TITLE_SIZE_PCT * W;
  const scaled = (units: number) => (units * fontPx) / beleren.unitsPerEm;
  const band = {
    left: (TITLE.rect.leftPct / 100) * W,
    right: ((TITLE.rect.leftPct + TITLE.rect.widthPct) / 100) * W,
  };
  const nameArea = { x0: 60, x1: 1440, y0: 100, y1: 240 };

  /** What the font says of a line as it is drawn (displayLine, one kerned run). */
  function metrics(text: string) {
    const line = displayLine(text);
    const glyphs = beleren.glyphsForString(line);
    const kerned = scaled(beleren.layout(line, { liga: false }).advanceWidth);
    const unkerned = scaled(glyphs.reduce((sum, g) => sum + g.advanceWidth, 0));
    const lsb = scaled(glyphs[0].bbox.minX);
    const last = glyphs[glyphs.length - 1];
    const rsb = scaled(last.advanceWidth - last.bbox.maxX);
    // The slot's tracking follows every glyph but the last one's ink.
    const tracking = (glyphs.length - 1) * (TITLE.letterSpacingEm ?? 0) * fontPx;
    return { kerned, unkerned, lsb, rsb, tracking };
  }

  it.each(["Astronomy Tower", "Voldemort’s Vengeful Spirit", "Avatar of Woe, Tyrant"])(
    "%s: its ink is centred on the bar, kerned or not",
    async (title) => {
      expect(TITLE.align).toBe("center");
      const m = metrics(title);
      // The line fits the bar at the full size (no shrink, no "…")…
      expect(m.kerned).toBeLessThan(band.right - band.left - 40);
      // …and the measurement can tell the two centrings apart: the old one
      // sat half the kerning left.
      const halfKerning = (m.unkerned - m.kerned) / 2;
      expect(halfKerning, title).toBeGreaterThan(5);
      const b = await bake(emblem({ title }), "hd");
      const name = inkBox(b, nameArea, white)!;
      expect(name, "name drawn").not.toBeNull();
      const expected = (band.left + band.right) / 2 + (m.lsb - m.rsb) / 2;
      expect(Math.abs((name.x0 + name.x1) / 2 - expected), title).toBeLessThanOrEqual(2);
      // The whole name is drawn, at the kerned width.
      expect(Math.abs(name.x1 - name.x0 - (m.kerned + m.tracking - m.lsb - m.rsb)), title).toBeLessThanOrEqual(4);
    },
    60_000,
  );

  it("a name too long for the bar still ends inside it", async () => {
    const b = await bake(emblem({ title: "Tobias Featherwhistle the Unconquerable, Keeper of the Western Watchtowers" }), "hd");
    const name = inkBox(b, nameArea, white)!;
    expect(name, "name drawn").not.toBeNull();
    expect(name.x0).toBeGreaterThanOrEqual(band.left - 2);
    expect(name.x1).toBeLessThanOrEqual(band.right + 2);
    // It fills the bar (shrunk and cut, not dropped), still on its centre.
    expect(name.x1 - name.x0).toBeGreaterThan((band.right - band.left) * 0.85);
    expect(Math.abs((name.x0 + name.x1) / 2 - (band.left + band.right) / 2)).toBeLessThanOrEqual(8);
  }, 60_000);
});
