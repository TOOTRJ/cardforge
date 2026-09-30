import { createHash } from "node:crypto";
import fs from "node:fs";
import path from "node:path";
import sharp from "sharp";
import { afterAll, beforeAll, describe, expect, it, vi } from "vitest";
import type { CardPreviewData } from "@/components/cards/card-preview";
import { getFrameProfile, type Rect } from "@/lib/cards/template-layout";
import { applyCardCornerMask } from "@/lib/cards/card-corner";
import { EDGE_CONTRACTS } from "@/lib/frames/edge-contract";
import { imageNaturalSize, toSatoriDataUrl } from "@/lib/render/art-source";

// ---------------------------------------------------------------------------
// The PRINT renderer (lib/render/card-print.ts — TODO 6.10 full-resolution
// art, 6.1a 1/8 in bleed, 6.1b 800 ppi) on REAL renders:
//
//   * 6.10's acceptance: a 2000 × 2800 source on a full-card slot renders
//     the 800 ppi export 1:1 — every art pixel is the source's, never the
//     bake's 1600 px inline copy upsampled.
//   * The composite is the bake: at 600 ppi the print render matches a
//     square renderCardImage bake (focal point and zoom included) — the art
//     is placed in the box Satori laid out, with the same fit.
//   * 800 ppi is the HD LAYOUT at 4/3 (downscaled, it is the 600 ppi card).
//   * The bleed: the trim box is the export without bleed, byte for byte;
//     each edge extends by its declared recipe (lib/frames/edge-contract.ts)
//     — `border` copies the border out (M15, extended art, a showcase),
//     `art` continues the art with the TRIM transform (real source pixels
//     where the cover crop left them, mirrored where the source runs out),
//     `bar` copies the bar out (borderless M15, whose fins continue too).
//   * MakePlayingCards (TODO 6.1): MPC's bleed (72 px a side at 600 ppi,
//     96 at 800) around the same trim box, and a landscape card turned 90°
//     anticlockwise into the portrait card; a bleed PER AXIS keeps the trim
//     and the `art` edge's trim transform on each axis.
//
// Bucket masters (m15, fullartland, m15borderless) are stand-ins served by a
// stubbed bucket, as in edge-to-edge-bake.test.tsx; git masters (extended
// art, Bloomburrow) are the real files. PRINT_EVIDENCE_DIR=<dir> writes the
// renders there for a look (never into git: CC-derived frames stay out).
// ---------------------------------------------------------------------------

const ORIGIN = "https://frames.print.test";
const EVIDENCE_DIR = process.env.PRINT_EVIDENCE_DIR ?? null;
const BORDER_PX = 60;
const BODY_RGB = [46, 90, 46] as const;
const BAR_RGB = [90, 58, 26] as const;

let restore: () => void = () => {};

function raw(width: number, height: number, fill: readonly number[]): Buffer {
  const data = Buffer.alloc(width * height * 4);
  for (let i = 0; i < data.length; i += 4) data.set(fill, i);
  return data;
}

async function png(data: Buffer, width: number, height: number): Promise<Buffer> {
  return sharp(data, { raw: { width, height, channels: 4 } }).png().toBuffer();
}

function fillRect(data: Buffer, width: number, rect: { x0: number; y0: number; x1: number; y1: number }, rgba: readonly number[]) {
  for (let y = rect.y0; y < rect.y1; y += 1) for (let x = rect.x0; x < rect.x1; x += 1) data.set(rgba, (y * width + x) * 4);
}

function pxRect(rect: Rect, width: number, height: number) {
  return {
    x0: Math.round((rect.leftPct / 100) * width),
    y0: Math.round((rect.topPct / 100) * height),
    x1: Math.round(((rect.leftPct + rect.widthPct) / 100) * width),
    y1: Math.round(((rect.topPct + rect.heightPct) / 100) * height),
  };
}

/** A black-bordered stand-in master: the border, a green body, the art
 *  window cut out, the card corner cut round (as the importer cuts CC's). */
async function borderedMaster(template: string): Promise<Buffer> {
  const w = 1500;
  const h = 2100;
  const data = raw(w, h, [0, 0, 0, 255]);
  fillRect(data, w, { x0: BORDER_PX, y0: BORDER_PX, x1: w - BORDER_PX, y1: h - BORDER_PX }, [...BODY_RGB, 255]);
  const win = pxRect(getFrameProfile(template).artSlot, w, h);
  fillRect(
    data,
    w,
    { x0: Math.max(win.x0, BORDER_PX), y0: Math.max(win.y0, BORDER_PX), x1: Math.min(win.x1, w - BORDER_PX), y1: Math.min(win.y1, h - BORDER_PX) },
    [0, 0, 0, 0],
  );
  applyCardCornerMask(data, w, h);
  return png(data, w, h);
}

/** M15's colourless master stand-in: CC's see-through "Eldrazi" frame —
 *  the border, a HALF-transparent body (the art runs under the frame there,
 *  4.17's underFrameArt for "c"), the art window cut out. */
async function seeThroughMaster(): Promise<Buffer> {
  const w = 1500;
  const h = 2100;
  const data = raw(w, h, [0, 0, 0, 255]);
  fillRect(data, w, { x0: BORDER_PX, y0: BORDER_PX, x1: w - BORDER_PX, y1: h - BORDER_PX }, [200, 200, 210, 128]);
  const win = pxRect(getFrameProfile("m15").artSlot, w, h);
  fillRect(data, w, win, [0, 0, 0, 0]);
  applyCardCornerMask(data, w, h);
  return png(data, w, h);
}

/** A see-through stand-in (fullartland: art on every edge). */
async function clearMaster(): Promise<Buffer> {
  return png(raw(1500, 2100, [0, 0, 0, 0]), 1500, 2100);
}

/** CC m15/borderless's edges (EDGE_CONTRACTS.m15borderless): see-through,
 *  an opaque bottom bar 7.76 % H deep, and its fins up the side edges from
 *  78.67 % H (here 3 % W wide). */
async function borderlessMaster(): Promise<Buffer> {
  const w = 1500;
  const h = 2100;
  const data = raw(w, h, [0, 0, 0, 0]);
  const bar = [...BAR_RGB, 255];
  fillRect(data, w, { x0: 0, y0: Math.round(h * (1 - 0.0776)), x1: w, y1: h }, bar);
  const finTop = Math.round(h * 0.7867);
  fillRect(data, w, { x0: 0, y0: finTop, x1: Math.round(w * 0.03), y1: h }, bar);
  fillRect(data, w, { x0: w - Math.round(w * 0.03), y0: finTop, x1: w, y1: h }, bar);
  applyCardCornerMask(data, w, h);
  return png(data, w, h);
}

beforeAll(async () => {
  const { frameObjectKey, setFrameStorageForTests } = await import("@/lib/frames/frame-url");
  const files: Record<string, Buffer> = {
    "m15/g.png": await borderedMaster("m15"),
    "m15/c.png": await seeThroughMaster(),
    "fullartland/g.png": await clearMaster(),
    "m15borderless/g.png": await borderlessMaster(),
  };
  const manifest = {
    version: 1 as const,
    bucket: "frames",
    files: Object.fromEntries(
      Object.entries(files).map(([key, buf]) => {
        const sha256 = createHash("sha256").update(buf).digest("hex");
        return [key, { hash: sha256.slice(0, 12), sha256, bytes: buf.length, width: 1500, height: 2100 }];
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
  if (EVIDENCE_DIR) fs.mkdirSync(EVIDENCE_DIR, { recursive: true });
});

afterAll(() => {
  restore();
  vi.unstubAllGlobals();
});

/** Every pixel its own: R = x, G = y, B = x ^ y (mod 256). Anything
 *  resampled — or shifted by one — shows. */
async function patternArt(width: number, height: number, format: "png" | "jpeg" = "png"): Promise<string> {
  const data = Buffer.alloc(width * height * 3);
  for (let y = 0; y < height; y += 1) {
    for (let x = 0; x < width; x += 1) {
      const i = (y * width + x) * 3;
      data[i] = x & 255;
      data[i + 1] = y & 255;
      data[i + 2] = (x ^ y) & 255;
    }
  }
  const img = sharp(data, { raw: { width, height, channels: 3 } });
  const buf = format === "png" ? await img.png().toBuffer() : await img.jpeg({ quality: 95 }).toBuffer();
  return `data:image/${format};base64,${buf.toString("base64")}`;
}

/** A smooth, busy picture (the visual suite's) — resampling differences
 *  between two renderers stay small on it. */
async function smoothArt(width: number, height: number): Promise<string> {
  const px = Buffer.alloc(width * height * 3);
  for (let y = 0; y < height; y += 1) {
    for (let x = 0; x < width; x += 1) {
      const t = (x / width + y / height) / 2;
      const i = (y * width + x) * 3;
      px[i] = Math.round(200 - 150 * t + 20 * Math.sin(x / 60));
      px[i + 1] = Math.round(190 - 140 * t + 20 * Math.cos(y / 50));
      px[i + 2] = Math.round(170 - 110 * t + 30 * Math.sin((x + y) / 120));
    }
  }
  const buf = await sharp(px, { raw: { width, height, channels: 3 } }).png().toBuffer();
  return `data:image/png;base64,${buf.toString("base64")}`;
}

function card(template: string, patch: Partial<CardPreviewData> = {}): CardPreviewData {
  return {
    title: "Print Test",
    cardType: "sorcery",
    colorIdentity: ["green"],
    rarity: "common",
    artistCredit: "Test Artist",
    rulesText: "",
    flavorText: "",
    artPosition: {},
    setIconUrl: null,
    setIconCode: null,
    backFace: null,
    faceContent: null,
    watermark: null,
    frameStyle: { template, finish: "regular" },
    ...patch,
  } as unknown as CardPreviewData;
}

type Image = { data: Buffer; width: number; height: number; density?: number };

async function decode(bytes: Buffer): Promise<Image> {
  const meta = await sharp(bytes).metadata();
  const { data, info } = await sharp(bytes).ensureAlpha().raw().toBuffer({ resolveWithObject: true });
  return { data, width: info.width, height: info.height, density: meta.density };
}

const at = (img: Image, x: number, y: number) => {
  const i = (y * img.width + x) * 4;
  return [img.data[i], img.data[i + 1], img.data[i + 2], img.data[i + 3]];
};

async function print(
  c: CardPreviewData,
  opts: { ppi: 600 | 800; bleed: boolean | "mpc" | { x: number; y: number } },
  name?: string,
): Promise<Image> {
  const { renderCardPrint } = await import("@/lib/render/card-print");
  const bytes = await renderCardPrint(c, { ...opts, brandMark: false, watermarkText: null });
  if (EVIDENCE_DIR && name) fs.writeFileSync(path.join(EVIDENCE_DIR, `${name}.png`), bytes);
  return decode(bytes);
}

/** The pixel diff of two same-size images over a rect: mean and the share
 *  of channels within `tol`. */
function diff(a: Image, b: Image, rect: { x0: number; y0: number; x1: number; y1: number }, tol: number) {
  expect([a.width, a.height]).toEqual([b.width, b.height]);
  let sum = 0;
  let within = 0;
  let n = 0;
  for (let y = rect.y0; y < rect.y1; y += 1) {
    for (let x = rect.x0; x < rect.x1; x += 1) {
      const i = (y * a.width + x) * 4;
      for (let c = 0; c < 3; c += 1) {
        const d = Math.abs(a.data[i + c] - b.data[i + c]);
        sum += d;
        if (d <= tol) within += 1;
        n += 1;
      }
    }
  }
  return { mean: sum / n, within: within / n };
}

async function bake(c: CardPreviewData): Promise<Image> {
  const { renderCardImage } = await import("@/lib/render/card-image");
  const res = await renderCardImage(c, "hd", { brandMark: false, watermarkText: null, corners: "square" });
  return decode(Buffer.from(await res.arrayBuffer()));
}

/** The art slot of `template` in px on a width × height canvas, inset by
 *  `inset` px (keeps a test off the frame's anti-aliased edge). */
function slotPx(template: string, width: number, height: number, inset = 0) {
  const r = pxRect(getFrameProfile(template).artSlot, width, height);
  return { x0: r.x0 + inset, y0: r.y0 + inset, x1: r.x1 - inset, y1: r.y1 - inset };
}

describe("TODO 6.10 — full-resolution art", () => {
  it("renders a 2000 × 2800 source on a full-card slot 1:1 at 800 ppi (no upsampling)", async () => {
    // WebP, as AI art arrives: the bake's inline path transcodes it and fits
    // it to 1600 px (so an 800 ppi slot would be an upsample of that copy).
    const pattern = await patternArt(2000, 2800);
    const webp = await sharp(Buffer.from(pattern.split(",")[1], "base64")).webp({ lossless: true, effort: 0 }).toBuffer();
    const inlined = await imageNaturalSize(await toSatoriDataUrl(webp));
    expect(Math.max(inlined!.width, inlined!.height)).toBe(1600);

    const img = await print(
      card("fullartland", { artUrl: `data:image/webp;base64,${webp.toString("base64")}` }),
      { ppi: 800, bleed: false },
      "fullartland-800ppi",
    );
    expect([img.width, img.height, img.density]).toEqual([2000, 2800, 800]);
    // Between the name (to 10 %) and the type line (from 85 %), nothing but
    // the art is drawn: every pixel is the source's own.
    let wrong = 0;
    for (let y = 420; y < 2300; y += 1) {
      for (let x = 60; x < 1940; x += 1) {
        const [r, g, b] = at(img, x, y);
        if (r !== (x & 255) || g !== (y & 255) || b !== ((x ^ y) & 255)) wrong += 1;
      }
    }
    expect(wrong).toBe(0);
  }, 60_000);

  it("draws the art the way the bake does — the box Satori laid out, focal point and zoom", async () => {
    const art = await smoothArt(1200, 900);
    for (const artPosition of [
      { focalX: 0.3, focalY: 0.65, scale: 1.7 },
      // Zoomed out: the art no longer covers its window (the root shows).
      { focalX: 0.8, focalY: 0.2, scale: 0.6 },
    ]) {
      const c = card("m15", { artUrl: art, artPosition, rulesText: "Draw two cards." });
      const [printed, baked] = await Promise.all([print(c, { ppi: 600, bleed: false }), bake(c)]);
      // Two resamplers (cairo's in the bake, lanczos3 here) and, zoomed out,
      // the picture's own edge (anti-aliased there, whole px here) — close,
      // never shifted (a 1 px shift triples the mean on this art).
      const inArt = diff(printed, baked, slotPx("m15", 1500, 2100, 20), 12);
      expect(inArt.mean).toBeLessThan(1.5);
      expect(inArt.within).toBeGreaterThan(0.985);
      // Frame, text and corners: the same layer, composited the same way.
      const whole = diff(printed, baked, { x0: 0, y0: 0, x1: 1500, y1: 2100 }, 2);
      expect(whole.within).toBeGreaterThan(0.995);
    }
  }, 60_000);

  it("keeps the paint order of a see-through frame: under-frame art, the art, then the frame", async () => {
    const c = card("m15", { artUrl: await smoothArt(1200, 900), colorIdentity: [] });
    const [printed, baked] = await Promise.all([print(c, { ppi: 600, bleed: false }, "m15-see-through-600ppi"), bake(c)]);
    // The half-transparent body shows the under-frame art in both.
    const body = { x0: 200, y0: 1300, x1: 1300, y1: 1800 };
    expect(diff(printed, baked, body, 4).within).toBeGreaterThan(0.99);
    expect(diff(printed, baked, slotPx("m15", 1500, 2100, 20), 12).mean).toBeLessThan(1.5);
  }, 60_000);

  it("leaves the second face's art (split) and a foil sheen to the layer, as the bake draws them", async () => {
    const back = {
      title: "Ice",
      cost: "{1}{U}",
      card_type: "instant",
      art_url: await smoothArt(900, 1200),
      art_position: { focalX: 0.4, focalY: 0.5, scale: 1.2 },
      rules_text: "Tap target permanent.",
    };
    const split = card("split", {
      artUrl: await smoothArt(1200, 900),
      rulesText: "Fire deals 2 damage divided as you choose.",
      backFace: back,
      colorIdentity: ["red"],
    } as unknown as Partial<CardPreviewData>);
    const [printed, baked] = await Promise.all([print(split, { ppi: 600, bleed: false }, "split-600ppi"), bake(split)]);
    expect([printed.width, printed.height]).toEqual([2100, 1500]);
    expect(diff(printed, baked, { x0: 0, y0: 0, x1: 2100, y1: 1500 }, 12).within).toBeGreaterThan(0.99);

    const foil = card("m15", { artUrl: await smoothArt(1200, 900), frameStyle: { template: "m15", finish: "foil" } } as Partial<CardPreviewData>);
    const [foilPrinted, foilBaked] = await Promise.all([print(foil, { ppi: 600, bleed: false }), bake(foil)]);
    expect(diff(foilPrinted, foilBaked, { x0: 0, y0: 0, x1: 1500, y1: 2100 }, 12).within).toBeGreaterThan(0.99);
  }, 60_000);

  it("prints art sharp can't fully decode (a truncated upload) the way the bake draws it, instead of failing", async () => {
    // sharp reads the header, then stops at the missing scans ("premature end
    // of JPEG"); the bake's decoder draws what is there. The PDF (every PDF
    // renders through here) must not turn that card into a 500.
    const full = Buffer.from((await smoothArt(1200, 900)).split(",")[1], "base64");
    const jpeg = await sharp(full).jpeg({ quality: 90 }).toBuffer();
    const truncated = jpeg.subarray(0, Math.floor(jpeg.length * 0.6));
    await expect(sharp(truncated).raw().toBuffer()).rejects.toThrow();
    const c = card("m15", { artUrl: `data:image/jpeg;base64,${truncated.toString("base64")}`, rulesText: "Draw a card." });
    const warn = vi.spyOn(console, "warn").mockImplementation(() => {});
    try {
      const [printed, baked] = await Promise.all([print(c, { ppi: 600, bleed: false }), bake(c)]);
      expect([printed.width, printed.height, printed.density]).toEqual([1500, 2100, 600]);
      // The layer drew the art itself: the square bake, pixel for pixel.
      expect(diff(printed, baked, { x0: 0, y0: 0, x1: 1500, y1: 2100 }, 1).within).toBeGreaterThan(0.999);
      expect(warn).toHaveBeenCalledWith(expect.stringMatching(/^\[print\] full-resolution art failed/));
      // …and with the bleed, the trim box is still that card.
      const bled = await print(c, { ppi: 600, bleed: true });
      expect([bled.width, bled.height]).toEqual([1650, 2250]);
    } finally {
      warn.mockRestore();
    }
  }, 60_000);

  it("turns a phone photo upright the way the creator shows it", async () => {
    // Stored sideways with EXIF 6 ("turn me 90° clockwise"): red on top as
    // stored, so red is on the RIGHT once turned.
    const w = 900;
    const h = 1200;
    const px = raw(w, h, [220, 30, 30, 255]);
    fillRect(px, w, { x0: 0, y0: h / 2, x1: w, y1: h }, [30, 30, 220, 255]);
    const jpeg = await sharp(px, { raw: { width: w, height: h, channels: 4 } })
      .removeAlpha()
      .jpeg({ quality: 95 })
      .withMetadata({ orientation: 6 })
      .toBuffer();
    const img = await print(card("m15", { artUrl: `data:image/jpeg;base64,${jpeg.toString("base64")}` }), { ppi: 600, bleed: false });
    const slot = slotPx("m15", 1500, 2100, 20);
    const midY = Math.round((slot.y0 + slot.y1) / 2);
    const [lr, , lb] = at(img, slot.x0 + 10, midY);
    const [rr, , rb] = at(img, slot.x1 - 10, midY);
    expect(lb).toBeGreaterThan(lr); // blue on the left
    expect(rr).toBeGreaterThan(rb); // red on the right
  }, 60_000);
});

describe("TODO 6.1b — 800 ppi", () => {
  it("is the HD layout at 4/3 (downscaled, the 600 ppi card), tagged 800 ppi", async () => {
    const c = card("m15", { artUrl: await smoothArt(1200, 900), rulesText: "Flying\nWhen this enters, draw a card." });
    const [hi, lo] = await Promise.all([print(c, { ppi: 800, bleed: false }, "m15-800ppi"), print(c, { ppi: 600, bleed: false })]);
    expect([hi.width, hi.height, hi.density]).toEqual([2000, 2800, 800]);
    expect(lo.density).toBe(600);
    const down = await decode(
      await sharp(hi.data, { raw: { width: 2000, height: 2800, channels: 4 } }).resize(1500, 2100).png().toBuffer(),
    );
    const d = diff(down, lo, { x0: 0, y0: 0, x1: 1500, y1: 2100 }, 24);
    expect(d.mean).toBeLessThan(2);
    expect(d.within).toBeGreaterThan(0.99);
  }, 60_000);

  it("turns a landscape frame the other way round (Battle at 800 ppi with the bleed: 3000 × 2200)", async () => {
    const img = await print(
      card("battle", { artUrl: await smoothArt(1200, 900), cardType: "battle", defense: "5" } as Partial<CardPreviewData>),
      { ppi: 800, bleed: true },
      "battle-800ppi-bleed",
    );
    expect([img.width, img.height]).toEqual([3000, 2200]);
  }, 60_000);
});

describe("TODO 6.1a — the 1/8 in bleed", () => {
  /** The trim box of a bleed render, cut back out. */
  async function trimOf(img: Image, bleed: number, w: number, h: number): Promise<Image> {
    return decode(
      await sharp(img.data, { raw: { width: img.width, height: img.height, channels: 4 } })
        .extract({ left: bleed, top: bleed, width: w, height: h })
        .png()
        .toBuffer(),
    );
  }

  it("never scales the card: the trim box IS the export without bleed, byte for byte", async () => {
    for (const [template, ppi] of [
      ["m15", 600],
      ["m15borderless", 800],
      ["fullartland", 600],
    ] as const) {
      const c = card(template, { artUrl: await smoothArt(1200, 1500), rulesText: "Draw a card." });
      const [bled, plain] = await Promise.all([print(c, { ppi, bleed: true }), print(c, { ppi, bleed: false })]);
      const b = ppi === 600 ? 75 : 100;
      expect([bled.width, bled.height]).toEqual([plain.width + 2 * b, plain.height + 2 * b]);
      const trim = await trimOf(bled, b, plain.width, plain.height);
      expect(trim.data.equals(plain.data)).toBe(true);
    }
  }, 120_000);

  it("`border`: M15's black border runs out to the bleed edge, corners included", async () => {
    // (Black up to the 1 px ramp where the master's own round cut meets the
    // square fill — (4,4,5) at most, as on the square HD card.)
    expect(EDGE_CONTRACTS.m15).toEqual({ top: { kind: "border" }, right: { kind: "border" }, bottom: { kind: "border" }, left: { kind: "border" } });
    const img = await print(card("m15", { artUrl: await smoothArt(1200, 900), rulesText: "Draw two cards." }), { ppi: 600, bleed: true }, "m15-bleed-600ppi");
    expect([img.width, img.height]).toEqual([1650, 2250]);
    let notBlack = 0;
    for (let y = 0; y < 2250; y += 1) {
      for (let x = 0; x < 1650; x += 1) {
        if (x >= 75 && x < 1575 && y >= 75 && y < 2175) continue;
        const [r, g, b] = at(img, x, y);
        if (Math.max(r, g, b) > 6) notBlack += 1;
      }
    }
    expect(notBlack).toBe(0);
  }, 60_000);

  it.each(["extendedart", "bloomburrow"])("`border` (%s, the git master): every bleed pixel continues its trim edge", async (template) => {
    const img = await print(card(template, { artUrl: await smoothArt(1200, 900) }), { ppi: 600, bleed: true }, `${template}-bleed-600ppi`);
    const b = 75;
    const w = 1650;
    const h = 2250;
    const same = (p: number[], q: number[]) => p.every((v, i) => v === q[i]);
    let off = 0;
    for (let y = b; y < h - b; y += 1) {
      for (let x = 0; x < b; x += 1) if (!same(at(img, x, y), at(img, b, y))) off += 1;
      for (let x = w - b; x < w; x += 1) if (!same(at(img, x, y), at(img, w - b - 1, y))) off += 1;
    }
    for (let x = 0; x < w; x += 1) {
      const cx = Math.min(Math.max(x, b), w - b - 1);
      for (let y = 0; y < b; y += 1) if (!same(at(img, x, y), at(img, cx, b))) off += 1;
      for (let y = h - b; y < h; y += 1) if (!same(at(img, x, y), at(img, cx, h - b - 1))) off += 1;
    }
    expect(off).toBe(0);
  }, 60_000);

  it("`art`: the art keeps the TRIM transform into the bleed — real source pixels, mirrored where it runs out", async () => {
    expect(EDGE_CONTRACTS.fullartland.left).toEqual({ kind: "art" });
    // 2400 × 2800 on the 2000 × 2800 full-card slot at 800 ppi: cover is
    // exactly 1 (height), the centred crop leaves 200 source px each side.
    const img = await print(card("fullartland", { artUrl: await patternArt(2400, 2800) }), { ppi: 800, bleed: true }, "fullartland-800ppi-bleed");
    const b = 100;
    expect([img.width, img.height]).toEqual([2200, 3000]);
    const src = (sx: number, sy: number) => [sx & 255, sy & 255, (sx ^ sy) & 255];
    const rgb = (x: number, y: number) => at(img, x, y).slice(0, 3);
    let wrong = 0;
    // Left and right bleed at mid-height: source columns 100–199 and
    // 2200–2299 — what the trim transform puts there, not a re-cover.
    for (let y = 1200; y < 1300; y += 1) {
      for (let x = 0; x < b; x += 1) {
        const sy = y - b;
        if (rgb(x, y).join() !== src(x + 100, sy).join()) wrong += 1;
        const rx = 2200 - b + x;
        if (rgb(rx, y).join() !== src(rx - b + 200, sy).join()) wrong += 1;
      }
    }
    // Top bleed: the source has no rows above 0 — mirrored (row d above the
    // trim shows source row d − 1).
    for (let d = 1; d <= b; d += 1) {
      for (let x = 900; x < 1000; x += 1) if (rgb(x, b - d).join() !== src(x - b + 200, d - 1).join()) wrong += 1;
    }
    expect(wrong).toBe(0);
  }, 60_000);

  it("`art` + `bar` (borderless M15): art up the top and sides, the fins and the bottom bar copied out", async () => {
    expect(EDGE_CONTRACTS.m15borderless.bottom.kind).toBe("bar");
    const img = await print(card("m15borderless", { artUrl: await smoothArt(1200, 1800) }), { ppi: 800, bleed: true }, "m15borderless-800ppi-bleed");
    const b = 100;
    const [w, h] = [2200, 3000];
    const isBar = (p: number[]) => p[0] === BAR_RGB[0] && p[1] === BAR_RGB[1] && p[2] === BAR_RGB[2];
    const isRoot = (p: number[]) => p[0] === 16 && p[1] === 16 && p[2] === 21;
    // Top band and the sides above the fins: art (neither bar nor root).
    for (const [x, y] of [[w / 2, 10], [10, 10], [w - 10, 10], [10, 1200], [w - 10, 1500]]) {
      const p = at(img, x, y);
      expect(isBar(p) || isRoot(p)).toBe(false);
    }
    // Beside a fin, and below the bar: the frame's colour.
    for (const [x, y] of [[10, 2600], [w - 10, 2600], [w / 2, h - 10], [w / 2, h - b]]) expect(isBar(at(img, x, y))).toBe(true);
  }, 60_000);
});

describe("TODO 6.1 — MakePlayingCards and a bleed per axis", () => {
  /** A rect of an image, as its own image. */
  async function crop(img: Image, left: number, top: number, width: number, height: number): Promise<Image> {
    return decode(
      await sharp(img.data, { raw: { width: img.width, height: img.height, channels: 4 } })
        .extract({ left, top, width, height })
        .png()
        .toBuffer(),
    );
  }

  it("MPC: 1644 × 2244 at 600 ppi (2192 × 2992 at 800) — the same trim box, MPC's bleed round it", async () => {
    const c = card("m15", { artUrl: await smoothArt(1200, 900), rulesText: "Draw two cards." });
    for (const [ppi, b, size] of [
      [600, 72, [1644, 2244]],
      [800, 96, [2192, 2992]],
    ] as const) {
      const [mpc, plain] = await Promise.all([print(c, { ppi, bleed: "mpc" }, `m15-mpc-${ppi}ppi`), print(c, { ppi, bleed: false })]);
      expect([mpc.width, mpc.height, mpc.density]).toEqual([...size, ppi]);
      const trim = await crop(mpc, b, b, plain.width, plain.height);
      expect(trim.data.equals(plain.data)).toBe(true);
      // `border`: M15's black runs out to the file's edge.
      for (const [x, y] of [[0, 0], [size[0] - 1, size[1] - 1], [b - 1, size[1] / 2], [size[0] / 2, 0]]) {
        expect(Math.max(...at(mpc, x, y).slice(0, 3))).toBeLessThanOrEqual(6);
      }
    }
  }, 120_000);

  it("MPC turns a landscape card (Battle) upright: 1644 × 2244, the landscape card turned 90° anticlockwise", async () => {
    const battle = card("battle", { artUrl: await smoothArt(1200, 900), cardType: "battle", defense: "5" } as Partial<CardPreviewData>);
    const [mpc, plain] = await Promise.all([
      print(battle, { ppi: 600, bleed: "mpc" }, "battle-mpc-600ppi"),
      print(battle, { ppi: 600, bleed: false }),
    ]);
    expect([plain.width, plain.height]).toEqual([2100, 1500]);
    expect([mpc.width, mpc.height, mpc.density]).toEqual([1644, 2244, 600]);
    // The trim box is the landscape card turned anticlockwise: its top edge
    // up the left side, its top-left corner at the bottom left — the way
    // the PDF turns it (card-pdf.ts cardSlotPlacement).
    const turned = await decode(
      await sharp(plain.data, { raw: { width: 2100, height: 1500, channels: 4 } }).rotate(270).png().toBuffer(),
    );
    expect([turned.width, turned.height]).toEqual([1500, 2100]);
    expect(at(turned, 0, 2099)).toEqual(at(plain, 0, 0));
    const trim = await crop(mpc, 72, 72, 1500, 2100);
    expect(trim.data.equals(turned.data)).toBe(true);
  }, 120_000);

  it("a bleed per axis: the trim box stays the card, each axis extends by its own bleed", async () => {
    const perAxis = { x: 0.125, y: 0.1 }; // 75 × 60 px at 600 ppi
    const c = card("m15", { artUrl: await smoothArt(1200, 900) });
    const [bled, plain] = await Promise.all([print(c, { ppi: 600, bleed: perAxis }), print(c, { ppi: 600, bleed: false })]);
    expect([bled.width, bled.height]).toEqual([1650, 2220]);
    expect((await crop(bled, 75, 60, 1500, 2100)).data.equals(plain.data)).toBe(true);

    // A landscape render is the card turned: its left and right edges take
    // the card's y bleed, its top and bottom the x.
    const battle = card("battle", { artUrl: await smoothArt(1200, 900), cardType: "battle", defense: "5" } as Partial<CardPreviewData>);
    const [wide, widePlain] = await Promise.all([print(battle, { ppi: 600, bleed: perAxis }), print(battle, { ppi: 600, bleed: false })]);
    expect([wide.width, wide.height]).toEqual([2220, 1650]);
    expect((await crop(wide, 60, 75, 2100, 1500)).data.equals(widePlain.data)).toBe(true);
  }, 120_000);

  it("`art` with a bleed per axis: the art keeps the TRIM transform on each axis — source pixels at the side, mirrored above", async () => {
    // As the 1/8 in `art` test: 2400 × 2800 on fullartland's 2000 × 2800
    // slot at 800 ppi (cover 1, 200 source px cropped each side) — with
    // 100 px of bleed at the sides and 80 px at the top and bottom.
    const img = await print(card("fullartland", { artUrl: await patternArt(2400, 2800) }), { ppi: 800, bleed: { x: 0.125, y: 0.1 } });
    const [bx, by] = [100, 80];
    expect([img.width, img.height]).toEqual([2200, 2960]);
    const src = (sx: number, sy: number) => [sx & 255, sy & 255, (sx ^ sy) & 255];
    const rgb = (x: number, y: number) => at(img, x, y).slice(0, 3);
    let wrong = 0;
    for (let y = 1200; y < 1300; y += 1) {
      for (let x = 0; x < bx; x += 1) {
        const sy = y - by;
        if (rgb(x, y).join() !== src(x + 100, sy).join()) wrong += 1;
        const rx = 2200 - bx + x;
        if (rgb(rx, y).join() !== src(rx - bx + 200, sy).join()) wrong += 1;
      }
    }
    for (let d = 1; d <= by; d += 1) {
      for (let x = 900; x < 1000; x += 1) if (rgb(x, by - d).join() !== src(x - bx + 200, d - 1).join()) wrong += 1;
    }
    expect(wrong).toBe(0);
  }, 60_000);
});
