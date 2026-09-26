import "server-only";

import sharp from "sharp";
import { isAllowedServerImageFetchUrl } from "@/lib/validation/card";

// ---------------------------------------------------------------------------
// Image sources for the Satori bake.
//
// Satori (next/og) decodes only PNG, JPEG and (inline) SVG. Card art may be
// anything the upload path accepts — PNG / JPEG / WebP / GIF — and AI art
// arrives in whatever the model returned, so a WebP upload rendered fine in
// the browser preview but every server render of that card failed:
// "Can't load image …webp: Unsupported image type: image/webp" (12 OG
// failures across 11 viewers on production, 2026-07 → 2026-09; the same
// throw breaks PNG/PDF downloads and the save-time bake for those cards).
//
// resolveRenderableImage() fetches the bytes once, transcodes anything
// Satori can't decode to PNG with sharp, and hands the renderer a data: URL
// — the same shape the frame PNGs already use. PNG/JPEG pass through as a
// data: URL too (one fetch here instead of Satori's own, with a timeout we
// control). A flaky fetch of an ALLOWED host falls back to the original URL
// so it degrades to Satori's own attempt rather than a blank art window.
//
// It is also the SSRF gate for the bake: art/watermark/set-icon/pip URLs are
// owner-writable columns, and Satori would otherwise fetch whatever they
// point at from inside the function. Only the app's own storage host and
// Scryfall (lib/validation/card.ts isAllowedServerImageFetchUrl) are fetched;
// anything else renders as a transparent pixel — never as a request.
// ---------------------------------------------------------------------------

/** Formats Satori decodes natively — passed through untouched. */
const SATORI_NATIVE_FORMATS: ReadonlySet<string> = new Set(["png", "jpeg", "jpg"]);

/** What a disallowed or unusable source renders as: nothing, quietly. */
export const TRANSPARENT_PIXEL_DATA_URL =
  "data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mNk+M8AAAMBAQDJ/pLvAAAAAElFTkSuQmCC";

/** Refuse to inline anything larger than this (a 1500×2100 HD render never
 *  needs more) — protects the function's memory on hostile URLs. */
const MAX_IMAGE_BYTES = 25 * 1024 * 1024;
const FETCH_TIMEOUT_MS = 10_000;
/** Largest payload inlined as-is. Above this (or for any transcode) the
 *  image is re-encoded to fit MAX_INLINE_EDGE — the HD bake's art slot is
 *  ~1300 px wide, so nothing visible is lost — keeping the SVG handed to
 *  resvg far below its ~10 MB XML buffer limit. */
export const MAX_INLINE_BYTES = 3 * 1024 * 1024;
export const MAX_INLINE_EDGE = 1600;
const INLINE_JPEG_QUALITY = 88;

/** True when Satori would reject the format and a PNG transcode is needed. */
export function needsSatoriTranscode(format: string | null | undefined): boolean {
  return format != null && !SATORI_NATIVE_FORMATS.has(format.toLowerCase());
}

const MIME_BY_FORMAT: Record<string, string> = {
  png: "image/png",
  jpeg: "image/jpeg",
  jpg: "image/jpeg",
};

/**
 * Bytes → a data: URL Satori can consume. PNG/JPEG are wrapped as-is;
 * everything else (WebP, GIF, TIFF, HEIF, AVIF…) is transcoded to PNG —
 * animated inputs collapse to their first frame. Throws on undecodable
 * input (the caller falls back to the URL).
 */
export async function toSatoriDataUrl(bytes: Buffer): Promise<string> {
  const meta = await sharp(bytes, { animated: false }).metadata();
  const native = Boolean(meta.format) && !needsSatoriTranscode(meta.format);
  if (native && bytes.byteLength <= MAX_INLINE_BYTES) {
    return `data:${MIME_BY_FORMAT[meta.format as string] ?? "image/png"};base64,${bytes.toString("base64")}`;
  }
  // Re-encode for inlining: fit the bake's largest art slot and pick JPEG
  // for opaque images (a lossless PNG of a 1600×1920 photo is ~7 MB, base64
  // ~10 MB — past resvg's XML buffer limit, which is how one card's re-bake
  // died with "Buffer size limit exceeded" on 2026-09-16); PNG only when
  // there is alpha to keep.
  const fitted = sharp(bytes, { animated: false }).resize({
    width: MAX_INLINE_EDGE,
    height: MAX_INLINE_EDGE,
    fit: "inside",
    withoutEnlargement: true,
  });
  if (meta.hasAlpha) {
    const png = await fitted.png().toBuffer();
    return `data:image/png;base64,${png.toString("base64")}`;
  }
  const jpeg = await fitted.jpeg({ quality: INLINE_JPEG_QUALITY, mozjpeg: true }).toBuffer();
  return `data:image/jpeg;base64,${jpeg.toString("base64")}`;
}

/**
 * Resolve an image URL (http(s) or data:) to something Satori can render.
 * data: URLs are transcoded too when they carry a non-native format; on any
 * fetch/decode problem the ORIGINAL url is returned unchanged.
 */
export async function resolveRenderableImage(
  url: string | null | undefined,
): Promise<string | null> {
  if (!url) return null;
  try {
    if (url.startsWith("data:")) {
      const comma = url.indexOf(",");
      const header = url.slice(5, comma);
      if (comma < 0 || !header.includes("base64")) return url;
      const mime = header.split(";")[0];
      if (mime === "image/png" || mime === "image/jpeg") return url;
      return await toSatoriDataUrl(Buffer.from(url.slice(comma + 1), "base64"));
    }
    if (!/^https?:\/\//i.test(url)) return url;
    if (!isAllowedServerImageFetchUrl(url)) {
      console.warn(`[render] Refusing to fetch image from a non-allowlisted host: ${url.slice(0, 120)}`);
      return TRANSPARENT_PIXEL_DATA_URL;
    }

    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), FETCH_TIMEOUT_MS);
    try {
      const response = await fetch(url, {
        signal: controller.signal,
        cache: "no-store",
      });
      if (!response.ok) return url;
      const length = Number(response.headers.get("content-length") ?? 0);
      if (length > MAX_IMAGE_BYTES) return url;
      const bytes = Buffer.from(await response.arrayBuffer());
      if (bytes.byteLength === 0 || bytes.byteLength > MAX_IMAGE_BYTES) return url;
      return await toSatoriDataUrl(bytes);
    } finally {
      clearTimeout(timer);
    }
  } catch {
    return url;
  }
}

/** Longest edge of the art copy the foil finish's luminance mask draws. The
 *  mask only needs the art's LIGHTNESS (the foil shows through light areas),
 *  so ~half the HD art slot is plenty — and a second full-size copy of the
 *  art inside the foil SVG would push that SVG (base64'd again by Satori
 *  into ONE attribute) towards librsvg's 10 MB attribute limit. */
export const FOIL_MASK_EDGE = 640;

/**
 * The foil mask's copy of an art data URL (lib/cards/foil-finish.tsx): a
 * small JPEG (PNG when the art has alpha) plus the ORIGINAL image's pixel
 * size, which the mask's object-fit: cover geometry is computed from — the
 * same size Satori reads when it draws the art itself. Null for anything
 * that is not an inlined, decodable image (the foil then follows the frame
 * alone there).
 */
export async function foilMaskSource(
  dataUrl: string | null | undefined,
): Promise<{ href: string; naturalWidth: number; naturalHeight: number } | null> {
  if (!dataUrl?.startsWith("data:")) return null;
  const comma = dataUrl.indexOf(",");
  if (comma < 0 || !dataUrl.slice(0, comma).includes("base64")) return null;
  try {
    const bytes = Buffer.from(dataUrl.slice(comma + 1), "base64");
    const meta = await sharp(bytes, { animated: false }).metadata();
    if (!meta.width || !meta.height) return null;
    const fitted = sharp(bytes, { animated: false }).resize({
      width: FOIL_MASK_EDGE,
      height: FOIL_MASK_EDGE,
      fit: "inside",
      withoutEnlargement: true,
    });
    const small = meta.hasAlpha
      ? `data:image/png;base64,${(await fitted.png().toBuffer()).toString("base64")}`
      : `data:image/jpeg;base64,${(await fitted.jpeg({ quality: 85 }).toBuffer()).toString("base64")}`;
    return { href: small, naturalWidth: meta.width, naturalHeight: meta.height };
  } catch {
    return null;
  }
}
