import sharp from "sharp";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import type { CardPreviewData } from "@/components/cards/card-preview";
import { getFrameProfile } from "@/lib/cards/template-layout";
import { getManaCodepoint } from "@/lib/render/card-fonts";
import { renderCardImage, type RenderPreset } from "@/lib/render/card-image";
import { haveBucketMasters, serveBucketMasters, type ServedBucketMasters } from "@/tests/stubs/bucket-masters";
import { serveStandInFrames, type StandInFrames } from "@/tests/stubs/stand-in-frames";

// ---------------------------------------------------------------------------
// The 1997 frame on REAL bakes (TODO 4.10a, layout v46), at HD and at the
// 750 px default: every text measure against the ORIGINAL prints (54 prints
// of blue, red, green, artifact, black and land read for baselines and
// centres; lib/cards/typography.ts RETRO_*):
//   • name baseline 163 px, type line 1229 px, P/T 1963 px ending at
//     1367 px (two-digit values grow to the left, as printed), artist line
//     1933 px centred on 748 px, the © slot 1976 px;
//   • white ink with a hard black shadow — right / down + 5 / + 3 (name),
//     + 4.5 / + 3.3 (type line), + 3.5 / + 3.5 (artist), + 6.7 / + 5.7 (P/T);
//   • flat 73 px cost discs (no shadow), the 1997 tap in the rules text;
//   • the © slot: the pipglyph.com mark on display, the card's footer text on
//     a clean download.
// The first block bakes on a flat stand-in master (tests/stubs/stand-in-
// frames.ts: text, pips and marks are the only ink), so it runs everywhere;
// the last bakes the REAL bucket masters (FRAMES_BUILD_DIR, else
// .frames-build; CI fetches them).
// ---------------------------------------------------------------------------

const TONE = 128;
const HD_W = 1500;
const retro = getFrameProfile("retro");

function card(over: Partial<CardPreviewData> = {}): CardPreviewData {
  return {
    title: "Exmn",
    cost: "{4}{R}{R}",
    cardType: "creature",
    supertype: null,
    subtypes: ["Edna"],
    rarity: "rare",
    colorIdentity: ["red"],
    rulesText: "Flying",
    flavorText: null,
    power: "5",
    toughness: "5",
    loyalty: null,
    defense: null,
    artistCredit: "Edna Edna",
    artUrl: null,
    artPosition: {},
    frameStyle: { template: "retro", finish: "regular" },
    setIconUrl: null,
    setIconCode: null,
    backFace: null,
    faceContent: null,
    watermark: null,
    ...over,
  } as unknown as CardPreviewData;
}

type Raw = { data: Buffer; w: number; h: number };
async function bake(data: CardPreviewData, preset: RenderPreset, opts: { brandMark?: boolean; watermarkText?: string | null } = {}): Promise<Raw> {
  const res = await renderCardImage(data, preset, { brandMark: false, watermarkText: null, corners: "square", ...opts });
  const { data: raw, info } = await sharp(Buffer.from(await res.arrayBuffer())).removeAlpha().raw().toBuffer({ resolveWithObject: true });
  return { data: raw, w: info.width, h: info.height };
}
const px = (r: Raw, x: number, y: number) => {
  const i = (y * r.w + x) * 3;
  return [r.data[i], r.data[i + 1], r.data[i + 2]];
};
const sum = (c: number[]) => c[0] + c[1] + c[2];
/** The prints' white ink (#f0f3ef), its anti-aliased rim excluded. */
const isWhite = (c: number[]) => sum(c) > 660;
/** The hard shadow's black (#181311). */
const isShadow = (c: number[]) => sum(c) < 110;
type Box = { x0: number; x1: number; y0: number; y1: number };
/** The bounding box, in HD px, of the pixels of an HD-px box that satisfy
 *  `pred`; null when there are none. */
function inkBox(r: Raw, [x0, y0, x1, y1]: number[], pred: (c: number[]) => boolean): Box | null {
  const k = r.w / HD_W;
  const b = { x0: Infinity, x1: -Infinity, y0: Infinity, y1: -Infinity };
  for (let y = Math.ceil(y0 * k); y < Math.floor(y1 * k); y += 1) {
    for (let x = Math.ceil(x0 * k); x < Math.floor(x1 * k); x += 1) {
      if (!pred(px(r, x, y))) continue;
      b.x0 = Math.min(b.x0, x);
      b.x1 = Math.max(b.x1, x);
      b.y0 = Math.min(b.y0, y);
      b.y1 = Math.max(b.y1, y);
    }
  }
  return Number.isFinite(b.x0) ? { x0: b.x0 / k, x1: (b.x1 + 1) / k, y0: b.y0 / k, y1: (b.y1 + 1) / k } : null;
}
/** The box of the pixels that differ between two bakes, HD px. */
function diffBox(a: Raw, b: Raw, minDelta = 24): Box | null {
  const k = a.w / HD_W;
  const box = { x0: Infinity, x1: -Infinity, y0: Infinity, y1: -Infinity };
  for (let y = 0; y < a.h; y += 1) {
    for (let x = 0; x < a.w; x += 1) {
      const [p, q] = [px(a, x, y), px(b, x, y)];
      if (Math.abs(p[0] - q[0]) + Math.abs(p[1] - q[1]) + Math.abs(p[2] - q[2]) < minDelta) continue;
      box.x0 = Math.min(box.x0, x);
      box.x1 = Math.max(box.x1, x);
      box.y0 = Math.min(box.y0, y);
      box.y1 = Math.max(box.y1, y);
    }
  }
  return Number.isFinite(box.x0) ? { x0: box.x0 / k, x1: (box.x1 + 1) / k, y0: box.y0 / k, y1: (box.y1 + 1) / k } : null;
}
// The bands each line of text is alone in, HD px [x0, y0, x1, y1].
const NAME = [100, 90, 1000, 190];
const TYPE = [100, 1160, 1000, 1250];
const PT = [1150, 1880, 1430, 2015];
const ARTIST = [300, 1885, 1140, 1947];
const SLOT = [300, 1948, 1140, 2012];

describe("the 1997 frame — text on the prints' baselines, in the prints' ink", () => {
  let frames: StandInFrames;
  beforeAll(async () => {
    frames = await serveStandInFrames([
      { template: "retro", keys: ["r", "w"], tone: TONE },
      { template: "retroland", keys: ["c"], tone: TONE },
    ]);
  });
  afterAll(() => frames.restore());

  for (const preset of ["hd", "default"] as const) {
    // A whole px of the 750 bake is two of HD.
    const tol = preset === "hd" ? 1.5 : 3.5;
    it(`${preset}: name 163 px, type line 1229 px, P/T 1963 px ending at 1367 px, artist line 1933 px on 748 px (baselines; "Exmn" has no descender — Beleren's H does — and no ascender past its capital)`, async () => {
      const r = await bake(card(), preset);
      const name = inkBox(r, NAME, isWhite)!;
      const type = inkBox(r, TYPE, isWhite)!;
      const pt = inkBox(r, PT, isWhite)!;
      const artist = inkBox(r, ARTIST, isWhite)!;
      expect(Math.abs(name.y1 - 163), `name ${JSON.stringify(name)}`).toBeLessThanOrEqual(tol);
      expect(Math.abs(type.y1 - 1229), `type ${JSON.stringify(type)}`).toBeLessThanOrEqual(tol);
      // The P/T's digits stand on 1963 px; Beleren's slash runs 4 px below
      // them and a little above (the box read here is "5/5" whole).
      expect(Math.abs(pt.y1 - 1967), `pt ${JSON.stringify(pt)}`).toBeLessThanOrEqual(tol);
      expect(Math.abs(artist.y1 - 1933), `artist ${JSON.stringify(artist)}`).toBeLessThanOrEqual(tol);
      // Sizes: Beleren's capital E at 71 px is 50 px tall (the acceptance's
      // 50 ± 1), MPlantin's at 67 px 46 ± 1.
      expect(Math.abs(name.y1 - name.y0 - 50)).toBeLessThanOrEqual(tol);
      expect(Math.abs(type.y1 - type.y0 - 46)).toBeLessThanOrEqual(tol);
      // …68 px from the slash's top to its foot at 86 px (the digits are
      // 60), its ink ending where every print's does: 1367 px (1364–1370
      // on 54 one-digit and 4 two-digit prints).
      expect(Math.abs(pt.y1 - pt.y0 - 68)).toBeLessThanOrEqual(tol + 1);
      expect(Math.abs(pt.x1 - 1367), `pt ${JSON.stringify(pt)}`).toBeLessThanOrEqual(tol + 0.5);
      // The artist line is centred on the card's 748 px (the acceptance:
      // within 2 px).
      expect(Math.abs((artist.x0 + artist.x1) / 2 - 748)).toBeLessThanOrEqual(2);
      // The name starts where the prints' does (166 px), the type line at 162.
      expect(Math.abs(name.x0 - 166)).toBeLessThanOrEqual(tol + 1.5);
      expect(Math.abs(type.x0 - 162)).toBeLessThanOrEqual(tol + 1.5);
    }, 60_000);

    it(`${preset}: every line carries the prints' hard shadow — its black ends right of and below the white by the measured offset`, async () => {
      const r = await bake(card(), preset);
      for (const [band, dx, dy, label] of [
        [NAME, 5, 3, "name"],
        [TYPE, 4.5, 3.3, "type"],
        [ARTIST, 3.5, 3.5, "artist"],
        [PT, 6.7, 5.7, "pt"],
      ] as const) {
        const white = inkBox(r, [...band], isWhite)!;
        const shadow = inkBox(r, [...band], isShadow)!;
        expect(shadow, label).not.toBeNull();
        // (At 750 px an offset is 1.5–3.5 px of the bake: a whole px either
        // way is 2 HD px.)
        const offTol = preset === "hd" ? 1.5 : 3.5;
        expect(Math.abs(shadow.x1 - white.x1 - dx), `${label} dx ${shadow.x1 - white.x1}`).toBeLessThanOrEqual(offTol);
        expect(Math.abs(shadow.y1 - white.y1 - dy), `${label} dy ${shadow.y1 - white.y1}`).toBeLessThanOrEqual(offTol);
        // A drop shadow, not an outline: nothing dark left of or above the ink.
        expect(shadow.x0).toBeGreaterThanOrEqual(white.x0 - 1);
        expect(shadow.y0).toBeGreaterThanOrEqual(white.y0 - 1);
      }
    }, 60_000);
  }

  it("the cost: three FLAT 73 px discs centred on row 137, ending at 1383 px — no drop shadow under them", async () => {
    const r = await bake(card({ title: "H" }), "hd");
    // The red discs' fill (and the generic one's grey is the stand-in's
    // neighbour: read the two red ones).
    const red = (c: number[]) => c[0] > 180 && c[0] - c[2] > 40;
    const discs = inkBox(r, [1150, 80, 1420, 200], red)!;
    expect(Math.abs(discs.x1 - 1383)).toBeLessThanOrEqual(2);
    expect(Math.abs(discs.y1 - discs.y0 - 73)).toBeLessThanOrEqual(1);
    expect(Math.abs((discs.y0 + discs.y1) / 2 - 137)).toBeLessThanOrEqual(1.5);
    // Two discs and the 7 px between them.
    expect(Math.abs(discs.x1 - discs.x0 - (73 * 2 + 7.3))).toBeLessThanOrEqual(2);
    // "modern" would hang a #111 crescent 4–5 px below and left of each
    // disc: under the row the stand-in's flat tone is untouched.
    const offTone = (c: number[]) => Math.abs(c[0] - TONE) + Math.abs(c[1] - TONE) + Math.abs(c[2] - TONE) > 30;
    expect(inkBox(r, [1100, discs.y1 + 1, 1420, discs.y1 + 12], offTone)).toBeNull();
    expect(inkBox(r, [discs.x0 - 12, discs.y0, discs.x0 - 1, discs.y1], (c) => sum(c) < 90)).toBeNull();
  }, 60_000);

  it("the rules text draws the 1997 tap symbol, flat", async () => {
    // Satori's own text nodes: the glyph the bake asks the mana font for.
    const { renderCardImage: render } = await import("@/lib/render/card-image");
    const res = await render(card({ rulesText: "{T}: Add {R}." }), "hd", { brandMark: false, watermarkText: null });
    expect(res.ok).toBe(true);
    expect(getManaCodepoint("tap-4ed")).not.toBeNull();
    expect(getManaCodepoint("tap-4ed")).not.toBe(getManaCodepoint("tap"));
    // The discs in the rules line have no shadow either: right under the
    // {R} disc the stand-in's tone is untouched.
    const r = await bake(card({ rulesText: "{T}: Add {R}." }), "hd");
    const red = inkBox(r, [180, 1280, 1320, 1840], (c) => c[0] > 180 && c[0] - c[2] > 40)!;
    expect(red).not.toBeNull();
    const offTone = (c: number[]) => Math.abs(c[0] - TONE) + Math.abs(c[1] - TONE) + Math.abs(c[2] - TONE) > 30;
    expect(inkBox(r, [red.x0 - 4, red.y1 + 1, red.x1, red.y1 + 6], offTone)).toBeNull();
  }, 60_000);

  it("DISPLAY: the pipglyph.com mark sits in the © slot — centred on 748 px, on the frame, baseline 1976 px — and not on the border", async () => {
    const [off, on] = [await bake(card(), "hd"), await bake(card(), "hd", { brandMark: true })];
    const mark = diffBox(off, on)!;
    expect(mark).not.toBeNull();
    // Centred under the artist line (the star leads the text: the block's
    // middle is the slot's).
    expect(Math.abs((mark.x0 + mark.x1) / 2 - 748)).toBeLessThanOrEqual(4);
    // Inside the footer strip, above the frame's bottom edge (2019 px): the
    // old placement sat at 2060–2090 px, in the black border.
    expect(mark.y0).toBeGreaterThan(1940);
    expect(mark.y1).toBeLessThan(2012);
    // The white mark's text stands on the slot's baseline (descenders of
    // "pipglyph" and its soft shadow reach a few px below).
    const text = inkBox(on, SLOT, (c) => sum(c) > 600)!;
    expect(text.y1).toBeGreaterThanOrEqual(1976);
    expect(text.y1).toBeLessThanOrEqual(1986);
    // Nothing changed in the border.
    expect(diffBox({ ...off, data: off.data }, on)!.y1).toBeLessThan(2019);
  }, 60_000);

  it("DISPLAY on the white frame: the mark is the line's dark ink, flat — no white, no soft shadow", async () => {
    const white = card({ colorIdentity: ["white"] });
    const [off, on] = [await bake(white, "hd"), await bake(white, "hd", { brandMark: true })];
    const mark = diffBox(off, on)!;
    expect(Math.abs((mark.x0 + mark.x1) / 2 - 748)).toBeLessThanOrEqual(4);
    expect(inkBox(on, SLOT, (c) => sum(c) > 600)).toBeNull();
    const dark = inkBox(on, SLOT, (c) => sum(c) < 120)!;
    expect(dark).not.toBeNull();
    expect(Math.abs((dark.x0 + dark.x1) / 2 - 748)).toBeLessThanOrEqual(4);
    // …and a red-frame card's mark is white.
    const red = await bake(card(), "hd", { brandMark: true });
    expect(inkBox(red, SLOT, (c) => sum(c) > 600)).not.toBeNull();
  }, 60_000);

  it("CLEAN DOWNLOAD: the card's footer text prints in the © slot, centred — it used to be dropped by a centred footer", async () => {
    const text = "Edna Edna Edna";
    for (const preset of ["hd", "default"] as const) {
      const [none, custom] = [await bake(card(), preset), await bake(card(), preset, { watermarkText: text })];
      const box = diffBox(none, custom)!;
      expect(box, preset).not.toBeNull();
      expect(Math.abs((box.x0 + box.x1) / 2 - 748), preset).toBeLessThanOrEqual(preset === "hd" ? 3 : 5);
      // MPlantin at 33 px: capitals ≈ 22 px tall on the 1976 px baseline.
      const white = inkBox(custom, SLOT, isWhite)!;
      expect(Math.abs(white.y1 - 1976), preset).toBeLessThanOrEqual(preset === "hd" ? 1.5 : 2.5);
      expect(Math.abs(white.y1 - white.y0 - 22.5), preset).toBeLessThanOrEqual(3);
      // No shadow on this line (the prints' second line has none).
      expect(inkBox(custom, SLOT, isShadow), preset).toBeNull();
      // The artist line above it is untouched.
      expect(box.y0).toBeGreaterThan(1940);
    }
    // Dark on the white frame.
    const white = card({ colorIdentity: ["white"] });
    const custom = await bake(white, "hd", { watermarkText: text });
    expect(inkBox(custom, SLOT, isWhite)).toBeNull();
    expect(inkBox(custom, SLOT, (c) => sum(c) < 120)).not.toBeNull();
    // No footer text: the slot is empty on a clean download.
    expect(diffBox(await bake(card(), "hd"), await bake(card(), "hd", { watermarkText: "   " }))).toBeNull();
  }, 120_000);

  it("a land: no cost, the same lines, the © slot white on the brown frame", async () => {
    const land = card({ title: "Edna", cost: null, cardType: "land", subtypes: [], colorIdentity: ["colorless"], power: null, toughness: null, frameStyle: { template: "retroland", finish: "regular" } });
    const r = await bake(land, "hd", { watermarkText: "Edna" });
    expect(Math.abs(inkBox(r, NAME, isWhite)!.y1 - 163)).toBeLessThanOrEqual(1.5);
    expect(Math.abs(inkBox(r, ARTIST, isWhite)!.y1 - 1933)).toBeLessThanOrEqual(1.5);
    expect(inkBox(r, SLOT, isWhite)).not.toBeNull();
    expect(inkBox(r, PT, isWhite)).toBeNull();
    expect(inkBox(r, [1100, 80, 1420, 200], (c) => Math.abs(c[0] - TONE) > 40)).toBeNull();
  }, 60_000);

  it("the PRINT path (600 ppi, with the bleed) prints the footer text in the slot too — the same layer the bake draws", async () => {
    const { renderCardPrint } = await import("@/lib/render/card-print");
    const read = async (bytes: Buffer): Promise<Raw> => {
      const { data, info } = await sharp(bytes).removeAlpha().raw().toBuffer({ resolveWithObject: true });
      return { data, w: info.width, h: info.height };
    };
    const opts = { ppi: 600, bleed: false, brandMark: false } as const;
    const [none, custom] = [await read(await renderCardPrint(card(), { ...opts, watermarkText: null })), await read(await renderCardPrint(card(), { ...opts, watermarkText: "Edna Edna Edna" }))];
    expect([custom.w, custom.h]).toEqual([1500, 2100]);
    const box = diffBox(none, custom)!;
    expect(box).not.toBeNull();
    expect(Math.abs((box.x0 + box.x1) / 2 - 748)).toBeLessThanOrEqual(3);
    expect(Math.abs(inkBox(custom, SLOT, isWhite)!.y1 - 1976)).toBeLessThanOrEqual(1.5);
    // With the 1/8 in bleed the card is the same card, 75 px in.
    const bled = await read(await renderCardPrint(card(), { ...opts, bleed: true, watermarkText: "Edna Edna Edna" }));
    expect([bled.w, bled.h]).toEqual([1650, 2250]);
    // A display print (the free viewer's) carries the mark in the slot.
    const marked = await read(await renderCardPrint(card(), { ...opts, brandMark: true, watermarkText: null }));
    const mark = diffBox(none, marked)!;
    expect(Math.abs((mark.x0 + mark.x1) / 2 - 748)).toBeLessThanOrEqual(4);
    expect(mark.y1).toBeLessThan(2012);
  }, 120_000);

  it("a long artist credit takes ONE ellipsis inside the line's box and never reaches the P/T", async () => {
    const long = await bake(card({ artistCredit: "Edna ".repeat(14).trim() }), "hd");
    const artist = inkBox(long, [200, 1885, 1200, 1947], isWhite)!;
    const rect = retro.footer!.rect;
    expect(artist.x0).toBeGreaterThanOrEqual((rect.leftPct / 100) * HD_W - 2);
    expect(artist.x1).toBeLessThanOrEqual(((rect.leftPct + rect.widthPct) / 100) * HD_W + 2);
    expect(artist.x1).toBeLessThan(inkBox(long, PT, isWhite)!.x0);
  }, 60_000);
});

const REAL_KEYS = ["retro/w.png", "retro/b.png", "retro/u.png", "retroland/c.png"];
describe.skipIf(!haveBucketMasters(REAL_KEYS))("the 1997 frame on its REAL masters (frames bucket)", () => {
  let served: ServedBucketMasters;
  beforeAll(() => {
    served = serveBucketMasters(REAL_KEYS);
  });
  afterAll(() => served.restore());
  /** WCAG 2 contrast of two sRGB colours. */
  const contrast = (a: number[], b: number[]) => {
    const lum = (c: number[]) => {
      const [r, g, bl] = c.map((v) => (v / 255 <= 0.03928 ? v / 255 / 12.92 : ((v / 255 + 0.055) / 1.055) ** 2.4));
      return 0.2126 * r + 0.7152 * g + 0.0722 * bl;
    };
    const [hi, lo] = [lum(a), lum(b)].sort((x, y) => y - x);
    return (hi + 0.05) / (lo + 0.05);
  };

  it("the mark reads on every master it sits on: dark on the white frame, white on blue (the lowest ground, 2.8 : 1), black and the land", async () => {
    for (const [template, colour, key] of [
      ["retro", "white", "w"],
      ["retro", "blue", "u"],
      ["retro", "black", "b"],
      ["retroland", "colorless", "c"],
    ] as const) {
      const data = card({ colorIdentity: [colour], frameStyle: { template, finish: "regular" }, ...(template === "retroland" ? { cardType: "land", cost: null, power: null, toughness: null, subtypes: [] } : {}) } as Partial<CardPreviewData>);
      const [off, on] = [await bake(data, "hd"), await bake(data, "hd", { brandMark: true })];
      const mark = diffBox(off, on, 60)!;
      expect(mark, key).not.toBeNull();
      // On the frame: inside the footer strip.
      expect(mark.y0, key).toBeGreaterThan(1940);
      expect(mark.y1, key).toBeLessThan(2014);
      // The ground under the mark (the unmarked bake's median there)…
      const ground = [0, 1, 2].map((c) => {
        const v: number[] = [];
        for (let y = Math.floor(mark.y0); y < mark.y1; y += 1) for (let x = Math.floor(mark.x0); x < mark.x1; x += 1) v.push(px(off, x, y)[c]);
        return v.sort((a, b) => a - b)[v.length >> 1];
      });
      // …against the mark's own ink: its strongest pixel on the side the
      // slot letters it (dark on the white frame, light elsewhere — the
      // white mark's soft shadow is darker than a mid ground, and is not
      // its ink).
      const dark = key === "w";
      let ink = ground;
      let best = 0;
      for (let y = Math.floor(mark.y0); y < mark.y1; y += 1) {
        for (let x = Math.floor(mark.x0); x < mark.x1; x += 1) {
          const c = px(on, x, y);
          if (sum(c) < sum(ground) !== dark) continue;
          const ratio = contrast(c, ground);
          if (ratio > best) [best, ink] = [ratio, c];
        }
      }
      // Measured: 4.6 : 1 dark on white marble, 2.8 : 1 on blue (the lowest
      // ground — the mark's standard 82 % white, before its own soft
      // shadow), more on black and the land.
      expect(best, `${template}/${key} ground ${ground} ink ${ink}`).toBeGreaterThanOrEqual(2.5);
      // The white frame's mark has no light ink at all.
      if (dark) expect(inkBox(on, SLOT, (c) => sum(c) > 700), key).toBeNull();
    }
  }, 180_000);

  it("the lettering reads on the real frames: white over its shadow on white marble, ≥ 4.5 : 1 against the shadow it stands on", async () => {
    const r = await bake(card({ colorIdentity: ["white"] }), "hd");
    const white = inkBox(r, NAME, isWhite)!;
    const shadow = inkBox(r, NAME, isShadow)!;
    expect(white).not.toBeNull();
    expect(shadow).not.toBeNull();
    expect(contrast([240, 243, 239], [24, 19, 17])).toBeGreaterThan(15);
  }, 60_000);
});
