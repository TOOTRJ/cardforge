"use client";

import { createClient } from "@/lib/supabase/client";

const ALLOWED_MIME_TYPES = [
  "image/png",
  "image/jpeg",
  "image/webp",
  "image/gif",
] as const;
const MAX_BYTES = 5 * 1024 * 1024; // 5 MB — matches the set-covers bucket cap.

export type UploadCoverResult =
  | { ok: true; publicUrl: string; path: string }
  | { ok: false; error: string };

function extensionFromMime(mime: string): string {
  switch (mime) {
    case "image/png":
      return "png";
    case "image/jpeg":
      return "jpg";
    case "image/webp":
      return "webp";
    case "image/gif":
      return "gif";
    default:
      return "bin";
  }
}

/**
 * Upload a set-cover image to the public `set-covers` bucket.
 *
 * Path layout: `set-covers/{userId}/{uuid}.{ext}` — matches the storage RLS
 * policy that requires `auth.uid()::text = (storage.foldername(name))[1]`.
 */
export async function uploadSetCover(
  userId: string,
  file: File,
): Promise<UploadCoverResult> {
  if (
    !ALLOWED_MIME_TYPES.includes(
      file.type as (typeof ALLOWED_MIME_TYPES)[number],
    )
  ) {
    return {
      ok: false,
      error: "Only PNG, JPEG, WebP, and GIF images are allowed.",
    };
  }
  if (file.size > MAX_BYTES) {
    return {
      ok: false,
      error: "Cover image must be 5 MB or smaller.",
    };
  }

  const supabase = createClient();
  const ext = extensionFromMime(file.type);
  const id =
    typeof crypto !== "undefined" && "randomUUID" in crypto
      ? crypto.randomUUID()
      : `${Date.now()}-${Math.random().toString(36).slice(2, 10)}`;
  const path = `${userId}/${id}.${ext}`;

  const { error } = await supabase.storage
    .from("set-covers")
    .upload(path, file, {
      cacheControl: "3600",
      contentType: file.type,
      upsert: false,
    });

  if (error) {
    return { ok: false, error: error.message };
  }

  const { data } = supabase.storage.from("set-covers").getPublicUrl(path);
  return { ok: true, publicUrl: data.publicUrl, path };
}
