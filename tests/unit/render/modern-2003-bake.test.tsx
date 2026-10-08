import sharp from "sharp";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import type { CardPreviewData } from "@/components/cards/card-preview";
import { footerInk, getFrameProfile } from "@/lib/cards/template-layout";
import { renderCardImage, type RenderPreset } from "@/lib/render/card-image";
import { haveBucketMasters, serveBucketMasters, type ServedBucketMasters } from "@/tests/stubs/bucket-masters";
import { serveStandInFrames, type StandInFrames } from "@/tests/stubs/stand-in-frames";

// ---------------------------------------------------------------------------
// The 2003 frame on REAL bakes (TODO 4.10b, layout v47), at HD and at the
// 750 px default: every text measure against the prints of the frame's later
// drawing (79 black-bordered prints, CHK 2004 → JOU 2014; lib/cards/
// typography.ts MODERN_*):
//   • name baseline 198.5 px from 133 px, type line 1264 px from 151 px,
//     P/T digits on 1959 px CENTRED on 1258 px at one size whatever the
//     value, the artist on 1967 px from 235 px after the brush
//     (118–227 × 1946–1969 px), the © slot on 2015 px from 128 px;
//   • dark ink with NO shadow on the name, the type line and the P/T; the
//     footer dark too, and WHITE on the black frame and on lands (4.23a);
//   • 68 px cost discs ending at 1368 px on row 173, each with a black
//     shadow 6 px straight down; flat pips in the rules text;
//   • the © slot: the pipglyph.com mark on display, the card's footer text
//     on a clean download — never at the end of the artist line.
// The first block bakes on a flat stand-in master (tests/stubs/stand-in-
// frames.ts: text, pips and marks are the only ink), so it runs everywhere;
// the last bakes the REAL bucket masters (FRAMES_BUILD_DIR, else
// .frames-build; CI fetches them).
// ---------------------------------------------------------------------------

const TONE = 128;
const HD_W = 1500;
const modern = getFrameProfile("modern");

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
    frameStyle: { template: "modern", finish: "regular" },
    setIconUrl: null,
    setIconCode: null,
    backFace: null,
    faceContent: null,
    watermark: null,
    ...over,
  } as unknown as CardPreviewData;
}
const LAND: Partial<CardPreviewData> = {
  title: "Edna",
  cost: null,
  cardType: "land",
  subtypes: [],
  colorIdentity: ["colorless"],
  power: null,
  toughness: null,
  frameStyle: { template: "modernland", finish: "regular" },
} as Partial<CardPreviewData>;

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
/** The frame's dark ink (#17120c), its anti-aliased rim excluded. */
const isDark = (c: number[]) => sum(c) < 150;
const isWhite = (c: number[]) => sum(c) > 690;
type Box = { x0: number; x1: number; y0: number; y1: number };
/** The bounding box, in HD px, of the pixels of an HD-px box that satisfy
 *  `pred`; null when there are none. */
function inkBox(r: Raw, [x0, y0, x1, y1]: readonly number[], pred: (c: number[]) => boolean): Box | null {
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
const NAME = [100, 110, 1000, 230];
const TYPE = [100, 1190, 1000, 1290];
const PT = [1130, 1885, 1380, 1990];
const BRUSH = [100, 1930, 230, 1984];
const ARTIST = [231, 1915, 1075, 1984];
const SLOT = [100, 1986, 1075, 2030];

describe("the 2003 frame — text on the prints' baselines, in the prints' ink", () => {
  let frames: StandInFrames;
  beforeAll(async () => {
    frames = await serveStandInFrames([
      { template: "modern", keys: ["r", "w", "b"], tone: TONE },
      { template: "modernland", keys: ["c"], tone: TONE },
    ]);
  });
  afterAll(() => frames.restore());

  for (const preset of ["hd", "default"] as const) {
    // A whole px of the 750 bake is two of HD.
    const tol = preset === "hd" ? 1.5 : 3.5;
    it(`${preset}: name 198.5 px from 133, type line 1264 px from 151, artist 1967 px from 235 ("Exmn" / "Edna": no descender)`, async () => {
      const r = await bake(card(), preset);
      const name = inkBox(r, NAME, isDark)!;
      const type = inkBox(r, TYPE, isDark)!;
      const artist = inkBox(r, ARTIST, isDark)!;
      expect(Math.abs(name.y1 - 198.5), `name ${JSON.stringify(name)}`).toBeLessThanOrEqual(tol);
      expect(Math.abs(type.y1 - 1264), `type ${JSON.stringify(type)}`).toBeLessThanOrEqual(tol);
      expect(Math.abs(artist.y1 - 1967), `artist ${JSON.stringify(artist)}`).toBeLessThanOrEqual(tol);
      // Sizes: Beleren's capital E is 0.70 em — 56 px at 80 (the prints'
      // 55–56; the acceptance's 55 ± 1); its d stands 0.75 em tall — 49.5 px
      // at 66 ("Creature — Edna"), 37.5 at 50 ("Edna Edna").
      expect(Math.abs(name.y1 - name.y0 - 56)).toBeLessThanOrEqual(tol);
      expect(Math.abs(type.y1 - type.y0 - 49.5)).toBeLessThanOrEqual(tol);
      expect(Math.abs(artist.y1 - artist.y0 - 37.5)).toBeLessThanOrEqual(tol);
      // The lines start where the prints' do (a capital E's stem sits a
      // bearing right of its pen).
      expect(Math.abs(name.x0 - 135)).toBeLessThanOrEqual(tol + 2);
      expect(Math.abs(type.x0 - 153)).toBeLessThanOrEqual(tol + 2);
      expect(Math.abs(artist.x0 - 236)).toBeLessThanOrEqual(tol + 2);
    }, 60_000);

    it(`${preset}: the P/T is CENTRED on 1258 px on the 1959 px baseline at ONE size — one digit a side or two`, async () => {
      const none = await bake(card({ power: null, toughness: null }), preset);
      const box = async (power: string, toughness: string) => diffBox(none, await bake(card({ power, toughness }), preset))!;
      // The plate comes with the value: read the dark ink inside its face.
      const ink = async (power: string, toughness: string) => inkBox(await bake(card({ power, toughness }), preset), PT, isDark)!;
      const five = await ink("5", "5");
      const thirteen = await ink("13", "13");
      const ten = await ink("10", "10");
      for (const [label, b] of [["5/5", five], ["13/13", thirteen], ["10/10", ten]] as const) {
        expect(Math.abs((b.x0 + b.x1) / 2 - 1258), `${label} ${JSON.stringify(b)}`).toBeLessThanOrEqual(tol + 2);
        // Beleren's slash runs a few px below the digits' 1959 px.
        expect(Math.abs(b.y1 - 1962), `${label} ${JSON.stringify(b)}`).toBeLessThanOrEqual(tol + 1);
      }
      // Two digits a side at the full size, as the prints set them (CON
      // #121 10/10, WWK #57 13/13: digits 58–59 px, the one-digit height).
      expect(Math.abs(thirteen.y1 - thirteen.y0 - (five.y1 - five.y0))).toBeLessThanOrEqual(preset === "hd" ? 1 : 2);
      expect(Math.abs(ten.y1 - ten.y0 - (five.y1 - five.y0))).toBeLessThanOrEqual(preset === "hd" ? 1 : 2);
      // …inside the plate's face (1134–1367 px).
      expect(ten.x0).toBeGreaterThanOrEqual(1134 - tol);
      expect(ten.x1).toBeLessThanOrEqual(1367 + tol);
      // The plate is drawn at the printed box (1112.5–1374.8 × 1880.8–1996.9
      // px), not 17 px too flat: the stand-in plate fills the profile's
      // plateRect, whose ink box (lib/cards/plate-ink.ts) is that outline.
      const plate = await box("5", "5");
      const rect = modern.pt!.plateRect!;
      expect(Math.abs(plate.y1 - ((rect.topPct + rect.heightPct) / 100) * 2100)).toBeLessThanOrEqual(tol + 1);
      expect(plate.y1 - plate.y0).toBeGreaterThan(170);
    }, 120_000);

    it(`${preset}: no shadow under the name, the type line or the artist — dark ink on the flat tone, nothing lighter`, async () => {
      const r = await bake(card({ cost: null }), preset);
      const k = r.w / HD_W;
      for (const band of [NAME, TYPE, ARTIST]) {
        let lighter = 0;
        let dark = 0;
        for (let y = Math.ceil(band[1] * k); y < Math.floor(band[3] * k); y += 1) {
          for (let x = Math.ceil(band[0] * k); x < Math.floor(band[2] * k); x += 1) {
            const c = px(r, x, y);
            if (sum(c) > TONE * 3 + 24) lighter += 1;
            if (isDark(c)) dark += 1;
          }
        }
        expect(lighter).toBe(0);
        expect(dark).toBeGreaterThan(preset === "hd" ? 1500 : 350);
      }
    }, 60_000);
  }

  it("the brush: our own path in the footer's ink at 118–227 × 1946–1969 px, before the artist", async () => {
    for (const preset of ["hd", "default"] as const) {
      const r = await bake(card(), preset);
      const brush = inkBox(r, BRUSH, isDark)!;
      const tol = preset === "hd" ? 2 : 3.5;
      expect(brush, preset).not.toBeNull();
      expect(Math.abs(brush.x0 - 118), `${preset} ${JSON.stringify(brush)}`).toBeLessThanOrEqual(tol + 1);
      expect(Math.abs(brush.x1 - 227), `${preset} ${JSON.stringify(brush)}`).toBeLessThanOrEqual(tol);
      expect(Math.abs(brush.y0 - 1946), `${preset} ${JSON.stringify(brush)}`).toBeLessThanOrEqual(tol);
      expect(Math.abs(brush.y1 - 1969), `${preset} ${JSON.stringify(brush)}`).toBeLessThanOrEqual(tol);
      // It ends before the artist starts.
      expect(brush.x1).toBeLessThan(inkBox(r, ARTIST, isDark)!.x0);
    }
    // A card with no credit still prints the brush (and "Unknown").
    const anonymous = await bake(card({ artistCredit: null }), "hd");
    expect(inkBox(anonymous, BRUSH, isDark)).not.toBeNull();
    expect(inkBox(anonymous, ARTIST, isDark)).not.toBeNull();
  }, 120_000);

  it("the footer is WHITE on the black frame and on a land — brush, artist and © slot — and dark elsewhere (4.23a's rule)", async () => {
    const black = await bake(card({ colorIdentity: ["black"] }), "hd", { watermarkText: "Edna" });
    const land = await bake(card(LAND), "hd", { watermarkText: "Edna" });
    const red = await bake(card(), "hd", { watermarkText: "Edna" });
    for (const [label, r] of [["black", black], ["land", land]] as const) {
      for (const band of [BRUSH, ARTIST, SLOT]) {
        expect(inkBox(r, band, isWhite), label).not.toBeNull();
        expect(inkBox(r, band, isDark), label).toBeNull();
      }
    }
    for (const band of [BRUSH, ARTIST, SLOT]) {
      expect(inkBox(red, band, isDark)).not.toBeNull();
      expect(inkBox(red, band, isWhite)).toBeNull();
    }
    // The name, the type line and the P/T stay dark on the black frame:
    // its bars and plate are light.
    expect(inkBox(black, NAME, isDark)).not.toBeNull();
    expect(inkBox(black, TYPE, isDark)).not.toBeNull();
    expect(inkBox(black, PT, isDark)).not.toBeNull();
    // The profile's own answer, both templates.
    const landProfile = getFrameProfile("modernland");
    expect(footerInk(modern.footer!, "b", modern).colorHex).toBe("#ffffff");
    expect(footerInk(modern.footer!, "c", modern).colorHex).toBe(modern.footer!.colorHex);
    for (const key of ["w", "u", "b", "r", "g", "c", "m"]) expect(footerInk(landProfile.footer!, key, landProfile).colorHex, key).toBe("#ffffff");
  }, 120_000);

  it("the cost: 68 px discs ending at 1368 px on row 173, each with a black shadow 6 px STRAIGHT DOWN — nothing to its left", async () => {
    const r = await bake(card({ title: "H" }), "hd");
    const red = (c: number[]) => c[0] > 180 && c[0] - c[2] > 40;
    const discs = inkBox(r, [1150, 120, 1420, 230], red)!;
    expect(Math.abs(discs.x1 - 1368)).toBeLessThanOrEqual(2);
    expect(Math.abs(discs.y1 - discs.y0 - 68)).toBeLessThanOrEqual(1);
    expect(Math.abs((discs.y0 + discs.y1) / 2 - 173)).toBeLessThanOrEqual(1.5);
    // Two red discs and the 8 px between them.
    expect(Math.abs(discs.x1 - discs.x0 - (68 * 2 + 8))).toBeLessThanOrEqual(2);
    // The shadow: black, under the disc by 6 px, no further.
    const black = (c: number[]) => sum(c) < 40;
    // (Read under the two red discs: the generic one left of them has its own.)
    const shadow = inkBox(r, [discs.x0 - 4, discs.y1 - 20, discs.x1 + 12, discs.y1 + 14], black)!;
    expect(shadow).not.toBeNull();
    expect(Math.abs(shadow.y1 - (discs.y1 + 6))).toBeLessThanOrEqual(1);
    // Straight down: it reaches no further left or right than the discs.
    expect(shadow.x0).toBeGreaterThanOrEqual(discs.x0 - 1);
    expect(shadow.x1).toBeLessThanOrEqual(discs.x1 + 1);
    // …and "modern" would hang a crescent LEFT of the first disc: nothing
    // dark there, at the disc's own rows.
    const first = inkBox(r, [1100, 120, discs.x0 - 30, 230], (c) => Math.abs(c[0] - TONE) > 30 && sum(c) > 150)!;
    expect(inkBox(r, [first.x0 - 12, first.y0 + 10, first.x0 - 1, first.y1 - 10], black)).toBeNull();
  }, 60_000);

  it("a pip in the rules text is FLAT (the 2003 prints shadow the cost alone), and {T} is the modern arrow", async () => {
    const r = await bake(card({ rulesText: "{T}: Add {R}." }), "hd");
    const red = inkBox(r, [150, 1320, 1350, 1900], (c) => c[0] > 180 && c[0] - c[2] > 40)!;
    expect(red).not.toBeNull();
    const offTone = (c: number[]) => Math.abs(c[0] - TONE) + Math.abs(c[1] - TONE) + Math.abs(c[2] - TONE) > 30;
    expect(inkBox(r, [red.x0 - 6, red.y1 + 1, red.x1, red.y1 + 8], offTone)).toBeNull();
    const { getManaCodepoint } = await import("@/lib/render/card-fonts");
    const { symbolStyleOf, styledSuffix } = await import("@/lib/cards/symbol-style");
    expect(styledSuffix(symbolStyleOf(modern), "tap")).toBe("tap");
    expect(getManaCodepoint("tap")).not.toBeNull();
  }, 60_000);

  it("DISPLAY: the pipglyph.com mark sits in the © slot — from 128 px, under the brush, on the frame — and not on the border", async () => {
    for (const [colour, dark] of [["red", true], ["black", false]] as const) {
      const data = card({ colorIdentity: [colour] });
      const [off, on] = [await bake(data, "hd"), await bake(data, "hd", { brandMark: true })];
      const mark = diffBox(off, on)!;
      expect(mark, colour).not.toBeNull();
      // From the slot's left end (the star leads the text), on the frame:
      // the old placement sat at 2060–2090 px, in the black border.
      expect(mark.x0, colour).toBeGreaterThanOrEqual(126);
      expect(mark.x0, colour).toBeLessThan(150);
      expect(mark.y0, colour).toBeGreaterThan(1980);
      expect(mark.y1, colour).toBeLessThan(2030);
      // Where the print's line is dark the mark takes that ink, flat; on the
      // black frame it is its standard white.
      if (dark) {
        expect(inkBox(on, SLOT, isDark), colour).not.toBeNull();
        expect(inkBox(on, SLOT, (c) => sum(c) > 600), colour).toBeNull();
      } else {
        expect(inkBox(on, SLOT, (c) => sum(c) > 600), colour).not.toBeNull();
      }
    }
  }, 120_000);

  it("CLEAN DOWNLOAD: the card's footer text prints in the © slot from 128 px on the 2015 px baseline — never at the end of the artist line", async () => {
    const text = "Edna Edna Edna";
    for (const preset of ["hd", "default"] as const) {
      const [none, custom] = [await bake(card(), preset), await bake(card(), preset, { watermarkText: text })];
      const box = diffBox(none, custom)!;
      expect(box, preset).not.toBeNull();
      // Only line 2 changed: the artist line (and its end, where every other
      // frame prints the custom text) is untouched.
      expect(box.y0, preset).toBeGreaterThan(1984);
      const ink = inkBox(custom, SLOT, isDark)!;
      expect(Math.abs(ink.x0 - 129), preset).toBeLessThanOrEqual(preset === "hd" ? 2 : 4);
      expect(Math.abs(ink.y1 - 2015), preset).toBeLessThanOrEqual(preset === "hd" ? 1.5 : 2.5);
      // MPlantin at 32 px: capitals ≈ 22 px tall.
      expect(Math.abs(ink.y1 - ink.y0 - 22), preset).toBeLessThanOrEqual(3);
    }
    // No footer text: the slot is empty on a clean download.
    expect(diffBox(await bake(card(), "hd"), await bake(card(), "hd", { watermarkText: "   " }))).toBeNull();
    // A long one is cut with one "…" short of the P/T box (1112 px).
    const long = await bake(card(), "hd", { watermarkText: "Edna ".repeat(30).trim() });
    expect(inkBox(long, [100, 1986, 1400, 2030], isDark)!.x1).toBeLessThanOrEqual(1100);
  }, 120_000);

  it("a land: no cost, the same lines, no P/T", async () => {
    const r = await bake(card(LAND), "hd");
    expect(Math.abs(inkBox(r, NAME, isDark)!.y1 - 198.5)).toBeLessThanOrEqual(1.5);
    expect(Math.abs(inkBox(r, ARTIST, isWhite)!.y1 - 1967)).toBeLessThanOrEqual(1.5);
    expect(inkBox(r, PT, isDark)).toBeNull();
    expect(inkBox(r, [1100, 120, 1420, 230], (c) => Math.abs(c[0] - TONE) > 40)).toBeNull();
  }, 60_000);

  it("the PRINT path (600 ppi, with the bleed) prints the brush and the footer text in the slot too — the same layer the bake draws", async () => {
    const { renderCardPrint } = await import("@/lib/render/card-print");
    const read = async (bytes: Buffer): Promise<Raw> => {
      const { data, info } = await sharp(bytes).removeAlpha().raw().toBuffer({ resolveWithObject: true });
      return { data, w: info.width, h: info.height };
    };
    const opts = { ppi: 600, bleed: false, brandMark: false } as const;
    const [none, custom] = [await read(await renderCardPrint(card(), { ...opts, watermarkText: null })), await read(await renderCardPrint(card(), { ...opts, watermarkText: "Edna Edna Edna" }))];
    expect([custom.w, custom.h]).toEqual([1500, 2100]);
    expect(inkBox(none, BRUSH, isDark)).not.toBeNull();
    const box = diffBox(none, custom)!;
    expect(box.y0).toBeGreaterThan(1984);
    expect(Math.abs(inkBox(custom, SLOT, isDark)!.y1 - 2015)).toBeLessThanOrEqual(1.5);
    const bled = await read(await renderCardPrint(card(), { ...opts, bleed: true, watermarkText: "Edna Edna Edna" }));
    expect([bled.w, bled.h]).toEqual([1650, 2250]);
  }, 120_000);

  it("a long artist credit takes ONE ellipsis inside the line's box and never reaches the P/T box", async () => {
    const long = await bake(card({ artistCredit: "Edna ".repeat(16).trim() }), "hd");
    const rect = modern.footer!.rect;
    const end = ((rect.leftPct + rect.widthPct) / 100) * HD_W;
    // The line's box ends short of the P/T box (1112.5 px)…
    expect(end).toBeLessThan(1112);
    // …and the credit's ink ends inside it (read up to the stand-in plate).
    const artist = inkBox(long, [231, 1915, 1081, 1984], isDark)!;
    expect(artist.x1).toBeGreaterThan(900);
    expect(artist.x1).toBeLessThanOrEqual(end + 2);
  }, 60_000);

  it("a long name shrinks before its detached cost and is never cut while it can shrink", async () => {
    const long = await bake(card({ title: "Edna Edna Edna Edna Edna Edna", cost: "{4}{R}{R}" }), "hd");
    const name = inkBox(long, NAME, isDark)!;
    const red = inkBox(long, [900, 120, 1420, 230], (c) => c[0] > 180 && c[0] - c[2] > 40)!;
    // Shrunk (capitals under 56 px) and ending before the first disc.
    expect(name.y1 - name.y0).toBeLessThan(54);
    expect(name.x1).toBeLessThan(red.x0 - 68);
  }, 60_000);
});

const REAL_KEYS = ["modern/w.png", "modern/b.png", "modern/g.png", "modern/pt/w.png", "modern/pt/b.png", "modern/pt/g.png", "modernland/c.png"];
describe.skipIf(!haveBucketMasters(REAL_KEYS))("the 2003 frame on its REAL masters (frames bucket)", () => {
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
  const median = (r: Raw, [x0, y0, x1, y1]: number[]) =>
    [0, 1, 2].map((c) => {
      const v: number[] = [];
      for (let y = y0; y < y1; y += 1) for (let x = x0; x < x1; x += 1) v.push(px(r, x, y)[c]);
      return v.sort((a, b) => a - b)[v.length >> 1];
    });

  it("the footer reads on every master: dark on white and green, white on the black frame and on the land (the last two were 1.1–2.3 : 1 in dark ink)", async () => {
    for (const [template, colour, key, white] of [
      ["modern", "white", "w", false],
      ["modern", "green", "g", false],
      ["modern", "black", "b", true],
      ["modernland", "colorless", "c", true],
    ] as const) {
      const data = card({ colorIdentity: [colour], title: " ", artistCredit: " ", frameStyle: { template, finish: "regular" }, ...(template === "modernland" ? { cardType: "land", cost: null, power: null, toughness: null, subtypes: [] } : {}) } as Partial<CardPreviewData>);
      const r = await bake(data, "hd");
      // The ground under the artist line, clear of the brush.
      const ground = median(r, [300, 1930, 1000, 1975]);
      const profile = getFrameProfile(template);
      const ink = footerInk(profile.footer!, key, profile).colorHex;
      const rgb = [1, 3, 5].map((i) => parseInt(ink.slice(i, i + 2), 16));
      expect(ink === "#ffffff", `${template}/${key}`).toBe(white);
      // Green is the lowest ground the prints letter in black (3.9 : 1 on
      // the toned master; the prints set it black all the same).
      expect(contrast(rgb, ground), `${template}/${key} ground ${ground}`).toBeGreaterThanOrEqual(key === "g" ? 3.5 : 4.5);
    }
  }, 180_000);

  it("the P/T stands on the real plate's light face: its digits' rows are light from 1140 to 1360 px", async () => {
    const blank = await bake(card({ colorIdentity: ["white"], power: " ", toughness: " " }), "hd");
    for (const x of [1140, 1250, 1360]) expect(sum(px(blank, x, 1930)), String(x)).toBeGreaterThan(540);
    // …and the value's ink is the frame's dark ink on it.
    const five = inkBox(await bake(card({ colorIdentity: ["white"] }), "hd"), [1150, 1890, 1350, 1975], isDark)!;
    expect(Math.abs((five.x0 + five.x1) / 2 - 1258)).toBeLessThanOrEqual(3.5);
  }, 120_000);

  it("the art window is clear and the slot covers it: art shows through 130–1370 × 252–1161 px", async () => {
    const art = `data:image/png;base64,${(await sharp({ create: { width: 64, height: 64, channels: 3, background: "#ff00ff" } }).png().toBuffer()).toString("base64")}`;
    const r = await bake(card({ colorIdentity: ["white"], artUrl: art }), "hd");
    const magenta = (c: number[]) => c[0] > 230 && c[2] > 230 && c[1] < 40;
    const window = inkBox(r, [100, 200, 1400, 1200], magenta)!;
    expect(Math.abs(window.x0 - 130)).toBeLessThanOrEqual(1);
    expect(Math.abs(window.x1 - 1370)).toBeLessThanOrEqual(1);
    expect(Math.abs(window.y0 - 252)).toBeLessThanOrEqual(1);
    expect(Math.abs(window.y1 - 1161)).toBeLessThanOrEqual(1);
  }, 120_000);
});
