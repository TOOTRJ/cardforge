"use server";

import "server-only";

import sharp from "sharp";
import { createClient, getCurrentUser } from "@/lib/supabase/server";
import { isSupabaseConfigured } from "@/lib/supabase/env";
import { scanImageUrl } from "@/lib/moderation/image-scan";

// ---------------------------------------------------------------------------
// Moderated upload for the `set-covers` bucket — deck covers and custom card
// set icons (the bucket keeps its historical name; the sets feature itself was
// removed 2026-09-22). Mirrors lib/cards/upload-art-server.ts: the bytes are
// validated with Sharp (never the client-declared MIME), stored under the
// caller's own folder (the bucket RLS demands it), then run through the same
// NSFW scan as card art. Until 2026-09-21 these went browser → storage with
// no scan at all — a deck cover is public the moment the deck is.
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

export type UploadCoverServerResult =
  | { ok: true; publicUrl: string; path: string }
  | { ok: false; error: string };

export async function uploadCoverServerAction(
  formData: FormData,
): Promise<UploadCoverServerResult> {
  if (!isSupabaseConfigured()) {
    return { ok: false, error: "Uploads aren't configured." };
  }
  const user = await getCurrentUser();
  if (!user) return { ok: false, error: "Sign in to upload an image." };

  const file = formData.get("file");
  if (!(file instanceof File)) return { ok: false, error: "No file received." };
  if (file.size > MAX_BYTES) {
    return { ok: false, error: "Image must be 5 MB or smaller." };
  }

  const buffer = Buffer.from(await file.arrayBuffer());
  let format: string | undefined;
  try {
    format = (await sharp(buffer).metadata()).format;
  } catch {
    return { ok: false, error: "That doesn't look like an image." };
  }
  if (!format || !ALLOWED_FORMATS.has(format)) {
    return { ok: false, error: "Only PNG, JPEG, WebP, and GIF images are allowed." };
  }

  const path = `${user.id}/${crypto.randomUUID()}.${EXTENSION_BY_FORMAT[format]}`;
  const supabase = await createClient();
  const { error } = await supabase.storage.from("set-covers").upload(path, buffer, {
    cacheControl: "3600",
    contentType: CONTENT_TYPE_BY_FORMAT[format],
    upsert: false,
  });
  if (error) return { ok: false, error: error.message };

  const { data } = supabase.storage.from("set-covers").getPublicUrl(path);

  // Fails open on a missing key / API error (a moderation hiccup never blocks
  // uploads); a positive flag removes the object and rejects the upload.
  const scan = await scanImageUrl(data.publicUrl);
  if (scan.flagged) {
    await supabase.storage.from("set-covers").remove([path]);
    return {
      ok: false,
      error: "That image was flagged by our content filter and can't be uploaded.",
    };
  }

  return { ok: true, publicUrl: data.publicUrl, path };
}
