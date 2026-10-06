import sharp from "sharp";
import { beforeAll, describe, expect, it, vi } from "vitest";
import type { CardPreviewData } from "@/components/cards/card-preview";
import { backPreviewData, frontPreviewData } from "@/lib/cards/faces";

// ---------------------------------------------------------------------------
// TODO 5.1d on REAL bakes: the crown and the two-colour frames on the
// double-faced bodies. The masters live in the frames bucket (never in git),
// so the bake is served stand-ins — a flat mid-grey card, a RED crown piece,
// a WHITE rider, a dark plate — and records which frame master and which
// overlay paths it asked for: a Legendary transform front with the switch on
// draws the crown's red over its rect and the rider's white ON TOP of it (the
// overlay order: crown first, the glyph after); with the switch absent the
// bake is byte-identical to a crownless one; a two-colour face with the
// two-colour switch paints its pair master (`wu`) and the pair's crown
// (`m15dfccrown/wu`), the ▼ back the right-well folder's, a modal face the
// housing's, a land back nothing.
// ---------------------------------------------------------------------------

const stand = vi.hoisted(() => ({ grey: "", plate: "", rider: "", crown: "", masters: [] as string[], overlays: [] as string[] }));

vi.mock("@/lib/render/card-frames", async (importOriginal) => {
  const real = await importOriginal<typeof import("@/lib/render/card-frames")>();
  return {
    ...real,
    preloadFrame: async () => {},
    preloadFrameAssets: async () => {},
    getFrameDataUrl: (template: string, key: string) => {
      stand.masters.push(`${template}/${key}`);
      return stand.grey;
    },
    getPlateDataUrlForPath: () => stand.plate,
    getFrameOverlayDataUrl: (path: string) => {
      stand.overlays.push(path);
      return path.includes("crown") ? stand.crown : stand.rider;
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
  stand.rider = await solid([255, 255, 255], 32, 32);
  stand.crown = await solid([220, 30, 30], 64, 16);
});

type Back = NonNullable<CardPreviewData["backFace"]>;
const BACK: Back = {
  title: "Tovolar, the Midnight Scourge",
  cost: "",
  card_type: "creature",
  supertype: "Legendary",
  subtypes: ["Werewolf"],
  rules_text: "Whenever a Wolf or Werewolf you control deals combat damage to a player, draw a card.",
  power: "4",
  toughness: "4",
  frame_style: { template: "m15dfcbackleft" },
  color_identity: ["red", "green"],
} as Back;

function card(over: Partial<CardPreviewData> = {}, back: Partial<Back> | null = {}): CardPreviewData {
  return {
    title: "Tovolar, Dire Overlord",
    cost: "{1}{R}{G}",
    cardType: "creature",
    supertype: "Legendary",
    subtypes: ["Human", "Werewolf"],
    rarity: "mythic",
    colorIdentity: ["red", "green"],
    rulesText: "Whenever a Wolf or Werewolf you control deals combat damage to a player, draw a card.",
    flavorText: null,
    power: "3",
    toughness: "3",
    loyalty: null,
    defense: null,
    artistCredit: "Test",
    artUrl: null,
    artPosition: {},
    frameStyle: { template: "m15dfcfront", finish: "regular", dfcIcon: "sunmoon" },
    backFace: back ? { ...BACK, ...back } : null,
    backCard: null,
    faceContent: null,
    watermark: null,
    setCode: null,
    collectorNumber: null,
    lang: null,
    ...over,
  } as CardPreviewData;
}

type Baked = { data: Buffer; w: number; h: number; png: Buffer };
async function bake(c: CardPreviewData): Promise<Baked> {
  stand.masters.length = 0;
  stand.overlays.length = 0;
  const { renderCardImage } = await import("@/lib/render/card-image");
  const png = Buffer.from(await (await renderCardImage(c, "hd", { brandMark: false, watermarkText: null })).arrayBuffer());
  const { data, info } = await sharp(png).ensureAlpha().raw().toBuffer({ resolveWithObject: true });
  return { data, w: info.width, h: info.height, png };
}
const px = (b: Baked, x: number, y: number) => { const o = (y * b.w + x) * 4; return [b.data[o], b.data[o + 1], b.data[o + 2], b.data[o + 3]]; };
const isRed = (p: number[]) => p[0] > 180 && p[1] < 80 && p[2] < 80;
const isWhite = (p: number[]) => p[0] > 240 && p[1] > 240 && p[2] > 240;

describe("the crown and the pairs on the double-faced bodies (TODO 5.1d, real bakes)", () => {
  it("a Legendary transform front with the switch on: the crown's piece over the top band, the rider's glyph ON TOP of it inside the well; the switch absent is byte-identical to a crownless bake", async () => {
    const on = await bake(frontPreviewData(card({ frameStyle: { template: "m15dfcfront", finish: "regular", dfcIcon: "sunmoon", crown: true } })));
    // The overlays, in order: the crown (the left-well folder, gold for a
    // pair with the two-colour switch off), then the sun rider.
    expect(stand.overlays).toEqual(["/frames/m15dfccrown/m.png", "/frames/dfcicon/sun.png"]);
    // The crown's red covers the band's rect (rows 0–409 at HD) away from
    // the well — the top band's left peak, the right leg.
    expect(isRed(px(on, 400, 60)), "the crown over the top band").toBe(true);
    expect(isRed(px(on, 1440, 300)), "the crown's right leg").toBe(true);
    // The rider's white sits inside the well (CC's bounds 89–199 × 106–216
    // at HD), over the crown's red: the glyph is drawn AFTER the crown.
    expect(isWhite(px(on, 144, 161)), "the rider on top").toBe(true);
    expect(isRed(px(on, 144, 161))).toBe(false);
    // Below the band: the grey master, untouched.
    expect(px(on, 750, 1000).slice(0, 3)).toEqual([128, 128, 128]);
    const off = await bake(frontPreviewData(card()));
    expect(stand.overlays).toEqual(["/frames/dfcicon/sun.png"]);
    const explicitOff = await bake(frontPreviewData(card({ frameStyle: { template: "m15dfcfront", finish: "regular", dfcIcon: "sunmoon", crown: false } })));
    expect(Buffer.compare(off.png, explicitOff.png)).toBe(0);
    expect(isRed(px(off, 400, 60))).toBe(false);
    expect(isWhite(px(off, 144, 161))).toBe(true);
  }, 90_000);

  it("the two-colour switch paints the pair master on a transform front and on its back, with the pair's crown from each face's folder; a nonlegendary face draws no crown", async () => {
    const both = { template: "m15dfcfront", finish: "regular", dfcIcon: "arrows", crown: true, twoColor: true } as CardPreviewData["frameStyle"];
    await bake(frontPreviewData(card({ frameStyle: both })));
    expect(stand.masters).toContain("m15dfcfront/rg");
    expect(stand.overlays).toEqual(["/frames/m15dfccrown/rg.png", "/frames/dfcicon/default.png"]);
    // The ▼ back (the arrows family) with a two-colour Legendary back: the
    // pair master and the right-well folder's pair crown; no rider there.
    const back = backPreviewData(card({ frameStyle: both }, { frame_style: { template: "m15dfcback" } }))!;
    expect(back.frameStyle?.template).toBe("m15dfcback");
    await bake(back);
    expect(stand.masters).toContain("m15dfcback/rg");
    expect(stand.overlays).toEqual(["/frames/m15dfccrownright/rg.png"]);
    // The 2016–22 back: the left-well folder's, the moon rider after it.
    const left = backPreviewData(card({ frameStyle: { ...both, dfcIcon: "sunmoon" } }, { frame_style: { template: "m15dfcbackleft" } }))!;
    await bake(left);
    expect(stand.masters).toContain("m15dfcbackleft/rg");
    expect(stand.overlays).toEqual(["/frames/m15dfccrown/rg.png", "/frames/dfcicon/moon.png"]);
    // A nonlegendary back draws no crown; its pair master still.
    const plain = backPreviewData(card({ frameStyle: both }, { frame_style: { template: "m15dfcback" }, supertype: undefined }))!;
    await bake(plain);
    expect(stand.masters).toContain("m15dfcback/rg");
    expect(stand.overlays).toEqual([]);
    // The switch off: gold, and the gold crown.
    const gold = backPreviewData(card({ frameStyle: { template: "m15dfcfront", finish: "regular", crown: true } }, { frame_style: { template: "m15dfcback" } }))!;
    await bake(gold);
    expect(stand.masters).toContain("m15dfcback/m");
    expect(stand.overlays).toEqual(["/frames/m15dfccrownright/m.png"]);
  }, 120_000);

  it("the modal faces: the housing's folder on both, the hybrid dress for an all-hybrid front cost; the land back draws neither", async () => {
    const modal = card(
      { frameStyle: { template: "m15mdfcfront", finish: "regular", crown: true, twoColor: true }, cost: "{W/U}{W/U}", colorIdentity: ["white", "blue"] },
      { frame_style: { template: "m15mdfcback" }, cost: "{3}{W}{U}", color_identity: ["white", "blue"], supertype: "Legendary" },
    );
    await bake(frontPreviewData(modal));
    expect(stand.masters).toContain("m15mdfcfront/wu-h");
    expect(stand.overlays).toEqual(["/frames/m15mdfccrown/wu.png"]);
    await bake(backPreviewData(modal)!);
    expect(stand.masters).toContain("m15mdfcback/wu");
    expect(stand.overlays).toEqual(["/frames/m15mdfccrown/wu.png"]);
    // A legendary land back on the ▼ land back: the stone master, no crown, no pair.
    const land = card(
      { frameStyle: { template: "m15dfcfront", finish: "regular", crown: true, twoColor: true } },
      { frame_style: { template: "m15dfclandback" }, card_type: "land", cost: "", power: undefined, toughness: undefined, subtypes: [], color_identity: ["colorless"] },
    );
    await bake(backPreviewData(land)!);
    expect(stand.masters).toContain("m15dfclandback/c");
    expect(stand.overlays).toEqual([]);
  }, 120_000);
});
