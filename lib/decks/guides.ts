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

// ---------------------------------------------------------------------------
// Deck guides — storage + the one shared "build a guide for this deck"
// routine used by the generation job's guide step (free) and the paid
// analyze route (Pro owner, 1 credit). Reads go through RLS (the guide
// follows the deck's visibility); writes use the service role.
// ---------------------------------------------------------------------------

export type DeckGuide = DeckGuideContent & {
  deck_id: string;
  source: "generation" | "analysis";
  generated_at: string;
};

export async function getDeckGuide(deckId: string): Promise<DeckGuide | null> {
  if (!isSupabaseConfigured()) return null;
  const supabase = await createClient();
  const { data } = await supabase
    .from("deck_guides")
    .select("deck_id, overview, game_plan, mulligan, combos, weaknesses, key_cards, source, generated_at")
    .eq("deck_id", deckId)
    .maybeSingle();
  if (!data) return null;
  return {
    deck_id: data.deck_id,
    overview: data.overview,
    game_plan: (data.game_plan as string[]) ?? [],
    mulligan: data.mulligan ?? "",
    combos: (data.combos as DeckGuideContent["combos"]) ?? [],
    weaknesses: data.weaknesses ?? "",
    key_cards: (data.key_cards as string[]) ?? [],
    source: data.source === "analysis" ? "analysis" : "generation",
    generated_at: data.generated_at,
  };
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
    return { ok: false, error: error instanceof Error ? error.message : "Guide generation failed." };
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
