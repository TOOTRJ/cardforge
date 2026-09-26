import { NextResponse, type NextRequest } from "next/server";
import { getCurrentProfile, getCurrentUser } from "@/lib/supabase/server";
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
import { rateLimitedResponse } from "@/lib/api/responses";

// ---------------------------------------------------------------------------
// GET /api/scryfall/search?q=<query>&limit=<n>
//
// Server-side proxy in front of Scryfall's /cards/search. Auth-gated and
// per-user rate-limited so a single malicious account can't hammer the
// upstream API. The response is trimmed to just the fields the
// ScryfallImportDialog needs — keeps the wire small and avoids surfacing
// data we don't show.
//
// Admins skip the per-user quota (TODO 0.17). The frame-compare reference
// picker (components/admin/frame-reference-picker.tsx) searches through this
// route, and a verification session would otherwise spend the admin's own
// "search" bucket, which the creator's printings strip (/api/scryfall/
// printings) also draws from. So an admin's search is never refused by the
// quota and never logged, and it doesn't show in the /admin/scryfall counts. is_admin comes
// from the session's own profile (getCurrentProfile), never from the request.
// The global throttle in lib/scryfall/client.ts still spaces every upstream
// call, admin or not.
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
  image_status: string | null;
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
    image_status: card.image_status ?? null,
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

  // The profile read and the (read-only) quota check run side by side — the
  // typeahead shouldn't pay them one after the other. A failed profile read
  // comes back null, so the exemption fails closed; an admin's check result
  // is simply ignored.
  const [profile, limitCheck] = await Promise.all([
    getCurrentProfile(),
    checkScryfallRateLimit(user.id, "search"),
  ]);
  const quotaExempt = profile?.is_admin === true;
  if (!quotaExempt && !limitCheck.ok) {
    return rateLimitedResponse(limitCheck);
  }

  // Log only after the upstream call resolves, so a network error (which
  // rejects here) doesn't erode the user's budget. searchCards collapses an
  // upstream 5xx into an empty list, so that case is still counted.
  const cards = await searchCards({ query, limit });
  if (!quotaExempt) {
    await logScryfallCall(user.id, "search");
  }
  return NextResponse.json({
    ok: true,
    results: cards.map(trim),
  });
}
