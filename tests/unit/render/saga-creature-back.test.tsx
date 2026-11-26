import sharp from "sharp";
import { beforeAll, describe, expect, it, vi } from "vitest";
import type { CardPreviewData } from "@/components/cards/card-preview";
import { backPreviewData, bakedBackOf } from "@/lib/cards/faces";
import { frameAssetPathsFor } from "@/lib/render/card-image";

// ---------------------------------------------------------------------------
// TODO 4.5d, part B on REAL bakes, at HD and at the 750 px default: the saga
// creature's BACK (`sagacreaturedfcback`) draws what FIN's printed summon
// backs put there (Scryfall's PNGs scaled to 1500 × 2100, read 2026-11-25 —
// FIN #13 / #16 / #58 / #133 / #185 / #229):
//   • the name in WHITE from the M15 band (the prints' ink from 130–135 px),
//     no cost;
//   • the colour dot on the RAISED type bar — its outline's centre at ≈ 1659
//     px (the prints' 1658.5–1659; the ▼ back's 1239 + 420);
//   • the type line in WHITE past it (the prints' ink from 202–203 px);
//   • the chapters on the rail, from the back's PLAIN rules text, and the
//     line after the last chapter in the SECOND box, one line centred (FIN
//     #16's "Flying");
//   • the P/T in WHITE on the plate at M15's spot (FIN #16's "5/5").
// The masters live in the frames bucket: the bake is served a flat mid-grey
// card, so the text and the dot are the only marks on it.
// ---------------------------------------------------------------------------

const stand = vi.hoisted(() => ({ grey: "", black: "" }));

vi.mock("@/lib/render/card-frames", async (importOriginal) => {
  const real = await importOriginal<typeof import("@/lib/render/card-frames")>();
  return {
    ...real,
    preloadFrame: async () => {},
    preloadFrameAssets: async () => {},
    getFrameDataUrl: () => stand.grey,
    getPlateDataUrlForPath: () => stand.grey,
    getFrameOverlayDataUrl: () => stand.grey,
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
  stand.black = await solid(0);
});

const CHAPTERS =
  "(As this Saga enters and after your draw step, add a lore counter.)\nI, II — Wings of Light — Put a +1/+1 counter on each other creature you control. Those creatures gain flying until end of turn.\nIII — Gigaflare — Destroy target permanent. Exile Bahamut, then return it to the battlefield (front face up).\nFlying";

function card(back: Record<string, unknown> = {}): CardPreviewData {
  return {
    title: "Dion, Bahamut's Dominant",
    cost: "{3}{W}",
    cardType: "creature",
    supertype: "Legendary",
    subtypes: ["Human", "Noble", "Knight"],
    rarity: "rare",
    colorIdentity: ["white"],
    rulesText: "When Dion enters, create a 2/2 white Knight creature token.",
    flavorText: null,
    power: "3",
    toughness: "3",
    loyalty: null,
    defense: null,
    artistCredit: null,
    artUrl: null,
    artPosition: {},
    frameStyle: { template: "m15dfcfront", finish: "regular" },
    setIconUrl: stand.black,
    setIconCode: null,
    backFace: {
      title: "HHHH",
      cost: "",
      card_type: "creature",
      supertype: "Legendary Enchantment",
      subtypes: ["Saga", "Dragon"],
      rules_text: CHAPTERS,
      power: "5",
      toughness: "5",
      frame_style: { template: "sagacreaturedfcback" },
      color_identity: ["white"],
      ...back,
    },
    faceContent: null,
    watermark: null,
  } as unknown as CardPreviewData;
}

type Baked = { lum: Float32Array; w: number; h: number };

async function bake(face: CardPreviewData, preset: "hd" | "default"): Promise<Baked> {
  const { renderCardImage } = await import("@/lib/render/card-image");
  const png = Buffer.from(await (await renderCardImage(face, preset, { brandMark: false, watermarkText: null })).arrayBuffer());
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

const PRESETS = [
  ["hd", 1],
  ["default", 0.5],
] as const;

describe("the saga creature's back on real bakes (TODO 4.5d, part B)", () => {
  it("bakes as the card's back (a body of its own) and preloads its plate and no rider", () => {
    const back = bakedBackOf(card());
    expect(back?.frameStyle?.template).toBe("sagacreaturedfcback");
    const paths = frameAssetPathsFor(back!);
    expect(paths.some((p) => p.includes("/dfcicon/"))).toBe(false);
    expect(paths).toContain("/frames/sagacreaturedfcback/pt/w.png");
  });

  it.each(PRESETS)("@%s: a white name, no cost; the dot on the raised type bar; the type line past it; the rail, the second box and the P/T", async (preset, s) => {
    const b = await bake(backPreviewData(card())!, preset);
    const name = inkBox(b, { x0: 100 * s, x1: 1270 * s, y0: 100 * s, y1: 225 * s }, white)!;
    expect(name, "name drawn").not.toBeNull();
    expect(name.x0 / s).toBeGreaterThanOrEqual(126);
    expect(name.x0 / s).toBeLessThanOrEqual(137);
    // No cost: nothing right of the name (its four capitals end well short).
    expect(name.x1 / s).toBeLessThan(900);
    // The dot's dark outline, centred on the prints' row.
    const dot = inkBox(b, { x0: 100 * s, x1: 185 * s, y0: 1600 * s, y1: 1720 * s }, dark)!;
    expect(dot, "dot drawn").not.toBeNull();
    expect(Math.abs((dot.y0 + dot.y1) / 2 / s - 1659)).toBeLessThanOrEqual(2);
    const type = inkBox(b, { x0: 185 * s, x1: 1350 * s, y0: 1610 * s, y1: 1710 * s }, white)!;
    expect(type, "type line drawn").not.toBeNull();
    expect(type.x0 / s).toBeGreaterThanOrEqual(200);
    expect(type.x0 / s).toBeLessThanOrEqual(210);
    // The chapters: dark rules ink down the rail's column.
    const column = inkBox(b, { x0: 200 * s, x1: 740 * s, y0: 450 * s, y1: 1580 * s }, dark)!;
    expect(column, "chapter text drawn").not.toBeNull();
    expect(column.y1 / s - column.y0 / s).toBeGreaterThan(300);
    // The second box: "Flying" — the line after the last chapter — ONE line
    // centred on the box's row, never on the rail.
    const box = inkBox(b, { x0: 110 * s, x1: 1130 * s, y0: 1742 * s, y1: 1937 * s }, dark)!;
    expect(box, "creature box drawn").not.toBeNull();
    expect(box.y1 / s - box.y0 / s).toBeLessThan(70);
    expect(Math.abs((box.x0 + box.x1) / 2 / s - (110 + 1383) / 2)).toBeLessThanOrEqual(20);
    // The P/T in white on the plate's face.
    const pt = inkBox(b, { x0: 1150 * s, x1: 1410 * s, y0: 1870 * s, y1: 2000 * s }, white)!;
    expect(pt, "P/T drawn").not.toBeNull();
    expect(pt.x0 / s).toBeGreaterThan(1170);
  }, 90_000);

  it.each(PRESETS)("@%s: a three-colour back — the dot in wedges, still on the raised row", async (preset, s) => {
    const b = await bake(backPreviewData(card({ color_identity: ["green", "red", "white"] }))!, preset);
    const dot = inkBox(b, { x0: 100 * s, x1: 185 * s, y0: 1600 * s, y1: 1720 * s }, dark)!;
    expect(Math.abs((dot.y0 + dot.y1) / 2 / s - 1659)).toBeLessThanOrEqual(2);
  }, 90_000);
});
