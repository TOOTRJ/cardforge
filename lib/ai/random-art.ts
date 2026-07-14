import "server-only";

import { createClient, getCurrentUser } from "@/lib/supabase/server";
import { isSupabaseConfigured } from "@/lib/supabase/env";

// ---------------------------------------------------------------------------
// Generated-art persistence.
//
// Image GENERATION lives in lib/ai/image-gen.ts and goes exclusively through
// the AI Gateway (FLUX / Gemini) — there is no direct-OpenAI path anywhere in
// the app. This module now only owns the shared UPLOAD step: take the bytes an
// image model returned and store them in the signed-in user's card-art bucket
// folder so the public URL sits on our CDN origin.
// ---------------------------------------------------------------------------

export type PersistArtResult =
  | { ok: true; publicUrl: string }
  | { ok: false; error: string };

/**
 * Upload generated image bytes to the signed-in user's `card-art` folder.
 * Shared by every AI art flow (random card, remix, decks, sets). The path
 * layout matches the human-upload flow so the bucket's RLS write policy
 * (`auth.uid()::text = (storage.foldername(name))[1]`) accepts it.
 */
export async function persistGeneratedArt(
  bytes: Uint8Array,
  contentType: string,
): Promise<PersistArtResult> {
  if (!isSupabaseConfigured()) {
    return { ok: false, error: "Supabase isn't configured." };
  }
  const user = await getCurrentUser();
  if (!user) {
    return { ok: false, error: "Sign in to generate AI artwork." };
  }
  if (!contentType.startsWith("image/")) {
    return { ok: false, error: "Generated asset wasn't an image." };
  }

  // Store the bytes under their REAL type — FLUX returns JPEG, Gemini returns
  // PNG. Serving jpeg bytes as image/png happens to render (browsers sniff),
  // but the stored mime should not lie.
  const extension =
    { "image/png": "png", "image/jpeg": "jpg", "image/webp": "webp" }[
      contentType.split(";")[0].trim()
    ] ?? "png";

  const id =
    typeof crypto !== "undefined" && "randomUUID" in crypto
      ? crypto.randomUUID()
      : `${Date.now()}-${Math.random().toString(36).slice(2, 10)}`;
  const path = `${user.id}/ai-${id}.${extension}`;

  const supabase = await createClient();
  const { error: uploadError } = await supabase.storage
    .from("card-art")
    .upload(path, bytes, {
      cacheControl: "3600",
      contentType: contentType.split(";")[0].trim(),
      upsert: false,
    });
  if (uploadError) {
    return { ok: false, error: uploadError.message };
  }

  const { data } = supabase.storage.from("card-art").getPublicUrl(path);

  // No post-generation moderation scan here (owner decision, 2026-07-10):
  // the image PROVIDERS already refuse unsafe generations upstream, and our
  // omni-moderation pass was flagging benign fantasy art and deleting it
  // with no admin review path. Human uploads (lib/cards/upload-art-server,
  // watermarks, pips) keep their scan; the report flow remains the backstop
  // for anything AI-generated.

  return { ok: true, publicUrl: data.publicUrl };
}
