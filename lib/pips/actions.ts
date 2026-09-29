"use server";

import "server-only";

import sharp from "sharp";
import { createClient, getCurrentUser } from "@/lib/supabase/server";
import { isSupabaseConfigured } from "@/lib/supabase/env";
import { scanImageUrl } from "@/lib/moderation/image-scan";
import { isUserStorageConfigured, userFolder } from "@/lib/media/user-storage";
import {
  checkUploadRateLimit,
  uploadRateLimitFailure,
  type UploadLimitFields,
} from "@/lib/media/upload-rate-limit";
import { deleteCustomPipRow, finishPipChange, removeCustomPipObject } from "@/lib/pips/remove-pip";
import {
  isCustomPipSymbol,
  type CustomPipSymbol,
} from "@/lib/pips/override";

// ---------------------------------------------------------------------------
// Custom pip writes — upload/replace and remove a per-user pip icon.
//
// Upload hardening mirrors lib/cards/upload-art-server.ts: auth gate, size
// cap, Sharp byte-sniff (rejects SVG and non-images), then the bytes are
// NORMALIZED to a 256×256 PNG (cover crop, transparency preserved) so every
// stored pip is a uniform square the renderers can trust.
//
// Storage path is deterministic — custom-pips/{userId}/{symbol}.png with
// upsert — so replacing a pip never orphans objects; the row's image_url
// carries a ?v= cache-buster so CDNs pick up replacements. Objects are
// written and removed with the service role, only inside the signed-in
// user's folder (lib/media/user-storage.ts; no user write policy since 0126).
// ---------------------------------------------------------------------------

const MAX_BYTES = 4 * 1024 * 1024;
const PIP_SIZE = 256;

const ALLOWED_DECLARED_MIME_TYPES = new Set([
  "image/png",
  "image/jpeg",
  "image/webp",
]);

export type CustomPipActionResult =
  | { ok: true; symbol: CustomPipSymbol; imageUrl: string | null }
  | ({ ok: false; error: string } & UploadLimitFields);

export async function saveCustomPipAction(
  formData: FormData,
): Promise<CustomPipActionResult> {
  if (!isSupabaseConfigured()) {
    return { ok: false, error: "Supabase is not configured." };
  }
  if (!isUserStorageConfigured()) {
    return { ok: false, error: "Uploads aren't available right now." };
  }

  const user = await getCurrentUser();
  if (!user) {
    return { ok: false, error: "Sign in to customize pips." };
  }
  // 30 a minute / 300 a day per user (lib/media/upload-rate-limit.ts) — one
  // pip is one upload, however many objects it stages.
  const limit = await checkUploadRateLimit(user.id);
  if (!limit.ok) return uploadRateLimitFailure(limit);

  const symbolRaw = formData.get("symbol");
  if (typeof symbolRaw !== "string" || !isCustomPipSymbol(symbolRaw)) {
    return { ok: false, error: "Unknown pip symbol." };
  }
  const symbol = symbolRaw;

  const file = formData.get("file");
  if (!(file instanceof File)) {
    return { ok: false, error: "No file uploaded." };
  }
  if (file.type && !ALLOWED_DECLARED_MIME_TYPES.has(file.type)) {
    return { ok: false, error: "Only PNG, JPEG, and WebP images are allowed." };
  }
  if (file.size === 0) {
    return { ok: false, error: "Empty file." };
  }
  if (file.size > MAX_BYTES) {
    return { ok: false, error: "Image must be 4 MB or smaller." };
  }

  const buffer = Buffer.from(await file.arrayBuffer());

  // Byte sniff + normalize in one pass. Sharp throws on anything that isn't
  // a recognized raster image (SVG rejected by default). Auto-orient first
  // (EXIF, TODO 3.14): the PNG we write carries no tag, so a phone photo
  // would otherwise be stored sideways for good. Cover-crop to a square so
  // off-square uploads still fill the pip circle.
  let pngBytes: Buffer;
  try {
    pngBytes = await sharp(buffer)
      .autoOrient()
      .resize(PIP_SIZE, PIP_SIZE, { fit: "cover" })
      .png()
      .toBuffer();
  } catch {
    return { ok: false, error: "That doesn't look like a valid image." };
  }

  const name = `${symbol}.png`;
  const pips = userFolder("custom-pips", user.id);
  const supabase = await createClient();

  // Moderate BEFORE touching the canonical object. The canonical path is
  // deterministic and overwritten in place, so scanning after the upsert
  // meant a flagged image had already replaced the owner's approved pip —
  // and the rejection then deleted that object while the custom_pips row
  // kept pointing at it. Stage the bytes under a pending name, scan THAT
  // (versioned, so a cached copy of an older pending upload can't answer
  // for the new bytes), and only then write the real object.
  const pendingName = `${symbol}.pending.png`;
  const { error: stageError } = await pips.upload(pendingName, pngBytes, {
    cacheControl: "0",
    contentType: "image/png",
    upsert: true,
  });
  if (stageError) {
    return { ok: false, error: stageError.message };
  }
  const pendingUrl = `${pips.publicUrl(pendingName)}?v=${Date.now()}`;

  // NSFW auto-scan — fails open (a moderation hiccup never blocks uploads);
  // a positive flag drops the staged bytes and leaves the current pip alone.
  const scan = await scanImageUrl(pendingUrl);
  if (scan.flagged) {
    await pips.remove([pendingName]);
    return {
      ok: false,
      error: "That image was flagged by our content filter and can't be used.",
    };
  }

  const { error: uploadError } = await pips.upload(name, pngBytes, {
    cacheControl: "3600",
    contentType: "image/png",
    upsert: true,
  });
  await pips.remove([pendingName]);
  if (uploadError) {
    return { ok: false, error: uploadError.message };
  }

  // Deterministic path + upsert means CDNs may hold the previous bytes —
  // version the URL the same way bake-render.ts versions card renders.
  const imageUrl = `${pips.publicUrl(name)}?v=${Date.now()}`;

  const { error: upsertError } = await supabase
    .from("custom_pips")
    .upsert(
      { owner_id: user.id, symbol, image_url: imageUrl },
      { onConflict: "owner_id,symbol" },
    );
  if (upsertError) {
    return { ok: false, error: upsertError.message };
  }

  finishPipChange(user.id, symbol);
  return { ok: true, symbol, imageUrl };
}

export async function deleteCustomPipAction(
  symbolRaw: string,
): Promise<CustomPipActionResult> {
  if (!isSupabaseConfigured()) {
    return { ok: false, error: "Supabase is not configured." };
  }

  const user = await getCurrentUser();
  if (!user) {
    return { ok: false, error: "Sign in to customize pips." };
  }
  if (!isCustomPipSymbol(symbolRaw)) {
    return { ok: false, error: "Unknown pip symbol." };
  }
  const symbol = symbolRaw;

  // The shared remove (lib/pips/remove-pip.ts — the flagged-file rescan
  // removes a pip the same way): the row, then the object, then the caches
  // and the re-bake of the owner's cards that draw it.
  const supabase = await createClient();
  const { error } = await deleteCustomPipRow(supabase, user.id, symbol);
  if (error) {
    return { ok: false, error };
  }
  await removeCustomPipObject(user.id, symbol);

  finishPipChange(user.id, symbol);
  return { ok: true, symbol, imageUrl: null };
}
