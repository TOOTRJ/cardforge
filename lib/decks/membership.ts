import "server-only";

import { revalidatePath } from "next/cache";
import type { createClient } from "@/lib/supabase/server";
import { revalidateProfilePage } from "@/lib/profile/username";
import { deckEntryLimitMessage } from "@/lib/decks/import-plan";
import { isUuid } from "@/lib/ids";

// ---------------------------------------------------------------------------
// Deck membership helper for the card-create flow: dropping a freshly saved
// custom card into a deck as a custom-only entry (mainboard, ×1). Called
// from createCardAction — best-effort, never fails the card save.
// ---------------------------------------------------------------------------

/** Who adds the card (deck_cards.source, migration 0144): the creator by
 *  default, the AI jobs by name — an AI restyle of a printing keeps that
 *  printing's Scryfall id and its name on the entry (the copied decklist
 *  still names the real card; the list shows the card's own title). */
export type DeckEntryOrigin = {
  source: "creator" | "link" | "ai_generate" | "ai_remix";
  scryfallId?: string | null;
  name?: string | null;
};

const ORIGIN_SOURCES: ReadonlySet<string> = new Set(["creator", "link", "ai_generate", "ai_remix"]);

/** The origin as the RPC takes it: an unknown source is the creator's, a
 *  Scryfall id must be one (a uuid) and only an AI restyle keeps one, a
 *  name must fit deck_cards' CHECK (1–200). Options are server-built, but
 *  a server action's arguments can be sent by anyone: nothing here trusts
 *  them further than the deck owner's own entry. */
export function deckEntryOriginArgs(
  origin: DeckEntryOrigin | null | undefined,
  cardTitle: string,
): { p_name: string; p_source: DeckEntryOrigin["source"]; p_scryfall_id: string | null } {
  const source = origin && ORIGIN_SOURCES.has(origin.source) ? origin.source : "creator";
  const scryfallId = source === "ai_remix" && isUuid(origin?.scryfallId) ? origin!.scryfallId!.toLowerCase() : null;
  const printedName = scryfallId ? origin?.name?.trim() : "";
  const name = printedName && printedName.length <= 200 ? printedName : cardTitle;
  return { p_name: name, p_source: source, p_scryfall_id: scryfallId };
}

/** PostgREST's "no function with these arguments" (PGRST202): a database
 *  0144 has not reached, whose add_custom_deck_entry takes three. */
function isMissingOriginSignature(error: { code?: string | null } | null): boolean {
  return error?.code === "PGRST202";
}

export async function addCustomCardEntryToDeck(
  supabase: Awaited<ReturnType<typeof createClient>>,
  userId: string,
  deckId: string,
  cardId: string,
  cardTitle: string,
  origin?: DeckEntryOrigin | null,
): Promise<{ ok: boolean; deckSlug?: string; error?: string }> {
  // Ownership pre-flight (the RPC and RLS enforce it too; this yields the
  // slug for revalidation and a friendly failure).
  const { data: deck } = await supabase
    .from("decks")
    .select("id, slug, owner_id")
    .eq("id", deckId)
    .maybeSingle();
  if (!deck || deck.owner_id !== userId) {
    return { ok: false, error: "Deck not found or not yours." };
  }

  // Check-then-insert in ONE transaction under the deck's entry lock
  // (migration 0143): two saves racing into one deck — parallel AI deck
  // steps — can no longer both see "not in the deck yet", insert twice, or
  // take the same position. Already in the deck (any board) → no new entry;
  // the deck page is the place to adjust quantities. The entry says how it
  // got there (0144).
  const args = deckEntryOriginArgs(origin, cardTitle);
  let { data: added, error } = await supabase.rpc("add_custom_deck_entry", {
    p_deck_id: deckId,
    p_card_id: cardId,
    ...args,
  });
  // A database 0144 has not reached yet: the 3-argument call (no origin).
  // Remove once 0144 is on production and dev.
  if (isMissingOriginSignature(error)) {
    ({ data: added, error } = await supabase.rpc("add_custom_deck_entry", {
      p_deck_id: deckId,
      p_card_id: cardId,
      p_name: cardTitle,
    }));
  }
  if (error) {
    return { ok: false, error: deckEntryLimitMessage(error) ?? error.message };
  }
  if (added === false) return { ok: true, deckSlug: deck.slug };

  revalidatePath(`/deck/${deck.slug}`);
  revalidatePath(`/deck/${deck.slug}/edit`);
  revalidatePath("/dashboard/decks");
  // Profile "Decks by X" tiles show card counts — membership changes them.
  await revalidateProfilePage(supabase, userId);

  return { ok: true, deckSlug: deck.slug };
}
