import { NextResponse } from "next/server";
import { z } from "zod";
import { createClient, getCurrentUser } from "@/lib/supabase/server";
import { isSupabaseConfigured } from "@/lib/supabase/env";
import {
  fetchScryfallImage,
  getCardById,
  pickPrintImageUrl,
} from "@/lib/scryfall/client";
import {
  checkScryfallRateLimit,
  logScryfallCall,
} from "@/lib/scryfall/rate-limit";

// ---------------------------------------------------------------------------
// POST /api/scryfall/import-art
//   body: { scryfallId: string, mode?: "art" | "print" }
//
// Server fetches the Scryfall image (via the trusted client helper that
// host-locks to cards.scryfall.io / api.scryfall.com), validates the
// content type, and uploads the bytes to the user's `card-art` bucket. The
// upload uses the user's session so RLS still binds the destination path
// to auth.uid().
//
// We never accept an arbitrary `imageUrl` from the client. The client only
// names a Scryfall card id; the server re-derives the URL from a fresh
// Scryfall lookup. This blocks SSRF and stops the route from being used as
// a generic image proxy.
// ---------------------------------------------------------------------------

export const maxDuration = 30;

const MAX_BYTES = 8 * 1024 * 1024;

const bodySchema = z.object({
  scryfallId: z
    .string()
    .min(1)
    .max(200)
    // Scryfall ids are UUIDs but be liberal about format here — the
    // client helper will fail closed on anything that doesn't resolve.
    .regex(/^[0-9a-f-]+$/i, "Invalid Scryfall id."),
  /** Modes:
   *   - "print"     : full card frame (front)
   *   - "art"       : art_crop of the front face (default)
   *   - "print-back": full card frame of the back face (DFC only)
   *   - "art-back"  : art_crop of the back face (DFC only)
   *  Both "*-back" modes return 404 when the card has no second face. */
  mode: z
    .enum(["print", "art", "print-back", "art-back"])
    .optional()
    .default("art"),
});

function extensionFromContentType(contentType: string): string {
  if (contentType.includes("png")) return "png";
  if (contentType.includes("jpeg") || contentType.includes("jpg")) return "jpg";
  if (contentType.includes("webp")) return "webp";
  if (contentType.includes("gif")) return "gif";
  return "bin";
}

export async function POST(request: Request) {
  if (!isSupabaseConfigured()) {
    return NextResponse.json(
      { ok: false, error: "Supabase is not configured." },
      { status: 503 },
    );
  }

  const user = await getCurrentUser();
  if (!user) {
    return NextResponse.json(
      { ok: false, error: "Sign in to import artwork." },
      { status: 401 },
    );
  }

  let payload: unknown;
  try {
    payload = await request.json();
  } catch {
    return NextResponse.json(
      { ok: false, error: "Request body must be JSON." },
      { status: 400 },
    );
  }

  const parsed = bodySchema.safeParse(payload);
  if (!parsed.success) {
    return NextResponse.json(
      {
        ok: false,
        error: parsed.error.issues[0]?.message ?? "Invalid request.",
      },
      { status: 400 },
    );
  }

  const limit = await checkScryfallRateLimit(user.id, "import_art");
  if (!limit.ok) {
    return NextResponse.json(
      { ok: false, error: limit.message },
      {
        status: 429,
        headers: { "Retry-After": String(limit.retryAfterSeconds) },
      },
    );
  }
  await logScryfallCall(user.id, "import_art");

  // 1) Re-fetch the card from Scryfall to recover a trusted image URL. We
  // deliberately don't accept a URL from the client.
  const card = await getCardById(parsed.data.scryfallId);
  if (!card) {
    return NextResponse.json(
      { ok: false, error: "Scryfall card not found." },
      { status: 404 },
    );
  }

  // For "*-back" modes, source the image from `card_faces[1]`. If the
  // card has only one face, fail with 404 — the caller asked for art
  // that doesn't exist.
  const isBack =
    parsed.data.mode === "art-back" || parsed.data.mode === "print-back";
  const faceImages = isBack
    ? card.card_faces?.[1]?.image_uris ?? null
    : card.image_uris ?? card.card_faces?.[0]?.image_uris ?? null;

  if (isBack && !card.card_faces?.[1]) {
    return NextResponse.json(
      { ok: false, error: "This card has no back face." },
      { status: 404 },
    );
  }

  const wantsArt =
    parsed.data.mode === "art" || parsed.data.mode === "art-back";
  const imageUrl = wantsArt
    ? faceImages?.art_crop ?? faceImages?.normal ?? null
    : faceImages?.png ?? faceImages?.large ?? faceImages?.normal ?? null;

  // Front-face print still goes through the original picker so historic
  // behavior is unchanged.
  const finalImageUrl =
    !isBack && parsed.data.mode === "print"
      ? pickPrintImageUrl(card)
      : imageUrl;

  if (!finalImageUrl) {
    return NextResponse.json(
      { ok: false, error: "Scryfall has no image for this card." },
      { status: 404 },
    );
  }

  // 2) Pull the bytes. fetchScryfallImage host-locks the URL.
  const fetched = await fetchScryfallImage(finalImageUrl);
  if (!fetched) {
    return NextResponse.json(
      {
        ok: false,
        error: "Could not download artwork from Scryfall.",
      },
      { status: 502 },
    );
  }

  if (fetched.blob.size > MAX_BYTES) {
    return NextResponse.json(
      { ok: false, error: "Imported image is too large." },
      { status: 413 },
    );
  }

  // 3) Upload via the user's session — RLS binds the destination prefix.
  const ext = extensionFromContentType(fetched.contentType);
  const id =
    typeof crypto !== "undefined" && "randomUUID" in crypto
      ? crypto.randomUUID()
      : `${Date.now()}-${Math.random().toString(36).slice(2, 10)}`;
  const path = `${user.id}/${id}.${ext}`;

  const supabase = await createClient();
  const arrayBuffer = await fetched.blob.arrayBuffer();
  const { error: uploadError } = await supabase.storage
    .from("card-art")
    .upload(path, arrayBuffer, {
      cacheControl: "3600",
      contentType: fetched.contentType,
      upsert: false,
    });

  if (uploadError) {
    return NextResponse.json(
      { ok: false, error: uploadError.message },
      { status: 500 },
    );
  }

  const { data: publicData } = supabase.storage
    .from("card-art")
    .getPublicUrl(path);

  return NextResponse.json({
    ok: true,
    publicUrl: publicData.publicUrl,
    artist: card.artist ?? null,
    source: {
      scryfallId: card.id,
      cardName: card.name,
      scryfallUri: card.scryfall_uri ?? null,
    },
  });
}
