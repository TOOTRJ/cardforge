"use client";

import { createClient } from "@/lib/supabase/client";

const ALLOWED_MIME_TYPES = [
  "image/png",
  "image/jpeg",
  "image/webp",
  "image/gif",
] as const;
const MAX_BYTES = 8 * 1024 * 1024; // 8 MB — matches the bucket's file_size_limit.

export type UploadArtResult =
  | {
      ok: true;
      publicUrl: string;
      path: string;
    }
  | {
      ok: false;
      error: string;
    };

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
 * Upload a card-art file to the public `card-art` bucket.
 *
 * Path layout: `card-art/{userId}/{uuid}.{ext}` — matches the storage RLS
 * policy that requires `auth.uid()::text = (storage.foldername(name))[1]`.
 *
 * The bucket is public-read (no SELECT policy needed) so the returned
 * `publicUrl` works in any browser without a signed link.
 */
export async function uploadCardArt(
  userId: string,
  file: File,
): Promise<UploadArtResult> {
  if (!ALLOWED_MIME_TYPES.includes(file.type as (typeof ALLOWED_MIME_TYPES)[number])) {
    return {
      ok: false,
      error: "Only PNG, JPEG, WebP, and GIF images are allowed.",
    };
  }
  if (file.size > MAX_BYTES) {
    return {
      ok: false,
      error: "Image must be 8 MB or smaller.",
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
    .from("card-art")
    .upload(path, file, {
      cacheControl: "3600",
      contentType: file.type,
      upsert: false,
    });

  if (error) {
    return { ok: false, error: error.message };
  }

  const { data } = supabase.storage.from("card-art").getPublicUrl(path);
  return { ok: true, publicUrl: data.publicUrl, path };
}
