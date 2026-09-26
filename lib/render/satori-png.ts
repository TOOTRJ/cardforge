import "server-only";

import type { ReactNode } from "react";
import satori, { type Font } from "satori";
import sharp from "sharp";
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
// ---------------------------------------------------------------------------

export type PngRenderOptions = {
  width: number;
  height: number;
  fonts: readonly Font[];
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
  });
  return sharp(new TextEncoder().encode(svg)).resize(options.width).png().toBuffer();
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
