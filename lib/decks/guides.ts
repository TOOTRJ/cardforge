import "server-only";
import { createClient } from "@/lib/supabase/server";
import { createAdminClient, isAdminConfigured } from "@/lib/supabase/admin";
import { isSupabaseConfigured } from "@/lib/supabase/env";
import { computeDeckAnalytics } from "@/lib/decks/analytics";
import { listDeckCards } from "@/lib/decks/queries";
import {
  generateDeckGuide,
  type DeckGuideCard,
  type DeckGuideContent,
} from "@/lib/ai/deck-guide";
import { aiErrorMessage } from "@/lib/ai/structured-output";

// ---------------------------------------------------------------------------
// Deck guides — storage + the one shared "build a guide for this deck"
// routine used by the generation job's guide step (free) and the paid
// analyze route (Pro owner, 1 credit). Writes use the service role.
//
// Reads go through ONE database function, deck_guide_for_viewer (migration
// 0150, TODO DK0.11): the guide as the deck page shows it to the caller —
// nothing for a deck they can't open, the TEXT only for a Pro viewer (an
// admin, an active / trialing Pro plan, a Pro comp: entitlements.ts's rule),
// and for anyone but the deck's owner the text with the deck's hidden cards'
// names redacted (a guide was written from the owner's view of the cards; a
// card that has gone private since reads "Private card", or the printing's
// own name where its entry stands for one — what the visitor's list shows).
// The stored text is never rewritten, and deck_guides is no API role's to
// read directly, so the API hands out exactly what the page draws.
// ---------------------------------------------------------------------------

export type DeckGuide = DeckGuideContent & {
  deck_id: string;
  source: "generation" | "analysis";
  generated_at: string;
};

/** A deck's guide as this viewer reads it: the text, or — `withheld` —
 *  only that one exists (the Pro teaser), or neither. */
export type DeckGuideRead = { guide: DeckGuide | null; withheld: boolean };

const NO_GUIDE: DeckGuideRead = { guide: null, withheld: false };

type GuideRow = {
  deck_id: string;
  overview: string | null;
  game_plan: unknown;
  mulligan: string | null;
  combos: unknown;
  weaknesses: string | null;
  key_cards: unknown;
  source: string | null;
  generated_at: string | null;
};

function narrowGuide(row: GuideRow): DeckGuide {
  return {
    deck_id: row.deck_id,
    overview: row.overview ?? "",
    game_plan: (row.game_plan as string[] | null) ?? [],
    mulligan: row.mulligan ?? "",
    combos: (row.combos as DeckGuideContent["combos"] | null) ?? [],
    weaknesses: row.weaknesses ?? "",
    key_cards: (row.key_cards as string[] | null) ?? [],
    source: row.source === "analysis" ? "analysis" : "generation",
    generated_at: row.generated_at ?? new Date(0).toISOString(),
  };
}

export async function getDeckGuide(deckId: string): Promise<DeckGuideRead> {
  if (!isSupabaseConfigured()) return NO_GUIDE;
  const supabase = await createClient();
  const { data, error } = await supabase.rpc("deck_guide_for_viewer", { p_deck_id: deckId });
  if (error?.code === "PGRST202") {
    // A database 0150 hasn't reached has no such function: 0085's table read
    // (the page withholds the text from a non-Pro viewer itself). Remove once
    // 0150 is on production and dev.
    const { data: row } = await supabase
      .from("deck_guides")
      .select("deck_id, overview, game_plan, mulligan, combos, weaknesses, key_cards, source, generated_at")
      .eq("deck_id", deckId)
      .maybeSingle();
    return row ? { guide: narrowGuide(row), withheld: false } : NO_GUIDE;
  }
  const row = Array.isArray(data) ? data[0] : null;
  if (error || !row) return NO_GUIDE;
  return row.readable ? { guide: narrowGuide(row), withheld: false } : { guide: null, withheld: true };
}

export type BuildGuideResult = { ok: true; guide: DeckGuideContent } | { ok: false; error: string };

/**
 * Generate and store the guide for a deck the caller can read. The deck's
 * cards come through the caller's session (RLS), the write through the
 * service role. `source` records how it was paid for.
 */
export async function buildAndStoreDeckGuide(
  deckId: string,
  source: "generation" | "analysis",
): Promise<BuildGuideResult> {
  if (!isAdminConfigured()) return { ok: false, error: "Admin client isn't configured." };
  const supabase = await createClient();
  const { data: deck } = await supabase
    .from("decks")
    .select("id, title, description, format, deck_type, bracket")
    .eq("id", deckId)
    .maybeSingle();
  if (!deck) return { ok: false, error: "Deck not found." };
  const items = await listDeckCards(deckId);
  const cards: DeckGuideCard[] = items
    .filter((i) => i.entry.board !== "maybe")
    .map((i) => ({
      quantity: i.entry.quantity,
      board: i.entry.board,
      name: i.card?.title ?? i.entry.name,
      type_line: i.card?.card_type
        ? [i.card.supertype, i.card.card_type, ...(i.card.subtypes ?? [])].filter(Boolean).join(" ")
        : i.entry.type_line,
      mana_cost: i.card?.cost ?? i.entry.mana_cost,
      rules_text: i.card?.rules_text ?? null,
    }));
  if (cards.length === 0) return { ok: false, error: "Add some cards first — there is nothing to analyze yet." };
  let guide: DeckGuideContent;
  try {
    guide = await generateDeckGuide({
      title: deck.title,
      description: deck.description,
      format: deck.format,
      deckType: deck.deck_type,
      bracket: deck.bracket,
      cards,
      analytics: computeDeckAnalytics(items),
    });
  } catch (error) {
    return { ok: false, error: aiErrorMessage(error, (detail) => detail, "Guide generation failed.") };
  }
  const admin = createAdminClient();
  const { error } = await admin.from("deck_guides").upsert(
    {
      deck_id: deckId,
      overview: guide.overview,
      game_plan: guide.game_plan,
      mulligan: guide.mulligan || null,
      combos: guide.combos,
      weaknesses: guide.weaknesses || null,
      key_cards: guide.key_cards,
      source,
      generated_at: new Date().toISOString(),
    },
    { onConflict: "deck_id" },
  );
  if (error) return { ok: false, error: "Couldn't save the guide." };
  return { ok: true, guide };
}
