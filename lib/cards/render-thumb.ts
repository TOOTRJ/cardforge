import "server-only";
import sharp from "sharp";

// ---------------------------------------------------------------------------
// Gallery thumbnails for baked renders.
//
// The stored bake is the HD PNG (1500×2100, ~3 MB) because paid HD downloads
// serve those bytes untouched. Every gallery-style tile was pulling that same
// 3 MB object (through next/image, or raw in the featured-creators strip), so
// a gallery of 30 cards moved ~100 MB. The bake now also writes a WebP
// thumbnail next to the PNG — 600 px wide (2× the widest tile), ~40 KB — and
// the tiles use it directly with a plain <img>, no optimizer hop.
//
// Path: card-renders/{owner}/{card}.thumb.webp, upserted alongside the PNG and
// cache-busted with the same ?v= stamp. Cards baked before this existed have
// a null rendered_thumb_url and keep the next/image path until their next
// bake (or the one-off scripts/backfill-render-thumbs.mjs).
// ---------------------------------------------------------------------------

export const RENDER_THUMB_WIDTH = 600;
export const RENDER_THUMB_QUALITY = 78;

export function renderThumbPath(renderPath: string): string {
  return renderPath.replace(/\.png$/, "") + ".thumb.webp";
}

/** Downscale a baked PNG to the tile-sized WebP. */
export async function makeRenderThumb(png: ArrayBuffer | Buffer): Promise<Buffer> {
  return sharp(Buffer.from(png as ArrayBuffer))
    .resize({ width: RENDER_THUMB_WIDTH, withoutEnlargement: true })
    .webp({ quality: RENDER_THUMB_QUALITY })
    .toBuffer();
}
