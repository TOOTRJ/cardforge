"use server";

import "server-only";

import { after } from "next/server";
import { revalidatePath } from "next/cache";
import sharp from "sharp";
import { createClient, getCurrentUser } from "@/lib/supabase/server";
import { isSupabaseConfigured } from "@/lib/supabase/env";
import { scanImageUrl } from "@/lib/moderation/image-scan";
import { bakeAndPersistCardRender } from "@/lib/cards/bake-render";
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
// carries a ?v= cache-buster so CDNs pick up replacements.
// ---------------------------------------------------------------------------

const MAX_BYTES = 4 * 1024 * 1024;
const PIP_SIZE = 256;

const ALLOWED_DECLARED_MIME_TYPES = new Set([
  "image/png",
  "image/jpeg",
  "image/webp",
]);

// How many of the owner's affected baked thumbnails the post-response sweep
// refreshes, newest first. Detail pages and exports always render live; a
// long tail of very old gallery thumbnails catches up on next save or via
// scripts/rebake-renders.mjs.
const REBAKE_SWEEP_CAP = 40;

export type CustomPipActionResult =
  | { ok: true; symbol: CustomPipSymbol; imageUrl: string | null }
  | { ok: false; error: string };

export async function saveCustomPipAction(
  formData: FormData,
): Promise<CustomPipActionResult> {
  if (!isSupabaseConfigured()) {
    return { ok: false, error: "Supabase is not configured." };
  }

  const user = await getCurrentUser();
  if (!user) {
    return { ok: false, error: "Sign in to customize pips." };
  }

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
  // a recognized raster image (SVG rejected by default). Cover-crop to a
  // square so off-square uploads still fill the pip circle.
  let pngBytes: Buffer;
  try {
    pngBytes = await sharp(buffer)
      .resize(PIP_SIZE, PIP_SIZE, { fit: "cover" })
      .png()
      .toBuffer();
  } catch {
    return { ok: false, error: "That doesn't look like a valid image." };
  }

  const path = `${user.id}/${symbol}.png`;
  const supabase = await createClient();

  const { error: uploadError } = await supabase.storage
    .from("custom-pips")
    .upload(path, pngBytes, {
      cacheControl: "3600",
      contentType: "image/png",
      upsert: true,
    });
  if (uploadError) {
    return { ok: false, error: uploadError.message };
  }

  const { data: urlData } = supabase.storage
    .from("custom-pips")
    .getPublicUrl(path);
  // Deterministic path + upsert means CDNs may hold the previous bytes —
  // version the URL the same way bake-render.ts versions card renders.
  const imageUrl = `${urlData.publicUrl}?v=${Date.now()}`;

  // NSFW auto-scan — fails open (a moderation hiccup never blocks uploads);
  // a positive flag removes the object and rejects.
  const scan = await scanImageUrl(urlData.publicUrl);
  if (scan.flagged) {
    await supabase.storage.from("custom-pips").remove([path]);
    return {
      ok: false,
      error: "That image was flagged by our content filter and can't be used.",
    };
  }

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

  const supabase = await createClient();
  const { error } = await supabase
    .from("custom_pips")
    .delete()
    .eq("owner_id", user.id)
    .eq("symbol", symbol);
  if (error) {
    return { ok: false, error: error.message };
  }

  // Best-effort object cleanup — the row is the source of truth, so a
  // failed remove only leaves an unreferenced file behind.
  await supabase.storage
    .from("custom-pips")
    .remove([`${user.id}/${symbol}.png`])
    .catch(() => {});

  finishPipChange(user.id, symbol);
  return { ok: true, symbol, imageUrl: null };
}

// ---------------------------------------------------------------------------
// Shared post-change plumbing: refresh the RSC caches that feed overrides to
// the editor/preview, then sweep the owner's affected baked thumbnails AFTER
// the response is sent (next/server `after`) so the upload click stays fast.
// ---------------------------------------------------------------------------

function finishPipChange(ownerId: string, symbol: CustomPipSymbol) {
  revalidatePath("/create");
  revalidatePath("/dashboard");
  revalidatePath("/settings");

  after(async () => {
    try {
      await rebakeCardsUsingSymbol(ownerId, symbol);
    } catch (error) {
      console.error("[custom-pips] rebake sweep failed", error);
    }
  });
}

/**
 * Re-bake the owner's most recently updated cards whose front or back cost
 * uses the changed symbol as a pure color pip. Capped + best-effort: a
 * failure on one card never blocks the rest (bakeAndPersistCardRender
 * already swallows per-card render errors).
 */
async function rebakeCardsUsingSymbol(
  ownerId: string,
  symbol: CustomPipSymbol,
): Promise<void> {
  const supabase = await createClient();
  const { data, error } = await supabase
    .from("cards")
    .select("id, cost, back_face")
    .eq("owner_id", ownerId)
    .order("updated_at", { ascending: false })
    .limit(400);
  if (error || !data) return;

  const token = `{${symbol}}`;
  const affected = data
    .filter((row) => {
      if (row.cost?.includes(token)) return true;
      const backCost = (row.back_face as { cost?: string } | null)?.cost;
      return typeof backCost === "string" && backCost.includes(token);
    })
    .slice(0, REBAKE_SWEEP_CAP);

  for (const row of affected) {
    await bakeAndPersistCardRender(row.id, ownerId);
  }
}
