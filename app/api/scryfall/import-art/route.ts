import { NextResponse } from "next/server";
import { z } from "zod";
import { getCurrentUser } from "@/lib/supabase/server";
import { isSupabaseConfigured } from "@/lib/supabase/env";
import { isUserStorageConfigured } from "@/lib/media/user-storage";
import { getCardById } from "@/lib/scryfall/client";
import { checkScryfallRateLimit } from "@/lib/scryfall/rate-limit";
import { storeScryfallArt } from "@/lib/scryfall/import-art";
import { rateLimitedResponse } from "@/lib/api/responses";
import { checkUploadRateLimit } from "@/lib/media/upload-rate-limit";

// ---------------------------------------------------------------------------
// POST /api/scryfall/import-art
//   body: { scryfallId: string, mode?: "art" | "print" }
//
// Server fetches the Scryfall image (via the trusted client helper that
// host-locks to cards.scryfall.io / api.scryfall.com), validates the
// content type, and uploads the bytes to the user's `card-art` folder — with
// the service role, the folder forced from the session's user id
// (lib/media/user-storage.ts; users hold no storage write policy since 0126).
//
// We never accept an arbitrary `imageUrl` from the client. The client only
// names a Scryfall card id; the server re-derives the URL from a fresh
// Scryfall lookup. This blocks SSRF and stops the route from being used as
// a generic image proxy.
// ---------------------------------------------------------------------------

export const maxDuration = 30;

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
   *  Both "*-back" modes return 404 when the card has no second face, or
   *  when that face has no image of its own (a split / adventure / flip
   *  card — the import dialog asks only when /named says `has_back_image`,
   *  "Use art from a real card" only when /printings does; both flags are
   *  hasBackFaceImage). */
  mode: z
    .enum(["print", "art", "print-back", "art-back"])
    .optional()
    .default("art"),
});

export async function POST(request: Request) {
  if (!isSupabaseConfigured() || !isUserStorageConfigured()) {
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
    return rateLimitedResponse(limit);
  }
  // The upload limit too (30 a minute / 300 a day per user,
  // lib/media/upload-rate-limit.ts): this stores a file in the user's folder.
  const uploadLimit = await checkUploadRateLimit(user.id);
  if (!uploadLimit.ok) {
    return rateLimitedResponse(uploadLimit);
  }
  // 1) Re-fetch the card from Scryfall to recover a trusted image URL. We
  // deliberately don't accept a URL from the client.
  const card = await getCardById(parsed.data.scryfallId);
  if (!card) {
    // A missing/failed lookup shouldn't cost the user's Scryfall budget —
    // only log once we know there's a real image to import (below).
    return NextResponse.json(
      { ok: false, error: "Scryfall card not found." },
      { status: 404 },
    );
  }

  // 2) Pick, gate, charge, fetch and store — the one path the Bulk
  // Customize batch takes too (lib/scryfall/import-art.ts).
  const stored = await storeScryfallArt(user.id, card, parsed.data.mode);
  if (!stored.ok) {
    return NextResponse.json({ ok: false, error: stored.error }, { status: stored.status });
  }

  return NextResponse.json({
    ok: true,
    publicUrl: stored.publicUrl,
    // The requested face's artist (TODO 1.8): Ice's, not "David Martin &
    // Franz Vohwinkel".
    artist: stored.artist,
    // Non-blocking quality signal — the dialog surfaces this as a toast so
    // the user can pick a better printing if they care.
    warning: stored.warning,
    source: {
      scryfallId: card.id,
      cardName: card.name,
      scryfallUri: card.scryfall_uri ?? null,
    },
  });
}
