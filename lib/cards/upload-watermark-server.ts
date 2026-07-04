"use server";

import "server-only";

import { randomUUID } from "node:crypto";
import sharp from "sharp";
import { createClient, getCurrentUser } from "@/lib/supabase/server";
import { isSupabaseConfigured } from "@/lib/supabase/env";
import { scanImageUrl } from "@/lib/moderation/image-scan";

// ---------------------------------------------------------------------------
// Custom design-watermark upload — a near-copy of upload-art-server.ts with
// a tighter contract: 2 MB cap and transparency-capable formats only
// (png / webp), since a watermark without an alpha channel would stamp an
// opaque rectangle over the rules box. Stored in the existing card-art
// bucket under the caller's folder (same RLS ownership policy); the bake
// fetches the public URL like art.
// ---------------------------------------------------------------------------

const MAX_BYTES = 2 * 1024 * 1024;
const ALLOWED_FORMATS = new Set(["png", "webp"]);
const ALLOWED_DECLARED_MIME_TYPES = new Set(["image/png", "image/webp"]);

export type UploadWatermarkResult =
  | { ok: true; publicUrl: string }
  | { ok: false; error: string };

export async function uploadWatermarkServerAction(
  formData: FormData,
): Promise<UploadWatermarkResult> {
  if (!isSupabaseConfigured()) {
    return { ok: false, error: "Supabase is not configured." };
  }
  const user = await getCurrentUser();
  if (!user) {
    return { ok: false, error: "Sign in to upload a watermark." };
  }

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
  let format: string | undefined;
  try {
    format = (await sharp(buffer).metadata()).format;
  } catch {
    return { ok: false, error: "That doesn't look like a valid image." };
  }
  if (!format || !ALLOWED_FORMATS.has(format)) {
    return {
      ok: false,
      error: "Watermarks must be PNG or WebP (transparency required).",
    };
  }

  const ext = format === "webp" ? "webp" : "png";
  const objectPath = `${user.id}/wm-${randomUUID()}.${ext}`;
  const supabase = await createClient();

  const { error: uploadError } = await supabase.storage
    .from("card-art")
    .upload(objectPath, buffer, {
      cacheControl: "31536000",
      contentType: `image/${ext}`,
      upsert: false,
    });
  if (uploadError) {
    return { ok: false, error: uploadError.message };
  }

  const { data: urlData } = supabase.storage
    .from("card-art")
    .getPublicUrl(objectPath);

  // NSFW auto-scan — fails open (a moderation hiccup never blocks uploads);
  // a positive flag removes the object and rejects.
  const scan = await scanImageUrl(urlData.publicUrl);
  if (scan.flagged) {
    await supabase.storage.from("card-art").remove([objectPath]);
    return {
      ok: false,
      error: "That image was flagged by our content filter and can't be used.",
    };
  }

  return { ok: true, publicUrl: urlData.publicUrl };
}
