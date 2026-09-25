import sharp from "sharp";
import { describe, expect, it, vi } from "vitest";
import type { CardPreviewData } from "@/components/cards/card-preview";
import type { FrameTemplate } from "@/types/card";
import { getFrameProfile } from "@/lib/cards/template-layout";
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
