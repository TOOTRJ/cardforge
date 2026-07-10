import { NextResponse } from "next/server";
import { createClient, getCurrentUser } from "@/lib/supabase/server";

// GDPR-style data export: the signed-in user downloads everything we hold for
// them as a single JSON file. Reads through the user's own session (RLS-scoped),
// so it can only ever return the caller's own rows.

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export async function GET() {
  const user = await getCurrentUser();
  if (!user) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  const supabase = await createClient();
  const [
    profile,
    cards,
    sets,
    decks,
    comments,
    cardLikes,
    setLikes,
    deckLikes,
    creditLedger,
    cardReports,
    commentReports,
  ] = await Promise.all([
    supabase.from("profiles").select("*").eq("id", user.id).maybeSingle(),
    supabase.from("cards").select("*").eq("owner_id", user.id),
    supabase.from("card_sets").select("*").eq("owner_id", user.id),
    supabase.from("decks").select("*").eq("owner_id", user.id),
    supabase.from("card_comments").select("*").eq("author_id", user.id),
    supabase.from("card_likes").select("*").eq("user_id", user.id),
    supabase.from("set_likes").select("*").eq("user_id", user.id),
    supabase.from("deck_likes").select("*").eq("user_id", user.id),
    supabase.from("credit_ledger").select("*").eq("user_id", user.id),
    supabase.from("card_reports").select("*").eq("reporter_id", user.id),
    supabase.from("comment_reports").select("*").eq("reporter_id", user.id),
  ]);

  // Deck entries ride along with the user's decks (RLS scopes them to
  // readable decks; filtering by the owned deck ids keeps it explicit).
  const deckIds = (decks.data ?? []).map((deck) => deck.id);
  const deckCards =
    deckIds.length > 0
      ? await supabase.from("deck_cards").select("*").in("deck_id", deckIds)
      : { data: [] };

  const payload = {
    exportedAt: new Date().toISOString(),
    account: { id: user.id, email: user.email ?? null },
    profile: profile.data ?? null,
    cards: cards.data ?? [],
    sets: sets.data ?? [],
    decks: decks.data ?? [],
    deckCards: deckCards.data ?? [],
    comments: comments.data ?? [],
    likes: {
      cards: cardLikes.data ?? [],
      sets: setLikes.data ?? [],
      decks: deckLikes.data ?? [],
    },
    creditLedger: creditLedger.data ?? [],
    reportsFiled: {
      cards: cardReports.data ?? [],
      comments: commentReports.data ?? [],
    },
  };

  const filename = `pipglyph-export-${payload.exportedAt.slice(0, 10)}.json`;
  return new NextResponse(JSON.stringify(payload, null, 2), {
    headers: {
      "Content-Type": "application/json; charset=utf-8",
      "Content-Disposition": `attachment; filename="${filename}"`,
      "Cache-Control": "no-store",
    },
  });
}
