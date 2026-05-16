"use server";

import "server-only";

import sharp from "sharp";
import { createClient, getCurrentUser } from "@/lib/supabase/server";
import { isSupabaseConfigured } from "@/lib/supabase/env";

// ---------------------------------------------------------------------------
// Server-side card-art upload (Phase 11 chunk 14 — M1 hardening).
//
// Replaces the client-side `lib/cards/upload-art.ts` for trusted uploads.
// The browser still ships the bytes, but VALIDATION happens server-side:
//
//   1. Auth gate via the user's session.
//   2. Size check (8 MB) against the actual blob, not the declared length.
//   3. Sharp decodes the first bytes — throws on non-images.
//   4. Format whitelist: png / jpeg / webp / gif. Anything else (incl.
//      svg, avif, heif, tiff) is rejected.
//   5. Storage upload via the user's Supabase session — RLS still binds
//      the destination to `card-art/{userId}/...`.
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
 * the bytes via Sharp, uploads to `card-art/{userId}/...` via the user's
 * Supabase session, and returns the public URL.
 */
export async function uploadCardArtServerAction(
  formData: FormData,
): Promise<UploadArtServerResult> {
  if (!isSupabaseConfigured()) {
    return { ok: false, error: "Supabase is not configured." };
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

  // Storage upload. The same `card-art/{userId}/{uuid}.{ext}` layout as
  // the client-side path, so the bucket's RLS write policy
  // (`auth.uid()::text = (storage.foldername(name))[1]`) continues to
  // gate writes.
  const ext = EXTENSION_BY_FORMAT[format] ?? "bin";
  const id =
    typeof crypto !== "undefined" && "randomUUID" in crypto
      ? crypto.randomUUID()
      : `${Date.now()}-${Math.random().toString(36).slice(2, 10)}`;
  const path = `${user.id}/${id}.${ext}`;

  const supabase = await createClient();
  const { error } = await supabase.storage
    .from("card-art")
    .upload(path, buffer, {
      cacheControl: "3600",
      // Use Sharp's detected MIME, not the client-declared one, so the
      // stored object's Content-Type reflects reality.
      contentType: CONTENT_TYPE_BY_FORMAT[format] ?? "application/octet-stream",
      upsert: false,
    });

  if (error) {
    return { ok: false, error: error.message };
  }

  const { data } = supabase.storage.from("card-art").getPublicUrl(path);
  return { ok: true, publicUrl: data.publicUrl, path };
}
