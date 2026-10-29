import "server-only";

import { readFile } from "node:fs/promises";
import path from "node:path";
import sharp from "sharp";
import { OG_SIZE } from "@/lib/brand/constants";
import { isDefaultDeckCover } from "@/lib/decks/cover";
import { ogImageResponse } from "@/lib/og/image-response";
import { fetchImageAsDataUri } from "@/lib/og/shell";
import { toSatoriDataUrl } from "@/lib/render/art-source";
import { getSiteBaseUrl } from "@/lib/site-url";
import type { ReactNode } from "react";

// ---------------------------------------------------------------------------
// The deck share image's server half (TODO DK6.6): loading its cover and
// encoding the canvas. The canvas itself is OgDeckHero (lib/og/chrome.tsx).
//
// JPEG, not PNG: a full-bleed cover under five card thumbs is a photograph,
// and WhatsApp drops a preview over 600 KB — the rule the card's social
// image follows (app/api/cards/[id]/og/route.ts). The PNG of a busy upload
// was ~1.5 MB; this lands far under the cap (tests/unit/og/deck-share-
// image-size.test.tsx holds every default and a busy upload to it).
//
// A built-in background (lib/decks/cover.ts) is one of OUR static files,
// named by an exact list. It is read from disk where the process has the
// file (`next dev`, `next start`) — from the LITERAL folder, so the tracer
// can't widen the read to all of public/ — and the folder is kept out of
// every function bundle (next.config.ts outputFileTracingExcludes), so on
// Vercel it is fetched from the deployment's own CDN instead, with the
// automation bypass on a protected preview (as the bake fetches its frames,
// lib/render/card-frames.ts). An upload goes through fetchImageAsDataUri.
// ---------------------------------------------------------------------------

export const DECK_SHARE_IMAGE_TYPE = "image/jpeg";
const JPEG_QUALITY = 82;
const FETCH_TIMEOUT_MS = 3500;

const DECK_COVER_DIR = path.join(process.cwd(), "public/defaults/deck-covers");

async function fetchOwnStatic(sitePath: string): Promise<Buffer | null> {
  const origins = [getSiteBaseUrl(), process.env.VERCEL_PROJECT_PRODUCTION_URL]
    .filter((origin): origin is string => Boolean(origin))
    .map((origin) => (/^https?:\/\//.test(origin) ? origin : `https://${origin}`).replace(/\/+$/, ""));
  const headers: Record<string, string> = {};
  const bypass = process.env.VERCEL_AUTOMATION_BYPASS_SECRET;
  if (bypass) headers["x-vercel-protection-bypass"] = bypass;
  for (const origin of new Set(origins)) {
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), FETCH_TIMEOUT_MS);
    try {
      const res = await fetch(`${origin}${sitePath}`, { headers, signal: controller.signal });
      // A protected preview answers 200 with an HTML sign-in page.
      if (res.ok && (res.headers.get("content-type") ?? "").startsWith("image/")) {
        return Buffer.from(await res.arrayBuffer());
      }
    } catch {
      // next origin
    } finally {
      clearTimeout(timer);
    }
  }
  return null;
}

/** The deck's cover (deckCoverOf's `src`) as a data URI Satori can draw, or
 *  null — the canvas then falls back to the brand navy. */
export async function deckCoverDataUri(src: string): Promise<string | null> {
  if (!isDefaultDeckCover(src)) return fetchImageAsDataUri(src);
  const bytes =
    (await readFile(path.join(DECK_COVER_DIR, path.basename(src))).catch(() => null)) ??
    (await fetchOwnStatic(src));
  if (!bytes) return null;
  return toSatoriDataUrl(bytes).catch(() => null);
}

/** The canvas, rendered and encoded as the share image's JPEG. */
export async function renderDeckShareImage(element: ReactNode): Promise<Buffer> {
  const png = Buffer.from(await ogImageResponse(element, OG_SIZE).arrayBuffer());
  return sharp(png).jpeg({ quality: JPEG_QUALITY, mozjpeg: true }).toBuffer();
}

/** The route's Response, with the headers the PNG one had. */
export function deckShareImageResponse(jpeg: Buffer): Response {
  return new Response(new Uint8Array(jpeg), {
    headers: {
      "content-type": DECK_SHARE_IMAGE_TYPE,
      "cache-control":
        process.env.NODE_ENV === "development"
          ? "no-cache, no-store"
          : "public, immutable, no-transform, max-age=31536000",
    },
  });
}
