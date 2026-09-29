import sharp from "sharp";
import { beforeAll, beforeEach, describe, expect, it, vi } from "vitest";
import type { CardPreviewData } from "@/components/cards/card-preview";

// ---------------------------------------------------------------------------
// TODO 4.6.0 — the anatomy seams in the Satori BAKE, with the anatomy 4.6a /
// 4.6b will declare (tests/unit/cards/anatomy-fixture.ts), on REAL bakes:
// every frame asset is a flat stand-in (grey master, blue plate) and the
// crown band a flat red, so the band is the only thing that can differ
// between a crowned bake and the same card uncrowned. The preview's twins:
// tests/unit/components/anatomy-seams-preview.test.tsx.
// ---------------------------------------------------------------------------

const assets = vi.hoisted(() => ({
  grey: "",
  red: "",
  blue: "",
  masters: [] as string[],
  plates: [] as string[],
  overlays: [] as string[],
}));

vi.mock("@/lib/cards/template-layout", async (importOriginal) => {
  const real = await importOriginal<typeof import("@/lib/cards/template-layout")>();
  const { declaredGetFrameProfile } = await import("../cards/anatomy-fixture");
  return { ...real, getFrameProfile: declaredGetFrameProfile(real.getFrameProfile) };
});

vi.mock("@/lib/render/card-frames", async (importOriginal) => {
  const real = await importOriginal<typeof import("@/lib/render/card-frames")>();
  return {
    ...real,
    preloadFrame: async () => {},
    preloadFrameAssets: async () => {},
    getFrameDataUrl: (template: string, key: string) => {
      assets.masters.push(`${template}/${key}`);
      return assets.grey;
    },
    getPlateDataUrlForPath: (path: string, key: string) => {
      assets.plates.push(real.plateAssetPath(path, key));
      return assets.blue;
    },
    getFrameOverlayDataUrl: (path: string) => {
      assets.overlays.push(path);
      return assets.red;
    },
    getFrameAssetDataUrl: () => null,
  };
});

import { frameAssetPathsFor, renderCardImage } from "@/lib/render/card-image";

const W = 750;
const H = 1050;
/** The fixture's band, 0–19.52 %H: rows [0, 205) at 750 × 1050. */
const BAND_ROWS = Math.ceil((19.52 / 100) * H);

async function flat(r: number, g: number, b: number, w = 64, h = 64): Promise<string> {
  const png = await sharp({ create: { width: w, height: h, channels: 4, background: { r, g, b, alpha: 1 } } })
    .png()
    .toBuffer();
  return `data:image/png;base64,${png.toString("base64")}`;
}

beforeAll(async () => {
  assets.grey = await flat(128, 128, 128);
  assets.red = await flat(255, 0, 0);
  assets.blue = await flat(0, 0, 255);
});

beforeEach(() => {
  assets.masters.length = 0;
  assets.plates.length = 0;
  assets.overlays.length = 0;
});

function card(over: Partial<CardPreviewData> = {}): CardPreviewData {
  return {
    title: "Kesh",
    cost: "{2}{W}",
    cardType: "creature",
    supertype: "Legendary",
    subtypes: ["Dwarf"],
    rarity: "rare",
    colorIdentity: ["white"],
    rulesText: null,
    flavorText: null,
    power: "3",
    toughness: "4",
    loyalty: null,
    defense: null,
    artistCredit: "Probe",
    artUrl: null,
    artPosition: {},
    frameStyle: { template: "m15", finish: "regular", crown: true },
    setIconUrl: null,
    setIconCode: null,
    backFace: null,
    faceContent: null,
    watermark: null,
    ...over,
  } as CardPreviewData;
}

type Raw = { data: Buffer; width: number; height: number };
async function bake(data: CardPreviewData): Promise<Raw> {
  const res = await renderCardImage(data, "default", { brandMark: false, watermarkText: null });
  const { data: px, info } = await sharp(Buffer.from(await res.arrayBuffer()))
    .removeAlpha()
    .raw()
    .toBuffer({ resolveWithObject: true });
  return { data: px, width: info.width, height: info.height };
}

function differingRows(a: Raw, b: Raw): number[] {
  const rows = new Set<number>();
  for (let i = 0; i < a.data.length; i += 3) {
    if (a.data[i] !== b.data[i] || a.data[i + 1] !== b.data[i + 1] || a.data[i + 2] !== b.data[i + 2]) {
      rows.add(Math.floor(i / 3 / a.width));
    }
  }
  return [...rows].sort((x, y) => x - y);
}

function redAt(raw: Raw, x: number, y: number): boolean {
  const i = (y * raw.width + x) * 3;
  return raw.data[i] > 200 && raw.data[i + 1] < 60 && raw.data[i + 2] < 60;
}

describe("the crown band in the bake", () => {
  it("draws the band over the frame, inside its rect only", async () => {
    const [crowned, plain] = [await bake(card()), await bake(card({ frameStyle: { template: "m15", finish: "regular" } }))];
    expect(crowned.width).toBe(W);
    expect(assets.overlays).toEqual(["/frames/m15crown/w.png"]);
    const rows = differingRows(crowned, plain);
    expect(rows.length).toBeGreaterThan(150);
    expect(rows.at(-1)!).toBeLessThan(BAND_ROWS);
    // Over the frame and under the text: red in the band's middle.
    expect(redAt(crowned, W / 2, 20)).toBe(true);
    expect(redAt(plain, W / 2, 20)).toBe(false);
  }, 60_000);

  it("draws nothing — byte-identical — with the switch absent or off, or on a card that doesn't qualify", async () => {
    const plain = await bake(card({ frameStyle: { template: "m15", finish: "regular" } }));
    for (const data of [
      card({ frameStyle: { template: "m15", finish: "regular", crown: false } }),
      card({ supertype: null, frameStyle: { template: "m15", finish: "regular", crown: true } }),
    ]) {
      const other = await bake(data);
      const same = data.supertype === null ? await bake(card({ supertype: null, frameStyle: { template: "m15", finish: "regular" } })) : plain;
      expect(differingRows(other, same)).toEqual([]);
    }
    expect(assets.overlays).toEqual([]);
  }, 60_000);

  it("is preloaded: frameAssetPathsFor lists the band only when the card draws it", () => {
    expect(frameAssetPathsFor(card())).toContain("/frames/m15crown/w.png");
    expect(frameAssetPathsFor(card({ frameStyle: { template: "m15" } }))).not.toContain("/frames/m15crown/w.png");
    expect(frameAssetPathsFor(card({ cardType: "token", frameStyle: { template: "m15", crown: true } })).some((p) => p.includes("crown"))).toBe(false);
  });

  it.each(["foil", "etched"] as const)("%s: the finish masks the band with the frame", async (finish) => {
    // A BLACK master: luminance 0, so the finish masks nothing of it. The
    // band (flat red) is then the only light thing in the top rows — the
    // finish's sheen shows there only because the mask holds the overlay
    // too, as the preview's does.
    const grey = assets.grey;
    assets.grey = await flat(0, 0, 0);
    try {
      const band = async (crown: boolean) =>
        differingRows(
          await bake(card({ frameStyle: { template: "m15", finish, crown } })),
          await bake(card({ frameStyle: { template: "m15", finish: "regular", crown } })),
        ).filter((row) => row < BAND_ROWS);
      expect((await band(true)).length).toBeGreaterThan(50);
      // Control: uncrowned, the black band rows take no sheen.
      expect(await band(false)).toEqual([]);
    } finally {
      assets.grey = grey;
    }
  }, 60_000);
});

describe("the two-colour look in the bake", () => {
  it("paints the pair master and keys the crown to the pair with the switch on", async () => {
    await bake(card({ colorIdentity: ["blue", "white"], cost: "{1}{W}{U}", frameStyle: { template: "m15", crown: true, twoColor: true } }));
    expect(assets.masters).toEqual(["m15/wu"]);
    expect(assets.overlays).toEqual(["/frames/m15crown/wu.png"]);
    expect(assets.plates).toEqual(["/frames/m15/pt/m.png"]);
  }, 60_000);

  it("stays on the gold master with the switch absent", async () => {
    await bake(card({ colorIdentity: ["blue", "white"], cost: "{1}{W}{U}", frameStyle: { template: "m15" } }));
    expect(assets.masters).toEqual(["m15/m"]);
    expect(assets.overlays).toEqual([]);
  }, 60_000);

  it("a hybrid cost paints the hybrid master and the grey plate — preloaded as painted", async () => {
    const hybrid = card({
      supertype: null,
      colorIdentity: ["green", "white"],
      cost: "{G/W}{G/W}",
      frameStyle: { template: "m15", twoColor: true },
    });
    await bake(hybrid);
    expect(assets.masters).toEqual(["m15/gw-h"]);
    expect(assets.plates).toEqual(["/frames/m15/pt/c.png"]);
    expect(frameAssetPathsFor(hybrid)).toContain("/frames/m15/pt/c.png");
  }, 60_000);
});
