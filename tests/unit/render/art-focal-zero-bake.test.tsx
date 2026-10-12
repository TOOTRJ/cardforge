import sharp from "sharp";
import { beforeAll, describe, expect, it, vi } from "vitest";
import { visibleArtCentre } from "@/lib/cards/art-framing";
import { satoriTransformOrigin } from "@/lib/render/card-image";

// ---------------------------------------------------------------------------
// Layout v51 on REAL bakes: the art zooms about its focal point when that
// point is exactly 0 on an axis.
//
// Satori 0.25 drops a `transform-origin` component that is 0 (`0%`, `0px`:
// its parser keeps a value only when it is truthy) and falls back to the
// centre on that axis. A card with focalX (or focalY) exactly 0 and a zoom
// other than 100 % was therefore baked zoomed about the MIDDLE of its art
// window on that axis: the picture's left (top) edge left the window, while
// the live preview, the art positioner and the print render (sharp, its own
// arithmetic) keep it. Found by #497's review with a coded picture on a
// saga: at zoom 130 % the bake showed the picture from 1.6 % across, the
// browser from 0.
//
// The picture here is coded — red = how far across, green = how far down —
// so a pixel says which part of the picture it shows. The frame masters are
// swapped for a clear PNG: the art window is every blue-128 pixel. The
// reference is lib/cards/art-framing.ts (the browser's object-fit +
// object-position + scale about the focal point, which the positioner and
// its tests hold to the preview).
// ---------------------------------------------------------------------------

const stand = vi.hoisted(() => ({ clear: "" }));

vi.mock("@/lib/render/card-frames", async (importOriginal) => {
  const real = await importOriginal<typeof import("@/lib/render/card-frames")>();
  return {
    ...real,
    preloadFrame: async () => {},
    preloadFrameAssets: async () => {},
    getFrameDataUrl: () => stand.clear,
    getPlateDataUrlForPath: () => stand.clear,
    getFrameOverlayDataUrl: () => stand.clear,
    getFrameAssetDataUrl: () => null,
  };
});

type Size = { width: number; height: number };
const WIDE: Size = { width: 1086, height: 362 }; // 3:1
const TALL: Size = { width: 362, height: 1086 }; // 1:3

/** A picture whose red channel is x (0–255 across), green is y, blue `tag`. */
async function coded(size: Size, tag: number): Promise<string> {
  const raw = Buffer.alloc(size.width * size.height * 3);
  for (let y = 0; y < size.height; y++) {
    for (let x = 0; x < size.width; x++) {
      const i = (y * size.width + x) * 3;
      raw[i] = Math.round((x / (size.width - 1)) * 255);
      raw[i + 1] = Math.round((y / (size.height - 1)) * 255);
      raw[i + 2] = tag;
    }
  }
  const png = await sharp(raw, { raw: { width: size.width, height: size.height, channels: 3 } }).png().toBuffer();
  return `data:image/png;base64,${png.toString("base64")}`;
}

const art = { wide: "", tall: "", second: "" };

beforeAll(async () => {
  const clear = await sharp({ create: { width: 16, height: 16, channels: 4, background: { r: 0, g: 0, b: 0, alpha: 0 } } })
    .png()
    .toBuffer();
  stand.clear = `data:image/png;base64,${clear.toString("base64")}`;
  art.wide = await coded(WIDE, 128);
  art.tall = await coded(TALL, 128);
  art.second = await coded(WIDE, 200);
});

type Position = { focalX: number; focalY: number; scale: number };

function card(template: string, artUrl: string, artPosition: Position, over: Record<string, unknown> = {}) {
  return {
    title: "Probe",
    cost: "",
    cardType: "enchantment",
    supertype: null,
    subtypes: [],
    rarity: "common",
    // A coloured card: a colourless one on a see-through master also draws
    // the art UNDER the frame (underFrameArt), which the clear stand-in
    // would show around the window.
    colorIdentity: ["red"],
    rulesText: "",
    flavorText: "",
    power: null,
    toughness: null,
    artistCredit: "",
    artUrl,
    artPosition,
    frameStyle: { template, finish: "regular" },
    ...over,
  } as never;
}

/** The part of the picture tagged `tag` that the bake shows: its window on
 *  the card (px) and the picture coordinates (0–1) at the window's edges. */
async function shown(data: never, tag: number) {
  const { renderCardImage } = await import("@/lib/render/card-image");
  const res = await renderCardImage(data, "hd", { brandMark: false, watermarkText: null });
  const { data: px, info } = await sharp(Buffer.from(await res.arrayBuffer())).ensureAlpha().raw().toBuffer({ resolveWithObject: true });
  const at = (x: number, y: number) => {
    const i = (y * info.width + x) * 4;
    return { r: px[i], g: px[i + 1], b: px[i + 2], a: px[i + 3] };
  };
  const isArt = (x: number, y: number) => {
    const p = at(x, y);
    return p.a === 255 && Math.abs(p.b - tag) <= 2;
  };
  // The window is the longest run of art on any row, and the run down
  // through its middle — not a bounding box: a grey pixel of anti-aliased
  // text elsewhere on the card can carry the tag's blue.
  let x0 = 0, x1 = -1, row = 0;
  for (let y = 0; y < info.height; y += 4) {
    for (let x = 0, start = -1; x <= info.width; x++) {
      const on = x < info.width && isArt(x, y);
      if (on && start < 0) start = x;
      if (!on && start >= 0) {
        if (x - 1 - start > x1 - x0) [x0, x1, row] = [start, x - 1, y];
        start = -1;
      }
    }
  }
  const mid = Math.round((x0 + x1) / 2);
  let y0 = row, y1 = row;
  while (y0 > 0 && isArt(mid, y0 - 1)) y0--;
  while (y1 < info.height - 1 && isArt(mid, y1 + 1)) y1++;
  const cx = Math.round((x0 + x1) / 2);
  const cy = Math.round((y0 + y1) / 2);
  return {
    window: { width: x1 - x0 + 1, height: y1 - y0 + 1 },
    left: at(x0 + 1, cy).r / 255,
    right: at(x1 - 1, cy).r / 255,
    top: at(cx, y0 + 1).g / 255,
    bottom: at(cx, y1 - 1).g / 255,
  };
}

/** What a browser shows in a `window`-sized box: the picture's edges, 0–1. */
function browser(window: Size, natural: Size, position: Position) {
  const centre = visibleArtCentre(window, natural, position);
  const cover = Math.max(window.width / natural.width, window.height / natural.height);
  const spanX = window.width / (natural.width * cover) / position.scale;
  const spanY = window.height / (natural.height * cover) / position.scale;
  return { left: centre.x - spanX / 2, right: centre.x + spanX / 2, top: centre.y - spanY / 2, bottom: centre.y + spanY / 2 };
}

// One 8-bit step of the code, the bake's resampling and a px of edge.
const TOLERANCE = 2;

describe("satoriTransformOrigin", () => {
  it("names the edge for a zero — the one spelling Satori reads as 0 — and keeps every other focal as its percentage", () => {
    expect(satoriTransformOrigin(0, 30)).toBe("left 30%");
    expect(satoriTransformOrigin(30, 0)).toBe("30% top");
    expect(satoriTransformOrigin(0, 0)).toBe("left top");
    expect(satoriTransformOrigin(50, 50)).toBe("50% 50%");
    expect(satoriTransformOrigin(100, 100)).toBe("100% 100%");
    expect(satoriTransformOrigin(12.5, 81.64473684210526)).toBe("12.5% 81.64473684210526%");
  });
});

describe("a zoomed art whose focal point is exactly 0 bakes as the browser draws it (layout v51)", () => {
  it("focal X 0 — a 3:1 picture in the saga's tall window, zoom 130 %: the picture's LEFT edge is the window's", async () => {
    const position = { focalX: 0, focalY: 0.5, scale: 1.3 };
    const bake = await shown(card("saga", art.wide, position), 128);
    const want = browser(bake.window, WIDE, position);
    expect(want.left).toBeCloseTo(0, 6);
    expect(bake.left, "left edge").toBeCloseTo(want.left, TOLERANCE);
    expect(bake.right, "right edge").toBeCloseTo(want.right, TOLERANCE);
    // Before v51: 0.016 … 0.122 — zoomed about the middle of the window.
    expect(bake.left).toBeLessThan(0.008);
  }, 60_000);

  it("focal Y 0 — a 1:3 picture in M15's wide window, zoom 130 %: the picture's TOP edge is the window's", async () => {
    const position = { focalX: 0.5, focalY: 0, scale: 1.3 };
    const bake = await shown(card("m15", art.tall, position, { cardType: "creature" }), 128);
    const want = browser(bake.window, TALL, position);
    expect(want.top).toBeCloseTo(0, 6);
    expect(bake.top, "top edge").toBeCloseTo(want.top, TOLERANCE);
    expect(bake.bottom, "bottom edge").toBeCloseTo(want.bottom, TOLERANCE);
    expect(bake.top).toBeLessThan(0.008);
  }, 60_000);

  it("both 0, zoom 200 %: the picture's top-left corner stays in the window's", async () => {
    const position = { focalX: 0, focalY: 0, scale: 2 };
    const bake = await shown(card("saga", art.wide, position), 128);
    const want = browser(bake.window, WIDE, position);
    expect(bake.left, "left edge").toBeCloseTo(want.left, TOLERANCE);
    expect(bake.top, "top edge").toBeCloseTo(want.top, TOLERANCE);
    expect(bake.right, "right edge").toBeCloseTo(want.right, TOLERANCE);
    expect(bake.bottom, "bottom edge").toBeCloseTo(want.bottom, TOLERANCE);
    expect(bake.left).toBeLessThan(0.008);
    expect(bake.top).toBeLessThan(0.008);
  }, 60_000);

  it("the split's SECOND window (the back face's art) at focal X 0, zoom 130 %", async () => {
    const position = { focalX: 0, focalY: 0.5, scale: 1.3 };
    const data = card("split", art.wide, { focalX: 0.5, focalY: 0.5, scale: 1 }, {
      cardType: "instant",
      backFace: { title: "Second", card_type: "instant", art_url: art.second, art_position: position },
    });
    const bake = await shown(data, 200);
    const want = browser(bake.window, WIDE, position);
    expect(bake.left, "left edge").toBeCloseTo(want.left, TOLERANCE);
    expect(bake.right, "right edge").toBeCloseTo(want.right, TOLERANCE);
    expect(bake.left).toBeLessThan(0.008);
  }, 60_000);

  it.each([
    { focalX: 0.25, focalY: 0.5, scale: 1.3 },
    { focalX: 1, focalY: 0.5, scale: 1.3 },
    { focalX: 0, focalY: 0.5, scale: 1 },
    { focalX: 0.5, focalY: 0.5, scale: 1 },
  ])("every other position is the crop it was: $focalX across at ×$scale", async (position) => {
    const bake = await shown(card("saga", art.wide, position), 128);
    const want = browser(bake.window, WIDE, position);
    expect(bake.left, "left edge").toBeCloseTo(want.left, TOLERANCE);
    expect(bake.right, "right edge").toBeCloseTo(want.right, TOLERANCE);
  }, 60_000);
});
