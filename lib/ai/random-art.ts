import "server-only";

import { getCurrentUser } from "@/lib/supabase/server";
import { isSupabaseConfigured } from "@/lib/supabase/env";
import { isUserStorageConfigured, userFolder } from "@/lib/media/user-storage";
import { randomId } from "@/lib/ids";
import { AI_FAILURE_COPY, ART_NUDITY_BLOCKED_COPY } from "@/lib/ai/failure";
import { scanImageUrl } from "@/lib/moderation/image-scan";
import { AI_ART_BLOCKED_CATEGORIES } from "@/lib/moderation/image-scan-core";

// ---------------------------------------------------------------------------
// Generated-art persistence.
//
// Image GENERATION lives in lib/ai/image-gen.ts and goes exclusively through
// the AI Gateway (FLUX / Gemini) — there is no direct-OpenAI path anywhere in
// the app. This module owns the shared UPLOAD step — take the bytes an image
// model returned and store them in the signed-in user's card-art bucket
// folder so the public URL sits on our CDN origin — and the NUDITY SCAN every
// stored AI picture passes (owner 2026-10-28).
// ---------------------------------------------------------------------------

export type PersistArtResult =
  | { ok: true; publicUrl: string }
  | {
      ok: false;
      /** The user's sentence (no credit words: the step adds those). */
      error: string;
      /** `art_blocked`: the nudity scan flagged the picture (it was removed);
       *  `art_store`: it couldn't be stored (or storage isn't set up). */
      failure: "art_blocked" | "art_store";
    };

/** How long the nudity scan may hold a step: omni-moderation answers in a
 *  second or two; past this the picture is kept (fail open), so the step's
 *  180 s function keeps room after a picture that took the whole 150 s
 *  image budget (lib/ai/image-gen.ts IMAGE_BUDGET_MS). */
export const AI_ART_SCAN_TIMEOUT_MS = 10_000;

/**
 * Upload generated image bytes to the signed-in user's `card-art` folder,
 * then scan the stored picture for nudity. Shared by EVERY AI art flow (the
 * per-field fill and its double-faced back, the card job, deck generation,
 * the deck remix's restyle and fresh pictures, the deck cover), so none can
 * skip the scan. Written with the service role into the folder of the user
 * this call authenticated (lib/media/user-storage.ts — users hold no storage
 * write policy since migration 0126), with the same layout as the
 * human-upload flow.
 *
 * The scan (owner 2026-10-28; it replaces the 2026-07-10 decision to scan
 * no AI art): omni-moderation with the SEXUAL categories alone
 * (AI_ART_BLOCKED_CATEGORIES — the old full list flagged benign fantasy
 * violence). Flagged → the object is removed and the call fails
 * `art_blocked`; the step's credit wrapper refunds it once. FAILS OPEN, as
 * the uploads' scan does: no key, an error or a timeout keeps the picture
 * (logged).
 */
export async function persistGeneratedArt(
  bytes: Uint8Array,
  contentType: string,
): Promise<PersistArtResult> {
  const storeFailed = (): PersistArtResult => ({ ok: false, error: AI_FAILURE_COPY.art_store, failure: "art_store" });
  if (!isSupabaseConfigured() || !isUserStorageConfigured()) {
    console.error("[ai:art] storing generated art failed: Supabase isn't configured.");
    return storeFailed();
  }
  const user = await getCurrentUser();
  if (!user) {
    console.error("[ai:art] storing generated art failed: no signed-in user.");
    return storeFailed();
  }
  if (!contentType.startsWith("image/")) {
    console.error(`[ai:art] storing generated art failed: not an image (${contentType.slice(0, 60)}).`);
    return storeFailed();
  }

  // Store the bytes under their REAL type — FLUX returns JPEG, Gemini returns
  // PNG. Serving jpeg bytes as image/png happens to render (browsers sniff),
  // but the stored mime should not lie.
  const extension =
    { "image/png": "png", "image/jpeg": "jpg", "image/webp": "webp" }[
      contentType.split(";")[0].trim()
    ] ?? "png";

  const name = `ai-${randomId()}.${extension}`;
  const art = userFolder("card-art", user.id);
  const { error: uploadError } = await art.upload(name, bytes, {
    cacheControl: "3600",
    contentType: contentType.split(";")[0].trim(),
    upsert: false,
  });
  if (uploadError) {
    // Logged here; the caller tells the user in its own words (art_store).
    console.error(`[ai:art] storing generated art failed: ${uploadError.message}`);
    return storeFailed();
  }
  const publicUrl = art.publicUrl(name);

  const scan = await scanImageUrl(publicUrl, {
    bytes,
    categories: AI_ART_BLOCKED_CATEGORIES,
    timeoutMs: AI_ART_SCAN_TIMEOUT_MS,
  });
  if (scan.skipped) {
    // Fail open (owner: allow if unsure) — said in the log, never to the user.
    console.warn(`[ai:art] nudity scan didn't run (${scan.skipped}); keeping ${name}.`);
  }
  if (scan.flagged) {
    const removed = await art.remove([name]);
    console.warn(
      `[ai:art] nudity scan flagged ${name} (${scan.categories.join(", ")}); ${
        removed.error ? `removing it FAILED: ${removed.error.message}` : "removed"
      }.`,
    );
    return { ok: false, error: ART_NUDITY_BLOCKED_COPY, failure: "art_blocked" };
  }

  return { ok: true, publicUrl };
}
