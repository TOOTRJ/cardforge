import "server-only";

import sharp from "sharp";

// ---------------------------------------------------------------------------
// A stored picture handed to a third-party model — the omni-moderation scan
// of a card-art upload (lib/moderation/image-scan.ts) and the AI remix's
// source art (lib/ai/image-gen.ts restyleImage) — goes as-is up to
// MODEL_INPUT_MAX_BYTES and as a downscaled copy above it.
//
// Card art may be 20 MiB since TODO 6.10 (lib/cards/art-upload-limits.ts).
// OpenAI's moderation endpoint takes image files up to 20 MB, and a scan
// that errors FAILS OPEN — so a 20 MiB upload scanned by URL would skip the
// scan silently. Gemini (the remix, through the AI Gateway) takes the image
// inline, base64, in a request capped at 20 MB. Both models see far fewer
// pixels than a print-size file carries anyway (OpenAI's vision input is fit
// into 2048 × 2048 before tiling), so a MODEL_INPUT_EDGE copy loses nothing
// they look at.
//
// 8 MiB is the old card-art cap: every file that could be uploaded before
// 6.10 still goes to the model untouched.
// ---------------------------------------------------------------------------

/** Larger inputs are sent as a downscaled copy. */
export const MODEL_INPUT_MAX_BYTES = 8 * 1024 * 1024;
/** The copy's longest edge (px). */
export const MODEL_INPUT_EDGE = 2048;
const MODEL_INPUT_JPEG_QUALITY = 88;
/** What a transparent area turns into when the copy can't keep alpha: mid
 *  grey, against which both dark and light content stays visible. */
const FLATTEN_BACKGROUND = { r: 128, g: 128, b: 128 };

export type ModelInputImage = { bytes: Uint8Array; contentType: string; downscaled: boolean };

/**
 * `bytes` when they are within `maxBytes`, else a copy fit inside
 * `edge` × `edge` (never enlarged; the first frame of an animation): JPEG,
 * or PNG when `keepAlpha` and the image has alpha (otherwise transparency
 * is flattened onto mid grey). Undecodable input comes back unchanged — the
 * caller's own fallback applies.
 */
export async function modelInputImage(
  bytes: Uint8Array,
  contentType: string,
  opts: { keepAlpha?: boolean; maxBytes?: number; edge?: number } = {},
): Promise<ModelInputImage> {
  const maxBytes = opts.maxBytes ?? MODEL_INPUT_MAX_BYTES;
  const edge = opts.edge ?? MODEL_INPUT_EDGE;
  const original = { bytes, contentType, downscaled: false };
  if (bytes.byteLength <= maxBytes) return original;
  try {
    const meta = await sharp(bytes, { animated: false }).metadata();
    const fitted = sharp(bytes, { animated: false, failOn: "none" }).resize({
      width: edge,
      height: edge,
      fit: "inside",
      withoutEnlargement: true,
    });
    if (opts.keepAlpha && meta.hasAlpha) {
      return { bytes: new Uint8Array(await fitted.png().toBuffer()), contentType: "image/png", downscaled: true };
    }
    const jpeg = await fitted
      .flatten({ background: FLATTEN_BACKGROUND })
      .jpeg({ quality: MODEL_INPUT_JPEG_QUALITY, mozjpeg: true })
      .toBuffer();
    return { bytes: new Uint8Array(jpeg), contentType: "image/jpeg", downscaled: true };
  } catch {
    return original;
  }
}
