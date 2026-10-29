import { NextResponse } from "next/server";
import { createClient, getCurrentProfile, getCurrentUser } from "@/lib/supabase/server";
import { chunkIds, selectAllRows } from "@/lib/supabase/select-all-rows";

// GDPR-style data export: the signed-in user downloads everything we hold for
// them as a single JSON file. Reads through the user's own session (RLS-scoped),
// so it can only ever return the caller's own rows.
//
// Every list is read WHOLE: PostgREST answers an un-ranged select with at
// most 1000 rows and says nothing about the rest, so a Pro account's 1,001st
// card (or a deck's 1,001st entry) was silently missing from its own export.
// Each read pages by id (`selectAllRows`), and any failed or cut-short read
// refuses the export rather than hand back a file that looks complete.

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

type ExportClient = Awaited<ReturnType<typeof createClient>>;
type ExportTable =
  | "cards"
  | "decks"
  | "card_comments"
  | "card_likes"
  | "deck_likes"
  | "credit_ledger"
  | "card_reports"
  | "comment_reports";

/** Every row of `table` whose `column` is the user, paged by id. */
function readAll(supabase: ExportClient, table: ExportTable, column: string, userId: string) {
  return selectAllRows<Record<string, unknown>>((from, to) =>
    supabase
      .from(table)
      .select("*", { count: "exact" })
      .eq(column, userId)
      .order("id", { ascending: true })
      .range(from, to),
  );
}

export async function GET() {
  const user = await getCurrentUser();
  if (!user) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  const supabase = await createClient();
  const [
    profile,
    cards,
    decks,
    comments,
    cardLikes,
    deckLikes,
    creditLedger,
    cardReports,
    commentReports,
  ] = await Promise.all([
    // Public columns + the user's own billing slice (migration 0074 made
    // `select *` on profiles a permission error for user clients).
    getCurrentProfile().then((data) => ({ data })),
    readAll(supabase, "cards", "owner_id", user.id),
    readAll(supabase, "decks", "owner_id", user.id),
    readAll(supabase, "card_comments", "author_id", user.id),
    readAll(supabase, "card_likes", "user_id", user.id),
    readAll(supabase, "deck_likes", "user_id", user.id),
    readAll(supabase, "credit_ledger", "user_id", user.id),
    readAll(supabase, "card_reports", "reporter_id", user.id),
    readAll(supabase, "comment_reports", "reporter_id", user.id),
  ]);

  // Deck entries ride along with the user's decks (RLS scopes them to
  // readable decks; filtering by the owned deck ids keeps it explicit). 100
  // deck ids a request (`chunkIds`: the URL stays short), each one paged.
  const deckIds = decks.data.map((deck) => String(deck.id));
  const deckCards: Record<string, unknown>[] = [];
  let readError =
    cards.error ??
    decks.error ??
    comments.error ??
    cardLikes.error ??
    deckLikes.error ??
    creditLedger.error ??
    cardReports.error ??
    commentReports.error;
  for (const ids of chunkIds(deckIds)) {
    const page = await selectAllRows<Record<string, unknown>>((from, to) =>
      supabase
        .from("deck_cards")
        .select("*", { count: "exact" })
        .in("deck_id", ids)
        .order("id", { ascending: true })
        .range(from, to),
    );
    deckCards.push(...page.data);
    readError ??= page.error;
  }

  // A partial export would look complete — refuse it instead.
  if (readError) {
    return NextResponse.json(
      { error: "Couldn't read all of your data — try the export again." },
      { status: 503, headers: { "Cache-Control": "no-store" } },
    );
  }

  const payload = {
    exportedAt: new Date().toISOString(),
    account: { id: user.id, email: user.email ?? null },
    profile: profile.data ?? null,
    cards: cards.data,
    decks: decks.data,
    deckCards,
    comments: comments.data,
    likes: {
      cards: cardLikes.data,
      decks: deckLikes.data,
    },
    creditLedger: creditLedger.data,
    reportsFiled: {
      cards: cardReports.data,
      comments: commentReports.data,
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
