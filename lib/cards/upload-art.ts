"use client";

// ---------------------------------------------------------------------------
// @deprecated as of Phase 11 chunk 14.
//
// This client-side uploader uploads the raw browser File directly to
// Supabase Storage. It only validates the declared MIME type, which a
// malicious client can spoof. New callers should use the server action
// in `lib/cards/upload-art-server.ts` instead — that path Sharp-validates
// the bytes before they land in storage.
//
// Kept here so any historic call sites still compile during the
// migration. Will be removed in a follow-up once the codebase has no
// remaining importers.
// ---------------------------------------------------------------------------

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
 *
 * The user id is derived from the Supabase session inside the function, NOT
 * accepted as an argument from the caller. This removes the "client passes
 * an id" foot-gun even though RLS already binds the upload to auth.uid() —
 * a caller can't accidentally (or maliciously) point uploads at someone
 * else's prefix.
 */
export async function uploadCardArt(file: File): Promise<UploadArtResult> {
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

  // Derive the owner from the actual session. If the user signed out in
  // another tab between mounting the uploader and dropping the file, we
  // bail with a friendly error instead of generating a path that RLS will
  // reject.
  const { data: userData, error: userError } = await supabase.auth.getUser();
  if (userError || !userData.user) {
    return { ok: false, error: "Sign in to upload artwork." };
  }
  const userId = userData.user.id;

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
