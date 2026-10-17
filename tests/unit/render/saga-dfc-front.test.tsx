import sharp from "sharp";
import { beforeAll, describe, expect, it, vi } from "vitest";
import type { CardPreviewData } from "@/components/cards/card-preview";
import { frontPreviewData } from "@/lib/cards/faces";
import { DFC_ICON_RIDER, SAGA_DFC_RAIL_FOOT_PX, SAGA_DFC_REVERSE_PT } from "@/lib/cards/template-layout";
import { frameAssetPathsFor } from "@/lib/render/card-image";

// ---------------------------------------------------------------------------
// TODO 5.5 (b) on REAL bakes, at HD and at the 750 px default: the
// double-faced saga front (`sagadfcfront`, NEO's transforming Sagas) draws
// what the prints put there — the icon rider in the transform front's well,
// the name from the left-well inset (the prints' ink at 250–251 px), the
// back's P/T in #777 LEFT-aligned at the tab (the prints' digits from
// 125–133 px, median 128, over 1679–1682 → 1724–1727 px: 23 NEO fronts
// measured on Scryfall's PNGs) and only when the back prints one, and the
// chapters ending ABOVE the tab (the rail's foot, SAGA_DFC_RAIL_FOOT_PX: no
// print's chapter ink passes ~1655 px). The masters live in the frames
// bucket: the bake is served a flat mid-grey card and a stand-in rider (a
// white square), so the text and the rider are the only marks on it.
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

async function solid(v: number, w = 16, h = 16): Promise<string> {
  const png = await sharp({ create: { width: w, height: h, channels: 4, background: { r: v, g: v, b: v, alpha: 1 } } })
    .png()
    .toBuffer();
  return `data:image/png;base64,${png.toString("base64")}`;
}

beforeAll(async () => {
  stand.grey = await solid(128);
  stand.plate = await solid(40, 64, 32);
  stand.rider = await solid(255, 32, 32);
  stand.black = await solid(0);
});

const LONG = "Create a 2/2 red Goblin Shaman creature token with “Whenever this creature attacks, create a Treasure token.”";

function saga(back: Record<string, unknown> | null = {}, chapters = [LONG, "You may discard up to two cards. If you do, draw that many cards.", "Exile this Saga, then return it to the battlefield transformed under your control."]): CardPreviewData {
  return {
    title: "HHHH",
    cost: "{2}{R}",
    cardType: "enchantment",
    supertype: null,
    subtypes: ["Saga"],
    rarity: "rare",
    colorIdentity: ["red"],
    rulesText: null,
    flavorText: null,
    power: null,
    toughness: null,
    loyalty: null,
    defense: null,
    artistCredit: null,
    artUrl: null,
    artPosition: {},
    frameStyle: { template: "sagadfcfront", finish: "regular", dfcIcon: "fan" },
    setIconUrl: stand.black,
    setIconCode: null,
    backFace:
      back === null
        ? null
        : {
            title: "Reflection of Kiki-Jiki",
            cost: "",
            card_type: "creature",
            supertype: "Enchantment",
            subtypes: ["Goblin", "Shaman"],
            rules_text: "Haste",
            power: "2",
            toughness: "2",
            frame_style: { template: "m15dfcbackleft" },
            color_identity: ["red"],
            ...back,
          },
    faceContent: {
      saga: {
        intro: "(As this Saga enters and after your draw step, add a lore counter. Sacrifice after III.)",
        chapters: chapters.map((text, i) => ({ numerals: [i + 1], text })),
      },
    },
    watermark: null,
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

const dark = (l: number) => l < 60;
const white = (l: number) => l > 200;
/** The reverse P/T's grey (#777 = 119) against the mid-grey card (128). */
const reverseGrey = (l: number) => l < 123 && l > 100;

const PRESETS = [
  ["hd", 1],
  ["default", 0.5],
] as const;

/** The tab's box: under the rail's foot, left of the art window. */
const TAB = (s: number): Box => ({ x0: 60 * s, x1: 700 * s, y0: (SAGA_DFC_RAIL_FOOT_PX - 4) * s, y1: 1760 * s });

describe("the double-faced saga front on real bakes (TODO 5.5 (b))", () => {
  it("frameAssetPathsFor: the front's rider for the card's family (NEO's closed fan)", () => {
    expect(frameAssetPathsFor(frontPreviewData(saga()))).toContain("/frames/dfcicon/fanclosed.png");
  });

  it.each(PRESETS)("@%s: the rider in the well, the name from the left-well inset, the back's P/T left-aligned at the tab, the chapters above it", async (preset, s) => {
    const b = await bake(frontPreviewData(saga()), preset);
    const r = DFC_ICON_RIDER.rect;
    const rider = inkBox(b, { x0: 0, x1: 240 * s, y0: 0, y1: 300 * s }, white)!;
    expect(rider, "rider drawn").not.toBeNull();
    expect(Math.abs(rider.x0 - (r.leftPct / 100) * b.w)).toBeLessThanOrEqual(1);
    expect(Math.abs(rider.y1 - ((r.topPct + r.heightPct) / 100) * b.h)).toBeLessThanOrEqual(1);
    const name = inkBox(b, { x0: 230 * s, x1: 900 * s, y0: 100 * s, y1: 230 * s }, dark)!;
    expect(name.x0 / s).toBeGreaterThanOrEqual(249 - 1 / s);
    expect(name.x0 / s).toBeLessThanOrEqual(252 + 1 / s);
    // "2/2": its ink from the prints' 125–133 px, over their rows.
    const pt = inkBox(b, TAB(s), reverseGrey)!;
    expect(pt, "reverse P/T drawn").not.toBeNull();
    expect(pt.x0 / s).toBeGreaterThanOrEqual(125 - 1 / s);
    expect(pt.x0 / s).toBeLessThanOrEqual(133 + 1 / s);
    expect(pt.y0 / s).toBeGreaterThanOrEqual(1676);
    expect(pt.y0 / s).toBeLessThanOrEqual(1685);
    expect(pt.y1 / s).toBeGreaterThanOrEqual(1722);
    expect(pt.y1 / s).toBeLessThanOrEqual(1731);
    // The chapters (a full rail) end above the tab: no dark ink in the
    // chapters' column at or under the foot.
    const column = inkBox(b, { x0: 200 * s, x1: 740 * s, y0: 1300 * s, y1: 1760 * s }, dark)!;
    expect(column, "chapter text drawn").not.toBeNull();
    expect(column.y1 / s).toBeLessThanOrEqual(SAGA_DFC_RAIL_FOOT_PX);
  }, 90_000);

  it.each(PRESETS)("@%s: the tab prints EMPTY when the back prints no P/T", async (preset, s) => {
    const b = await bake(frontPreviewData(saga({ card_type: "enchantment", supertype: null, subtypes: ["Aura"], power: null, toughness: null })), preset);
    expect(inkBox(b, TAB(s), reverseGrey)).toBeNull();
  }, 90_000);

  it("the slot is the prints' left-aligned tab, the transform tab's ink", () => {
    expect(SAGA_DFC_REVERSE_PT.align).toBe("start");
    expect(SAGA_DFC_REVERSE_PT.colorHex).toBe("#777777");
    expect(SAGA_DFC_REVERSE_PT.sizePct * 1500).toBeCloseTo(61, 5);
  });
});
