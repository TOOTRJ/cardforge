"use server";

import "server-only";

import sharp from "sharp";
import { getCurrentUser } from "@/lib/supabase/server";
import { isSupabaseConfigured } from "@/lib/supabase/env";
import { scanImageUrl } from "@/lib/moderation/image-scan";
import { prepareUploadBytes } from "@/lib/media/upload-bytes";
import {
  STAGED_TOMBSTONE,
  isUserStorageConfigured,
  userFolder,
  userUploadStaging,
} from "@/lib/media/user-storage";
import {
  checkUploadRateLimit,
  uploadRateLimitFailure,
  type UploadLimitFields,
} from "@/lib/media/upload-rate-limit";
import {
  CARD_ART_EMPTY_MESSAGE,
  CARD_ART_MAX_BYTES,
  CARD_ART_STAGED_MAX_AGE_MS,
  CARD_ART_TOO_LARGE_MESSAGE,
  CARD_ART_TYPE_MESSAGE,
  isCardArtMimeType,
} from "@/lib/cards/art-upload-limits";
import { isUuid, randomId } from "@/lib/ids";

// ---------------------------------------------------------------------------
// Server-side card-art upload (Phase 11 chunk 14 — M1 hardening; TODO 6.10:
// up to 20 MiB, lib/cards/art-upload-limits.ts).
//
// The bytes no longer travel through this action: a Vercel Function takes at
// most 4.5 MB of request body, and print-quality art is 8–15 MiB. So an
// upload is three calls (lib/cards/art-upload-client.ts runs them):
//
//   1. startCardArtUploadAction({ size, type }) — auth, the per-user upload
//      rate limit (the upload is counted HERE, once), the declared size and
//      type, then a signed upload URL for ONE server-made name in the
//      caller's folder of the PRIVATE staging bucket `card-art-incoming`
//      (migration 0131: same 20 MiB + MIME limits as card-art, no policies,
//      never public, and no picture column accepts it — 0127).
//   2. The browser PUTs the file to that URL (Supabase Storage enforces the
//      bucket's size and MIME limits).
//   3. finishCardArtUploadAction(name) — reads the staged object back with
//      the service role and runs what this action always ran on the bytes:
//        * size check against the actual bytes, not the declared length;
//        * Sharp decodes the header — throws on non-images;
//        * format whitelist: png / jpeg / webp / gif (not svg, avif, heif,
//          tiff…);
//        * EXIF orientation applied and camera metadata (EXIF incl. GPS,
//          XMP, IPTC…) stripped without touching the pixels
//          (lib/media/upload-bytes.ts, TODO 3.14 / 3.14a);
//        * the real object written with the service role into
//          `card-art/{userId}/{uuid}.{ext}` (lib/media/user-storage.ts —
//          users hold no storage write policy since 0126);
//        * the NSFW scan (a downscaled copy above 8 MiB, lib/media/
//          model-input.ts), and a flagged object removed.
//      Once read, the staged object is replaced by a tombstone (not
//      deleted: the signed URL could put a deleted key again), so one
//      counted start stores at most one file.
//
// Why the byte sniff matters: a bucket validates the DECLARED Content-Type,
// not the file bytes. Sharp reads the actual bytes and rejects anything that
// doesn't decode as a raster image — so nothing reaches card-art that isn't.
// ---------------------------------------------------------------------------

const ALLOWED_FORMATS = new Set(["png", "jpeg", "webp", "gif"]);

const EXTENSION_BY_FORMAT: Record<string, string> = {
  png: "png",
  jpeg: "jpg",
  webp: "webp",
  gif: "gif",
};

const CONTENT_TYPE_BY_FORMAT: Record<string, string> = {
  png: "image/png",
  jpeg: "image/jpeg",
  webp: "image/webp",
  gif: "image/gif",
};

/** A staged object's name: `{uuid}.upload`, made by the start action. */
const STAGED_SUFFIX = ".upload";

export type UploadArtServerResult =
  | { ok: true; publicUrl: string; path: string }
  | ({ ok: false; error: string } & UploadLimitFields);

export type StartCardArtUploadResult =
  | {
      ok: true;
      /** The staged object's name — what the finish call names. */
      name: string;
      /** Its key in the staging bucket, `{userId}/{name}`, and the signed
       *  upload token (valid 2 hours, this one object only). */
      path: string;
      token: string;
    }
  | ({ ok: false; error: string } & UploadLimitFields);

type Ready = { ok: true; userId: string } | { ok: false; error: string };

async function uploader(): Promise<Ready> {
  if (!isSupabaseConfigured()) {
    return { ok: false, error: "Supabase is not configured." };
  }
  if (!isUserStorageConfigured()) {
    return { ok: false, error: "Uploads aren't available right now." };
  }
  const user = await getCurrentUser();
  if (!user) {
    return { ok: false, error: "Sign in to upload artwork." };
  }
  return { ok: true, userId: user.id };
}

/**
 * Step 1 of a card-art upload: a signed URL to put the file into the
 * caller's staging folder. Counts the upload against the rate limit.
 */
export async function startCardArtUploadAction(input: {
  size: number;
  type: string;
}): Promise<StartCardArtUploadResult> {
  const ready = await uploader();
  if (!ready.ok) return ready;

  // 30 a minute / 300 a day per user (lib/media/upload-rate-limit.ts),
  // before any work — this is the one call per upload that counts.
  const limit = await checkUploadRateLimit(ready.userId);
  if (!limit.ok) return uploadRateLimitFailure(limit);

  // The declared size and type are hints (the finish action checks the
  // bytes), but an obviously wrong file is refused before any storage call.
  const size = typeof input?.size === "number" ? input.size : NaN;
  const type = typeof input?.type === "string" ? input.type : "";
  if (!isCardArtMimeType(type)) {
    return { ok: false, error: CARD_ART_TYPE_MESSAGE };
  }
  if (!Number.isFinite(size) || size <= 0) {
    return { ok: false, error: CARD_ART_EMPTY_MESSAGE };
  }
  if (size > CARD_ART_MAX_BYTES) {
    return { ok: false, error: CARD_ART_TOO_LARGE_MESSAGE };
  }

  const staging = userUploadStaging(ready.userId);
  // Clear this user's uploads whose finish never came (best-effort — a
  // failure here must not stop the upload).
  try {
    await staging.removeOlderThan(CARD_ART_STAGED_MAX_AGE_MS);
  } catch {
    // ignore
  }

  const name = `${randomId()}${STAGED_SUFFIX}`;
  const { data, error } = await staging.createUploadUrl(name);
  if (error || !data) {
    return { ok: false, error: "Uploads aren't available right now." };
  }
  return { ok: true, name, path: data.path, token: data.token };
}

/** True for a name the start action makes — `{uuid}.upload` — so no other
 *  string reaches storage. */
function isStagedName(name: unknown): name is string {
  return (
    typeof name === "string" &&
    name.endsWith(STAGED_SUFFIX) &&
    isUuid(name.slice(0, -STAGED_SUFFIX.length))
  );
}

/**
 * Step 3 of a card-art upload: validate the staged file, store it in
 * `card-art/{userId}/…` without camera metadata, scan it, and return its
 * public URL. Once read, the staged object is consumed (a tombstone).
 */
export async function finishCardArtUploadAction(
  stagedName: string,
): Promise<UploadArtServerResult> {
  const ready = await uploader();
  if (!ready.ok) return ready;
  if (!isStagedName(stagedName)) {
    return { ok: false, error: "That upload wasn't found — try again." };
  }

  const staging = userUploadStaging(ready.userId);
  const staged = await staging.download(stagedName);
  if (!staged.bytes || isTombstone(staged.bytes)) {
    return { ok: false, error: "That upload wasn't found — try again." };
  }
  // The staged file has served its purpose once read: its bytes never
  // outlive this call. It is REPLACED by a tombstone rather than deleted —
  // the signed URL (valid 2 hours) only refuses to overwrite, so a deleted
  // key could be put again and finished again on this one counted upload.
  // The tombstone goes with the user's next start once the URL has expired.
  const consumed = await staging.markConsumed(stagedName).catch(() => ({ error: { message: "tombstone failed" } }));
  if (consumed.error) {
    await staging.remove([stagedName]).catch(() => undefined);
  }
  return storeCardArt(ready.userId, staged.bytes);
}

/** A staged object a finish already consumed (user-storage markConsumed). */
function isTombstone(bytes: Buffer): boolean {
  return bytes.byteLength === STAGED_TOMBSTONE.byteLength && bytes.equals(Buffer.from(STAGED_TOMBSTONE));
}

/** The checks every card-art file passes before it is stored — the same
 *  ones the FormData action ran before TODO 6.10. */
async function storeCardArt(userId: string, buffer: Buffer): Promise<UploadArtServerResult> {
  if (buffer.byteLength === 0) {
    return { ok: false, error: CARD_ART_EMPTY_MESSAGE };
  }
  if (buffer.byteLength > CARD_ART_MAX_BYTES) {
    return { ok: false, error: CARD_ART_TOO_LARGE_MESSAGE };
  }

  // The actual byte sniff. `sharp(buffer).metadata()` parses the header
  // chunks of the image and throws on anything that isn't a recognized
  // raster format. Default Sharp behavior REJECTS SVG inputs unless you
  // explicitly enable them via { failOn: "none" }, which we do not —
  // so SVG (and the embedded-JS risk it carries) is rejected by default.
  let metadata: sharp.Metadata;
  try {
    metadata = await sharp(buffer).metadata();
  } catch {
    return { ok: false, error: "That doesn't look like a valid image." };
  }

  const format = metadata.format;
  if (!format || !ALLOWED_FORMATS.has(format)) {
    return { ok: false, error: CARD_ART_TYPE_MESSAGE };
  }

  // Store upright pixels with no camera metadata: same format, the
  // orientation tag applied and dropped, EXIF/GPS/XMP removed losslessly
  // (untouched bytes when there is nothing to turn or remove).
  let stored: Buffer;
  try {
    stored = await prepareUploadBytes(buffer, metadata, { maxBytes: CARD_ART_MAX_BYTES });
  } catch {
    return { ok: false, error: "That doesn't look like a valid image." };
  }

  // Storage upload: `card-art/{userId}/{uuid}.{ext}`, written with the
  // service role into the folder of the user this action authenticated.
  const ext = EXTENSION_BY_FORMAT[format] ?? "bin";
  const name = `${randomId()}.${ext}`;
  const art = userFolder("card-art", userId);

  const { error } = await art.upload(name, stored, {
    cacheControl: "3600",
    // Use Sharp's detected MIME, not the client-declared one, so the
    // stored object's Content-Type reflects reality.
    contentType: CONTENT_TYPE_BY_FORMAT[format] ?? "application/octet-stream",
    upsert: false,
  });

  if (error) {
    return { ok: false, error: error.message };
  }

  const publicUrl = art.publicUrl(name);

  // NSFW auto-scan. scanImageUrl fails open (missing key / API error → not
  // flagged) so a moderation hiccup never blocks uploads; a positive flag
  // removes the just-uploaded object and rejects the upload. The bytes let
  // it send a big file as a downscaled copy (OpenAI takes ≤ 20 MB).
  const scan = await scanImageUrl(publicUrl, { bytes: stored });
  if (scan.flagged) {
    await art.remove([name]);
    return {
      ok: false,
      error: "That image was flagged by our content filter and can't be uploaded.",
    };
  }

  return { ok: true, publicUrl, path: art.path(name) };
}
