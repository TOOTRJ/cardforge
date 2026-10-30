"use server";

import "server-only";

import sharp from "sharp";
import { getCurrentUser } from "@/lib/supabase/server";
import { isSupabaseConfigured } from "@/lib/supabase/env";
import { scanImageUrl } from "@/lib/moderation/image-scan";
import { prepareUploadBytes } from "@/lib/media/upload-bytes";
import { normalizeDeckCover } from "@/lib/decks/cover-normalize";
import { isUserStorageConfigured, userFolder } from "@/lib/media/user-storage";
import {
  checkUploadRateLimit,
  uploadRateLimitFailure,
  type UploadLimitFields,
} from "@/lib/media/upload-rate-limit";

// ---------------------------------------------------------------------------
// Moderated upload for the `set-covers` bucket — deck covers, custom card
// set icons and the composer's article images (the bucket keeps its
// historical name; the sets feature itself was removed 2026-09-22). Mirrors lib/cards/upload-art-server.ts: the bytes are
// validated with Sharp (never the client-declared MIME), stored under the
// caller's own folder (service-role write, folder forced from the session —
// lib/media/user-storage.ts), then run through the same NSFW scan as card
// art. Until 2026-09-21 these went browser → storage with no scan at all — a
// deck cover is public the moment the deck is.
// ---------------------------------------------------------------------------

const MAX_BYTES = 5 * 1024 * 1024; // matches the bucket's file_size_limit
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

/** The longest side an article image is stored at (the article column is
 *  48rem; 1600 px covers it at 2× and keeps the LCP picture light). */
export const ARTICLE_IMAGE_MAX_PX = 1600;

export type UploadCoverServerResult =
  | {
      ok: true;
      publicUrl: string;
      path: string;
      /** The stored picture's size — an article sets width/height from it
       *  (no layout shift). */
      width: number | null;
      height: number | null;
    }
  | ({ ok: false; error: string } & UploadLimitFields);

export async function uploadCoverServerAction(
  formData: FormData,
): Promise<UploadCoverServerResult> {
  if (!isSupabaseConfigured() || !isUserStorageConfigured()) {
    return { ok: false, error: "Uploads aren't configured." };
  }
  const user = await getCurrentUser();
  if (!user) return { ok: false, error: "Sign in to upload an image." };
  // 30 a minute / 300 a day per user (lib/media/upload-rate-limit.ts).
  const limit = await checkUploadRateLimit(user.id);
  if (!limit.ok) return uploadRateLimitFailure(limit);

  const file = formData.get("file");
  if (!(file instanceof File)) return { ok: false, error: "No file received." };
  if (file.size > MAX_BYTES) {
    return { ok: false, error: "Image must be 5 MB or smaller." };
  }

  const buffer = Buffer.from(await file.arrayBuffer());
  let metadata: sharp.Metadata;
  try {
    metadata = await sharp(buffer).metadata();
  } catch {
    return { ok: false, error: "That doesn't look like an image." };
  }
  const format = metadata.format;
  if (!format || !ALLOWED_FORMATS.has(format)) {
    return { ok: false, error: "Only PNG, JPEG, WebP, and GIF images are allowed." };
  }

  // Upright pixels, no EXIF orientation tag (lib/media/orientation.ts): the
  // deck page shows a phone-photo cover upright, and so must its OG image
  // and a set icon's bake (TODO 3.14). No camera metadata either — a public
  // deck's cover is public (lib/media/upload-bytes.ts, TODO 3.14a).
  let stored: Buffer;
  try {
    stored = await prepareUploadBytes(buffer, metadata, { maxBytes: MAX_BYTES });
  } catch {
    return { ok: false, error: "That doesn't look like an image." };
  }

  // A DECK cover is stored as the cover standard (TODO DK6.5): 1600×900
  // WebP, cropped to 16:9 around the picture's most interesting region
  // (sharp's attention strategy) — the box every deck surface draws — from
  // the upright, metadata-free bytes above (sharp writes no metadata of its
  // own). A card's set icon keeps its own shape and format.
  let extension = EXTENSION_BY_FORMAT[format];
  let contentType = CONTENT_TYPE_BY_FORMAT[format];
  if (formData.get("purpose") === "deck-cover") {
    try {
      const normalized = await normalizeDeckCover(stored);
      stored = Buffer.from(normalized.bytes);
      extension = "webp";
      contentType = normalized.contentType;
    } catch {
      return { ok: false, error: "That doesn't look like an image." };
    }
  }

  // An ARTICLE image (the composer, /admin/articles): no larger than the
  // page draws it, as WebP — the same upright, metadata-free bytes.
  if (formData.get("purpose") === "article-image") {
    try {
      stored = await sharp(stored)
        .resize({ width: ARTICLE_IMAGE_MAX_PX, height: ARTICLE_IMAGE_MAX_PX, fit: "inside", withoutEnlargement: true })
        .webp({ quality: 82 })
        .toBuffer();
      extension = "webp";
      contentType = "image/webp";
    } catch {
      return { ok: false, error: "That doesn't look like an image." };
    }
  }

  let width: number | null = null;
  let height: number | null = null;
  try {
    const finalMeta = await sharp(stored).metadata();
    width = finalMeta.width ?? null;
    height = finalMeta.height ?? null;
  } catch {
    // The size is a nicety; the upload stands without it.
  }

  const name = `${crypto.randomUUID()}.${extension}`;
  const covers = userFolder("set-covers", user.id);
  const { error } = await covers.upload(name, stored, {
    cacheControl: "3600",
    contentType,
    upsert: false,
  });
  if (error) return { ok: false, error: error.message };

  const publicUrl = covers.publicUrl(name);

  // Fails open on a missing key / API error (a moderation hiccup never blocks
  // uploads); a positive flag removes the object and rejects the upload.
  const scan = await scanImageUrl(publicUrl);
  if (scan.flagged) {
    await covers.remove([name]);
    return {
      ok: false,
      error: "That image was flagged by our content filter and can't be uploaded.",
    };
  }

  return { ok: true, publicUrl, path: covers.path(name), width, height };
}
