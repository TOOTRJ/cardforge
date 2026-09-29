"use server";

import "server-only";

import sharp from "sharp";
import { getCurrentUser } from "@/lib/supabase/server";
import { isSupabaseConfigured } from "@/lib/supabase/env";
import { scanImageUrl } from "@/lib/moderation/image-scan";
import { prepareUploadBytes } from "@/lib/media/upload-bytes";
import { isUserStorageConfigured, userFolder } from "@/lib/media/user-storage";
import { randomId } from "@/lib/ids";

// ---------------------------------------------------------------------------
// Server-side card-art upload (Phase 11 chunk 14 — M1 hardening).
//
// Replaced the old client-side upload path (`lib/cards/upload-art.ts`,
// since removed) for trusted uploads. The browser still ships the bytes,
// but VALIDATION happens server-side:
//
//   1. Auth gate via the user's session.
//   2. Size check (8 MB) against the actual blob, not the declared length.
//   3. Sharp decodes the first bytes — throws on non-images.
//   4. Format whitelist: png / jpeg / webp / gif. Anything else (incl.
//      svg, avif, heif, tiff) is rejected.
//   5. EXIF orientation normalized (lib/media/orientation.ts): a phone
//      photo tagged "turn me" is stored as upright pixels with no tag, so
//      the bake draws what the creator showed (TODO 3.14) — and camera
//      metadata (EXIF incl. GPS, XMP, IPTC…) stripped without touching the
//      pixels (lib/media/upload-bytes.ts, TODO 3.14a).
//   6. Storage upload with the service role into `card-art/{userId}/...`,
//      the folder forced from the session's user id (lib/media/user-
//      storage.ts). Users hold no storage write policy since migration
//      0126, so this action — strip + scan included — is the only way in.
//
// Why this matters: the bucket policy validates the DECLARED Content-Type
// header, not the file bytes. Before this server-side check, a client
// could upload a non-image blob under `Content-Type: image/png`. Sharp
// reads the actual bytes and rejects anything that doesn't decode as a
// raster image.
// ---------------------------------------------------------------------------

const MAX_BYTES = 8 * 1024 * 1024;

const ALLOWED_FORMATS = new Set(["png", "jpeg", "webp", "gif"]);

const ALLOWED_DECLARED_MIME_TYPES = new Set([
  "image/png",
  "image/jpeg",
  "image/webp",
  "image/gif",
]);

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

export type UploadArtServerResult =
  | { ok: true; publicUrl: string; path: string }
  | { ok: false; error: string };

/**
 * Server action — accepts a FormData with a single `file` field, validates
 * the bytes via Sharp, uploads to `card-art/{userId}/...` with the service
 * role (the folder forced from the session), and returns the public URL.
 */
export async function uploadCardArtServerAction(
  formData: FormData,
): Promise<UploadArtServerResult> {
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

  const file = formData.get("file");
  if (!(file instanceof File)) {
    return { ok: false, error: "No file uploaded." };
  }

  // Declared Content-Type is a hint, not the truth — but obvious mismatches
  // (e.g. application/octet-stream) are worth a cheap up-front rejection
  // before we burn CPU on Sharp.
  if (file.type && !ALLOWED_DECLARED_MIME_TYPES.has(file.type)) {
    return {
      ok: false,
      error: "Only PNG, JPEG, WebP, and GIF images are allowed.",
    };
  }

  if (file.size === 0) {
    return { ok: false, error: "Empty file." };
  }
  if (file.size > MAX_BYTES) {
    return { ok: false, error: "Image must be 8 MB or smaller." };
  }

  // Read the bytes once. We hand the same Buffer to Sharp for validation
  // and to Supabase Storage for upload — no double-read of the request.
  const arrayBuffer = await file.arrayBuffer();
  const buffer = Buffer.from(arrayBuffer);

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
    return {
      ok: false,
      error: "Only PNG, JPEG, WebP, and GIF images are allowed.",
    };
  }

  // Store upright pixels with no camera metadata: same format, the
  // orientation tag applied and dropped, EXIF/GPS/XMP removed losslessly
  // (untouched bytes when there is nothing to turn or remove).
  let stored: Buffer;
  try {
    stored = await prepareUploadBytes(buffer, metadata, { maxBytes: MAX_BYTES });
  } catch {
    return { ok: false, error: "That doesn't look like a valid image." };
  }

  // Storage upload: `card-art/{userId}/{uuid}.{ext}`, written with the
  // service role into the folder of the user this action authenticated.
  const ext = EXTENSION_BY_FORMAT[format] ?? "bin";
  const name = `${randomId()}.${ext}`;
  const art = userFolder("card-art", user.id);

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
  // removes the just-uploaded object and rejects the upload.
  const scan = await scanImageUrl(publicUrl);
  if (scan.flagged) {
    await art.remove([name]);
    return {
      ok: false,
      error: "That image was flagged by our content filter and can't be uploaded.",
    };
  }

  return { ok: true, publicUrl, path: art.path(name) };
}
