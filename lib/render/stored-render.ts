import "server-only";

import sharp from "sharp";
import { isRenderStale, templateOfFrameStyle } from "@/lib/cards/layout-version";
import { isAllowedServerImageFetchUrl } from "@/lib/validation/card";
import { RENDER_PRESETS, type RenderPreset } from "@/lib/render/card-image";

// ---------------------------------------------------------------------------
// The baked render as a render SOURCE.
//
// Every public/unlisted card already has a 1500×2100 PNG in the card-renders
// bucket, baked at save time by the same renderer (lib/cards/bake-render.ts)
// with the card OWNER's export stamp. The OG image, the PNG download and the
// PDF used to re-run Satori + resvg on every request anyway — the single
// largest consumer of Vercel Active CPU. When the stored render is current
// and would carry the same stamp the request needs, serving (or downscaling)
// those bytes is a ~10 ms sharp call instead of a ~1 s render.
//
// "Current" = the row carries a render URL AND no bump since its
// layout_version touched its frame template (lib/cards/layout-version.ts
// isRenderStale — a template-scoped bump leaves other templates current). A
// save whose bake failed clears the URL (bake-render.ts), so a present URL
// that isn't stale is the bake of the row as saved. Anything else falls back
// to a live render, exactly as before.
//
// This is NOT the preview↔bake invariant: a downscale of the HD bake differs
// from a native 750 px render by resampling only, which is fine for a share
// preview or a free-tier download and irrelevant for the HD paths that serve
// the stored bytes untouched.
// ---------------------------------------------------------------------------

const FETCH_TIMEOUT_MS = 10_000;
/** An HD render is ~1 MB; a stored object far larger than that isn't ours. */
const MAX_RENDER_BYTES = 25 * 1024 * 1024;

export type StoredRenderRow = {
  rendered_image_url: string | null;
  layout_version: number | null;
  /** `cards.frame_style` jsonb — lets a template-scoped bump leave other
   *  templates' renders current. Optional: without it every bump counts. */
  frame_style?: unknown;
};

/** True when the row's baked PNG reflects the current renderer and row. */
export function hasCurrentStoredRender(row: StoredRenderRow): boolean {
  return (
    typeof row.rendered_image_url === "string" &&
    row.rendered_image_url.length > 0 &&
    !isRenderStale(row.layout_version, templateOfFrameStyle(row.frame_style))
  );
}

/**
 * Fetch the current stored render's bytes, or null when there is none, it is
 * stale, its host is not ours, or the fetch fails (callers render live).
 */
export async function fetchStoredRender(row: StoredRenderRow): Promise<Buffer | null> {
  if (!hasCurrentStoredRender(row)) return null;
  const url = row.rendered_image_url as string;
  // rendered_image_url is written by the bake, but it is still a row column —
  // the same SSRF gate the art fetch uses keeps this to our storage host.
  if (!isAllowedServerImageFetchUrl(url)) return null;

  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), FETCH_TIMEOUT_MS);
  try {
    const response = await fetch(url, { signal: controller.signal, cache: "no-store" });
    if (!response.ok) return null;
    const type = response.headers.get("content-type") ?? "";
    if (!type.startsWith("image/png")) return null;
    const bytes = Buffer.from(await response.arrayBuffer());
    if (bytes.byteLength === 0 || bytes.byteLength > MAX_RENDER_BYTES) return null;
    return bytes;
  } catch {
    return null;
  } finally {
    clearTimeout(timer);
  }
}

/**
 * Fit stored HD bytes to a render preset. The bake is always "hd", so the
 * hd preset returns the bytes untouched; "default" downscales by exactly 2×
 * (1500×2100 → 750×1050, or the landscape swap for Battle frames).
 */
export async function fitStoredRender(
  bytes: Buffer,
  preset: RenderPreset,
  landscape: boolean,
): Promise<Buffer> {
  if (preset === "hd") return bytes;
  const base = RENDER_PRESETS[preset];
  const width = landscape ? base.height : base.width;
  const height = landscape ? base.width : base.height;
  return sharp(bytes).resize(width, height, { fit: "fill" }).png().toBuffer();
}
