import "server-only";

import OpenAI from "openai";
import { createClient, getCurrentUser } from "@/lib/supabase/server";
import { isSupabaseConfigured } from "@/lib/supabase/env";

// ---------------------------------------------------------------------------
// DALL-E 3 art generator (Phase v2 Phase 4)
//
// Flow:
//   1. Wrap the model's art_prompt with an MTG-style preamble + the standard
//      "no text, no frame" constraints DALL-E benefits from.
//   2. Call OpenAI Images API with model="dall-e-3", quality="hd",
//      size="1024x1024", style="vivid", n=1.
//   3. Fetch the resulting URL server-side, byte-sniff it, upload to
//      `card-art/{userId}/ai-{uuid}.png` so the public URL is on our CDN
//      origin (not OpenAI's, which expires).
//   4. Return the public URL + the prompt actually sent.
//
// We default to a square 1024×1024 image. The card's art slot crops to the
// art window aspect; the user can re-position via the existing focal-point
// controls.
// ---------------------------------------------------------------------------

const PROMPT_PREAMBLE =
  "Magic: The Gathering style fantasy illustration. Cinematic composition, painterly oil-on-canvas finish, dramatic lighting, rich detail. NO frame, NO borders, NO card layout, NO text or lettering anywhere in the image.";

function modelId(): string {
  return process.env.OPENAI_IMAGE_MODEL?.trim() || "dall-e-3";
}

function client(): OpenAI {
  // The OpenAI SDK reads OPENAI_API_KEY automatically; constructing here
  // gives us a single point to override timeouts / base URL later.
  return new OpenAI({
    apiKey: process.env.OPENAI_API_KEY,
    // 60s DALL-E HD requests routinely take 20-40s; the SDK default is
    // already long enough but we set it explicitly to be safe.
    timeout: 90_000,
  });
}

export type RandomArtResult =
  | { ok: true; publicUrl: string; promptSent: string; revisedPrompt?: string }
  | { ok: false; error: string };

/**
 * Generate a DALL-E 3 image for the given prompt and upload to the user's
 * card-art bucket folder. Requires a signed-in user (uploads via their
 * session so RLS treats the file as their own).
 */
export async function generateRandomArt(rawPrompt: string): Promise<RandomArtResult> {
  if (!isSupabaseConfigured()) {
    return { ok: false, error: "Supabase isn't configured." };
  }
  if (!process.env.OPENAI_API_KEY?.trim()) {
    return { ok: false, error: "OPENAI_API_KEY is not configured." };
  }

  const user = await getCurrentUser();
  if (!user) {
    return { ok: false, error: "Sign in to generate AI artwork." };
  }

  const prompt = `${PROMPT_PREAMBLE} ${rawPrompt.trim()}`.slice(0, 4000);

  // ---- OpenAI image call ----
  let imageUrl: string | undefined;
  let revisedPrompt: string | undefined;
  try {
    const oa = client();
    const response = await oa.images.generate({
      model: modelId(),
      prompt,
      size: "1024x1024",
      quality: "hd",
      style: "vivid",
      n: 1,
      response_format: "url",
    });
    const first = response.data?.[0];
    imageUrl = first?.url ?? undefined;
    revisedPrompt = first?.revised_prompt ?? undefined;
  } catch (error) {
    const message =
      error instanceof Error ? error.message : "Image generation failed.";
    return { ok: false, error: friendlyOpenAiError(message) };
  }

  if (!imageUrl) {
    return { ok: false, error: "OpenAI returned no image URL." };
  }

  // ---- Fetch the image bytes ----
  let pngBytes: Uint8Array;
  let contentType: string;
  try {
    const imgResp = await fetch(imageUrl);
    if (!imgResp.ok) {
      return { ok: false, error: `OpenAI image fetch failed (${imgResp.status}).` };
    }
    contentType = imgResp.headers.get("content-type") ?? "image/png";
    pngBytes = new Uint8Array(await imgResp.arrayBuffer());
  } catch {
    return { ok: false, error: "Could not retrieve the generated image." };
  }

  // Defensive: only accept image responses.
  if (!contentType.startsWith("image/")) {
    return { ok: false, error: "Generated asset wasn't an image." };
  }

  // ---- Upload to Supabase Storage ----
  // Path layout matches the human-upload flow so the bucket's RLS write
  // policy (`auth.uid()::text = (storage.foldername(name))[1]`) accepts it.
  const id =
    typeof crypto !== "undefined" && "randomUUID" in crypto
      ? crypto.randomUUID()
      : `${Date.now()}-${Math.random().toString(36).slice(2, 10)}`;
  const path = `${user.id}/ai-${id}.png`;

  const supabase = await createClient();
  const { error: uploadError } = await supabase.storage
    .from("card-art")
    .upload(path, pngBytes, {
      cacheControl: "3600",
      contentType: "image/png",
      upsert: false,
    });
  if (uploadError) {
    return { ok: false, error: uploadError.message };
  }

  const { data } = supabase.storage.from("card-art").getPublicUrl(path);
  return {
    ok: true,
    publicUrl: data.publicUrl,
    promptSent: prompt,
    revisedPrompt,
  };
}

function friendlyOpenAiError(detail: string): string {
  const lower = detail.toLowerCase();
  if (lower.includes("safety") || lower.includes("policy")) {
    return "OpenAI refused that art prompt for safety reasons. Try again — the random card will produce a fresh prompt.";
  }
  if (lower.includes("rate limit") || lower.includes("429")) {
    return "OpenAI is rate-limiting us. Wait a moment and try again.";
  }
  if (lower.includes("billing") || lower.includes("quota")) {
    return "OpenAI billing/quota is exhausted on the server side. Contact the deploy owner.";
  }
  if (lower.includes("invalid api key") || lower.includes("401") || lower.includes("403")) {
    return "OpenAI rejected the API key. Double-check OPENAI_API_KEY on the server.";
  }
  return `OpenAI image error: ${detail}`;
}
