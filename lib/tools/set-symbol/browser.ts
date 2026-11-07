// ---------------------------------------------------------------------------
// Set Symbol Studio — the browser's half of the live preview: decode a
// picture into RGBA (upright, scaled to fit), and draw one back as a data
// URL. The cut and the paint are the shared pure code (cutout.ts, paint.ts):
// what the preview shows is what the server stores, computed again there
// from the original bytes.
// ---------------------------------------------------------------------------

import type { RgbaImage } from "./cutout";
import { cutOut } from "./cutout";
import { fitSquare, legibilityScore, paintSymbol } from "./paint";
import type { CutoutSettings } from "./model";

/** The preview works on a smaller copy than the server (speed); the cut's
 *  rules are relative, so it reads the same. */
export const PREVIEW_MAX_PX = 512;
export const PREVIEW_SYMBOL_PX = 256;

export async function decodeForPreview(source: Blob, max = PREVIEW_MAX_PX): Promise<RgbaImage> {
  const bitmap = await createImageBitmap(source, { imageOrientation: "from-image" });
  try {
    const scale = Math.min(1, max / Math.max(bitmap.width, bitmap.height));
    const width = Math.max(1, Math.round(bitmap.width * scale));
    const height = Math.max(1, Math.round(bitmap.height * scale));
    const canvas = document.createElement("canvas");
    canvas.width = width;
    canvas.height = height;
    const ctx = canvas.getContext("2d", { willReadFrequently: true });
    if (!ctx) throw new Error("No 2D canvas.");
    ctx.imageSmoothingQuality = "high";
    ctx.drawImage(bitmap, 0, 0, width, height);
    const { data } = ctx.getImageData(0, 0, width, height);
    return { width, height, data };
  } finally {
    bitmap.close();
  }
}

/** A stored source picture (the maker's own, public in our storage). */
export async function decodeUrlForPreview(url: string): Promise<RgbaImage> {
  const response = await fetch(url, { mode: "cors", cache: "force-cache" });
  if (!response.ok) throw new Error(`HTTP ${response.status}`);
  return decodeForPreview(await response.blob());
}

export function rgbaToDataUrl(img: RgbaImage): string {
  const canvas = document.createElement("canvas");
  canvas.width = img.width;
  canvas.height = img.height;
  const ctx = canvas.getContext("2d");
  if (!ctx) return "";
  const pixels = new Uint8ClampedArray(img.data.length);
  pixels.set(img.data);
  ctx.putImageData(new ImageData(pixels, img.width, img.height), 0, 0);
  return canvas.toDataURL("image/png");
}

export type PreviewLooks = {
  common: string;
  uncommon: string;
  rare: string;
  mythic: string;
  plain: string;
  watermark: string;
  legibility: number;
  /** Share of the picture kept as the symbol. */
  kept: number;
};

/** Every look of `source` cut with `settings`, as data URLs — or null when
 *  the cut leaves nothing. */
export function previewLooks(source: RgbaImage, settings: CutoutSettings): PreviewLooks | null {
  const { mask } = cutOut(source, { mode: settings.mode, tolerance: settings.tolerance });
  let on = 0;
  for (const v of mask.data) if (v >= 128) on += 1;
  const kept = on / Math.max(1, mask.data.length);
  const fitted = fitSquare(source, mask, PREVIEW_SYMBOL_PX);
  if (!fitted) return null;
  return {
    common: rgbaToDataUrl(paintSymbol(fitted, "common")),
    uncommon: rgbaToDataUrl(paintSymbol(fitted, "uncommon")),
    rare: rgbaToDataUrl(paintSymbol(fitted, "rare")),
    mythic: rgbaToDataUrl(paintSymbol(fitted, "mythic")),
    plain: rgbaToDataUrl(paintSymbol(fitted, "plain", settings.ink === "colour")),
    watermark: rgbaToDataUrl(paintSymbol(fitted, "watermark")),
    legibility: legibilityScore(fitted),
    kept,
  };
}
