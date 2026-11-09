import "server-only";

import { narrowCard } from "@/lib/cards/narrow";
import { viaDeckLink } from "@/lib/decks/deck-link";
import { publicDeckItems } from "@/lib/decks/private-card-name";
import { listDeckCards } from "@/lib/decks/queries";
import { isUuid } from "@/lib/ids";
import { getSiteBaseUrl } from "@/lib/site-url";
import { createClient } from "@/lib/supabase/server";
import { buildCardsExport, buildDeckExport, type PlayCardRow } from "./build";
import { fileStemOf, MAX_PLAY_SELECTION, type PlayExport } from "./model";

// ---------------------------------------------------------------------------
// The play export's READS — the rows the viewer may see, the way every deck
// surface reads them:
//   * a deck: listDeckCards (the D3 rule: another creator's card only while
//     public) and publicDeckItems (a private card's title never reaches a
//     visitor), its row by its id through viaDeckLink (an unlisted deck
//     opens by its link, migration 0151);
//   * a selection: the viewer's own cards at any visibility, another
//     creator's only while public (the deck rule, canLinkIntoDeck) — so a
//     card RLS would hand over as unlisted is never written into a file.
// Then buildDeckExport / buildCardsExport (pure) decide the files.
// ---------------------------------------------------------------------------

/** The most custom cards one selection exports. */
export const MAX_SELECTION_CARDS = MAX_PLAY_SELECTION;

/** PipGlyph's own card back (TTS needs a back picture; never a WotC one). */
export const CARD_BACK_PATH = "/tools/play-exports/card-back.png";

async function usernamesOf(ownerIds: readonly string[]): Promise<Map<string, string | null>> {
  const ids = Array.from(new Set(ownerIds));
  const map = new Map<string, string | null>();
  if (ids.length === 0) return map;
  const supabase = await createClient();
  const { data } = await supabase.from("profiles").select("id, username").in("id", ids);
  for (const row of data ?? []) map.set(row.id as string, (row.username as string | null) ?? null);
  return map;
}

/** The deck's export as `viewerId` may read it; null when the deck isn't
 *  theirs to open (or doesn't exist). */
export async function collectDeckExport(deckId: string, viewerId: string): Promise<PlayExport | null> {
  if (!isUuid(deckId)) return null;
  const supabase = await createClient();
  const { data: deck } = await viaDeckLink(
    supabase.from("decks").select("id, owner_id, title, slug").eq("id", deckId),
    deckId,
  ).maybeSingle();
  if (!deck) return null;
  const isOwner = deck.owner_id === viewerId;
  const items = publicDeckItems(await listDeckCards(deck.id), isOwner);
  const baseUrl = getSiteBaseUrl();
  const usernames = await usernamesOf(items.flatMap((item) => (item.card ? [item.card.owner_id] : [])));
  return buildDeckExport(
    { title: deck.title as string, fileStem: fileStemOf((deck.slug as string) || (deck.title as string)) },
    items.map((item) => ({ entry: item.entry, card: (item.card as PlayCardRow | null) ?? null })),
    { baseUrl, usernames, cardBackUrl: `${baseUrl}${CARD_BACK_PATH}` },
  );
}

/** The selection's export: the cards `viewerId` may put in a file, in the
 *  order asked; `skipped` = the ids it can't (missing, or another creator's
 *  card that isn't public). */
export async function collectCardsExport(
  cardIds: readonly string[],
  viewerId: string,
): Promise<{ export: PlayExport; skipped: number }> {
  const ids = Array.from(new Set(cardIds.filter(isUuid))).slice(0, MAX_SELECTION_CARDS);
  const supabase = await createClient();
  const { data } = ids.length > 0 ? await supabase.from("cards").select("*").in("id", ids) : { data: [] };
  const byId = new Map(
    (data ?? [])
      .map(narrowCard)
      .filter((card) => card.owner_id === viewerId || card.visibility === "public")
      .map((card) => [card.id, card as unknown as PlayCardRow]),
  );
  const ordered = ids.flatMap((id) => (byId.has(id) ? [byId.get(id)!] : []));
  const baseUrl = getSiteBaseUrl();
  const usernames = await usernamesOf(ordered.map((card) => card.owner_id));
  return {
    export: buildCardsExport(ordered, { baseUrl, usernames, cardBackUrl: `${baseUrl}${CARD_BACK_PATH}` }),
    skipped: cardIds.length - ordered.length,
  };
}
