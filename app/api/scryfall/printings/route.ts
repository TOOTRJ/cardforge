import { NextResponse, type NextRequest } from "next/server";
import { getCurrentUser } from "@/lib/supabase/server";
import { isSupabaseConfigured } from "@/lib/supabase/env";
import {
  getCardPrintings,
  searchPrintingsPage,
  type ScryfallCard,
} from "@/lib/scryfall/client";
import {
  checkScryfallRateLimit,
  logScryfallCall,
} from "@/lib/scryfall/rate-limit";
import { rateLimitedResponse } from "@/lib/api/responses";
import { getVerifiedFrameKeys } from "@/lib/cards/frame-reviews";
import {
  DEFAULT_PRINTING_VIEW,
  isPrintingView,
  printingsQuery,
  type PrintingsResponse,
} from "@/lib/scryfall/printing-views";
import {
  selectRepresentatives,
  trimPrinting,
} from "@/lib/scryfall/printing-summary";

// ---------------------------------------------------------------------------
// GET /api/scryfall/printings?oracle_id=<uuid>&view=<view>&page=<n>
//
// The printings of an oracle card, trimmed for the import dialog's grid
// (TODO 1.5), each with its frame match — Exact / Nearest / Not available —
// finalized against the verified combos (ONE frame_reviews read per
// request).
//
//   • view=representative (the default): the capped strip the dialog opens
//     with — the newest and oldest printing of every distinct look, then
//     the newest to fill (selectRepresentatives). Up to two Scryfall
//     searches (newest page + oldest page), never paged.
//   • every other view (all | regular | borderless | showcase | extendedart
//     | fullart | textless | oldborder): the FULL list narrowed by a Scryfall
//     qualifier (PRINTING_VIEW_QUALIFIERS), newest first, one Scryfall page
//     (175) per request — ONE search per "Load more".
//
// Counted against the "search" budget — it IS a Scryfall search.
// ---------------------------------------------------------------------------

/** Scryfall pages hold 175; the most-printed card (Plains) is ~6 pages. */
const MAX_PAGE = 50;

export async function GET(request: NextRequest) {
  if (!isSupabaseConfigured()) {
    return json({ ok: false, error: "Supabase is not configured." }, 503);
  }

  const user = await getCurrentUser();
  if (!user) {
    return json({ ok: false, error: "Sign in to look up cards." }, 401);
  }

  const params = request.nextUrl.searchParams;
  const oracleId = params.get("oracle_id")?.trim();
  // Scryfall oracle ids are UUID-shaped; reject anything else before it
  // reaches the upstream query string.
  if (!oracleId || !/^[0-9a-f-]{36}$/i.test(oracleId)) {
    return json({ ok: false, error: "Provide a valid oracle_id." }, 400);
  }
  const view = params.get("view")?.trim() || DEFAULT_PRINTING_VIEW;
  if (!isPrintingView(view)) {
    return json({ ok: false, error: "Unknown printings view." }, 400);
  }
  const pageParam = params.get("page")?.trim() || "1";
  const page = /^\d{1,3}$/.test(pageParam) ? Number(pageParam) : NaN;
  if (!Number.isInteger(page) || page < 1 || page > MAX_PAGE) {
    return json({ ok: false, error: "Provide a valid page." }, 400);
  }

  const limit = await checkScryfallRateLimit(user.id, "search");
  if (!limit.ok) {
    return rateLimitedResponse(limit);
  }

  let cards: ScryfallCard[];
  let hasMore = false;
  let totalCards: number;
  if (view === "representative") {
    const all = await getCardPrintings(oracleId);
    cards = selectRepresentatives(all.cards);
    totalCards = all.totalCards;
  } else {
    const result = await searchPrintingsPage(printingsQuery(oracleId, view), page);
    if (!result) {
      return json(
        { ok: false, error: "Scryfall didn't answer — try again in a moment." },
        502,
      );
    }
    cards = result.cards;
    hasMore = result.hasMore;
    totalCards = result.totalCards;
  }

  if (cards.length === 0) {
    // Don't spend the user's budget on a lookup that found nothing (the
    // posture /named keeps).
    return json({ ok: true, printings: [], has_more: false, total_cards: 0 });
  }

  await logScryfallCall(user.id, "search");

  const verifiedKeys = new Set(await getVerifiedFrameKeys());
  return json({
    ok: true,
    printings: cards.map((card) => trimPrinting(card, verifiedKeys)),
    has_more: hasMore,
    total_cards: totalCards,
  });
}

function json(body: PrintingsResponse, status = 200) {
  return NextResponse.json(body, { status });
}
