import { createHash } from "node:crypto";
import sharp from "sharp";
import { afterEach, beforeAll, describe, expect, it, vi } from "vitest";
import type { CardPreviewData } from "@/components/cards/card-preview";
import type { FrameTemplate } from "@/types/card";
import { getFrameProfile } from "@/lib/cards/template-layout";
import { loyaltyStripeRects } from "@/lib/cards/foil-finish";
import { RENDER_PRESETS } from "@/lib/render/card-image";
import { FOIL_MASK_EDGE, foilMaskSource } from "@/lib/render/art-source";

// ---------------------------------------------------------------------------
// Foil finish on REAL bakes (git frames from public/frames, read from disk, so
// these are deterministic and offline). The old overlay never reached a saved
// image: `inset: 0` (ignored by Satori → a zero-size box) + mixBlendMode
// (never emitted), so every foil bake was byte-identical to a regular one.
// The shared FoilSheen (lib/cards/foil-finish.tsx) paints a rainbow through a
// luminance mask of the art layers + frame, above art/frame, below the ink.
// Rendered at the "default" preset (750 × 1050).
// ---------------------------------------------------------------------------

const W = RENDER_PRESETS.default.width;
const H = RENDER_PRESETS.default.height;

/** 1200 × 800 art: light left half, black right half — the mask must follow
 *  it (foil on the light half only) with the art's own cover geometry. */
async function splitArt(): Promise<string> {
  const w = 1200;
  const h = 800;
  const px = Buffer.alloc(w * h * 3);
  for (let y = 0; y < h; y += 1) {
    for (let x = 0; x < w; x += 1) {
      px.fill(x < w / 2 ? 242 : 4, (y * w + x) * 3, (y * w + x) * 3 + 3);
    }
  }
  const png = await sharp(px, { raw: { width: w, height: h, channels: 3 } }).png().toBuffer();
  return `data:image/png;base64,${png.toString("base64")}`;
}

function card(template: FrameTemplate, finish: string, over: Partial<CardPreviewData> = {}): CardPreviewData {
  return {
    title: "Probe Knight",
    cost: "{2}{W}",
    cardType: "creature",
    supertype: null,
    subtypes: ["Human", "Knight"],
    rarity: "uncommon",
    colorIdentity: ["white"],
    rulesText: "Vigilance",
    flavorText: null,
    power: "4",
    toughness: "4",
    loyalty: null,
    defense: null,
    artistCredit: "Probe",
    artUrl: null,
    artPosition: {},
    frameStyle: { template, finish },
    setIconUrl: null,
    setIconCode: null,
    backFace: null,
    faceContent: null,
    watermark: null,
    ...over,
  } as CardPreviewData;
}

type Raw = { data: Buffer; png: Buffer };
async function bakeWith(
  mod: typeof import("@/lib/render/card-image"),
  data: CardPreviewData,
): Promise<Raw> {
  const png = Buffer.from(
    await (await mod.renderCardImage(data, "default", { brandMark: false, watermarkText: null })).arrayBuffer(),
  );
  return { png, data: await sharp(png).removeAlpha().raw().toBuffer() };
}

const box = (r: { topPct: number; leftPct: number; widthPct: number; heightPct: number }, inset = 1) => ({
  x0: Math.ceil(((r.leftPct + inset) / 100) * W),
  y0: Math.ceil(((r.topPct + inset) / 100) * H),
  x1: Math.floor(((r.leftPct + r.widthPct - inset) / 100) * W),
  y1: Math.floor(((r.topPct + r.heightPct - inset) / 100) * H),
});
const lum = (r: Raw, x: number, y: number) => {
  const i = (y * W + x) * 3;
  return 0.299 * r.data[i] + 0.587 * r.data[i + 1] + 0.114 * r.data[i + 2];
};
const delta = (a: Raw, b: Raw, x: number, y: number) => {
  const i = (y * W + x) * 3;
  return (
    Math.abs(a.data[i] - b.data[i]) + Math.abs(a.data[i + 1] - b.data[i + 1]) + Math.abs(a.data[i + 2] - b.data[i + 2])
  ) / 3;
};
function meanDelta(a: Raw, b: Raw, r: { x0: number; y0: number; x1: number; y1: number }) {
  let sum = 0;
  let n = 0;
  for (let y = r.y0; y < r.y1; y += 1) {
    for (let x = r.x0; x < r.x1; x += 1) {
      sum += delta(a, b, x, y);
      n += 1;
    }
  }
  return sum / n;
}

describe("foil finish — real bakes", () => {
  it("sheens the light art, the frame, the text box and the P/T plate; black border, dark art and ink stay put", async () => {
    const mod = await import("@/lib/render/card-image");
    const art = await splitArt();
    // Off-centre focal point + zoom: the mask must reproduce object-fit:
    // cover + object-position + transform: scale exactly.
    const over = { artUrl: art, artPosition: { focalX: 0.3, focalY: 0.5, scale: 1.25 } };
    const [regular, foil] = [await bakeWith(mod, card("modern", "regular", over)), await bakeWith(mod, card("modern", "foil", over))];
    const p = getFrameProfile("modern");

    // Black border: untouched (luminance mask ≈ 0 there).
    expect(meanDelta(regular, foil, { x0: 0, y0: 150, x1: 8, y1: 900 })).toBe(0);

    // Art: light half sheened, dark half (≈ black) not.
    const a = box(p.artSlot);
    const yMid = Math.round((a.y0 + a.y1) / 2);
    const band = { y0: yMid - 40, y1: yMid + 40 };
    // Where the art's light/dark edge actually lands in the regular bake…
    let artEdge = -1;
    for (let x = a.x0; x < a.x1; x += 1) {
      if (lum(regular, x, yMid) < 128) {
        artEdge = x;
        break;
      }
    }
    expect(artEdge).toBeGreaterThan(a.x0 + 50);
    expect(artEdge).toBeLessThan(a.x1 - 50);
    expect(meanDelta(regular, foil, { x0: a.x0, x1: artEdge - 6, ...band })).toBeGreaterThan(8);
    expect(meanDelta(regular, foil, { x0: artEdge + 6, x1: a.x1, ...band })).toBeLessThan(1.5);
    // …and where the sheen stops: the same column (± 3 px) — the mask's art
    // copy sits exactly on the drawn art.
    const colDelta = (x: number) => meanDelta(regular, foil, { x0: x, x1: x + 1, ...band });
    const left = meanDelta(regular, foil, { x0: a.x0, x1: artEdge - 6, ...band });
    let sheenEdge = -1;
    for (let x = a.x0; x < a.x1; x += 1) {
      if (colDelta(x) < left / 2) {
        sheenEdge = x;
        break;
      }
    }
    expect(Math.abs(sheenEdge - artEdge)).toBeLessThanOrEqual(3);

    // Frame + text box (the modern white frame is pale): sheened.
    expect(meanDelta(regular, foil, box(p.title.rect))).toBeGreaterThan(4);
    const rules = box(p.rules.rect);
    expect(meanDelta(regular, foil, { ...rules, y0: Math.round((rules.y0 + rules.y1) / 2) })).toBeGreaterThan(6);
    // The P/T plate (drawn above the full-card layer) carries its own sheen.
    expect(meanDelta(regular, foil, box(p.pt!.rect, 0.5))).toBeGreaterThan(3);

    // Ink sits ON the foil: the rules text's dark glyph cores are unchanged.
    let ink = 0;
    let moved = 0;
    for (let y = rules.y0; y < rules.y1; y += 1) {
      for (let x = rules.x0; x < rules.x1; x += 1) {
        if (lum(regular, x, y) < 40) {
          ink += 1;
          if (delta(regular, foil, x, y) > 24) moved += 1;
        }
      }
    }
    expect(ink).toBeGreaterThan(50);
    expect(moved / ink).toBeLessThan(0.02);
  }, 60_000);

  it("gives a separate plate box (plateRect) its sheen too", async () => {
    const mod = await import("@/lib/render/card-image");
    const [regular, foil] = [await bakeWith(mod, card("tarkirdragon", "regular")), await bakeWith(mod, card("tarkirdragon", "foil"))];
    const plate = getFrameProfile("tarkirdragon").pt!.plateRect!;
    expect(meanDelta(regular, foil, box(plate, 0.5))).toBeGreaterThan(2);
  }, 60_000);

  it("is purely additive: every other finish never touches it, and foil minus the sheen IS the regular bake", async () => {
    const real = await import("@/lib/render/card-image");
    const art = await splitArt();
    const over = { artUrl: art, artPosition: { focalX: 0.3, focalY: 0.5, scale: 1.25 } };
    const bakes = async (mod: typeof real) => ({
      regular: await bakeWith(mod, card("retro", "regular", over)),
      etched: await bakeWith(mod, card("retro", "etched", over)),
      showcase: await bakeWith(mod, card("retro", "showcase", over)),
      foil: await bakeWith(mod, card("retro", "foil", over)),
    });
    const withFoil = await bakes(real);

    vi.resetModules();
    vi.doMock("@/lib/cards/foil-finish", async (importOriginal) => ({
      ...(await importOriginal<typeof import("@/lib/cards/foil-finish")>()),
      FoilSheen: () => null,
    }));
    try {
      const stubbed = await bakes(await import("@/lib/render/card-image"));
      expect(stubbed.regular.png.equals(withFoil.regular.png)).toBe(true);
      expect(stubbed.etched.png.equals(withFoil.etched.png)).toBe(true);
      expect(stubbed.showcase.png.equals(withFoil.showcase.png)).toBe(true);
      // A foil bake with the sheen removed is byte-for-byte the regular one…
      expect(stubbed.foil.png.equals(withFoil.regular.png)).toBe(true);
      // …and with it, it isn't (the old bug: foil == regular).
      expect(withFoil.foil.png.equals(withFoil.regular.png)).toBe(false);
    } finally {
      vi.doUnmock("@/lib/cards/foil-finish");
      vi.resetModules();
    }
  }, 120_000);
});

// ---------------------------------------------------------------------------
// Planeswalker ability stripes. The rows paint translucent pale stripes OVER
// the full-card sheen, so a foil planeswalker's ability box only kept a
// faint trace of it; each stripe now carries its own sheen (FoilStripeSheen)
// between the stripe and the badge + text. The same frame's rules backdrop
// (its own block below) had the same trap and shares this stand-in. The
// m15pw masters live in the frames bucket (never in git), so these bakes are
// served a synthetic stand-in through a stubbed bucket — near-black card
// with a transparent art window, grey loyalty plate — while the stripes,
// rows and badges (git) are the real M15PW profile's. Offline and
// deterministic.
// ---------------------------------------------------------------------------

const PW_ORIGIN = "https://frames.test";
// A static first row, like Coden's: every row gets the sheen, badged or not.
const PW_RULES = "Static line.\n+1: Scry 1.\n−2: Draw a card.\n−7: You win.";
const PW_ROWS = 4;

async function syntheticPwBucket() {
  const { frameObjectKey } = await import("@/lib/frames/frame-url");
  const [fw, fh] = [1500, 2100];
  const a = getFrameProfile("m15pw").artSlot;
  const [x0, x1] = [Math.round((a.leftPct / 100) * fw), Math.round(((a.leftPct + a.widthPct) / 100) * fw)];
  const [y0, y1] = [Math.round((a.topPct / 100) * fh), Math.round(((a.topPct + a.heightPct) / 100) * fh)];
  const px = Buffer.alloc(fw * fh * 4);
  for (let y = 0; y < fh; y += 1) {
    for (let x = 0; x < fw; x += 1) {
      if (x >= x0 && x < x1 && y >= y0 && y < y1) continue; // the window: transparent
      px.fill(20, (y * fw + x) * 4, (y * fw + x) * 4 + 3);
      px[(y * fw + x) * 4 + 3] = 255;
    }
  }
  const frame = await sharp(px, { raw: { width: fw, height: fh, channels: 4 } }).png().toBuffer();
  const plate = await sharp({ create: { width: 240, height: 154, channels: 4, background: { r: 128, g: 128, b: 128, alpha: 1 } } })
    .png()
    .toBuffer();
  const files: Record<string, Buffer> = { "m15pw/w.png": frame, "m15pw/loyalty/w.png": plate };
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
    Object.entries(files).map(([key, buf]) => [`${PW_ORIGIN}/${frameObjectKey(key, manifest.files[key].hash)}`, buf]),
  );
  return { manifest, byUrl };
}

/** Uniform art. Mid-dark (40): the card-wide sheen under the stripes is weak
 *  there, so what the stripes show is the stripe sheen's own. */
async function solidArt(v: number): Promise<string> {
  const png = await sharp({ create: { width: 1200, height: 800, channels: 3, background: { r: v, g: v, b: v } } }).png().toBuffer();
  return `data:image/png;base64,${png.toString("base64")}`;
}

describe("foil finish — m15pw stand-in (real bakes)", () => {
  let bucket: Awaited<ReturnType<typeof syntheticPwBucket>>;
  let art: string;
  let restoreStorage: () => void = () => {};

  /** Point a freshly imported frame-url at the synthetic bucket (the module
   *  registry may have been reset) and return the renderer from the same
   *  registry. */
  async function renderer() {
    restoreStorage();
    vi.stubGlobal(
      "fetch",
      vi.fn(async (input: string) => {
        const buf = bucket.byUrl.get(String(input));
        if (!buf) throw new Error(`unexpected fetch: ${input}`);
        return new Response(new Uint8Array(buf), { status: 200, headers: { "content-type": "image/png" } });
      }),
    );
    restoreStorage = (await import("@/lib/frames/frame-url")).setFrameStorageForTests({
      manifest: bucket.manifest,
      origin: PW_ORIGIN,
    });
    return import("@/lib/render/card-image");
  }

  beforeAll(async () => {
    bucket = await syntheticPwBucket();
    art = await solidArt(40);
  });
  afterEach(() => {
    restoreStorage();
    restoreStorage = () => {};
    vi.unstubAllGlobals();
  });

  const walker = (finish: string, over: Partial<CardPreviewData> = {}) =>
    card("m15pw", finish, {
      title: "Probe, the Walker",
      cardType: "planeswalker",
      supertype: "Legendary",
      subtypes: ["Probe"],
      rulesText: PW_RULES,
      power: null,
      toughness: null,
      loyalty: "4",
      artUrl: art,
      ...over,
    } as Partial<CardPreviewData>);

  /** The blank right-hand part of each ability row (no badge, no text, clear
   *  of the loyalty plate and of the row seams). */
  const stripeProbes = () =>
    loyaltyStripeRects(getFrameProfile("m15pw").rules.rect, PW_ROWS).map((r) => {
      const b = box(r, 0);
      return { x0: Math.round(W * 0.52), x1: Math.round(W * 0.74), y0: b.y0 + 8, y1: b.y1 - 8 };
    });

  it("sheens every stripe (in its own colour) over the regular look, keeping the ink and badges on top", async () => {
    const mod = await renderer();
    const [regular, foil] = [await bakeWith(mod, walker("regular")), await bakeWith(mod, walker("foil"))];

    // Each blank stripe area changes clearly — before the fix only the
    // card-wide sheen reached it, through the stripe's 22 % and over dark art.
    for (const p of stripeProbes()) expect(meanDelta(regular, foil, p)).toBeGreaterThan(8);
    // The sheen fills its whole row, padding included: the strip left of the
    // badge rail changes too.
    const rules = box(getFrameProfile("m15pw").rules.rect, 0);
    for (const p of stripeProbes()) {
      const yMid = Math.round((p.y0 + p.y1) / 2);
      expect(meanDelta(regular, foil, { x0: rules.x0 + 1, x1: rules.x0 + 5, y0: yMid - 20, y1: yMid + 20 })).toBeGreaterThan(4);
    }

    // Ink sits ON the foil: the ability text's and the badges' dark cores
    // (the whole rules box) are unchanged.
    let ink = 0;
    let moved = 0;
    for (let y = rules.y0; y < rules.y1; y += 1) {
      for (let x = rules.x0; x < rules.x1; x += 1) {
        if (lum(regular, x, y) < 40) {
          ink += 1;
          if (delta(regular, foil, x, y) > 24) moved += 1;
        }
      }
    }
    expect(ink).toBeGreaterThan(300);
    expect(moved).toBe(0);
  }, 60_000);

  it("is a luminance mask of the stripe itself: an opaque black stripe gets no sheen at all", async () => {
    const mod = await renderer();
    // Row B opaque black: it hides the card-wide sheen AND masks its own out,
    // so that row bakes exactly as the regular card; the pale rows still shine.
    const black = { m15pw: { loyaltyRows: { stripeBHex: "#000000" } } };
    const [regular, foil] = [
      await bakeWith(mod, walker("regular", { profileOverrides: black })),
      await bakeWith(mod, walker("foil", { profileOverrides: black })),
    ];
    const [a0, b1, a2, b3] = stripeProbes().map((p) => meanDelta(regular, foil, p));
    expect(Math.min(a0, a2)).toBeGreaterThan(8);
    expect(b1).toBe(0);
    expect(b3).toBe(0);
  }, 60_000);

  it("stays inside the ability box's rounded corners", async () => {
    const mod = await renderer();
    // Black art: the card-wide sheen is nil around the box, so any change
    // there is the stripe sheen's. Satori clips the stripes to the box's
    // rounded overflow but an image inside them only to its rectangle, so
    // the outer rows' sheens round their own corners.
    const black = await solidArt(0);
    const [regular, foil] = [
      await bakeWith(mod, walker("regular", { artUrl: black })),
      await bakeWith(mod, walker("foil", { artUrl: black })),
    ];
    // The box as Satori lays it out, on whole pixels.
    const rect = getFrameProfile("m15pw").rules.rect;
    const [left, top] = [Math.round((rect.leftPct / 100) * W), Math.round((rect.topPct / 100) * H)];
    const right = Math.round(((rect.leftPct + rect.widthPct) / 100) * W);
    const bottom = Math.round(((rect.topPct + rect.heightPct) / 100) * H);
    const radius = Math.round(W * 0.012);
    // [arc centre x, y, outward x, y]: top-left, top-right, bottom-left (the
    // bottom-right corner is under the loyalty plate).
    const corners = [
      [left + radius, top + radius, -1, -1],
      [right - radius, top + radius, 1, -1],
      [left + radius, bottom - radius, -1, 1],
    ];
    for (const [cx, cy, sx, sy] of corners) {
      const outside: number[] = [];
      const inside: number[] = [];
      for (let y = top; y < bottom; y += 1) {
        for (let x = left; x < right; x += 1) {
          const [dx, dy] = [(x + 0.5 - cx) * sx, (y + 0.5 - cy) * sy];
          if (dx <= 0 || dy <= 0) continue; // not this corner
          const d = Math.hypot(dx, dy);
          // Past the arc's anti-aliasing (Satori may round the last row a
          // pixel past the box, shifting that arc by as much)…
          if (d > radius + 1.5) outside.push(delta(regular, foil, x, y));
          else if (d < radius - 2) inside.push(delta(regular, foil, x, y));
        }
      }
      // …untouched; inside the arc the sheen reaches right into the corner.
      expect(outside.length).toBeGreaterThanOrEqual(5);
      expect(Math.max(...outside)).toBe(0);
      expect(inside.reduce((sum, v) => sum + v, 0) / inside.length).toBeGreaterThan(4);
    }
  }, 60_000);

  it("continues the card-wide rainbow: over an opaque white stripe it matches the card-wide sheen over white art", async () => {
    const mod = await renderer();
    const white = await solidArt(255);
    const stripes = (hex: string) => ({ m15pw: { loyaltyRows: { stripeAHex: hex, stripeBHex: hex } } });
    // Clear stripes show the card-wide sheen over the white art; opaque white
    // ones hide it and show their own at full strength. Same rainbow in the
    // same place — as long as each row's sheen keeps its card-space position.
    const [opaque, clear] = [
      await bakeWith(mod, walker("foil", { artUrl: white, profileOverrides: stripes("#ffffff") })),
      await bakeWith(mod, walker("foil", { artUrl: white, profileOverrides: stripes("rgba(255,255,255,0)") })),
    ];
    for (const p of stripeProbes()) expect(meanDelta(opaque, clear, p)).toBeLessThan(1.5);
    // No step where one row's sheen meets the next.
    const { x0, x1 } = stripeProbes()[0];
    for (const r of loyaltyStripeRects(getFrameProfile("m15pw").rules.rect, PW_ROWS).slice(1)) {
      const seam = Math.round((r.topPct / 100) * H);
      let step = 0;
      for (let x = x0; x < x1; x += 1) {
        const [above, below] = [((seam - 2) * W + x) * 3, ((seam + 1) * W + x) * 3];
        for (let c = 0; c < 3; c += 1) step = Math.max(step, Math.abs(opaque.data[above + c] - opaque.data[below + c]));
      }
      expect(step).toBeLessThanOrEqual(3);
    }
  }, 60_000);

  it("adds only that layer: regular planeswalkers and foil non-planeswalkers bake byte-identical without it", async () => {
    const bakes = async (mod: Awaited<ReturnType<typeof renderer>>) => ({
      regular: await bakeWith(mod, walker("regular")),
      etched: await bakeWith(mod, walker("etched")),
      foil: await bakeWith(mod, walker("foil")),
      foilCreature: await bakeWith(mod, walker("foil", { cardType: "creature", rulesText: "Vigilance", loyalty: null })),
      foilNoAbilities: await bakeWith(mod, walker("foil", { rulesText: null })),
    });
    const real = await bakes(await renderer());

    vi.resetModules();
    vi.doMock("@/lib/cards/foil-finish", async (importOriginal) => ({
      ...(await importOriginal<typeof import("@/lib/cards/foil-finish")>()),
      FoilStripeSheen: () => null,
    }));
    try {
      const stubbed = await bakes(await renderer());
      expect(stubbed.regular.png.equals(real.regular.png)).toBe(true);
      expect(stubbed.etched.png.equals(real.etched.png)).toBe(true);
      expect(stubbed.foilCreature.png.equals(real.foilCreature.png)).toBe(true);
      expect(stubbed.foilNoAbilities.png.equals(real.foilNoAbilities.png)).toBe(true);
      // The foil planeswalker is the one bake the stripe sheen changes — and
      // without it, its stripes kept only the faint trace (the old look).
      expect(stubbed.foil.png.equals(real.foil.png)).toBe(false);
      for (const p of stripeProbes()) {
        const trace = meanDelta(stubbed.regular, stubbed.foil, p);
        expect(trace).toBeLessThan(2);
        expect(meanDelta(real.regular, real.foil, p)).toBeGreaterThan(4 * trace);
      }
    } finally {
      vi.doUnmock("@/lib/cards/foil-finish");
      vi.resetModules();
    }
  }, 120_000);

  // -------------------------------------------------------------------------
  // Translucent rules backdrop (TODO 4.31): m15pw's 72 % cream box for a card
  // that isn't a planeswalker with ability rows — the same trap as the
  // stripes, and now the same fix (FoilBackdropSheen, masked by the backdrop).
  // -------------------------------------------------------------------------

  describe("translucent rules backdrop", () => {
    const boxed = (finish: string, over: Partial<CardPreviewData> = {}) =>
      card("m15pw", finish, { rulesText: "Vigilance", power: null, toughness: null, artUrl: art, ...over });

    /** The backdrop's blank lower part: below "Vigilance", clear of the rails. */
    const backdropProbe = () => {
      const b = box(getFrameProfile("m15pw").rules.rect, 0);
      return { x0: Math.round(W * 0.3), x1: Math.round(W * 0.85), y0: Math.round(H * 0.72), y1: b.y1 - 8 };
    };

    it("sheens a translucent rules backdrop in its own colour, keeping the ink on top", async () => {
      const mod = await renderer();
      const [regular, foil] = [await bakeWith(mod, boxed("regular")), await bakeWith(mod, boxed("foil"))];
      // Before the fix only the card-wide sheen reached it, through the
      // backdrop's 28 % and over dark art.
      expect(meanDelta(regular, foil, backdropProbe())).toBeGreaterThan(8);
      const rules = box(getFrameProfile("m15pw").rules.rect, 0);
      let ink = 0;
      let moved = 0;
      for (let y = rules.y0; y < rules.y1; y += 1) {
        for (let x = rules.x0; x < rules.x1; x += 1) {
          if (lum(regular, x, y) < 40) {
            ink += 1;
            if (delta(regular, foil, x, y) > 24) moved += 1;
          }
        }
      }
      expect(ink).toBeGreaterThan(100);
      expect(moved).toBe(0);
    }, 60_000);

    it("stays inside the backdrop's rounded corners", async () => {
      const mod = await renderer();
      // Black art: the card-wide sheen is nil around the box, so any change
      // there is the backdrop sheen's (Satori clips it only to its own shape).
      const black = await solidArt(0);
      const [regular, foil] = [
        await bakeWith(mod, boxed("regular", { artUrl: black })),
        await bakeWith(mod, boxed("foil", { artUrl: black })),
      ];
      const rect = getFrameProfile("m15pw").rules.rect;
      const [left, top] = [Math.round((rect.leftPct / 100) * W), Math.round((rect.topPct / 100) * H)];
      const right = Math.round(((rect.leftPct + rect.widthPct) / 100) * W);
      const bottom = Math.round(((rect.topPct + rect.heightPct) / 100) * H);
      const radius = Math.round(W * 0.015);
      const corners = [
        [left + radius, top + radius, -1, -1],
        [right - radius, top + radius, 1, -1],
        [left + radius, bottom - radius, -1, 1],
        [right - radius, bottom - radius, 1, 1],
      ];
      for (const [cx, cy, sx, sy] of corners) {
        const outside: number[] = [];
        const inside: number[] = [];
        for (let y = top - 2; y < bottom + 2; y += 1) {
          for (let x = left - 2; x < right + 2; x += 1) {
            const [dx, dy] = [(x + 0.5 - cx) * sx, (y + 0.5 - cy) * sy];
            if (dx <= 0 || dy <= 0) continue; // not this corner
            const d = Math.hypot(dx, dy);
            if (d > radius + 1.5) outside.push(delta(regular, foil, x, y));
            else if (d < radius - 2) inside.push(delta(regular, foil, x, y));
          }
        }
        expect(outside.length).toBeGreaterThanOrEqual(5);
        expect(Math.max(...outside)).toBe(0);
        expect(inside.reduce((sum, v) => sum + v, 0) / inside.length).toBeGreaterThan(4);
      }
    }, 60_000);

    it("adds only that layer: every other finish, and foil cards without a backdrop, bake byte-identical without it", async () => {
      const bakes = async (mod: Awaited<ReturnType<typeof renderer>>) => ({
        regular: await bakeWith(mod, boxed("regular")),
        etched: await bakeWith(mod, boxed("etched")),
        showcase: await bakeWith(mod, boxed("showcase")),
        foil: await bakeWith(mod, boxed("foil")),
        // Ability rows replace the backdrop; an empty box draws none.
        foilWalker: await bakeWith(mod, walker("foil")),
        foilEmpty: await bakeWith(mod, boxed("foil", { rulesText: null })),
      });
      const real = await bakes(await renderer());

      vi.resetModules();
      vi.doMock("@/lib/cards/foil-finish", async (importOriginal) => ({
        ...(await importOriginal<typeof import("@/lib/cards/foil-finish")>()),
        FoilBackdropSheen: () => null,
      }));
      try {
        const stubbed = await bakes(await renderer());
        for (const k of ["regular", "etched", "showcase", "foilWalker", "foilEmpty"] as const) {
          expect(stubbed[k].png.equals(real[k].png), k).toBe(true);
        }
        // Without it, the foil backdrop kept only a faint trace of the sheen.
        expect(stubbed.foil.png.equals(real.foil.png)).toBe(false);
        const trace = meanDelta(stubbed.regular, stubbed.foil, backdropProbe());
        expect(trace).toBeLessThan(2);
        expect(meanDelta(real.regular, real.foil, backdropProbe())).toBeGreaterThan(4 * trace);
      } finally {
        vi.doUnmock("@/lib/cards/foil-finish");
        vi.resetModules();
      }
    }, 120_000);
  });
});

// ---------------------------------------------------------------------------
// The scrims over full art (git frames, so no stand-in): bloomanime's rules
// box is a cut-out over the art with a 55 % dark scrim.
// ---------------------------------------------------------------------------

describe("foil finish — rules scrims over the art (real bakes)", () => {
  const anime = (finish: string, over: Partial<CardPreviewData> = {}) =>
    card("bloomanime", finish, { colorIdentity: ["red"], cost: "{1}{R}", ...over });
  const inner = () => box(getFrameProfile("bloomanime").rules.rect, 1.5);

  it("continues the card-wide rainbow: under an opaque white backdrop it matches the card-wide sheen over white art", async () => {
    const mod = await import("@/lib/render/card-image");
    const white = await solidArt(255);
    const backdrop = (hex: string) => ({ bloomanime: { rules: { backdropHex: hex } } });
    // A clear backdrop shows the card-wide sheen over the white art; an
    // opaque white one hides it and shows its own at full strength — the
    // same rainbow in the same place, as long as it keeps its card-space
    // position.
    const [opaque, clear] = [
      await bakeWith(mod, anime("foil", { artUrl: white, profileOverrides: backdrop("#ffffff") })),
      await bakeWith(mod, anime("foil", { artUrl: white, profileOverrides: backdrop("rgba(255,255,255,0)") })),
    ];
    const regular = await bakeWith(mod, anime("regular", { artUrl: white, profileOverrides: backdrop("#ffffff") }));
    expect(meanDelta(regular, opaque, inner())).toBeGreaterThan(8);
    expect(meanDelta(opaque, clear, inner())).toBeLessThan(1.5);
  }, 60_000);

  it("barely touches a dark scrim: dark ink swallows the foil, as printed", async () => {
    const real = await import("@/lib/render/card-image");
    const light = await solidArt(230);
    const foil = await bakeWith(real, anime("foil", { artUrl: light }));
    vi.resetModules();
    vi.doMock("@/lib/cards/foil-finish", async (importOriginal) => ({
      ...(await importOriginal<typeof import("@/lib/cards/foil-finish")>()),
      FoilBackdropSheen: () => null,
    }));
    try {
      const without = await bakeWith(await import("@/lib/render/card-image"), anime("foil", { artUrl: light }));
      const b = inner();
      let max = 0;
      for (let y = b.y0; y < b.y1; y += 1) {
        for (let x = b.x0; x < b.x1; x += 1) {
          const i = (y * W + x) * 3;
          for (let c = 0; c < 3; c += 1) max = Math.max(max, Math.abs(foil.data[i + c] - without.data[i + c]));
        }
      }
      // The scrim's own luminance (≈ 0.03 × 55 %) is all its sheen adds; the
      // card-wide sheen already shows through its other 45 %.
      expect(max).toBeLessThanOrEqual(2);
    } finally {
      vi.doUnmock("@/lib/cards/foil-finish");
      vi.resetModules();
    }
  }, 120_000);
});

describe("foilMaskSource", () => {
  it("hands the mask a small copy but the ORIGINAL size (the cover geometry's input)", async () => {
    const src = await foilMaskSource(await splitArt());
    expect(src).not.toBeNull();
    expect([src!.naturalWidth, src!.naturalHeight]).toEqual([1200, 800]);
    expect(src!.href.startsWith("data:image/jpeg;base64,")).toBe(true);
    const meta = await sharp(Buffer.from(src!.href.split(",")[1], "base64")).metadata();
    expect(Math.max(meta.width!, meta.height!)).toBe(FOIL_MASK_EDGE);
  });

  it("skips anything that isn't an inlined image", async () => {
    expect(await foilMaskSource(null)).toBeNull();
    expect(await foilMaskSource("https://example.com/art.png")).toBeNull();
    expect(await foilMaskSource("data:image/png;base64,bm90IGFuIGltYWdl")).toBeNull();
  });
});
