import "server-only";

import sharp from "sharp";
import {
  browserAppliesOrientation,
  needsAutoOrient,
  normalizeUploadOrientation,
} from "@/lib/media/orientation";
import { isOrientationOnlyTiff, stripImageMetadata, tiffOf } from "@/lib/media/strip-metadata";

// ---------------------------------------------------------------------------
// The bytes an upload action stores (TODO 3.14 + 3.14a): upright, and with no
// camera metadata. Every human upload path — card art (both faces),
// watermarks / land icons, deck covers and card set icons, avatars and
// banners — calls prepareUploadBytes() on the server before it writes to
// storage; a client-side strip would not count, anyone can post a file.
//
//   1. lib/media/orientation.ts turns a photo tagged 2–8 (a re-encode that
//      writes no metadata at all);
//   2. lib/media/strip-metadata.ts drops EXIF (GPS, camera, dates,
//      thumbnail), XMP, IPTC, comments, text chunks, C2PA, trailers … at the
//      container level — the pixels are untouched and the ICC profile stays;
//   3. sharp reads the result back as a second opinion. A container the
//      stripper cannot walk, or anything sharp still finds, is re-encoded
//      instead (sharp writes no metadata) — so no path stores a file with
//      camera metadata, even a malformed one.
// ---------------------------------------------------------------------------

type UploadMeta = Pick<sharp.Metadata, "format" | "orientation" | "pages">;

const REENCODE_QUALITY = 92;

const asBuffer = (bytes: Uint8Array): Buffer =>
  Buffer.isBuffer(bytes) ? bytes : Buffer.from(bytes.buffer, bytes.byteOffset, bytes.byteLength);

/** True when sharp finds nothing but pixels, colour and (kept) orientation. */
export async function carriesNoMetadata(bytes: Uint8Array): Promise<boolean> {
  try {
    const meta = await sharp(bytes, { animated: false }).metadata();
    if (meta.xmp || meta.iptc || meta.comments?.length) return false;
    return !meta.exif || isOrientationOnlyTiff(tiffOf(meta.exif));
  } catch {
    return false;
  }
}

/** Fallback: decode and re-encode in the same format (turned upright first).
 *  sharp writes no EXIF/XMP/IPTC/ICC — it converts to sRGB instead. */
async function reencodeWithoutMetadata(buffer: Buffer, meta: UploadMeta): Promise<Buffer> {
  const animated = (meta.pages ?? 1) > 1;
  let image = sharp(buffer, { animated });
  if (!animated && needsAutoOrient(meta.orientation)) image = image.autoOrient();
  switch (meta.format) {
    case "jpeg":
      return image.jpeg({ quality: REENCODE_QUALITY }).toBuffer();
    case "png":
      return image.png().toBuffer();
    case "webp":
      return image.webp({ quality: REENCODE_QUALITY, alphaQuality: 100 }).toBuffer();
    case "gif":
      return image.gif().toBuffer();
    default:
      throw new Error(`Unsupported upload format: ${meta.format}`);
  }
}

/**
 * Upload normalizer: returns the bytes to STORE — upright (orientation.ts)
 * and without camera metadata. An already-clean, untagged file comes back as
 * the input itself (stored byte-for-byte). Throws when the image cannot be
 * decoded, or when its re-encode (only for a container the stripper could
 * not walk) would not fit `maxBytes`; the callers answer "not a valid image".
 */
export async function prepareUploadBytes(
  buffer: Buffer,
  meta: UploadMeta,
  opts: { maxBytes?: number } = {},
): Promise<Buffer> {
  const { buffer: upright } = await normalizeUploadOrientation(buffer, meta, opts);
  const stripped = stripImageMetadata(upright);
  if (stripped && (await carriesNoMetadata(stripped.bytes))) {
    return stripped.bytes === upright ? upright : asBuffer(stripped.bytes);
  }
  const reencoded = await reencodeWithoutMetadata(upright, meta);
  if (opts.maxBytes != null && reencoded.byteLength > opts.maxBytes) {
    throw new Error("Re-encoded upload exceeds the size cap.");
  }
  return reencoded;
}

/**
 * The same guarantee for bytes handed to a third party that were not just
 * uploaded (the AI remix source: a stored file, maybe from before 3.14a).
 * Lossless strip first; a container the stripper refuses is re-encoded
 * (PNG when there is alpha, else JPEG). Clean input comes back as the same
 * object; undecodable input comes back unchanged.
 */
export async function imageWithoutMetadata(
  bytes: Uint8Array,
  contentType: string,
): Promise<{ bytes: Uint8Array; contentType: string }> {
  const stripped = stripImageMetadata(bytes);
  if (stripped && (await carriesNoMetadata(stripped.bytes))) {
    return { bytes: stripped.bytes, contentType };
  }
  try {
    // Turn only what the browser turns (a tagged JPEG/PNG), like
    // autoOrientBytes: a tagged WebP is shown — and sent — as stored.
    const meta = await sharp(bytes, { animated: false }).metadata();
    const decoded = sharp(bytes, { animated: false });
    const image = browserAppliesOrientation(meta) ? decoded.autoOrient() : decoded;
    if (meta.hasAlpha) return { bytes: new Uint8Array(await image.png().toBuffer()), contentType: "image/png" };
    return {
      bytes: new Uint8Array(await image.jpeg({ quality: REENCODE_QUALITY }).toBuffer()),
      contentType: "image/jpeg",
    };
  } catch {
    return { bytes, contentType };
  }
}
