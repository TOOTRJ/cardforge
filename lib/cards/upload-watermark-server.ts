"use server";

import "server-only";

import { randomUUID } from "node:crypto";
import sharp from "sharp";
import { getCurrentUser } from "@/lib/supabase/server";
import { isSupabaseConfigured } from "@/lib/supabase/env";
import { scanImageUrl } from "@/lib/moderation/image-scan";
import { prepareUploadBytes } from "@/lib/media/upload-bytes";
import { isUserStorageConfigured, userFolder } from "@/lib/media/user-storage";
import {
  checkUploadRateLimit,
  uploadRateLimitFailure,
  type UploadLimitFields,
} from "@/lib/media/upload-rate-limit";

// ---------------------------------------------------------------------------
// Custom design-watermark upload — a near-copy of upload-art-server.ts with
// a tighter contract: 2 MB cap and transparency-capable formats only
// (png / webp), since a watermark without an alpha channel would stamp an
// opaque rectangle over the rules box. Stored in the existing card-art
// bucket under the caller's folder (written with the service role, the
// folder forced from the session — lib/media/user-storage.ts); the bake
// fetches the public URL like art.
// ---------------------------------------------------------------------------

const MAX_BYTES = 2 * 1024 * 1024;
const ALLOWED_FORMATS = new Set(["png", "webp"]);
const ALLOWED_DECLARED_MIME_TYPES = new Set(["image/png", "image/webp"]);

export type UploadWatermarkResult =
  | { ok: true; publicUrl: string }
  | ({ ok: false; error: string } & UploadLimitFields);

export async function uploadWatermarkServerAction(
  formData: FormData,
): Promise<UploadWatermarkResult> {
  if (!isSupabaseConfigured()) {
    return { ok: false, error: "Supabase is not configured." };
  }
  if (!isUserStorageConfigured()) {
    return { ok: false, error: "Uploads aren't available right now." };
  }
  const user = await getCurrentUser();
  if (!user) {
    return { ok: false, error: "Sign in to upload a watermark." };
  }
  // 30 a minute / 300 a day per user (lib/media/upload-rate-limit.ts).
  const limit = await checkUploadRateLimit(user.id);
  if (!limit.ok) return uploadRateLimitFailure(limit);

  const file = formData.get("file");
  if (!(file instanceof File)) {
    return { ok: false, error: "No file uploaded." };
  }
  if (file.type && !ALLOWED_DECLARED_MIME_TYPES.has(file.type)) {
    return {
      ok: false,
      error: "Watermarks must be PNG or WebP (transparency required).",
    };
  }
  if (file.size === 0) return { ok: false, error: "Empty file." };
  if (file.size > MAX_BYTES) {
    return { ok: false, error: "Watermark images must be 2 MB or smaller." };
  }

  const buffer = Buffer.from(await file.arrayBuffer());

  // Byte sniff — Sharp throws on anything that isn't a real raster image
  // (SVG rejected by default), and the format whitelist rejects opaque-only
  // containers regardless of the declared Content-Type.
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
      error: "Watermarks must be PNG or WebP (transparency required).",
    };
  }

  // Upright pixels, no EXIF orientation tag (lib/media/orientation.ts) —
  // Chrome obeys a PNG's tag and ignores a WebP's, the bake used to ignore
  // both; with the tag gone every viewer and the bake agree (TODO 3.14) —
  // and no camera metadata (lib/media/upload-bytes.ts, TODO 3.14a).
  let stored: Buffer;
  try {
    stored = await prepareUploadBytes(buffer, metadata, { maxBytes: MAX_BYTES });
  } catch {
    return { ok: false, error: "That doesn't look like a valid image." };
  }

  const ext = format === "webp" ? "webp" : "png";
  const name = `wm-${randomUUID()}.${ext}`;
  const art = userFolder("card-art", user.id);

  const { error: uploadError } = await art.upload(name, stored, {
    cacheControl: "31536000",
    contentType: `image/${ext}`,
    upsert: false,
  });
  if (uploadError) {
    return { ok: false, error: uploadError.message };
  }

  const publicUrl = art.publicUrl(name);

  // NSFW auto-scan — fails open (a moderation hiccup never blocks uploads);
  // a positive flag removes the object and rejects.
  const scan = await scanImageUrl(publicUrl);
  if (scan.flagged) {
    await art.remove([name]);
    return {
      ok: false,
      error: "That image was flagged by our content filter and can't be used.",
    };
  }

  return { ok: true, publicUrl };
}
