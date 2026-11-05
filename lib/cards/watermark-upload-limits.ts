// ---------------------------------------------------------------------------
// Custom watermark / land icon upload limits — ONE source for the server
// action (lib/cards/upload-watermark-server.ts, which also sniffs the bytes)
// and the guest creator's early check on a picture it keeps in the browser
// until sign-in (TODO HM3). No "server-only": the browser reads it too.
// ---------------------------------------------------------------------------

/** The largest watermark file (bytes). */
export const WATERMARK_MAX_BYTES = 2 * 1024 * 1024;

/** Transparency-capable types only: an opaque mark stamps a rectangle. */
export const WATERMARK_MIME_TYPES = ["image/png", "image/webp"] as const;

export const WATERMARK_TYPE_MESSAGE = "Watermarks must be PNG or WebP (transparency required).";
export const WATERMARK_TOO_LARGE_MESSAGE = "Watermark images must be 2 MB or smaller.";

/** Why a picked file can't be a watermark, or null. The server checks the
 *  bytes themselves when it is uploaded. */
export function watermarkFileProblem(file: { size: number; type: string }): string | null {
  if (!(WATERMARK_MIME_TYPES as readonly string[]).includes(file.type)) return WATERMARK_TYPE_MESSAGE;
  if (file.size <= 0) return "Empty file.";
  if (file.size > WATERMARK_MAX_BYTES) return WATERMARK_TOO_LARGE_MESSAGE;
  return null;
}
