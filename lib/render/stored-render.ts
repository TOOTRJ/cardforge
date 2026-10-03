import "server-only";

import sharp from "sharp";
import { hasPendingCorrection, type ScopeCard } from "@/lib/cards/layout-version";
import { isAllowedServerImageFetchUrl } from "@/lib/validation/card";
import { isStoredRenderUrl } from "@/lib/cards/render-cdn";
import type { CardFace } from "@/lib/cards/card-face";
import { squareCardCorners, type CardCornerFills } from "@/lib/cards/card-corner";
import { RENDER_PRESETS, type RenderPreset } from "@/lib/render/card-image";

// ---------------------------------------------------------------------------
// The baked render as a render SOURCE.
//
// Every public/unlisted card already has a 1500×2100 PNG in the card-renders
// bucket, baked at save time by the same renderer (lib/cards/bake-render.ts)
// as the always-watermarked DISPLAY copy (layout v20). The OG image, the PNG download and the
// PDF used to re-run Satori + resvg on every request anyway — the single
// largest consumer of Vercel Active CPU. When the stored render is current
// and would carry the same stamp the request needs, serving (or downscaling)
// those bytes is a ~10 ms sharp call instead of a ~1 s render.
//
// "Servable" = the row carries a render URL AND the platform owes it no
// correction (lib/cards/layout-version.ts hasPendingCorrection: the stamp is
// set and no SWEEP-policy bump since it changed this card). An OPT-IN bump
// the owner hasn't accepted does not disqualify the bake: the stored image
// IS the card's look until the owner updates it, so a watermarked download
// serves it and matches the gallery tile (TODO 0.21, owner-reported
// 2026-09-25 — downloads used to jump to the newer look the owner had not
// accepted). A save whose bake failed clears the URL (bake-render.ts), so a
// present URL is the bake of the row as saved. Anything else falls back to
// a live render.
//
// This is NOT the preview↔bake invariant: a downscale of the HD bake differs
// from a native 750 px render by resampling only, which is fine for a share
// preview or a free-tier download and irrelevant for the HD paths that serve
// the stored bytes untouched.
// ---------------------------------------------------------------------------

const FETCH_TIMEOUT_MS = 10_000;
/** An HD render is ~1 MB; a stored object far larger than that isn't ours. */
const MAX_RENDER_BYTES = 25 * 1024 * 1024;

/** The row as the routes read it (`select("*")`). `frame_style` lets a
 *  template-scoped bump leave other templates' renders current, and the
 *  other ScopeCard columns feed the card-scoped bumps
 *  (lib/cards/layout-version.ts VERSION_SCOPES). All optional: a column the
 *  row lacks counts as "can't tell", so every bump that could reach it
 *  counts. */
export type StoredRenderRow = ScopeCard & {
  rendered_image_url: string | null;
  layout_version: number | null;
  /** The BACK face's bake (migration 0134, TODO 5.3) — `face: "back"` reads
   *  it; a row read without the column has no back bake to serve. */
  rendered_back_image_url?: string | null;
  /** With both, the URL must be THIS card's own bake (see fetchStoredRender). */
  id?: string;
  owner_id?: string;
};

/** The stored render URL of a face: the front's, or the back's (TODO 5.3). */
export function storedRenderUrlOf(row: StoredRenderRow, face: CardFace = "front"): string | null {
  const url = face === "back" ? row.rendered_back_image_url : row.rendered_image_url;
  return typeof url === "string" && url.length > 0 ? url : null;
}

/** True when the row's baked PNG of `face` (the front unless asked for the
 *  back, TODO 5.3) may stand in for a live render: a URL and no pending
 *  platform correction (see the header). The correction is the CARD's —
 *  one layout_version stamps both faces, baked by one run — so a back is
 *  servable exactly when its front is, and only once it exists. */
export function hasServableStoredRender(row: StoredRenderRow, face: CardFace = "front"): boolean {
  return (
    storedRenderUrlOf(row, face) !== null &&
    // The whole row: v29 also reads the type line, title and stat columns.
    !hasPendingCorrection({ ...row, frame_style: row.frame_style })
  );
}

/**
 * Fetch the stored render's bytes, or null when there is none, it is not
 * acceptable, its host is not ours, or the fetch fails (callers render live).
 *
 *   accept "servable" (default) — downloads: the bake unless a platform
 *     correction is pending (a geometry change or a sweep bump the admin
 *     re-bake hasn't reached yet — rendering live then shows the corrected
 *     card rather than a bake the platform already deems wrong).
 *   accept "any" — DISPLAY surfaces like the share image: whatever bake
 *     exists, because the gallery tile shows exactly that image and the
 *     owner-driven update flow means a card may keep an older look for a
 *     long time.
 *   face — the front (default) or the back face's bake (TODO 5.3).
 */
export async function fetchStoredRender(
  row: StoredRenderRow,
  opts: { accept?: "servable" | "any"; face?: CardFace } = {},
): Promise<Buffer | null> {
  const face = opts.face ?? "front";
  if (opts.accept !== "any" && !hasServableStoredRender(row, face)) return null;
  const url = storedRenderUrlOf(row, face);
  if (!url) return null;
  // rendered_image_url is written by the bake, but it is still a row column —
  // the same SSRF gate the art fetch uses keeps this to our storage host, and
  // it must be a bake in card-renders — this card's own when the row carries
  // its ids (lib/cards/render-cdn.ts). Since migration 0126 only the service
  // role can set the column, but a row written before it (when an owner could
  // PATCH their card) might name anything the SSRF gate lets through: a raw
  // card-art upload (no watermark, served as the "watermarked" download and
  // the share image), another card's bake, a Scryfall image.
  if (!isAllowedServerImageFetchUrl(url)) return null;
  const card = row.id && row.owner_id ? { ownerId: row.owner_id, cardId: row.id } : undefined;
  if (!isStoredRenderUrl(url, card)) return null;

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
  // sharp premultiplies alpha to resample, so a round bake's transparent
  // corners (TODO 3.26) stay clean at 750 px — no dark or light fringe.
  return sharp(bytes).resize(width, height, { fit: "fill" }).png().toBuffer();
}

/**
 * A SQUARE PNG from a round stored bake (TODO 3.26, owner decision
 * 2026-09-27), so a free viewer's Square download stays a few ms of sharp
 * instead of a live Satori render: each corner squared with its fill
 * (lib/cards/card-corner.ts squareCardCorners, `fills` from the png route's
 * squareCornerFillsOf) — the very function the bake's square mode runs, so
 * it is the live Square's twin: the border black, or the root's #101015 on
 * a ring, outside the arc, a blend on the 1 px ramp. Every fill must be a
 * colour: a null corner (art or design in the corner) needs pixels a
 * downscaled round bake no longer has — the route renders those live.
 * Opaque output (no alpha channel).
 */
export async function flattenStoredCorners(bytes: Buffer, fills: CardCornerFills): Promise<Buffer> {
  if (fills.some((fill) => fill === null)) {
    throw new Error("flattenStoredCorners: a corner that keeps its drawn pixels can't be squared from a round bake");
  }
  const { data, info } = await sharp(bytes).ensureAlpha().raw().toBuffer({ resolveWithObject: true });
  squareCardCorners(data, info.width, info.height, fills);
  return sharp(data, { raw: { width: info.width, height: info.height, channels: 4 } })
    .removeAlpha()
    .png()
    .toBuffer();
}
