import { createHash } from "node:crypto";
import sharp from "sharp";
import { afterAll, beforeAll, describe, expect, it, vi } from "vitest";
import type { CardPreviewData } from "@/components/cards/card-preview";
import { basicSymbolBox, BASIC_SYMBOL_DISC_FILL } from "@/lib/cards/basic-symbol";
import {
  BASIC_SYMBOL_MSE_SOCKET,
  BRAND_MARK_ON_ART,
  BRAND_MARK_PILL,
  getFrameProfile,
  type FrameProfile,
  type Rect,
} from "@/lib/cards/template-layout";
import type { FrameProfileOverride } from "@/lib/cards/profile-override";
import { RENDER_PRESETS } from "@/lib/render/card-image";

// ---------------------------------------------------------------------------
// Edge-to-edge and full-art renderer pieces on REAL bakes (TODO 3.23 / 3.24):
// the basic-land symbol slot, the brand mark's pill and the outlined footer
// on the art, a split type line and a textless frame. No profile opts in
// today, so each case opts a real template in through profileOverrides (the
// renderers merge them over the code profile, resolveFrameProfile); the
// frames are the git masters (fullartland, m15textless). The preview's twin
// is tests/unit/components/edge-to-edge-preview.test.tsx.
//
// The art is one flat colour, so anything that isn't that colour where the
// art shows is something the renderer drew. Rendered at the default preset
// (750 × 1050). Bucket assets (the M15 P/T plate a textless creature draws,
// a symbol image) come from a stubbed bucket, like pw-cost-bake.test.tsx.
// ---------------------------------------------------------------------------

const W = RENDER_PRESETS.default.width;
const H = RENDER_PRESETS.default.height;
const ORIGIN = "https://frames.test";
const ART_RGB = [40, 160, 200] as const;
const PLATE_RGB = [128, 128, 128] as const;
const SYMBOL_RGB = [255, 0, 255] as const;

let artUrl = "";
let restore: () => void = () => {};

async function solid(w: number, h: number, rgb: readonly number[]) {
  return sharp({ create: { width: w, height: h, channels: 4, background: { r: rgb[0], g: rgb[1], b: rgb[2], alpha: 1 } } })
    .png()
    .toBuffer();
}

beforeAll(async () => {
  artUrl = `data:image/png;base64,${(await solid(600, 840, ART_RGB)).toString("base64")}`;
  const { frameObjectKey, setFrameStorageForTests } = await import("@/lib/frames/frame-url");
  const files: Record<string, Buffer> = {
    "m15/pt/g.png": await solid(240, 154, PLATE_RGB),
    "fullartland/symbol/w.png": await solid(168, 168, SYMBOL_RGB),
  };
  const manifest = {
    version: 1 as const,
    bucket: "frames",
    files: Object.fromEntries(
      Object.entries(files).map(([key, buf]) => {
        const sha256 = createHash("sha256").update(buf).digest("hex");
        return [key, { hash: sha256.slice(0, 12), sha256, bytes: buf.length, width: 1, height: 1 }];
      }),
    ),
  };
  const byUrl = new Map(
    Object.entries(files).map(([key, buf]) => [`${ORIGIN}/${frameObjectKey(key, manifest.files[key].hash)}`, buf]),
  );
  vi.stubGlobal(
    "fetch",
    vi.fn(async (input: string) => {
      const buf = byUrl.get(String(input));
      if (!buf) throw new Error(`unexpected fetch: ${input}`);
      return new Response(new Uint8Array(buf), { status: 200, headers: { "content-type": "image/png" } });
    }),
  );
  restore = setFrameStorageForTests({ manifest, origin: ORIGIN });
});

afterAll(() => {
  restore();
  vi.unstubAllGlobals();
});

type Bake = { px: (x: number, y: number) => [number, number, number]; data: Buffer };

async function bake(card: Record<string, unknown>, brandMark = false): Promise<Bake> {
  const { renderCardImage } = await import("@/lib/render/card-image");
  const res = await renderCardImage(
    {
      rarity: "common",
      artistCredit: "Test Artist",
      artUrl,
      artPosition: {},
      setIconUrl: null,
      setIconCode: null,
      backFace: null,
      faceContent: null,
      watermark: null,
      ...card,
    } as unknown as CardPreviewData,
    "default",
    { brandMark, watermarkText: null },
  );
  const data = await sharp(Buffer.from(await res.arrayBuffer())).removeAlpha().raw().toBuffer();
  return {
    data,
    px: (x, y) => {
      const i = (Math.round(y) * W + Math.round(x)) * 3;
      return [data[i], data[i + 1], data[i + 2]];
    },
  };
}

const isArt = ([r, g, b]: [number, number, number]) =>
  Math.abs(r - ART_RGB[0]) <= 2 && Math.abs(g - ART_RGB[1]) <= 2 && Math.abs(b - ART_RGB[2]) <= 2;
const lum = ([r, g, b]: [number, number, number]) => 0.299 * r + 0.587 * g + 0.114 * b;

/** Pixels in a card-percent rect matching `pred`. */
function count(b: Bake, rect: Rect, pred: (p: [number, number, number]) => boolean): number {
  let n = 0;
  const x0 = Math.ceil((rect.leftPct / 100) * W);
  const x1 = Math.floor(((rect.leftPct + rect.widthPct) / 100) * W);
  const y0 = Math.ceil((rect.topPct / 100) * H);
  const y1 = Math.floor(((rect.topPct + rect.heightPct) / 100) * H);
  for (let y = y0; y < y1; y += 1) for (let x = x0; x < x1; x += 1) if (pred(b.px(x, y))) n += 1;
  return n;
}

const plains = { title: "Plains", cardType: "land", supertype: "Basic", subtypes: ["Plains"], colorIdentity: ["white"] } as const;
const onArt = (extra: FrameProfileOverride = {}): FrameProfileOverride => ({
  basicSymbol: BASIC_SYMBOL_MSE_SOCKET,
  brandMark: BRAND_MARK_ON_ART,
  footerOnArt: true,
  ...extra,
});
const fullart = (override?: FrameProfileOverride) =>
  ({ frameStyle: { template: "fullartland" }, ...(override ? { profileOverrides: { fullartland: override } } : {}) }) as const;

describe("a full-art Plains with a basic-symbol slot (TODO 3.24)", () => {
  it("draws the symbol in the socket and nothing over the art", async () => {
    const today = await bake({ ...plains, ...fullart() });
    const slotted = await bake({ ...plains, ...fullart(onArt()) });
    const rules = getFrameProfile("fullartland").rules.rect;
    // Today the automatic big watermark covers the middle of the art…
    expect(count(today, rules, (p) => !isArt(p))).toBeGreaterThan(20_000);
    // …with the slot, the art there is untouched.
    expect(count(slotted, rules, (p) => !isArt(p))).toBe(0);

    // The disc fills the socket in the white frame's fill, the white sun on it.
    const box = basicSymbolBox(BASIC_SYMBOL_MSE_SOCKET.rect, 7 / 5);
    const fill = BASIC_SYMBOL_DISC_FILL.w.match(/[0-9a-f]{2}/g)!.map((h) => parseInt(h, 16));
    const isFill = ([r, g, b]: [number, number, number]) =>
      Math.abs(r - fill[0]) <= 3 && Math.abs(g - fill[1]) <= 3 && Math.abs(b - fill[2]) <= 3;
    expect(count(slotted, box, isFill)).toBeGreaterThan(1500);
    expect(count(slotted, box, (p) => lum(p) > 245)).toBeGreaterThan(600);
    expect(count(today, box, isFill)).toBe(0);
    // Centred on the slot: the fill's bounding box sits in the socket.
    let [minX, maxX, minY, maxY]: number[] = [W, 0, H, 0];
    for (let y = 0; y < H; y += 1) {
      for (let x = 0; x < W * 0.3; x += 1) {
        if (!isFill(slotted.px(x, y))) continue;
        minX = Math.min(minX, x);
        maxX = Math.max(maxX, x);
        minY = Math.min(minY, y);
        maxY = Math.max(maxY, y);
      }
    }
    const cx = ((box.leftPct + box.widthPct / 2) / 100) * W;
    const cy = ((box.topPct + box.heightPct / 2) / 100) * H;
    expect(Math.abs((minX + maxX) / 2 - cx)).toBeLessThanOrEqual(2);
    expect(Math.abs((minY + maxY) / 2 - cy)).toBeLessThanOrEqual(2);
  });

  it("swaps an explicit mana watermark into the slot", async () => {
    const swamp = await bake({
      ...plains,
      ...fullart(onArt()),
      watermark: { kind: "mana", key: "b", size: "large" },
    });
    const box = basicSymbolBox(BASIC_SYMBOL_MSE_SOCKET.rect, 7 / 5);
    // The black skull, not the white sun, and still nothing over the art.
    expect(count(swamp, box, (p) => lum(p) < 45)).toBeGreaterThan(800);
    expect(count(swamp, box, (p) => lum(p) > 245)).toBeLessThan(50);
    expect(count(swamp, getFrameProfile("fullartland").rules.rect, (p) => !isArt(p))).toBe(0);
  });

  it("draws the slot's symbol image when it has one (preloaded like any frame asset)", async () => {
    const withAsset = await bake({
      ...plains,
      ...fullart(onArt({ basicSymbol: { ...BASIC_SYMBOL_MSE_SOCKET, style: "glyph", assetPathTemplate: "/frames/fullartland/symbol/{symbol}.png" } })),
    });
    const box = basicSymbolBox(BASIC_SYMBOL_MSE_SOCKET.rect, 7 / 5);
    const magenta = ([r, g, b]: [number, number, number]) => r > 250 && g < 5 && b > 250;
    // The stand-in image fills the square box (~101 px at 750 wide).
    expect(count(withAsset, box, magenta)).toBeGreaterThan(0.9 * ((box.widthPct / 100) * W) ** 2);
  });
});

describe("the brand mark and the footer on the art (TODO 3.23)", () => {
  it("backs the mark with the dark pill, placed by its box", async () => {
    const pill = await bake({ ...plains, ...fullart(onArt()) }, true);
    const bare = await bake({ ...plains, ...fullart(onArt({ brandMark: { ...BRAND_MARK_ON_ART, pill: false } })) }, true);
    // The pill is the fill over the art (0.62 × fill + 0.38 × art): find its
    // box in the bottom-right corner.
    expect(BRAND_MARK_PILL.fill).toBe("rgba(12,12,16,0.62)");
    const expected = ART_RGB.map((c, i) => 0.62 * [12, 12, 16][i] + 0.38 * c);
    const isPill = (p: [number, number, number]) => p.every((c, i) => Math.abs(c - expected[i]) <= 4);
    const box = (b: Bake) => {
      let [minX, maxX, minY, maxY, n]: number[] = [W, -1, H, -1, 0];
      for (let y = Math.round(H * 0.9); y < H; y += 1) {
        for (let x = Math.round(W * 0.6); x < W; x += 1) {
          if (!isPill(b.px(x, y))) continue;
          n += 1;
          minX = Math.min(minX, x);
          maxX = Math.max(maxX, x);
          minY = Math.min(minY, y);
          maxY = Math.max(maxY, y);
        }
      }
      return { minX, maxX, minY, maxY, n };
    };
    const got = box(pill);
    expect(got.n).toBeGreaterThan(1000);
    // Its right and bottom edges are the placement's offsets…
    expect(Math.abs(got.maxX + 1 - W * (1 - BRAND_MARK_ON_ART.rightPct / 100))).toBeLessThanOrEqual(2);
    expect(Math.abs(got.maxY + 1 - H * (1 - BRAND_MARK_ON_ART.bottomPct / 100))).toBeLessThanOrEqual(2);
    // …and it is the mark's line box (≈1.2 em of 2.6 % W) plus its padding.
    const height = got.maxY - got.minY + 1;
    const expectedHeight = 1.2 * 0.026 * W + 2 * BRAND_MARK_PILL.padYPct * W;
    expect(Math.abs(height - expectedHeight)).toBeLessThanOrEqual(3);
    // Round ends (radius = half its height): the box's corner pixel is art,
    // the middle of its left end is the pill.
    expect(isArt(pill.px(got.minX, got.minY))).toBe(true);
    expect(isPill(pill.px(got.minX + 1, Math.round((got.minY + got.maxY) / 2)))).toBe(true);
    // Without the pill, none of it.
    expect(box(bare).n).toBe(0);
  });

  it("outlines the artist line when the profile prints it on the art", async () => {
    const footer = getFrameProfile("fullartland").footer!.rect;
    const outlined = await bake({ ...plains, ...fullart(onArt()) });
    const plain = await bake({ ...plains, ...fullart(onArt({ footerOnArt: false })) });
    const dark = (p: [number, number, number]) => lum(p) < 40;
    // The light artist line alone leaves the bright art; the outline rings
    // every letter in black.
    expect(count(plain, footer, dark)).toBeLessThan(20);
    expect(count(outlined, footer, dark)).toBeGreaterThan(150);
  });

  it("shows the art in the card's corner on a full-bleed frame, the border on a bordered one", async () => {
    const full = await bake({ ...plains, ...fullart(onArt()) });
    expect(isArt(full.px(1, 1))).toBe(true);
    expect(isArt(full.px(W - 2, H - 2))).toBe(true);
    const bordered = await bake({ ...plains, frameStyle: { template: "m15textlessland" } });
    expect(lum(bordered.px(8, H / 2))).toBeLessThan(30);
  });
});

describe("art framing across a treatment switch (TODO 3.23)", () => {
  it("keeps the framed point on the window's centre when the card moves to a full-bleed frame", async () => {
    // A picture with a red dot at (0.38, 0.4), framed on the extended-art
    // window at zoom 1.5 with the dot in the middle (a point the window can
    // centre: at zoom 1 this 4:3 picture exactly spans its width), then
    // carried to fullartland.
    const natural = { width: 1600, height: 1200 };
    const dot = await sharp(await solid(natural.width, natural.height, ART_RGB))
      .composite([
        {
          input: Buffer.from(
            `<svg width="1600" height="1200"><circle cx="608" cy="480" r="30" fill="#ff0000"/></svg>`,
          ),
          top: 0,
          left: 0,
        },
      ])
      .png()
      .toBuffer();
    const dotUrl = `data:image/png;base64,${dot.toString("base64")}`;
    const { carryArtFraming, positionForCentre, rectPx } = await import("@/lib/cards/art-framing");
    const extended = getFrameProfile("extendedart");
    const full = getFrameProfile("fullartland");
    const onExtended = positionForCentre(rectPx(extended.artSlot, extended), natural, { x: 0.38, y: 0.4 }, 1.5);
    const onFull = carryArtFraming({ from: extended, to: full, natural, position: onExtended });
    // Neither framing is clamped at the picture's edge.
    for (const f of [onExtended.focalX, onExtended.focalY, onFull.focalX, onFull.focalY]) {
      expect(f).toBeGreaterThan(0.01);
      expect(f).toBeLessThan(0.99);
    }
    const card = { title: "Probe", cardType: "instant", colorIdentity: ["blue"], artUrl: dotUrl } as const;
    const redCentre = (b: Bake) => {
      let [sx, sy, n] = [0, 0, 0];
      for (let y = 0; y < H; y += 1) {
        for (let x = 0; x < W; x += 1) {
          const [r, g, bl] = b.px(x, y);
          if (r > 200 && g < 60 && bl < 60) {
            sx += x;
            sy += y;
            n += 1;
          }
        }
      }
      return { x: sx / n + 0.5, y: sy / n + 0.5, n };
    };
    const a = redCentre(await bake({ ...card, artPosition: onExtended, frameStyle: { template: "extendedart" } }));
    const s = extended.artSlot;
    expect(a.n).toBeGreaterThan(100);
    expect(Math.abs(a.x - ((s.leftPct + s.widthPct / 2) / 100) * W)).toBeLessThanOrEqual(1.5);
    expect(Math.abs(a.y - ((s.topPct + s.heightPct / 2) / 100) * H)).toBeLessThanOrEqual(1.5);
    const b = redCentre(await bake({ ...card, artPosition: onFull, frameStyle: { template: "fullartland" } }));
    expect(Math.abs(b.x - W / 2)).toBeLessThanOrEqual(1.5);
    expect(Math.abs(b.y - H / 2)).toBeLessThanOrEqual(1.5);
    // Reusing the old numbers would have moved it well off-centre.
    const c = redCentre(await bake({ ...card, artPosition: onExtended, frameStyle: { template: "fullartland" } }));
    expect(Math.hypot(c.x - W / 2, c.y - H / 2)).toBeGreaterThan(40);
  });
});

describe("a split type line (TODO 3.24)", () => {
  // Boxes on fullartland's own type bar (84.5–90.3 % H), either side of a
  // gap — CC's ZEN boxes (TYPE_SPLIT_ZEN) sit on the ZEN frame's bar.
  const split = {
    leftRect: { topPct: 85.4, leftPct: 18, widthPct: 28, heightPct: 4.2 },
    rightRect: { topPct: 85.4, leftPct: 58, widthPct: 26, heightPct: 4.2 },
  };
  it("prints 'Basic Land' left and the subtype right, nothing between, no inline set symbol", async () => {
    const forest = await bake({
      title: "Forest",
      cardType: "land",
      supertype: "Basic",
      subtypes: ["Forest"],
      colorIdentity: ["green"],
      ...fullart({ type: { split } as FrameProfile["type"] }),
    });
    const ink = (p: [number, number, number]) => lum(p) < 90;
    expect(count(forest, split.leftRect, ink)).toBeGreaterThan(150);
    expect(count(forest, split.rightRect, ink)).toBeGreaterThan(100);
    // The gap and the band's right end (where the inline set symbol was).
    expect(count(forest, { topPct: 85.4, leftPct: 47, widthPct: 10, heightPct: 4.2 }, ink)).toBe(0);
    expect(count(forest, { topPct: 85.4, leftPct: 85, widthPct: 5, heightPct: 4.2 }, ink)).toBe(0);
    const whole = await bake({
      title: "Forest",
      cardType: "land",
      supertype: "Basic",
      subtypes: ["Forest"],
      colorIdentity: ["green"],
      ...fullart(),
    });
    expect(count(whole, { topPct: 85.4, leftPct: 47, widthPct: 10, heightPct: 4.2 }, ink)).toBeGreaterThan(50);
  });
});

describe("a textless frame (TODO 3.24)", () => {
  const titan = {
    title: "Textless Titan",
    cost: "{3}{G}{G}",
    cardType: "creature",
    subtypes: ["Giant"],
    colorIdentity: ["green"],
    rulesText: "Trample\nWhen Textless Titan enters, draw a card.\nWard {2}\nAt the beginning of your upkeep, scry 1.",
    flavorText: "Big.",
    power: "6",
    toughness: "6",
    frameStyle: { template: "m15textless" },
  } as const;

  it("prints only the title, cost and P/T of a creature with four lines of rules", async () => {
    const p = getFrameProfile("m15textless");
    const today = await bake(titan);
    const textless = await bake({ ...titan, profileOverrides: { m15textless: { textless: true } } });
    const notArt = (b: Bake, rect: Rect) => count(b, rect, (px) => !isArt(px));
    // Today: a type line and cream rules on the art.
    expect(notArt(today, p.type.rect)).toBeGreaterThan(500);
    expect(notArt(today, p.rules.rect)).toBeGreaterThan(1000);
    // Textless: neither, and no set symbol — checked inside the art window
    // (the rules rect runs 0.3 % onto the border) and above the P/T plate.
    const inWindow = {
      ...p.rules.rect,
      leftPct: p.artSlot.leftPct + 0.5,
      widthPct: p.artSlot.widthPct - 1,
      heightPct: (p.pt!.plateRect ?? p.pt!.rect).topPct - p.rules.rect.topPct,
    };
    expect(notArt(textless, p.type.rect)).toBe(0);
    expect(notArt(textless, inWindow)).toBe(0);
    expect(notArt(today, inWindow)).toBeGreaterThan(1000);
    // Kept: the name + cost in the title band, and the P/T on its plate.
    expect(count(textless, p.title.rect, (px) => lum(px) < 60)).toBeGreaterThan(300);
    const plate = p.pt!.plateRect!;
    const gray = ([r, g, b]: [number, number, number]) => Math.abs(r - 128) <= 3 && Math.abs(g - 128) <= 3 && Math.abs(b - 128) <= 3;
    expect(count(textless, plate, gray)).toBeGreaterThan(500);
    expect(count(textless, p.pt!.rect, (px) => lum(px) < 60)).toBeGreaterThan(50);
  });
});
