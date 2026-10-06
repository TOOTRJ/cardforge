import sharp from "sharp";
import { beforeAll, describe, expect, it, vi } from "vitest";
import type { CardPreviewData } from "@/components/cards/card-preview";
import { backPreviewData, frontPreviewData } from "@/lib/cards/faces";
import { MDFC_FLIPSIDE_FRONT, MDFC_STRIP_RIDER_FRONT } from "@/lib/cards/template-layout";
import { frameAssetPathsFor } from "@/lib/render/card-image";
import { MDFC_STRIP_BOX, cutStripRider, insideMaskEroded } from "@/scripts/lib/cc-frames.mjs";

// ---------------------------------------------------------------------------
// TODO 5.1c on REAL bakes: the modal flipside strip rider. The masters live
// in the frames bucket (never in git), so the bake is served stand-ins — a
// flat mid-grey card, a RED strip piece for any strip path, a white crown —
// and records which overlay paths it asked for:
//   • a two-colour modal card asks for the OTHER face's piece from this
//     face's own strip folder (W front // U back: strip/u on the front,
//     strip/w on the back), the land pair the same; a mono-colour card, a
//     legacy back, a transform front and a plain frame ask for none;
//   • the piece is painted inside the slot's box, under the strip's texts
//     (the white word on a front, the dark one on a back, ON the red), and
//     the crown comes before it;
//   • the painted strip stays the rules keep-out it was: a long rules text
//     bakes the same pixels with the rider as without, outside the box;
//   • the slot lands the piece 1:1 through Satori + the rasteriser: a piece
//     cut from a synthetic master's tab and drawn back over it changes 0 px
//     at HD, and at the 750 bake only the cut's resampled edge.
// ---------------------------------------------------------------------------

const stand = vi.hoisted(() => ({ grey: "", plate: "", crown: "", strip: "" as string | null, master: null as string | null, overlays: [] as string[], masters: [] as string[] }));

vi.mock("@/lib/render/card-frames", async (importOriginal) => {
  const real = await importOriginal<typeof import("@/lib/render/card-frames")>();
  return {
    ...real,
    preloadFrame: async () => {},
    preloadFrameAssets: async () => {},
    getFrameDataUrl: (template: string, key: string) => {
      stand.masters.push(`${template}/${key}`);
      return stand.master ?? stand.grey;
    },
    getPlateDataUrlForPath: () => stand.plate,
    getFrameOverlayDataUrl: (path: string) => {
      stand.overlays.push(path);
      return path.includes("/strip/") ? stand.strip : stand.crown;
    },
    getFrameAssetDataUrl: () => null,
  };
});

async function solid(rgb: [number, number, number], w = 16, h = 16): Promise<string> {
  const png = await sharp({ create: { width: w, height: h, channels: 4, background: { r: rgb[0], g: rgb[1], b: rgb[2], alpha: 1 } } }).png().toBuffer();
  return `data:image/png;base64,${png.toString("base64")}`;
}

beforeAll(async () => {
  stand.grey = await solid([128, 128, 128]);
  stand.plate = await solid([40, 40, 40], 64, 32);
  stand.crown = await solid([255, 255, 255], 64, 16);
  stand.strip = await solid([220, 30, 30], 64, 16);
});

type Back = NonNullable<CardPreviewData["backFace"]>;
const BACK: Back = {
  title: "Echoing Equation",
  cost: "{3}{U}{U}",
  card_type: "sorcery",
  subtypes: [],
  rules_text: "Choose target creature you control.",
  frame_style: { template: "m15mdfcback" },
  color_identity: ["blue"],
} as Back;

function card(over: Partial<CardPreviewData> = {}, back: Partial<Back> | null = {}): CardPreviewData {
  return {
    title: "Augmenter Pugilist",
    cost: "{1}{W}{W}",
    cardType: "creature",
    supertype: null,
    subtypes: ["Troll", "Druid"],
    rarity: "rare",
    colorIdentity: ["white"],
    rulesText: "Trample",
    flavorText: null,
    power: "3",
    toughness: "3",
    loyalty: null,
    defense: null,
    artistCredit: "Test",
    artUrl: null,
    artPosition: {},
    frameStyle: { template: "m15mdfcfront", finish: "regular" },
    backCard: null,
    faceContent: null,
    watermark: null,
    setCode: null,
    collectorNumber: null,
    lang: null,
    ...over,
    backFace: back === null ? null : { ...BACK, ...back },
  } as CardPreviewData;
}

type Baked = { data: Buffer; w: number; h: number; png: Buffer };
async function bake(c: CardPreviewData, preset: "hd" | "default" = "hd"): Promise<Baked> {
  stand.masters.length = 0;
  stand.overlays.length = 0;
  const { renderCardImage } = await import("@/lib/render/card-image");
  const png = Buffer.from(await (await renderCardImage(c, preset, { brandMark: false, watermarkText: null })).arrayBuffer());
  const { data, info } = await sharp(png).ensureAlpha().raw().toBuffer({ resolveWithObject: true });
  return { data, w: info.width, h: info.height, png };
}
const px = (b: Baked, x: number, y: number) => { const o = (y * b.w + x) * 4; return [b.data[o], b.data[o + 1], b.data[o + 2], b.data[o + 3]]; };
const isRed = (p: number[]) => p[0] > 180 && p[1] < 80 && p[2] < 80;
const isWhite = (p: number[]) => p[0] > 235 && p[1] > 235 && p[2] > 235;
const isDark = (p: number[]) => p[0] < 70 && p[1] < 70 && p[2] < 70;
/** The slot's box at the bake's scale. */
const box = (s = 1) => ({ x0: MDFC_STRIP_BOX.x * s, y0: MDFC_STRIP_BOX.y * s, x1: (MDFC_STRIP_BOX.x + MDFC_STRIP_BOX.width) * s, y1: (MDFC_STRIP_BOX.y + MDFC_STRIP_BOX.height) * s });
function count(b: Baked, area: ReturnType<typeof box>, hit: (p: number[]) => boolean): number {
  let n = 0;
  for (let y = area.y0; y < area.y1; y += 1) for (let x = area.x0; x < area.x1; x += 1) if (hit(px(b, x, y))) n += 1;
  return n;
}
/** The pixels that differ between two bakes of the same size, split by
 *  whether they lie inside the slot's box. */
function differing(a: Baked, b: Baked, area: ReturnType<typeof box>): { inside: number; outside: number; max: number } {
  let inside = 0;
  let outside = 0;
  let max = 0;
  for (let y = 0; y < a.h; y += 1) {
    for (let x = 0; x < a.w; x += 1) {
      const o = (y * a.w + x) * 4;
      let d = 0;
      for (let c = 0; c < 4; c += 1) d = Math.max(d, Math.abs(a.data[o + c] - b.data[o + c]));
      if (!d) continue;
      if (d > max) max = d;
      if (x >= area.x0 && x < area.x1 && y >= area.y0 && y < area.y1) inside += 1;
      else outside += 1;
    }
  }
  return { inside, outside, max };
}

describe("the modal strip rider on real bakes (TODO 5.1c)", () => {
  it("a W front // U back asks for the other face's piece from each face's own folder and paints it in the slot's box, under the strip's texts; the slot's rect is the box", async () => {
    expect(MDFC_STRIP_RIDER_FRONT.rect.leftPct * 15).toBeCloseTo(MDFC_STRIP_BOX.x, 9);
    const c = card();
    const front = await bake(frontPreviewData(c));
    expect(stand.overlays).toEqual(["/frames/m15mdfcfront/strip/u.png"]);
    expect(frameAssetPathsFor(frontPreviewData(c))).toEqual(["/frames/m15/pt/w.png", "/frames/m15mdfcfront/strip/u.png"]);
    const area = box();
    // The red stand-in fills the box — but for the texts on top of it.
    expect(count(front, area, isRed)).toBeGreaterThan(MDFC_STRIP_BOX.width * MDFC_STRIP_BOX.height * 0.6);
    // Just outside the box: the grey card, never red (the slot is the box).
    expect(isRed(px(front, area.x1 + 2, (area.y0 + area.y1) >> 1))).toBe(false);
    expect(isRed(px(front, (area.x0 + area.x1) >> 1, area.y0 - 2))).toBe(false);
    expect(isRed(px(front, (area.x0 + area.x1) >> 1, area.y1 + 1))).toBe(false);
    expect(isRed(px(front, area.x0 - 1, (area.y0 + area.y1) >> 1))).toBe(false);
    // The front's WHITE word ("Sorcery") and line ink are drawn over the red.
    const wordRect = MDFC_FLIPSIDE_FRONT.word.rect;
    const word = { x0: Math.round((wordRect.leftPct / 100) * 1500), x1: Math.round((wordRect.leftPct / 100) * 1500) + 330, y0: area.y0, y1: area.y1 };
    expect(count(front, word, isWhite)).toBeGreaterThan(200);
    const back = await bake(backPreviewData(c)!);
    expect(stand.overlays).toEqual(["/frames/m15mdfcback/strip/w.png"]);
    expect(count(back, area, isRed)).toBeGreaterThan(MDFC_STRIP_BOX.width * MDFC_STRIP_BOX.height * 0.6);
    // The back's word ("Druid") in DARK ink over the red.
    expect(count(back, word, isDark)).toBeGreaterThan(200);
  });

  it("a mono-colour card, a back with no colour of its own, a legacy back, a transform front and a plain frame ask for no strip piece", async () => {
    await bake(frontPreviewData(card({}, { color_identity: ["white"], cost: "{3}{W}{W}" })));
    expect(stand.overlays).toEqual([]);
    await bake(backPreviewData(card({}, { color_identity: ["white"], cost: "{3}{W}{W}" }))!);
    expect(stand.overlays).toEqual([]);
    expect(frameAssetPathsFor(frontPreviewData(card({}, { color_identity: ["white"] })))).toEqual(["/frames/m15/pt/w.png"]);
    await bake(frontPreviewData(card({}, { color_identity: undefined as never })));
    expect(stand.overlays).toEqual([]);
    const legacy = card({}, { frame_style: {} as never });
    await bake(backPreviewData(legacy)!);
    expect(stand.overlays).toEqual([]);
    await bake(frontPreviewData(card({ frameStyle: { template: "m15dfcfront", finish: "regular" } }, { frame_style: { template: "m15dfcback" }, cost: "" })));
    expect(stand.overlays).toEqual(["/frames/dfcicon/default.png"]);
    await bake(frontPreviewData(card({ frameStyle: { template: "m15", finish: "regular" } })));
    expect(stand.overlays).toEqual([]);
  });

  it("the land pair (a pathway): each face carries the other's colour from its own folder; a Legendary pair card draws the crown first, then the rider", async () => {
    const pathway = card(
      { title: "Branchloft Pathway", cardType: "land", cost: null, colorIdentity: ["green"], rulesText: "{T}: Add {G}.", power: null, toughness: null, subtypes: [], frameStyle: { template: "m15mdfclandfront", finish: "regular" } },
      { title: "Boulderloft Pathway", cost: "", card_type: "land", rules_text: "{T}: Add {W}.", frame_style: { template: "m15mdfclandback" }, color_identity: ["white"] },
    );
    await bake(frontPreviewData(pathway));
    expect(stand.overlays).toEqual(["/frames/m15mdfclandfront/strip/w.png"]);
    await bake(backPreviewData(pathway)!);
    expect(stand.overlays).toEqual(["/frames/m15mdfclandback/strip/g.png"]);
    // KHM #114's shape with a crown: a Legendary black front, a B/R back → the crown's piece, then gold.
    const valki = card(
      { title: "Valki, God of Lies", supertype: "Legendary", cost: "{1}{B}", colorIdentity: ["black"], frameStyle: { template: "m15mdfcfront", finish: "regular", crown: true } },
      { title: "Tibalt, Cosmic Impostor", cost: "{5}{B}{R}", color_identity: ["black", "red"] },
    );
    const front = await bake(frontPreviewData(valki));
    expect(stand.overlays).toEqual(["/frames/m15mdfccrown/b.png", "/frames/m15mdfcfront/strip/m.png"]);
    expect(count(front, box(), isRed)).toBeGreaterThan(MDFC_STRIP_BOX.width * MDFC_STRIP_BOX.height * 0.6);
  });

  it("the painted strip stays the rules keep-out: a long text bakes the same pixels with the rider as without, outside the slot's box (HD and 750)", async () => {
    const long = "Whenever a creature you control attacks, draw a card. Whenever a creature you control attacks, draw a card. Whenever a creature you control attacks, draw a card. Whenever a creature you control attacks, draw a card. Whenever a creature you control attacks, draw a card. Whenever a creature you control attacks, draw a card.";
    for (const [preset, s] of [["hd", 1], ["default", 0.5]] as const) {
      const ridden = await bake(frontPreviewData(card({ rulesText: long })), preset);
      expect(stand.overlays).toEqual(["/frames/m15mdfcfront/strip/u.png"]);
      stand.strip = null; // the piece absent: nothing drawn (frameAssetPathsFor would have thrown for a bucket piece; here the stand-in is simply gone)
      try {
        const bare = await bake(frontPreviewData(card({ rulesText: long })), preset);
        const d = differing(ridden, bare, box(s));
        expect(d.outside, `${preset}: pixels outside the slot's box`).toBe(0);
        expect(d.inside, `${preset}: the red inside it`).toBeGreaterThan(1000 * s);
        // The rules ink reached the strip's rows (the long text wraps round
        // the keep-out): dark ink on the rows above the tab, right of it.
        expect(count(ridden, { x0: Math.round(760 * s), x1: Math.round(1380 * s), y0: Math.round(1870 * s), y1: Math.round(1950 * s) }, isDark)).toBeGreaterThan(50 * s);
      } finally {
        stand.strip = await solid([220, 30, 30], 64, 16);
      }
    }
  });

  it("the slot lands the piece 1:1: a piece cut from a synthetic master's tab and drawn back over it changes 0 px at HD; at the 750 bake only the cut's resampled edge", async () => {
    // A 1500 × 2100 master with a deterministic texture everywhere (a busy
    // strip zone), and a tab-shaped mask: the rectangle x 45–660 × y 1866–
    // 1955 with a 40-px chevron tip, a 128 rim round it.
    const W = 1500;
    const H = 2100;
    const master = Buffer.alloc(W * H * 4);
    for (let y = 0; y < H; y += 1) {
      for (let x = 0; x < W; x += 1) {
        const o = (y * W + x) * 4;
        master[o] = (x * 31 + y * 17) & 255;
        master[o + 1] = (x * 7 + y * 29 + 90) & 255;
        master[o + 2] = (x * 13 + y * 3 + 180) & 255;
        master[o + 3] = 255;
      }
    }
    const inTab = (x: number, y: number) => (x >= 45 && x < 660 && y >= 1866 && y < 1956) || (x >= 660 && x < 701 && Math.abs(y - 1910.5) <= 44 - (x - 660) * 1.1);
    const mask = Buffer.alloc(W * H * 4);
    for (let y = 1860; y < 1962; y += 1) {
      for (let x = 40; x < 706; x += 1) {
        const o = (y * W + x) * 4;
        if (inTab(x, y)) mask[o + 3] = 255;
        else if ([[1, 0], [-1, 0], [0, 1], [0, -1]].some(([dx, dy]) => inTab(x + dx, y + dy))) mask[o + 3] = 128;
      }
    }
    const inside = insideMaskEroded(mask, W, H, 1);
    const piece = cutStripRider(master, inside, W, MDFC_STRIP_BOX);
    const masterPng = await sharp(master, { raw: { width: W, height: H, channels: 4 } }).png().toBuffer();
    const piecePng = await sharp(piece, { raw: { width: MDFC_STRIP_BOX.width, height: MDFC_STRIP_BOX.height, channels: 4 } }).png().toBuffer();
    stand.master = `data:image/png;base64,${masterPng.toString("base64")}`;
    try {
      for (const [preset, s] of [["hd", 1], ["default", 0.5]] as const) {
        stand.strip = `data:image/png;base64,${piecePng.toString("base64")}`;
        const ridden = await bake(frontPreviewData(card()), preset);
        expect(stand.overlays).toEqual(["/frames/m15mdfcfront/strip/u.png"]);
        stand.strip = null;
        const bare = await bake(frontPreviewData(card()), preset);
        const d = differing(ridden, bare, box(s));
        expect(d.outside, `${preset}: outside the box`).toBe(0);
        if (preset === "hd") {
          expect(d, "HD: the piece is the master, pixel for pixel, where it lands").toEqual({ inside: 0, outside: 0, max: 0 });
        } else {
          // The 2:1 resample across the cut: only the cut's edge pixels differ
          // (the synthetic master has no uniform outline for the cut to run
          // inside, so every edge pixel moves — the real pieces' residual is
          // 1–6 px, tests/unit/frames/mdfc-strip-rider.test.ts).
          expect(d.inside).toBeGreaterThan(0);
          expect(d.inside).toBeLessThanOrEqual(1500);
        }
      }
    } finally {
      stand.master = null;
      stand.strip = await solid([220, 30, 30], 64, 16);
    }
  }, 120_000);
});
