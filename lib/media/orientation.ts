import "server-only";

import sharp from "sharp";

// ---------------------------------------------------------------------------
// EXIF orientation: one rule for every raster we store or decode.
//
// A phone camera saves its pixels in the sensor's orientation and writes an
// EXIF Orientation tag (1–8) saying how to turn them for display. sharp,
// Satori and resvg ignore the tag unless told to. Browsers do NOT all agree,
// and not for every format (measured 2026-09-25 in Chromium 148 and Google
// Chrome 153, TODO 3.14):
//   * JPEG — Chrome turns it (CSS `image-orientation: from-image`, the
//     default), and `naturalWidth`/`naturalHeight` are the turned size.
//   * PNG  — Chrome turns it when the eXIf chunk comes before IDAT, which is
//     also the only place sharp reads it (an eXIf after IDAT is ignored by
//     both, so they agree there too).
//   * WebP — Chrome IGNORES the tag and draws the pixels as stored (macOS
//     ImageIO, Safari's decoder, does report it, so Safari may turn it: a
//     tagged WebP cannot look the same in every browser).
// Before TODO 3.14 the bake, the WebP thumb, the OG image and every download
// drew a tagged phone JPEG sideways while the creator showed it upright, and
// the saved focal point / zoom (set against the upright image) landed on the
// wrong part of the art.
//
// So:
//   * UPLOAD — normalizeUploadOrientation(): turn the pixels the way the tag
//     says (every format, WebP included: that is what the camera or editor
//     meant, and what Safari and the OS viewers show) and drop the tag, so
//     the stored file needs no interpretation and every browser AND the bake
//     draw it the same.
//   * RENDER (bake / OG) — lib/render/art-source.ts draws a stored file the
//     way Chrome shows it in the creator (browserAppliesOrientation): files
//     stored before this fix keep their tag, so a tagged JPEG/PNG is turned
//     and a tagged WebP is drawn as stored (no production file is one; the
//     bake drew WebP that way before 3.14 too).
//
// Orientation 1 (or no tag) is the common case and costs nothing: the bytes
// are returned untouched, never re-encoded.
// ---------------------------------------------------------------------------

/** True for the EXIF Orientation values that ask for a turn or a mirror
 *  (2–8). 1, a missing tag and out-of-range junk (0, 9…) mean "as stored" —
 *  sharp and Chrome both treat them that way. */
export function needsAutoOrient(orientation: number | null | undefined): boolean {
  return (
    typeof orientation === "number" &&
    Number.isInteger(orientation) &&
    orientation >= 2 &&
    orientation <= 8
  );
}

/** Formats whose EXIF orientation Chrome applies when it displays the file
 *  (see the header). WebP is deliberately absent. */
const BROWSER_ORIENTED_FORMATS: ReadonlySet<string> = new Set(["jpeg", "png"]);

/** The slice of sharp's metadata the orientation rule reads (sharp.Metadata
 *  satisfies it). */
export type OrientationMeta = {
  format?: string | null;
  orientation?: number | null;
  width?: number | null;
  height?: number | null;
};

/**
 * True when the browser (Chrome — the creator's live preview and art
 * positioner) shows this stored file TURNED: a JPEG or PNG whose tag is 2–8.
 * A tagged WebP is shown as stored, so it is false there. Render-time code
 * turns exactly these files, so the bake matches what the owner saw.
 */
export function browserAppliesOrientation(meta: OrientationMeta): boolean {
  return (
    Boolean(meta.format) &&
    BROWSER_ORIENTED_FORMATS.has(meta.format as string) &&
    needsAutoOrient(meta.orientation)
  );
}

/** Orientations 5–8 include a quarter turn, so the displayed image swaps
 *  width and height. */
export function swapsAxes(orientation: number | null | undefined): boolean {
  return needsAutoOrient(orientation) && (orientation as number) >= 5;
}

/**
 * The size the browser lays an image out at (its naturalWidth /
 * naturalHeight): the stored size, with width and height swapped when
 * Chrome turns the file a quarter turn (a JPEG/PNG tagged 5–8; never a
 * WebP). This is what `object-fit: cover` and the saved focal point were
 * measured against in the creator. Null when sharp could not read a size.
 */
export function orientedSize(meta: OrientationMeta): { width: number; height: number } | null {
  if (!meta.width || !meta.height) return null;
  return browserAppliesOrientation(meta) && swapsAxes(meta.orientation)
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
 *   * orientation 2–8 → the pixels turned the way the tag says, re-encoded
 *     in the SAME format (so the caller's extension and Content-Type stay
 *     right), with the tag gone. This follows the tag for WebP too, although
 *     Chrome ignores it there: a new upload should be stored the way its
 *     camera/editor meant it, and once the tag is gone every browser and the
 *     bake agree on it. sharp drops all metadata on output by default, which
 *     also removes the photo's other EXIF (camera, GPS) and converts an
 *     embedded colour profile to sRGB — the same pixels resvg will draw.
 * Animated images are left alone (a WebP/GIF with frames and an orientation
 * tag is not a thing cameras make). So is an image whose upright re-encode
 * would not fit `maxBytes` (the bucket's cap) even at the fallback quality:
 * the upload keeps its original bytes rather than failing, and the
 * render-time rule in lib/render/art-source.ts then draws it the way Chrome
 * shows it. Throws only when sharp cannot decode the image (the callers
 * already validated that it can).
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
 * Bytes as the creator shows them, for pipelines that hand a STORED image
 * to something that may not read EXIF (the AI remix model). Same rule as
 * the render path (browserAppliesOrientation): a tagged JPEG/PNG comes back
 * turned — upright JPEG, or PNG when there is alpha to keep — and anything
 * else, a tagged WebP included, comes back untouched. Undecodable input
 * comes back unchanged.
 */
export async function autoOrientBytes(
  bytes: Uint8Array,
  contentType: string,
): Promise<{ bytes: Uint8Array; contentType: string }> {
  try {
    const meta = await sharp(bytes, { animated: false }).metadata();
    if (!browserAppliesOrientation(meta)) return { bytes, contentType };
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
