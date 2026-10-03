import { NextResponse, type NextRequest } from "next/server";
import { getCurrentProfile, getCurrentUser } from "@/lib/supabase/server";
import { isSupabaseConfigured } from "@/lib/supabase/env";
import {
  pickArtCropUrl,
  pickPrintImageUrl,
  searchCardsWithOutcome,
  type ScryfallCard,
} from "@/lib/scryfall/client";
import {
  DEFAULT_SEARCH_SCOPE,
  SEARCH_FALLBACK,
  isSearchScope,
  tokensScopeQuery,
  type SearchScope,
} from "@/lib/scryfall/search-scope";
import {
  checkScryfallRateLimit,
  logScryfallCall,
} from "@/lib/scryfall/rate-limit";
import { rateLimitedResponse } from "@/lib/api/responses";

// ---------------------------------------------------------------------------
// GET /api/scryfall/search?q=<query>&limit=<n>&scope=<cards|tokens>&fallback=tokens
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
//
// Tokens and emblems (TODO 1.23, lib/scryfall/search-scope.ts): Scryfall
// leaves them out unless the request sends `include_extras`. `scope=tokens`
// (the dialog's "Tokens & emblems" scope) searches only tokens and emblems,
// with the flag. The default scope (`cards`) sends a plain query; only when
// the caller asks (`fallback=tokens` — the import dialog's Cards scope) and
// Scryfall finds NOTHING (its 404 — never on an upstream failure) does it ask
// once more in the tokens scope. The answer's `scope` says which one the
// results come from. Each upstream search is one call against the quota. The
// route's other callers (the real-card art dialog, the admin reference
// picker) send no `fallback`: one request, as before 1.23.
// ---------------------------------------------------------------------------

export const maxDuration = 15;

// Trimmed card shape returned to the client. Smaller than the full Scryfall
// payload — only fields the dialog renders.
type TrimmedScryfallCard = {
  id: string;
  name: string;
  /** The printings grid of "Use art from a real card" (TODO 1.15) pages
   *  /api/scryfall/printings by it. Null on Scryfall's reversible cards,
   *  whose oracle id sits on the faces. */
  oracle_id: string | null;
  set: string | null;
  set_name: string | null;
  type_line: string | null;
  mana_cost: string | null;
  rarity: string | null;
  artist: string | null;
  /** The front face's power and toughness: the tokens scope lists "1/1"
   *  beside the type line (a Soldier token is several cards). */
  power: string | null;
  toughness: string | null;
  thumb_url: string | null;
  /** The SECOND face's art crop (TODO 5.0b): a transform, modal DFC,
   *  battle or reversible printing; null for every other card. The admin
   *  reference picker shows it when pinning a back-face frame's printing. */
  back_thumb_url: string | null;
  print_url: string | null;
  oracle_text: string | null;
  image_status: string | null;
};

function trim(card: ScryfallCard): TrimmedScryfallCard {
  return {
    id: card.id,
    name: card.name,
    oracle_id: card.oracle_id ?? null,
    set: card.set ?? null,
    set_name: card.set_name ?? null,
    type_line: card.type_line ?? null,
    mana_cost: card.mana_cost ?? null,
    rarity: card.rarity ?? null,
    artist: card.artist ?? null,
    power: card.power ?? card.card_faces?.[0]?.power ?? null,
    toughness: card.toughness ?? card.card_faces?.[0]?.toughness ?? null,
    thumb_url: pickArtCropUrl(card),
    back_thumb_url: card.card_faces?.[1]?.image_uris?.art_crop ?? null,
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

  const scopeParam = request.nextUrl.searchParams.get("scope")?.trim() || DEFAULT_SEARCH_SCOPE;
  if (!isSearchScope(scopeParam)) {
    return NextResponse.json(
      { ok: false, error: "Unknown search scope." },
      { status: 400 },
    );
  }
  const fallbackParam = request.nextUrl.searchParams.get("fallback")?.trim() || null;
  if (fallbackParam !== null && fallbackParam !== SEARCH_FALLBACK) {
    return NextResponse.json(
      { ok: false, error: "Unknown search fallback." },
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

  // Log only after each upstream call resolves, so a network error (which
  // rejects here) doesn't erode the user's budget. The client collapses an
  // upstream 5xx into an empty list, so that case is still counted.
  const search = async (scope: SearchScope) => {
    const outcome = await searchCardsWithOutcome(
      scope === "tokens"
        ? { query: tokensScopeQuery(query), limit, includeExtras: true }
        : { query, limit },
    );
    if (!quotaExempt) {
      await logScryfallCall(user.id, "search");
    }
    return outcome;
  };

  let scope: SearchScope = scopeParam;
  let outcome = await search(scope);
  if (scope === "cards" && fallbackParam === SEARCH_FALLBACK && outcome.noMatches) {
    // Nothing is called that: perhaps a token or an emblem (TODO 1.23).
    const extras = await search("tokens");
    if (extras.cards.length > 0) {
      scope = "tokens";
      outcome = extras;
    }
  }
  return NextResponse.json({
    ok: true,
    results: outcome.cards.map(trim),
    scope,
  });
}
