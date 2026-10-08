import sharp from "sharp";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import type { CardPreviewData } from "@/components/cards/card-preview";
import { originalSymbolPath } from "@/lib/cards/symbol-style";
import { getManaCodepoint } from "@/lib/render/card-fonts";
import { frameAssetPathsFor, renderCardImage, type RenderPreset } from "@/lib/render/card-image";
import { bucketKeysOf, haveBucketMasters, serveBucketMasters, type ServedBucketMasters } from "@/tests/stubs/bucket-masters";
import { ORIGINAL_SYMBOL_STAND_INS, serveStandInFrames, type StandInFrames } from "@/tests/stubs/stand-in-frames";

// ---------------------------------------------------------------------------
// The 1993 frame on REAL bakes (TODO 4.10c, layout v48), at HD and at the
// 750 px default — every measure against the Alpha / Beta prints (proof 3,
// 118 scans; lib/cards/typography.ts ALPHA_*). "Dark layer" = the prints'
// dark ink (the lettering is embossed):
//   • name baseline 171.5 px (Beleren 72), type line 1227.4 px (MPlantin
//     70) — both ON the dark layer;
//   • the credit `Illus. <artist>` (MPlantin 70) and the P/T (MPlantin 84)
//     on one line: dark layer 1950.4 / 1950.7 px; ours sits half the emboss
//     above it (1949 px), so the white frame's flat ink and the other keys'
//     dark edge are each within 1.5 px. The credit starts at 153 px, the
//     P/T's ink ends at 1375–1378 px and two digits grow to the left;
//   • flat 72 px cost discs 84 px apart on row 142.5, ending at 1365 px;
//     the five colour symbols are frames-bucket images, the tap the tilted T;
//   • the © slot on the black border: the mark on display, a clean
//     download's footer text.
// The first blocks bake on flat stand-in masters and stand-in symbol discs
// (tests/stubs/stand-in-frames.ts: text, pips and marks are the only ink),
// so they run everywhere; the last bakes the REAL bucket symbols
// (FRAMES_BUILD_DIR, else .frames-build; CI fetches them).
// ---------------------------------------------------------------------------

const TONE = 128;
const HD_W = 1500;

function card(over: Partial<CardPreviewData> = {}): CardPreviewData {
  return {
    title: "Exmn",
    cost: "{4}{R}{R}",
    cardType: "creature",
    supertype: null,
    subtypes: ["Edna"],
    rarity: "rare",
    colorIdentity: ["white"],
    rulesText: "Flying",
    flavorText: null,
    power: "5",
    toughness: "5",
    loyalty: null,
    defense: null,
    artistCredit: "Edna Edna",
    artUrl: null,
    artPosition: {},
    frameStyle: { template: "agclassic", finish: "regular" },
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
/** The dark ink (and the emboss's dark edge) on the 128 stand-in. */
const isDark = (c: number[]) => sum(c) < 170;
/** The embossed silver face on the 128 stand-in. */
const isSilver = (c: number[]) => sum(c) > 420 && Math.abs(c[0] - c[2]) < 24;
/** The stand-in {R} disc (#e49977). */
const isRedDisc = (c: number[]) => c[0] > 200 && c[0] - c[2] > 70;
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
const NAME = [150, 95, 1000, 205];
const TYPE = [150, 1160, 1000, 1246];
const CREDIT = [100, 1880, 1150, 1990];
const PT = [1150, 1880, 1440, 1990];
const COST = [1050, 90, 1440, 200];
const BORDER = [0, 2000, 1500, 2100];

describe("the 1993 frame — text on the prints' rows, at the prints' sizes", () => {
  let frames: StandInFrames;
  beforeAll(async () => {
    frames = await serveStandInFrames([
      { template: "agclassic", keys: ["w", "r"], tone: TONE, pieces: ORIGINAL_SYMBOL_STAND_INS },
      { template: "alphaland", keys: ["c"], tone: TONE },
    ]);
  });
  afterAll(() => frames.restore());

  for (const preset of ["hd", "default"] as const) {
    // A whole px of the 750 bake is two of HD.
    const tol = preset === "hd" ? 1.5 : 3.5;
    it(`${preset}: name 171.5 px, type line 1227.4 px, the credit and the P/T on 1949 px ("Exmn", "Edna": no descender, no ascender past the capital)`, async () => {
      const r = await bake(card(), preset);
      const name = inkBox(r, NAME, isDark)!;
      const type = inkBox(r, TYPE, isDark)!;
      const credit = inkBox(r, CREDIT, isDark)!;
      const pt = inkBox(r, PT, isDark)!;
      expect(Math.abs(name.y1 - 171.5), `name ${JSON.stringify(name)}`).toBeLessThanOrEqual(tol);
      expect(Math.abs(type.y1 - 1227.4), `type ${JSON.stringify(type)}`).toBeLessThanOrEqual(tol);
      // The white frame's flat ink: 1.2–1.5 px above the prints' dark layer
      // (1950.4 / 1950.7), half the emboss the other keys draw under it.
      expect(Math.abs(credit.y1 - 1949.5), `credit ${JSON.stringify(credit)}`).toBeLessThanOrEqual(tol);
      // The P/T's digits stand on the same row; MPlantin's slash dips ~3 px
      // under them (the box read here is "5/5" whole).
      expect(pt.y1, `pt ${JSON.stringify(pt)}`).toBeGreaterThanOrEqual(1949.5 - tol);
      expect(pt.y1).toBeLessThanOrEqual(1949.5 + 6 + tol);
      // Sizes: Beleren's capital E at 72 px is 51 px tall; MPlantin's "d"
      // ascender at 70 px 50 (the prints' type line: rows 1179–1228).
      expect(Math.abs(name.y1 - name.y0 - 51)).toBeLessThanOrEqual(tol + 0.5);
      expect(Math.abs(type.y1 - type.y0 - 50)).toBeLessThanOrEqual(tol + 1);
      // The credit's "l" ascender and capitals: 47–50 px at 70 px (the
      // prints' credit covers rows 1902–1950).
      expect(Math.abs(credit.y1 - credit.y0 - 48.5)).toBeLessThanOrEqual(tol + 1.5);
      // The credit starts where the prints' does (ink at 155–156 px); the
      // name and the type line on the owner's margin, the art window's edge.
      expect(Math.abs(credit.x0 - 155)).toBeLessThanOrEqual(tol + 1);
      expect(name.x0).toBeGreaterThanOrEqual(176);
      expect(name.x0).toBeLessThanOrEqual(186);
      expect(Math.abs(name.x0 - type.x0)).toBeLessThanOrEqual(4);
      // The P/T's ink ends where the prints end a one-digit pair (1370–1380).
      expect(pt.x1, `pt ${JSON.stringify(pt)}`).toBeGreaterThanOrEqual(1370 - tol);
      expect(pt.x1).toBeLessThanOrEqual(1380 + tol);
    }, 60_000);

    it(`${preset}: the cost — three FLAT 72 px discs 84 px apart on row 142.5, ending at 1365 px`, async () => {
      const r = await bake(card({ title: "H" }), preset);
      const none = await bake(card({ title: "H", cost: null }), preset);
      const row = diffBox(none, r)!;
      // Three discs and two 12 px gaps: 240 px, ending on the prints' 1364.9.
      expect(Math.abs(row.x1 - 1365), `row ${JSON.stringify(row)}`).toBeLessThanOrEqual(tol);
      expect(Math.abs(row.x1 - row.x0 - 240)).toBeLessThanOrEqual(tol);
      expect(Math.abs(row.y1 - row.y0 - 72)).toBeLessThanOrEqual(tol - 0.5);
      expect(Math.abs((row.y0 + row.y1) / 2 - 142.5)).toBeLessThanOrEqual(tol);
      // The two {R} discs are the style's IMAGES (the stand-in's flat red,
      // rounded into a disc): 72 + 12 + 72 px.
      const red = inkBox(r, COST, isRedDisc)!;
      expect(Math.abs(red.x1 - red.x0 - 156)).toBeLessThanOrEqual(tol);
      expect(Math.abs(red.y1 - red.y0 - 72)).toBeLessThanOrEqual(tol - 0.5);
      // Round: the image's corner is the frame, not the stand-in's square.
      const k = r.w / HD_W;
      expect(isRedDisc(px(r, Math.round((red.x1 - 2) * k), Math.round((red.y0 + 2) * k)))).toBe(false);
      expect(isRedDisc(px(r, Math.round((red.x1 - 36) * k), Math.round((red.y0 + 36) * k)))).toBe(true);
      // Flat: "modern" would hang a #111 crescent 4–5 px below and left of
      // each disc — under and beside the row nothing differs from the
      // cost-less bake, and nothing is dark.
      expect(inkBox(r, [1050, row.y1 + 1, 1440, row.y1 + 14], isDark)).toBeNull();
      expect(inkBox(r, [row.x0 - 14, row.y0, row.x0 - 1, row.y1], isDark)).toBeNull();
    }, 60_000);
  }

  it("the embossed keys: a silver face with the dark edge 0.035 em down and right — the edge lands on the prints' dark layer", async () => {
    const r = await bake(card({ colorIdentity: ["red"] }), "hd");
    for (const [band, sizePx, row, label] of [
      [CREDIT, 70, 1950.4, "credit"],
      [PT, 84, 1950.7, "pt"],
    ] as const) {
      const face = inkBox(r, band, isSilver)!;
      const edge = inkBox(r, band, isDark)!;
      expect(face, label).not.toBeNull();
      expect(edge, label).not.toBeNull();
      const off = sizePx * 0.035;
      expect(Math.abs(edge.x1 - face.x1 - off), `${label} dx`).toBeLessThanOrEqual(1.5);
      // A drop edge, not an outline: nothing dark left of or above the face.
      expect(edge.x0).toBeGreaterThanOrEqual(face.x0 - 1);
      expect(edge.y0).toBeGreaterThanOrEqual(face.y0 - 1);
      if (label === "credit") {
        expect(Math.abs(edge.y1 - face.y1 - off), `${label} dy`).toBeLessThanOrEqual(1.5);
        // print − ours on the dark layer: within 1.5 px.
        expect(Math.abs(edge.y1 - row), `${label} ${JSON.stringify(edge)}`).toBeLessThanOrEqual(2);
      }
    }
    // The name and the type line stay flat dark on red (owner 2026-09-25).
    expect(inkBox(r, NAME, isSilver)).toBeNull();
    expect(inkBox(r, NAME, isDark)).not.toBeNull();
  }, 60_000);

  it("a two-digit P/T grows to the LEFT at full size, as DRK #30 10/10 and ICE #89 11/11 print it", async () => {
    const none = await bake(card({ power: null, toughness: null }), "hd");
    const one = diffBox(none, await bake(card({ power: "5", toughness: "5" }), "hd"))!;
    const two = diffBox(none, await bake(card({ power: "10", toughness: "10" }), "hd"))!;
    expect(Math.abs(two.x1 - one.x1)).toBeLessThanOrEqual(3);
    expect(one.x0 - two.x0).toBeGreaterThan(80);
    expect(Math.abs(two.y1 - two.y0 - (one.y1 - one.y0))).toBeLessThanOrEqual(1);
    // Clear of the pinstripe's dark line (~1405 px) and the credit's box.
    expect(two.x1).toBeLessThanOrEqual(1400);
    expect(two.x0).toBeGreaterThanOrEqual(1160);
  }, 60_000);

  it("a long name shrinks to its room instead of being cut; a long credit takes its ellipsis before the P/T", async () => {
    // {3}{W}{W}{W}: four discs and three gaps start at 1365 − 324 = 1041 px.
    const long = await bake(card({ title: "Personal Incarnation of the Northern Paladin", cost: "{3}{W}{W}{W}" }), "hd");
    const name = inkBox(long, [150, 95, 1036, 205], isDark)!;
    // The name's last ink stays left of the first disc, with the band's gap…
    expect(name.x1).toBeLessThan(1041 - 4);
    expect(name.x1).toBeGreaterThan(780);
    // …because it shrank: its capitals are under the 51 px of the full size
    // ("P", "I", "N": no ascender past them but the "f"/"l"/"h"/"t"/"d").
    const short = inkBox(await bake(card({ title: "Personal", cost: "{3}{W}{W}{W}" }), "hd"), [150, 95, 1036, 205], isDark)!;
    expect(name.y1 - name.y0).toBeLessThan(short.y1 - short.y0 - 6);
    const credit = await bake(card({ artistCredit: "Bartholomew Maximilian Featherstonehaugh-Cholmondeley the Younger", power: "10", toughness: "10" }), "hd");
    const line = inkBox(credit, CREDIT, isDark)!;
    expect(line.x1).toBeLessThanOrEqual(1150);
  }, 60_000);

  it("the land: no cost, `Land` a pixel under the other cards' type line (1228 px), the same credit line", async () => {
    const r = await bake(card({ frameStyle: { template: "alphaland", finish: "regular" }, colorIdentity: [], cardType: "land", cost: null, subtypes: [], power: null, toughness: null } as Partial<CardPreviewData>), "hd");
    // The land's strip ink is silver on every key, with the dark edge.
    const type = inkBox(r, TYPE, isDark)!;
    expect(Math.abs(type.y1 - 1228.6), JSON.stringify(type)).toBeLessThanOrEqual(1.5);
    const edge = inkBox(r, CREDIT, isDark)!;
    expect(Math.abs(edge.y1 - 1950.4), JSON.stringify(edge)).toBeLessThanOrEqual(2);
    expect(inkBox(r, COST, isRedDisc)).toBeNull();
  }, 60_000);

  it("warms exactly the symbol images the card's text draws, and fetches them from the bucket", async () => {
    expect(frameAssetPathsFor(card({ cost: "{2}{W}{W}", rulesText: "{T}: Add {G}." })).filter((p) => p.includes("manaoriginal")).sort()).toEqual([
      originalSymbolPath("g"),
      originalSymbolPath("w"),
    ]);
    expect(frameAssetPathsFor(card({ cost: "{4}", rulesText: "{T}: Draw a card." })).filter((p) => p.includes("manaoriginal"))).toEqual([]);
    // A second face's and a structured face's symbols count too.
    expect(
      frameAssetPathsFor(card({ cost: "{4}", backFace: { title: "Back", cost: "{U}", rules_text: "Add {B}." } } as never)).filter((p) => p.includes("manaoriginal")).sort(),
    ).toEqual([originalSymbolPath("b"), originalSymbolPath("u")]);
    // Another frame never asks for them.
    expect(frameAssetPathsFor(card({ frameStyle: { template: "tarkirdragon", finish: "regular" } })).filter((p) => p.includes("manaoriginal"))).toEqual([]);
    frames.fetched.length = 0;
    await bake(card({ cost: "{R}", rulesText: "Add {G}." }), "default");
    // (Cached after the first fetch: at least the green one is new here.)
    expect(frames.fetched).toContain("manaoriginal/g.png");
  }, 60_000);

  it("the rules text: the colour pip is the image too, flat; {T} is the tilted T", async () => {
    const nodes: { textContent?: string }[] = [];
    const res = await renderCardImage(card({ rulesText: "{T}: Add {R}." }), "hd", {
      brandMark: false,
      watermarkText: null,
      printLayer: { omitArt: false, outputWidth: 1500, onNodeDetected: (node) => nodes.push(node as { textContent?: string }) },
    });
    const { data, info } = await sharp(Buffer.from(await res.arrayBuffer())).removeAlpha().raw().toBuffer({ resolveWithObject: true });
    const r = { data, w: info.width, h: info.height };
    const texts = nodes.map((n) => n.textContent);
    expect(texts).toContain(getManaCodepoint("tap-3ed"));
    expect(texts).not.toContain(getManaCodepoint("tap"));
    // No font glyph is drawn for {R}: the pip is the image.
    expect(texts).not.toContain(getManaCodepoint("r"));
    const pip = inkBox(r, [220, 1270, 1300, 1830], isRedDisc)!;
    expect(pip).not.toBeNull();
    // The inline disc: 0.785 em of the 76 px rules text.
    expect(Math.abs(pip.x1 - pip.x0 - 60)).toBeLessThanOrEqual(1.5);
    expect(Math.abs(pip.y1 - pip.y0 - 60)).toBeLessThanOrEqual(1.5);
  }, 60_000);

  it("an owner's custom pip still draws its own image, over the style's", async () => {
    const magenta = await sharp({ create: { width: 32, height: 32, channels: 4, background: { r: 255, g: 0, b: 255, alpha: 1 } } }).png().toBuffer();
    const src = `data:image/png;base64,${magenta.toString("base64")}`;
    const r = await bake(card({ title: "H", pipOverrides: { R: src } } as Partial<CardPreviewData>), "hd");
    const isMagenta = (c: number[]) => c[0] > 220 && c[2] > 220 && c[1] < 60;
    const own = inkBox(r, COST, isMagenta)!;
    expect(own).not.toBeNull();
    expect(Math.abs(own.x1 - own.x0 - 156)).toBeLessThanOrEqual(1.5);
    expect(Math.abs(own.x1 - 1365)).toBeLessThanOrEqual(1.5);
    expect(inkBox(r, COST, isRedDisc)).toBeNull();
  }, 60_000);

  it("the © slot: the mark on the black border on display, ending 3.5 % in; a clean download's footer text there — never on the credit line", async () => {
    const data = card();
    const none = await bake(data, "hd");
    const mark = diffBox(none, await bake(data, "hd", { brandMark: true }))!;
    expect(mark.y0).toBeGreaterThanOrEqual(BORDER[1]);
    expect(mark.y1).toBeLessThanOrEqual(BORDER[3]);
    expect(Math.abs(mark.x1 - 0.965 * 1500)).toBeLessThanOrEqual(4);
    expect(Math.abs((mark.y0 + mark.y1) / 2 - 2050)).toBeLessThanOrEqual(6);
    const text = diffBox(none, await bake(data, "hd", { watermarkText: "Proxy Press" }))!;
    expect(text.y0).toBeGreaterThanOrEqual(BORDER[1]);
    expect(text.y1).toBeLessThanOrEqual(BORDER[3]);
    expect(Math.abs(text.x1 - 0.965 * 1500)).toBeLessThanOrEqual(4);
    // …and with no footer text a clean download draws nothing more.
    expect(diffBox(none, await bake(data, "hd", { watermarkText: "   " }))).toBeNull();
  }, 60_000);
});

// The REAL symbols (Card Conjurer's, in the frames bucket — never git).
const SYMBOL_KEYS = bucketKeysOf("manaoriginal");
describe.skipIf(!haveBucketMasters(SYMBOL_KEYS) || SYMBOL_KEYS.length === 0)("the 1993 frame — the published symbols", () => {
  let served: ServedBucketMasters;
  beforeAll(() => {
    served = serveBucketMasters(SYMBOL_KEYS);
  });
  afterAll(() => served.restore());

  it("five 216 px PNGs, each a round pip: clear corners, a pale disc, a black drawing", async () => {
    expect([...SYMBOL_KEYS].sort()).toEqual(["b", "g", "r", "u", "w"].map((c) => `manaoriginal/${c}.png`));
    const { bucketMaster } = await import("@/tests/stubs/bucket-masters");
    for (const key of SYMBOL_KEYS) {
      const { data, info } = await sharp(bucketMaster(key)!).ensureAlpha().raw().toBuffer({ resolveWithObject: true });
      expect([info.width, info.height], key).toEqual([216, 216]);
      const at = (x: number, y: number) => [...data.subarray((y * info.width + x) * 4, (y * info.width + x) * 4 + 4)];
      for (const [x, y] of [[0, 0], [215, 0], [0, 215], [215, 215]]) expect(at(x, y)[3], `${key} corner`).toBe(0);
      // The rim is the disc's pale colour, opaque; the drawing is black.
      const rim = at(108, 6);
      expect(rim[3], key).toBe(255);
      expect(rim[0] + rim[1] + rim[2], key).toBeGreaterThan(300);
      let black = 0;
      for (let p = 0; p < info.width * info.height; p += 1) if (data[p * 4 + 3] === 255 && data[p * 4] + data[p * 4 + 1] + data[p * 4 + 2] < 90) black += 1;
      expect(black / (info.width * info.height), key).toBeGreaterThan(0.12);
      expect(black / (info.width * info.height), key).toBeLessThan(0.6);
    }
  });

  it("a real bake draws all five in the cost row — five different discs, each with its black drawing", async () => {
    const r = await bake(card({ title: "H", cost: "{W}{U}{B}{R}{G}" }), "hd");
    const none = await bake(card({ title: "H", cost: null }), "hd");
    const row = diffBox(none, r)!;
    expect(Math.abs(row.x1 - 1365)).toBeLessThanOrEqual(1.5);
    expect(Math.abs(row.x1 - row.x0 - (5 * 72 + 4 * 12))).toBeLessThanOrEqual(1.5);
    // Each disc's mean colour: five different pips.
    const mean = (i: number) => {
      const acc = [0, 0, 0];
      let n = 0;
      for (let y = Math.round(row.y0 + 12); y < row.y1 - 12; y += 1) {
        for (let x = Math.round(row.x0 + i * 84 + 12); x < row.x0 + i * 84 + 60; x += 1) {
          const c = px(r, x, y);
          acc[0] += c[0];
          acc[1] += c[1];
          acc[2] += c[2];
          n += 1;
        }
      }
      return acc.map((v) => Math.round(v / n / 8)).join(",");
    };
    expect(new Set([0, 1, 2, 3, 4].map(mean)).size).toBe(5);
    for (let i = 0; i < 5; i += 1) expect(inkBox(r, [row.x0 + i * 84 + 8, row.y0 + 8, row.x0 + i * 84 + 64, row.y1 - 8], (c) => sum(c) < 90), `disc ${i}`).not.toBeNull();
    expect(served.fetched.filter((k) => k.startsWith("manaoriginal/")).sort()).toEqual([...SYMBOL_KEYS].sort());
  }, 60_000);
});
