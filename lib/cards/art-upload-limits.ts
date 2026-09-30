// ---------------------------------------------------------------------------
// Card-art upload limits — ONE source for the creator's early check
// (components/creator/art-uploader.tsx via lib/cards/art-upload-client.ts),
// the server actions (lib/cards/upload-art-server.ts) and, through
// tests/unit/cards/art-upload-limits.test.ts, the two buckets migration 0131
// sizes: `card-art` (the stored art) and `card-art-incoming` (the private
// staging bucket the browser uploads into). No "server-only": the browser
// reads it too.
//
// 20 MiB (TODO 6.10, owner decision 2026-09-29: print exports need full-
// resolution art). A 2000×2800 lossless PNG — the 800 ppi full-art slot — is
// 8–11 MiB for a clean digital painting and 13–15 MiB with painted grain
// (measured 2026-09-29 on 6K sources downscaled to 2000×2800); even pure
// noise is 16 MiB at 2000×2800 and 18.9 MiB at the 2200×3000 bleed size, so
// no 8-bit RGB art of print size is refused. Past 20 MiB is 16-bit or
// incompressible RGBA, which no card needs.
//
// Why a staging bucket: a Vercel Function takes at most 4.5 MB of request
// body (413 FUNCTION_PAYLOAD_TOO_LARGE, every plan), whatever
// `serverActions.bodySizeLimit` says — so the old FormData server action
// never received a file much over 4.4 MB on Vercel (the multipart body is
// the file plus a few hundred bytes), whatever its own 8 MB cap said.
// The browser now PUTs the file straight to Supabase Storage through a
// signed URL the server mints for ONE path in a PRIVATE bucket; the finish
// action reads it back and runs the same sniff / strip / scan as before.
// ---------------------------------------------------------------------------

/** The largest card-art file (bytes): both buckets' `file_size_limit`. */
export const CARD_ART_MAX_BYTES = 20 * 1024 * 1024;

/** The same cap in words, for copy ("up to 20 MB"). */
export const CARD_ART_MAX_LABEL = "20 MB";

/** Declared types the buckets accept (`allowed_mime_types`, 0004 + 0131). */
export const CARD_ART_MIME_TYPES = ["image/png", "image/jpeg", "image/webp", "image/gif"] as const;

export type CardArtMimeType = (typeof CARD_ART_MIME_TYPES)[number];

/** The PRIVATE bucket a card-art file is uploaded into before the finish
 *  action checks it and writes the real object into `card-art`. Nothing can
 *  read it but the service role, and no picture column accepts it (0127). */
export const CARD_ART_INCOMING_BUCKET = "card-art-incoming";

/** How long a staged upload may sit before the next start clears it. A
 *  signed upload URL is valid for 2 hours; this leaves one more for a slow
 *  upload to reach its finish call. */
export const CARD_ART_STAGED_MAX_AGE_MS = 3 * 60 * 60 * 1000;

export const CARD_ART_NOT_IMAGE_MESSAGE = "That doesn't look like an image.";
export const CARD_ART_TYPE_MESSAGE = "Only PNG, JPEG, WebP, and GIF images are allowed.";
export const CARD_ART_EMPTY_MESSAGE = "Empty file.";
export const CARD_ART_TOO_LARGE_MESSAGE = `Image must be ${CARD_ART_MAX_LABEL} or smaller.`;
export const CARD_ART_UPLOAD_FAILED_MESSAGE = "The upload didn't go through — check your connection and try again.";

export function isCardArtMimeType(type: string): type is CardArtMimeType {
  return (CARD_ART_MIME_TYPES as readonly string[]).includes(type);
}

/**
 * Why a picked / dropped / pasted file can't be card art, or null when it
 * may be uploaded. The browser's early answer; the start action asks the
 * same of the declared size and type, and the finish action checks the
 * bytes themselves.
 */
export function cardArtFileProblem(file: { size: number; type: string }): string | null {
  if (!file.type.startsWith("image/")) return CARD_ART_NOT_IMAGE_MESSAGE;
  if (!isCardArtMimeType(file.type)) return CARD_ART_TYPE_MESSAGE;
  if (file.size <= 0) return CARD_ART_EMPTY_MESSAGE;
  if (file.size > CARD_ART_MAX_BYTES) return `That image is over ${CARD_ART_MAX_LABEL}. Pick a smaller file.`;
  return null;
}
