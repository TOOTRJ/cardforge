import { NextResponse, type NextRequest } from "next/server";
import { getCurrentUser } from "@/lib/supabase/server";
import { isSupabaseConfigured } from "@/lib/supabase/env";
import {
  pickArtCropUrl,
  pickPrintImageUrl,
  searchCards,
  type ScryfallCard,
} from "@/lib/scryfall/client";
import {
  checkScryfallRateLimit,
  logScryfallCall,
} from "@/lib/scryfall/rate-limit";

// ---------------------------------------------------------------------------
// GET /api/scryfall/search?q=<query>&limit=<n>
//
// Server-side proxy in front of Scryfall's /cards/search. Auth-gated and
// per-user rate-limited so a single malicious account can't hammer the
// upstream API. The response is trimmed to just the fields the
// ScryfallImportDialog needs — keeps the wire small and avoids surfacing
// data we don't show.
// ---------------------------------------------------------------------------

export const maxDuration = 15;

// Trimmed card shape returned to the client. Smaller than the full Scryfall
// payload — only fields the dialog renders.
type TrimmedScryfallCard = {
  id: string;
  name: string;
  set: string | null;
  set_name: string | null;
  type_line: string | null;
  mana_cost: string | null;
  rarity: string | null;
  artist: string | null;
  thumb_url: string | null;
  print_url: string | null;
  oracle_text: string | null;
};

function trim(card: ScryfallCard): TrimmedScryfallCard {
  return {
    id: card.id,
    name: card.name,
    set: card.set ?? null,
    set_name: card.set_name ?? null,
    type_line: card.type_line ?? null,
    mana_cost: card.mana_cost ?? null,
    rarity: card.rarity ?? null,
    artist: card.artist ?? null,
    thumb_url: pickArtCropUrl(card),
    print_url: pickPrintImageUrl(card),
    oracle_text: card.oracle_text ?? null,
  };
}

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
      { ok: false, error: "Sign in to search cards." },
      { status: 401 },
    );
  }

  const query = (request.nextUrl.searchParams.get("q") ?? "").trim();
  if (!query) {
    return NextResponse.json({ ok: true, results: [] });
  }
  if (query.length > 200) {
    return NextResponse.json(
      { ok: false, error: "Search query is too long." },
      { status: 400 },
    );
  }

  const limitRaw = Number(request.nextUrl.searchParams.get("limit") ?? "12");
  const limit = Number.isFinite(limitRaw)
    ? Math.min(50, Math.max(1, Math.round(limitRaw)))
    : 12;

  const limit_check = await checkScryfallRateLimit(user.id, "search");
  if (!limit_check.ok) {
    return NextResponse.json(
      { ok: false, error: limit_check.message },
      {
        status: 429,
        headers: { "Retry-After": String(limit_check.retryAfterSeconds) },
      },
    );
  }

  await logScryfallCall(user.id, "search");

  const cards = await searchCards({ query, limit });
  return NextResponse.json({
    ok: true,
    results: cards.map(trim),
  });
}
