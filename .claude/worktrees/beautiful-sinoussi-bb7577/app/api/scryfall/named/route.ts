import { NextResponse, type NextRequest } from "next/server";
import { getCurrentUser } from "@/lib/supabase/server";
import { isSupabaseConfigured } from "@/lib/supabase/env";
import {
  getCardById,
  getCardByName,
  pickArtCropUrl,
  pickPrintImageUrl,
} from "@/lib/scryfall/client";
import {
  checkScryfallRateLimit,
  logScryfallCall,
} from "@/lib/scryfall/rate-limit";
import { mapScryfallToFormPatch } from "@/lib/scryfall/import-mapper";

// ---------------------------------------------------------------------------
// GET /api/scryfall/named?id=<scryfall_id>
//                       ?exact=<name>
//                       ?fuzzy=<name>
//
// Resolves a single Scryfall card and returns it together with our form
// patch shape. Used by the import dialog when the user clicks a result —
// we re-fetch by id so the client never has to round-trip the full card
// object and we always operate on canonical Scryfall data.
// ---------------------------------------------------------------------------

export const maxDuration = 15;

export async function GET(request: NextRequest) {
  if (!isSupabaseConfigured()) {
    return NextResponse.json(
      { ok: false, error: "Supabase is not configured." },
      { status: 503 },
    );
  }

  const user = await getCurrentUser();
  if (!user) {
    return NextResponse.json(
      { ok: false, error: "Sign in to look up cards." },
      { status: 401 },
    );
  }

  const params = request.nextUrl.searchParams;
  const id = params.get("id")?.trim();
  const exact = params.get("exact")?.trim();
  const fuzzy = params.get("fuzzy")?.trim();

  if (!id && !exact && !fuzzy) {
    return NextResponse.json(
      { ok: false, error: "Provide id, exact, or fuzzy." },
      { status: 400 },
    );
  }

  const limit = await checkScryfallRateLimit(user.id, "named");
  if (!limit.ok) {
    return NextResponse.json(
      { ok: false, error: limit.message },
      {
        status: 429,
        headers: { "Retry-After": String(limit.retryAfterSeconds) },
      },
    );
  }

  await logScryfallCall(user.id, "named");

  const card =
    id != null
      ? await getCardById(id)
      : exact != null
        ? await getCardByName({ exact })
        : await getCardByName({ fuzzy: fuzzy! });

  if (!card) {
    return NextResponse.json(
      { ok: false, error: "Card not found." },
      { status: 404 },
    );
  }

  const artPreviewUrl = pickArtCropUrl(card);
  const patch = mapScryfallToFormPatch(card, { artPreviewUrl });

  return NextResponse.json({
    ok: true,
    card: {
      id: card.id,
      name: card.name,
      set: card.set ?? null,
      set_name: card.set_name ?? null,
      print_url: pickPrintImageUrl(card),
      thumb_url: artPreviewUrl,
      scryfall_uri: card.scryfall_uri ?? null,
    },
    patch,
  });
}
