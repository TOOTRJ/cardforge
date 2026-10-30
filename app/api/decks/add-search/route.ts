import { NextResponse, type NextRequest } from "next/server";
import { createClient, getCurrentUser } from "@/lib/supabase/server";
import { isSupabaseConfigured } from "@/lib/supabase/env";
import { ADD_SEARCH_MAX_CHARS } from "@/lib/decks/add-search";
import { searchDeckAddCards } from "@/lib/decks/add-search-queries";

// ---------------------------------------------------------------------------
// GET /api/decks/add-search?q=<query> — the deck page's add box (TODO DK5.2):
// the signed-in maker's own cards and other creators' public cards
// (lib/decks/add-search-queries.ts). A route, not a server action, so the
// box can cancel a stale search and never queues behind the page's edits.
// Never cached: it answers for the session's own cards.
// ---------------------------------------------------------------------------

export const dynamic = "force-dynamic";

export async function GET(request: NextRequest) {
  if (!isSupabaseConfigured()) {
    return NextResponse.json({ ok: false, error: "Supabase is not configured." }, { status: 503 });
  }
  const user = await getCurrentUser();
  if (!user) return NextResponse.json({ ok: false, error: "Sign in to add cards." }, { status: 401 });

  const query = request.nextUrl.searchParams.get("q") ?? "";
  if (query.length > ADD_SEARCH_MAX_CHARS * 2) {
    return NextResponse.json({ ok: false, error: "That search is too long." }, { status: 400 });
  }
  const results = await searchDeckAddCards(await createClient(), user.id, query);
  return NextResponse.json({ ok: true, ...results }, { headers: { "Cache-Control": "private, no-store" } });
}
