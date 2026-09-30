import { createHash } from "node:crypto";
import sharp from "sharp";
import { afterEach, beforeAll, describe, expect, it, vi } from "vitest";
import type { CardPreviewData } from "@/components/cards/card-preview";
import { KEYRUNE_CODEPOINTS, KEYRUNE_GLYPHS, KEYRUNE_UNITS_PER_EM } from "@/lib/cards/keyrune-metrics";
import { setSymbolSize, setSymbolSource } from "@/lib/cards/set-symbol-size";
import { getFrameProfile } from "@/lib/cards/template-layout";
import { RENDER_PRESETS } from "@/lib/render/card-image";

// ---------------------------------------------------------------------------
// The set symbol on REAL HD bakes (TODO 4.20, layout v32): an uploaded icon
// fills Card Conjurer's box (86 px on M15, 80 on the planeswalker), a Keyrune
// glyph is fitted to it by its ink (DOM's 86 px, M20's 41 px at its 0.065 W
// cap), and the symbol keeps its place — right-aligned at the band's right
// edge, centred on it. The m15 / m15pw masters live in the frames bucket
// (never in git): the bake is served a flat mid-grey stand-in, so the
// symbol's ink is the only saturated or dark mark right of the type line.
// The preview half is pinned in tests/unit/components/set-symbol-preview.test.tsx.
// ---------------------------------------------------------------------------

const W = RENDER_PRESETS.hd.width;
const H = RENDER_PRESETS.hd.height;
const ORIGIN = "https://frames.test";

let bucket: { manifest: unknown; byUrl: Map<string, Buffer> };
let icon = "";

beforeAll(async () => {
  const { frameObjectKey } = await import("@/lib/frames/frame-url");
  const frame = await sharp({
    create: { width: 1500, height: 2100, channels: 4, background: { r: 128, g: 128, b: 128, alpha: 1 } },
  })
    .png()
    .toBuffer();
  const files: Record<string, Buffer> = { "m15/w.png": frame, "m15pw/w.png": frame };
  const entries = Object.entries(files).map(([key, buf]) => {
    const sha256 = createHash("sha256").update(buf).digest("hex");
    return [key, { hash: sha256.slice(0, 12), sha256, bytes: buf.length, width: 1, height: 1 }] as const;
  });
  const manifest = { version: 1 as const, bucket: "frames", files: Object.fromEntries(entries) };
  bucket = {
    manifest,
    byUrl: new Map(entries.map(([key, e]) => [`${ORIGIN}/${frameObjectKey(key, e.hash)}`, files[key]])),
  };
  icon = `data:image/png;base64,${(
    await sharp({ create: { width: 64, height: 64, channels: 4, background: { r: 220, g: 0, b: 170, alpha: 1 } } })
      .png()
      .toBuffer()
  ).toString("base64")}`;
});

let restoreStorage: () => void = () => {};
afterEach(() => {
  restoreStorage();
  restoreStorage = () => {};
  vi.unstubAllGlobals();
});

async function bake(template: string, symbol: { setIconUrl?: string | null; setIconCode?: string | null }) {
  vi.stubGlobal(
    "fetch",
    vi.fn(async (input: string) => {
      const buf = bucket.byUrl.get(String(input));
      if (!buf) throw new Error(`unexpected fetch: ${input}`);
      return new Response(new Uint8Array(buf), { status: 200, headers: { "content-type": "image/png" } });
    }),
  );
  restoreStorage();
  restoreStorage = (await import("@/lib/frames/frame-url")).setFrameStorageForTests({
    manifest: bucket.manifest as never,
    origin: ORIGIN,
  });
  const { renderCardImage } = await import("@/lib/render/card-image");
  const card = {
    title: "Probe",
    cost: "{W}",
    cardType: "instant",
    supertype: null,
    subtypes: [],
    rarity: "common",
    colorIdentity: ["white"],
    rulesText: null,
    flavorText: null,
    power: null,
    toughness: null,
    loyalty: null,
    defense: null,
    artistCredit: "Probe",
    artUrl: null,
    artPosition: {},
    frameStyle: { template, finish: "regular" },
    setIconUrl: null,
    setIconCode: null,
    backFace: null,
    faceContent: null,
    watermark: null,
    ...symbol,
  } as unknown as CardPreviewData;
  const png = Buffer.from(
    await (await renderCardImage(card, "hd", { brandMark: false, watermarkText: null })).arrayBuffer(),
  );
  return sharp(png).removeAlpha().raw().toBuffer();
}

/** The ink box of the pixels `hit` accepts in the symbol's region: right of
 *  x0, the rows of `rect` ± 20 px. */
function inkBox(
  data: Buffer,
  rect: { topPct: number; heightPct: number },
  x0: number,
  hit: (r: number, g: number, b: number) => boolean,
) {
  const y0 = Math.floor((rect.topPct / 100) * H) - 20;
  const y1 = Math.ceil(((rect.topPct + rect.heightPct) / 100) * H) + 20;
  let box: { top: number; bottom: number; left: number; right: number } | null = null;
  for (let y = y0; y < y1; y += 1) {
    for (let x = x0; x < W; x += 1) {
      const i = (y * W + x) * 3;
      if (!hit(data[i], data[i + 1], data[i + 2])) continue;
      box = box
        ? { top: Math.min(box.top, y), bottom: Math.max(box.bottom, y), left: Math.min(box.left, x), right: Math.max(box.right, x) }
        : { top: y, bottom: y, left: x, right: x };
    }
  }
  expect(box).not.toBeNull();
  return { ...box!, h: box!.bottom - box!.top + 1, w: box!.right - box!.left + 1 };
}

const magenta = (r: number, g: number, b: number) => r > 180 && g < 60 && b > 130;
// The common glyph's #0f0f12 at ≥ half coverage on the 128-grey stand-in.
const glyphInk = (r: number, g: number, b: number) => 0.299 * r + 0.587 * g + 0.114 * b < 72;
const inkHeightPx = (code: string, fontPx: number) => {
  const [, , yMin, , yMax] = KEYRUNE_GLYPHS[KEYRUNE_CODEPOINTS[code]];
  return ((yMax - yMin) / KEYRUNE_UNITS_PER_EM) * fontPx;
};

describe("the set symbol on a real HD bake (layout v32; v36's printed sizes and walker rect)", () => {
  it("fills M15's 86 px box with an icon, right-aligned and centred on the type band", async () => {
    const p = getFrameProfile("m15");
    const box = inkBox(await bake("m15", { setIconUrl: icon }), p.type.rect, Math.round(W * 0.7), magenta);
    expect([box.w, box.h]).toEqual([86, 86]);
    // Its right edge is the band's (92.2 %W), its centre the band's.
    const right = ((p.type.rect.leftPct + p.type.rect.widthPct) / 100) * W;
    expect(Math.abs(box.right + 1 - right)).toBeLessThanOrEqual(1);
    const centre = ((p.type.rect.topPct + p.type.rect.heightPct / 2) / 100) * H;
    expect(Math.abs((box.top + box.bottom + 1) / 2 - centre)).toBeLessThanOrEqual(1);
  }, 60_000);

  it("fits an unmeasured Keyrune glyph's ink to the box (XLN 86 px), and draws a measured set at its print's size (v36): DOM 88 px, M20 180 × 75", async () => {
    const p = getFrameProfile("m15");
    for (const [code, expectedFontPx, printedH] of [
      ["xln", 86, null],
      ["dom", 89, 88.5],
      ["m20", 180, null],
    ] as const) {
      const fontPx = Math.round(setSymbolSize(p, setSymbolSource(null, code)).sizePct * W);
      expect(fontPx, code).toBe(expectedFontPx);
      const box = inkBox(await bake("m15", { setIconCode: code }), p.type.rect, Math.round(W * 0.6), glyphInk);
      // Anti-aliased edges count from half coverage: ±1 px of the outline.
      expect(Math.abs(box.h - inkHeightPx(code, fontPx)), code).toBeLessThanOrEqual(1.5);
      if (printedH) expect(Math.abs(box.h - printedH), code).toBeLessThanOrEqual(1.5);
    }
    // M20's pill: CC's 0.12 W (180 px) binds — the print is 187.5 × 86.
    const m20 = inkBox(await bake("m15", { setIconCode: "m20" }), p.type.rect, Math.round(W * 0.6), glyphInk);
    expect(Math.abs(m20.w - 180)).toBeLessThanOrEqual(1.5);
    expect(Math.abs(m20.h - 75)).toBeLessThanOrEqual(1.5);
  }, 60_000);

  it("uses the planeswalker's 80 px box in its symbolRect, ending where M15's does (4.47: 1383 px, was 1365)", async () => {
    const p = getFrameProfile("m15pw");
    const icon80 = inkBox(await bake("m15pw", { setIconUrl: icon }), p.symbolRect!, Math.round(W * 0.7), magenta);
    expect([icon80.w, icon80.h]).toEqual([80, 80]);
    // The walker prints put the symbol's right edge where their set's regular
    // cards do: M15's band edge, 92.2 %W.
    expect(Math.abs(icon80.right + 1 - 1383)).toBeLessThanOrEqual(1);
    const m15 = getFrameProfile("m15");
    expect(p.symbolRect!.leftPct + p.symbolRect!.widthPct).toBeCloseTo(m15.type.rect.leftPct + m15.type.rect.widthPct, 9);
    // A measured set prints at its regular size on the walkers too (v36).
    const dom = inkBox(await bake("m15pw", { setIconCode: "dom" }), p.symbolRect!, Math.round(W * 0.7), glyphInk);
    expect(Math.abs(dom.h - 88.5)).toBeLessThanOrEqual(1.5);
    expect(Math.abs(dom.right + 1 - 1383)).toBeLessThanOrEqual(1.5);
  }, 60_000);
});
