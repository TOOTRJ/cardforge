import "server-only";

import type { ReactNode } from "react";
import satori, { type Font, type SatoriNode } from "satori";
import sharp from "sharp";
import { applyCardCornerMask, squareCardCorners, type CardCornerFills } from "@/lib/cards/card-corner";
import { loadLocalAdditionalAsset } from "@/lib/render/fallback-assets";

// ---------------------------------------------------------------------------
// JSX → PNG for every Node-runtime Satori render (the card bake and the OG
// images), with NO render-time network access (TODO 6.16a).
//
// This is next/og's `ImageResponse` (node build) minus its asset loader:
// next/og hard-wires `loadAdditionalAsset` to Twemoji on jsDelivr and Noto on
// fonts.googleapis.com, and there is no option to replace it. So we call the
// same satori (pinned to the version next/og bundles — see
// tests/unit/render/satori-pipeline.test.ts) and the same rasterizer call
// (next/og uses sharp when it is installed, which it is here), and hand
// Satori lib/render/fallback-assets.ts instead. Same inputs → the same PNG
// bytes next/og produced (proven on every public production card when this
// landed).
//
// Edge routes (app/opengraph-image.tsx, twitter-image, icon, apple-icon) keep
// next/og: they draw only fixed brand copy the default Geist covers, so they
// never reach its loader (tests/unit/og/image-response.test.tsx).
//
// A CARD render may ask for its rounded corner (`cornerRadiusPx`, TODO 3.26):
// the raster's alpha is cut with lib/cards/card-corner.ts applyCardCornerMask
// — the formula the CSS clip and the frame importer share — AFTER
// rasterizing, so the arc is exact and RGB is kept (a Satori clip would
// anti-alias its own way and blacken the pixels it hides). A card's SQUARE
// render (print, the Square download) passes the radius AND
// `squareCornerFills`: the masked raster is then squared again with
// squareCardCorners — each corner composited over its fill (the border black
// or the root's #101015, lib/frames/square-corners.ts) or, for art or design
// in the corner, made opaque as drawn — the same function a free Square
// download runs on the stored round bake. Unset — every OG / brand image —
// the bytes are exactly what they were.
//
// A PRINT layer (lib/render/card-print.ts, TODO 6.10/6.1b) lays the card out
// at the HD size and rasterizes it at `outputWidth` — sharp re-renders the
// SVG's vectors at the target scale (the same pixels as a density bump, not
// an upsample), so an 800 ppi card is the HD layout with 800 ppi text — and
// may watch Satori's layout (`onNodeDetected`) to find the boxes it leaves
// empty for the art. Unset (every other render) changes nothing.
// ---------------------------------------------------------------------------

export type PngRenderOptions = {
  width: number;
  height: number;
  fonts: readonly Font[];
  /** Cut the card's rounded corner at this radius in px — fractional, pass
   *  cardCornerRadiusPx(width, height) and never round it. Alpha only, RGB
   *  kept. Unset = the square PNG exactly as drawn (the OG/brand invariant). */
  cornerRadiusPx?: number;
  /** With `cornerRadiusPx`: square the output again, each corner outside the
   *  arc in its fill (null: as drawn) — lib/cards/card-corner.ts
   *  squareCardCorners. Opaque. */
  squareCornerFills?: CardCornerFills;
  /** Rasterize at this width instead of `width` (the layout's): the vectors
   *  are drawn at the target scale, embedded rasters are resampled. Print
   *  layers only (lib/render/card-print.ts); unset = `width`. */
  outputWidth?: number;
  /** Satori's layout callback — every node's absolute box and props. Print
   *  layers only; never changes the drawing. */
  onNodeDetected?: (node: SatoriNode) => void;
};

export async function renderPng(element: ReactNode, options: PngRenderOptions): Promise<Buffer> {
  const svg = await satori(element, {
    width: options.width,
    height: options.height,
    debug: false,
    // A fresh array for every render: Satori memoizes its font engine per
    // ARRAY and adds the render's fallback fonts to it, so a shared array
    // would carry one card's fallbacks into the next card's text layout.
    fonts: [...options.fonts],
    loadAdditionalAsset: loadLocalAdditionalAsset,
    ...(options.onNodeDetected ? { onNodeDetected: options.onNodeDetected } : {}),
  });
  const raster = sharp(new TextEncoder().encode(svg)).resize(options.outputWidth ?? options.width);
  if (options.cornerRadiusPx === undefined) return raster.png().toBuffer();
  // Straight (unpremultiplied) RGBA out of the rasterizer, the corner cut
  // into its alpha, then the same PNG encode as the square path.
  const { data, info } = await raster.ensureAlpha().raw().toBuffer({ resolveWithObject: true });
  applyCardCornerMask(data, info.width, info.height, options.cornerRadiusPx);
  if (options.squareCornerFills) {
    squareCardCorners(data, info.width, info.height, options.squareCornerFills, options.cornerRadiusPx);
  }
  return sharp(data, { raw: { width: info.width, height: info.height, channels: 4 } })
    .png()
    .toBuffer();
}

/**
 * A lazily rendered PNG `Response` with next/og `ImageResponse`'s headers —
 * a drop-in for `new ImageResponse(element, options)` (a render error
 * surfaces when the body is read, as it did there).
 */
export function pngImageResponse(
  element: ReactNode,
  options: PngRenderOptions & {
    headers?: Record<string, string>;
    status?: number;
    statusText?: string;
  },
): Response {
  const body = new ReadableStream<Uint8Array>({
    async start(controller) {
      controller.enqueue(new Uint8Array(await renderPng(element, options)));
      controller.close();
    },
  });
  return new Response(body, {
    headers: {
      "content-type": "image/png",
      "cache-control":
        process.env.NODE_ENV === "development"
          ? "no-cache, no-store"
          : "public, immutable, no-transform, max-age=31536000",
      ...options.headers,
    },
    status: options.status,
    statusText: options.statusText,
  });
}
