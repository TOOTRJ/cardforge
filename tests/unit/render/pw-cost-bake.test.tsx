import { createHash } from "node:crypto";
import sharp from "sharp";
import { afterEach, beforeAll, describe, expect, it, vi } from "vitest";
import type { CardPreviewData } from "@/components/cards/card-preview";
import { getFrameProfile } from "@/lib/cards/template-layout";
import { RENDER_PRESETS } from "@/lib/render/card-image";

// ---------------------------------------------------------------------------
// Planeswalker mana cost on a REAL bake. The m15pw profile draws its cost in a
// detached box (costRect) and, since the round-3 frame review, nudges it
// down by costDy so the pips sit in Card Conjurer's taller title plate the
// way printed planeswalkers' do. The m15pw masters live in the frames bucket
// (never in git), so the bake is served a synthetic near-black stand-in
// through a stubbed bucket; the pale {W} disc is then the only bright thing
// in the title band. Rendered at the "default" preset (750 × 1050).
// ---------------------------------------------------------------------------

const W = RENDER_PRESETS.default.width;
const H = RENDER_PRESETS.default.height;
const ORIGIN = "https://frames.test";

async function standInBucket() {
  const { frameObjectKey } = await import("@/lib/frames/frame-url");
  const frame = await sharp({ create: { width: 1500, height: 2100, channels: 4, background: { r: 20, g: 20, b: 20, alpha: 1 } } })
    .png()
    .toBuffer();
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
    Object.entries(files).map(([key, buf]) => [`${ORIGIN}/${frameObjectKey(key, manifest.files[key].hash)}`, buf]),
  );
  return { manifest, byUrl };
}

const walker = {
  title: "Probe",
  cost: "{W}",
  cardType: "planeswalker",
  supertype: "Legendary",
  subtypes: ["Probe"],
  rarity: "rare",
  colorIdentity: ["white"],
  rulesText: "+1: Scry 1.",
  flavorText: null,
  power: null,
  toughness: null,
  loyalty: "4",
  defense: null,
  artistCredit: "Probe",
  artUrl: null,
  artPosition: {},
  frameStyle: { template: "m15pw", finish: "regular" },
  setIconUrl: null,
  setIconCode: null,
  backFace: null,
  faceContent: null,
  watermark: null,
} as unknown as CardPreviewData;

describe("m15pw mana cost — real bake", () => {
  let bucket: Awaited<ReturnType<typeof standInBucket>>;
  let restoreStorage: () => void = () => {};

  beforeAll(async () => {
    bucket = await standInBucket();
  });
  afterEach(() => {
    restoreStorage();
    restoreStorage = () => {};
    vi.unstubAllGlobals();
  });

  it("centres the pip 0.4 % of the width below its box's centre, right edge on the box's", async () => {
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
      origin: ORIGIN,
    });
    const mod = await import("@/lib/render/card-image");
    const png = Buffer.from(
      await (await mod.renderCardImage(walker, "default", { brandMark: false, watermarkText: null })).arrayBuffer(),
    );
    const data = await sharp(png).removeAlpha().raw().toBuffer();
    const lum = (x: number, y: number) => {
      const i = (y * W + x) * 3;
      return 0.299 * data[i] + 0.587 * data[i + 1] + 0.114 * data[i + 2];
    };

    // The pale disc's bounding box inside the title band (the sun glyph and
    // the name are dark, the stand-in frame is near-black).
    const p = getFrameProfile("m15pw");
    const box = p.costRect!;
    let top: number = H;
    let bottom = -1;
    let right = -1;
    for (let y = 20; y < Math.round(H * 0.1); y += 1) {
      for (let x = Math.round(W * 0.5); x < Math.round(W * 0.95); x += 1) {
        if (lum(x, y) > 120) {
          top = Math.min(top, y);
          bottom = Math.max(bottom, y);
          right = Math.max(right, x);
        }
      }
    }
    const disc = Math.round((p.costSizePct ?? p.title.sizePct) * W);
    expect(bottom - top + 1).toBeGreaterThanOrEqual(disc - 1);
    expect(bottom - top + 1).toBeLessThanOrEqual(disc + 1);

    const boxCentre = ((box.topPct + box.heightPct / 2) / 100) * H;
    const centre = (top + bottom + 1) / 2;
    expect(p.costDy).toBe(0.004);
    expect(Math.abs(centre - (boxCentre + p.costDy! * W))).toBeLessThanOrEqual(1);
    // Right-aligned in the box as before — only the height moved.
    expect(Math.abs(right + 1 - ((box.leftPct + box.widthPct) / 100) * W)).toBeLessThanOrEqual(1);
  });
});
