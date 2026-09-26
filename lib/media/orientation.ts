import "server-only";

import sharp from "sharp";

// ---------------------------------------------------------------------------
// EXIF orientation: one rule for every raster we store or decode.
//
// A phone camera saves its pixels in the sensor's orientation and writes an
// EXIF Orientation tag (1–8) saying how to turn them for display. Browsers
// obey the tag (CSS `image-orientation: from-image` is the default), so the
// creator, the art positioner and the live preview all show a phone photo
// upright, and `naturalWidth`/`naturalHeight` are the turned size. sharp,
// Satori and resvg ignore the tag unless told to. Before TODO 3.14 the bake,
// the WebP thumb, the OG image and every download drew those photos sideways,
// and the saved focal point / zoom (set against the upright image) landed on
// the wrong part of the art.
//
// So every server path does what the browser does:
//   * UPLOAD — normalizeUploadOrientation(): turn the pixels upright and drop
//     the tag, so the stored file needs no interpretation by anyone.
//   * BAKE / OG — lib/render/art-source.ts auto-orients every raster it
//     inlines (files stored before this fix keep their tag), and reads the
//     turned size (orientedSize) wherever geometry depends on it.
//
// Orientation 1 (or no tag) is the common case and costs nothing: the bytes
// are returned untouched, never re-encoded.
// ---------------------------------------------------------------------------

/** True for the EXIF Orientation values that change what a browser shows
 *  (2–8). 1, a missing tag and out-of-range junk mean "as stored". */
export function needsAutoOrient(orientation: number | null | undefined): boolean {
  return (
    typeof orientation === "number" &&
    Number.isInteger(orientation) &&
    orientation >= 2 &&
    orientation <= 8
  );
}

/** Orientations 5–8 include a quarter turn, so the displayed image swaps
 *  width and height. */
export function swapsAxes(orientation: number | null | undefined): boolean {
  return needsAutoOrient(orientation) && (orientation as number) >= 5;
}

/**
 * The size the browser lays an image out at: the stored size, with width and
 * height swapped for orientations 5–8. This is what `object-fit: cover` and
 * the saved focal point were measured against in the creator. Null when
 * sharp could not read a size.
 */
export function orientedSize(
  meta: Pick<sharp.Metadata, "width" | "height" | "orientation">,
): { width: number; height: number } | null {
  if (!meta.width || !meta.height) return null;
  return swapsAxes(meta.orientation)
    ? { width: meta.height, height: meta.width }
    : { width: meta.width, height: meta.height };
}

/** Re-encode quality for an upload that had to be turned. High: the stored
 *  art is the master every render and download is made from. The fallback
 *  is only tried when the first encode would overflow the bucket's cap. */
const UPLOAD_QUALITY = 92;
const UPLOAD_FALLBACK_QUALITY = 85;

async function encodeUpright(
  buffer: Buffer,
  format: string | undefined,
  quality: number,
): Promise<Buffer | null> {
  const upright = sharp(buffer, { animated: false }).autoOrient();
  switch (format) {
    case "jpeg":
      return upright.jpeg({ quality }).toBuffer();
    case "png":
      return upright.png().toBuffer();
    case "webp":
      return upright.webp({ quality, alphaQuality: 100 }).toBuffer();
    default:
      return null;
  }
}

/**
 * Upload normalizer. Returns the bytes to STORE:
 *   * orientation 1 / no tag / not a still JPEG-PNG-WebP → the input,
 *     byte-for-byte (no needless re-encode);
 *   * orientation 2–8 → the pixels turned upright, re-encoded in the SAME
 *     format (so the caller's extension and Content-Type stay right), with
 *     the tag gone. sharp drops all metadata on output by default, which
 *     also removes the photo's other EXIF (camera, GPS) and converts an
 *     embedded colour profile to sRGB — the same pixels resvg will draw.
 * Animated images are left alone (a WebP/GIF with frames and an orientation
 * tag is not a thing cameras make); the bake still auto-orients their first
 * frame. So does an image whose upright re-encode would not fit `maxBytes`
 * (the bucket's cap) even at the fallback quality: the upload keeps its
 * original bytes rather than failing, and the render-time rule in
 * lib/render/art-source.ts still draws it upright. Throws only when sharp
 * cannot decode the image (the callers already validated that it can).
 */
export async function normalizeUploadOrientation(
  buffer: Buffer,
  meta: Pick<sharp.Metadata, "format" | "orientation" | "pages">,
  opts: { maxBytes?: number } = {},
): Promise<{ buffer: Buffer; reoriented: boolean }> {
  const untouched = { buffer, reoriented: false };
  if (!needsAutoOrient(meta.orientation) || (meta.pages ?? 1) > 1) return untouched;
  const fits = (out: Buffer) => opts.maxBytes == null || out.byteLength <= opts.maxBytes;
  let out = await encodeUpright(buffer, meta.format, UPLOAD_QUALITY);
  if (!out) return untouched;
  if (!fits(out) && meta.format !== "png") {
    out = await encodeUpright(buffer, meta.format, UPLOAD_FALLBACK_QUALITY);
  }
  return out && fits(out) ? { buffer: out, reoriented: true } : untouched;
}

/**
 * Bytes as the browser would show them, for pipelines that hand an image to
 * something that may not read EXIF (the AI remix model). Untouched when no
 * turn is needed; otherwise upright JPEG (PNG when there is alpha to keep).
 * Undecodable input comes back unchanged.
 */
export async function autoOrientBytes(
  bytes: Uint8Array,
  contentType: string,
): Promise<{ bytes: Uint8Array; contentType: string }> {
  try {
    const meta = await sharp(bytes, { animated: false }).metadata();
    if (!needsAutoOrient(meta.orientation)) return { bytes, contentType };
    const upright = sharp(bytes, { animated: false }).autoOrient();
    if (meta.hasAlpha) {
      return { bytes: new Uint8Array(await upright.png().toBuffer()), contentType: "image/png" };
    }
    return {
      bytes: new Uint8Array(await upright.jpeg({ quality: UPLOAD_QUALITY }).toBuffer()),
      contentType: "image/jpeg",
    };
  } catch {
    return { bytes, contentType };
  }
}
