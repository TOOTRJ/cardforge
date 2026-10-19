import sharp from "sharp";
import { beforeAll, describe, expect, it, vi } from "vitest";
import type { CardPreviewData } from "@/components/cards/card-preview";
import { backPreviewData, bakedBackOf } from "@/lib/cards/faces";
import { frameAssetPathsFor } from "@/lib/render/card-image";

// ---------------------------------------------------------------------------
// TODO 5.5 (b), PR 2 on REAL bakes, at HD and at the 750 px default: the
// double-faced saga BACK (`sagadfcback`) draws what MOM's and LCI's printed
// Saga backs put there (Scryfall's PNGs scaled to 1500 × 2100, read
// 2026-10-18 — MOM #65 / #125 / #169 / #213, LCI #189):
//   • the name in WHITE from the M15 band (the prints' ink from 127–134 px),
//     no cost;
//   • the colour dot moved down with the type bar — its outline's centre at
//     ≈ 1832 px (the prints' 1830–1834; the ▼ back's 1239 + 593), at
//     9.3 %W;
//   • the type line in WHITE indented past the dot (the prints' ink from
//     205–206 px);
//   • the chapters on the rail, from the back's PLAIN rules text.
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
  "(As this Saga enters and after your draw step, add a lore counter.)\nI — Incubate 2 five times, then transform all Incubator tokens you control.\nII — Creatures you control get +1/+1 and gain double strike until end of turn.\nIII — Destroy all other permanents except for artifacts, lands, and Phyrexians.";

function card(back: Record<string, unknown> = {}): CardPreviewData {
  return {
    title: "Elesh Norn",
    cost: "{2}{W}{W}",
    cardType: "creature",
    supertype: "Legendary",
    subtypes: ["Phyrexian", "Praetor"],
    rarity: "mythic",
    colorIdentity: ["white"],
    rulesText: "Vigilance",
    flavorText: null,
    power: "4",
    toughness: "7",
    loyalty: null,
    defense: null,
    artistCredit: null,
    artUrl: null,
    artPosition: {},
    frameStyle: { template: "m15dfcfront", finish: "regular" },
    setIconUrl: stand.black,
    setIconCode: null,
    backFace: {
      title: "HHHH Etchings",
      cost: "",
      card_type: "enchantment",
      subtypes: ["Saga"],
      rules_text: CHAPTERS,
      frame_style: { template: "sagadfcback" },
      color_identity: ["blue"],
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

describe("the double-faced saga back on real bakes (TODO 5.5 (b), PR 2)", () => {
  it("bakes as the card's back (a body of its own) and preloads no rider", () => {
    const back = bakedBackOf(card());
    expect(back?.frameStyle?.template).toBe("sagadfcback");
    expect(frameAssetPathsFor(back!).some((p) => p.includes("/dfcicon/"))).toBe(false);
  });

  it.each(PRESETS)("@%s: a white name from the M15 band, no cost; the dot on the saga's type row; the type line past it; the chapters on the rail", async (preset, s) => {
    const b = await bake(backPreviewData(card())!, preset);
    const name = inkBox(b, { x0: 100 * s, x1: 1270 * s, y0: 100 * s, y1: 225 * s }, white)!;
    expect(name, "name drawn").not.toBeNull();
    expect(name.x0 / s).toBeGreaterThanOrEqual(126);
    expect(name.x0 / s).toBeLessThanOrEqual(135);
    // No cost: nothing right of the name (its four capitals end well short).
    expect(name.x1 / s).toBeLessThan(900);
    // The dot's dark outline, centred on the prints' row.
    const dot = inkBox(b, { x0: 100 * s, x1: 185 * s, y0: 1780 * s, y1: 1890 * s }, dark)!;
    expect(dot, "dot drawn").not.toBeNull();
    const cy = (dot.y0 + dot.y1) / 2 / s;
    const cx = (dot.x0 + dot.x1) / 2 / s;
    expect(Math.abs(cy - 1832)).toBeLessThanOrEqual(2);
    expect(Math.abs(cx - 139.5)).toBeLessThanOrEqual(2);
    const type = inkBox(b, { x0: 185 * s, x1: 1150 * s, y0: 1790 * s, y1: 1885 * s }, white)!;
    expect(type, "type line drawn").not.toBeNull();
    expect(type.x0 / s).toBeGreaterThanOrEqual(202);
    expect(type.x0 / s).toBeLessThanOrEqual(209);
    // The chapters: dark rules ink down the rail's column, three badges'
    // worth of rows.
    const column = inkBox(b, { x0: 200 * s, x1: 740 * s, y0: 640 * s, y1: 1760 * s }, dark)!;
    expect(column, "chapter text drawn").not.toBeNull();
    expect(column.y1 / s - column.y0 / s).toBeGreaterThan(400);
  }, 90_000);

  it.each(PRESETS)("@%s: a three-colour back (LCI #189) — the dot in wedges, still on the saga's row", async (preset, s) => {
    const b = await bake(backPreviewData(card({ color_identity: ["green", "red", "white"] }))!, preset);
    const dot = inkBox(b, { x0: 100 * s, x1: 185 * s, y0: 1780 * s, y1: 1890 * s }, dark)!;
    expect(Math.abs((dot.y0 + dot.y1) / 2 / s - 1832)).toBeLessThanOrEqual(2);
  }, 90_000);
});
