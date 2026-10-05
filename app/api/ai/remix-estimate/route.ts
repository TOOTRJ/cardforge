import { NextResponse, type NextRequest } from "next/server";
import { getCurrentUser } from "@/lib/supabase/server";
import { isSupabaseConfigured } from "@/lib/supabase/env";
import { isUuid } from "@/lib/ids";
import { checkAiRateLimit } from "@/lib/ai/rate-limit";
import { rateLimitedResponse } from "@/lib/api/responses";
import { batchCardLimit } from "@/lib/ai/generation-limits";
import { estimateDeckRemix } from "@/lib/ai/remix-estimate";

// ---------------------------------------------------------------------------
// GET /api/ai/remix-estimate?deck_id=<uuid> — what an AI deck remix would
// cost (TODO 5.4; owner decision Q4, 2026-10-02): the entries it would run
// and the credits they reserve, a double-faced printing landing on its
// bodies at two (both faces painted). The remix dialog asks before its
// credit confirm, so the number the user agrees to is the number the steps
// charge (the jobs route sizes its pre-check and the plan from the same
// estimate, lib/ai/remix-estimate.ts).
//
// Resolves the deck's printings through Scryfall's collection endpoint (≤ 2
// calls for a 100-card deck, the client's own throttle between them), so it
// is gated by the AI rate limit like the jobs route itself. `private,
// no-store`: per-viewer data (the deck's RLS decides what it sees).
// ---------------------------------------------------------------------------

export const maxDuration = 30;

const NO_STORE = { "cache-control": "private, no-store" };

export async function GET(request: NextRequest) {
  if (!isSupabaseConfigured()) {
    return NextResponse.json({ ok: false, error: "Supabase is not configured." }, { status: 503, headers: NO_STORE });
  }
  const user = await getCurrentUser();
  if (!user) {
    return NextResponse.json({ ok: false, error: "Sign in to remix decks." }, { status: 401, headers: NO_STORE });
  }
  const deckId = request.nextUrl.searchParams.get("deck_id")?.trim() ?? "";
  if (!isUuid(deckId)) {
    return NextResponse.json({ ok: false, error: "Provide a deck_id." }, { status: 400, headers: NO_STORE });
  }
  const rate = await checkAiRateLimit(user.id);
  if (!rate.ok) return rateLimitedResponse(rate);

  const limit = await batchCardLimit();
  const estimate = await estimateDeckRemix(deckId, limit);
  return NextResponse.json(
    {
      ok: true,
      cards: estimate.cards,
      credits: estimate.credits,
      doubleFaced: estimate.doubleFaced,
      skipped: estimate.skipped,
      unresolved: estimate.unresolved,
      cardLimit: limit,
    },
    { headers: NO_STORE },
  );
}
