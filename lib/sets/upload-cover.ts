"use client";

import { uploadCoverServerAction } from "@/lib/sets/upload-cover-server";

// Client entry point for deck / set cover and set-icon uploads. The upload
// itself runs server-side (lib/sets/upload-cover-server.ts) so every image
// passes the moderation scan; this wrapper only gives instant feedback on the
// obvious rejections before the bytes leave the browser.

const ALLOWED_MIME_TYPES = new Set([
  "image/png",
  "image/jpeg",
  "image/webp",
  "image/gif",
]);
const MAX_BYTES = 5 * 1024 * 1024; // 5 MB — matches the set-covers bucket cap.

export type UploadCoverResult =
  | { ok: true; publicUrl: string; path: string }
  | { ok: false; error: string };

/**
 * Upload an image to the public `set-covers` bucket under the signed-in
 * user's folder. `_userId` is kept for call-site compatibility; the server
 * derives the owner from the session, never from the argument.
 */
export async function uploadSetCover(
  _userId: string,
  file: File,
): Promise<UploadCoverResult> {
  if (!ALLOWED_MIME_TYPES.has(file.type)) {
    return { ok: false, error: "Only PNG, JPEG, WebP, and GIF images are allowed." };
  }
  if (file.size > MAX_BYTES) {
    return { ok: false, error: "Cover image must be 5 MB or smaller." };
  }
  const formData = new FormData();
  formData.append("file", file);
  return uploadCoverServerAction(formData);
}
