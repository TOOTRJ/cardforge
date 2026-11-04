"use server";

import { createClient, getCurrentUser, getCurrentUsername } from "@/lib/supabase/server";
import { isSupabaseConfigured } from "@/lib/supabase/env";
import { isUuid } from "@/lib/ids";
import { chunkIds } from "@/lib/supabase/select-all-rows";
import { viaDeckLink } from "@/lib/decks/deck-link";
import { revalidateDeckPaths } from "@/lib/decks/revalidate";
import {
  cloneErrorMessage,
  cloneNotice,
  cloneSlugOf,
  cloneTitleOf,
  maskedCloneEntryIds,
  parseCloneResult,
  type CloneSourceCard,
  type CloneSourceRow,
} from "@/lib/decks/clone";

// ---------------------------------------------------------------------------
// "Copy deck" (TODO DK5.16): the viewer's PRIVATE copy of a deck they can
// open — a public one, an unlisted one by its link, or their own — through
// ONE database write, migration 0164's clone_deck() (the deck, its entries
// by the deck rules, the "remixed from" lineage for another owner's deck
// and the source owner's notice in one transaction). The source is read by
// its id — its link (lib/decks/deck-link.ts) — for its name and owner; for
// another owner's deck, its kept printings whose card the caller can't read
// are read too, so the copy masks what the page masks for them
// (strong language: maskedCloneEntryIds). The database decides the rest.
// No rate limit of its own: a copy is a deck made, as createDeckAction's.
// ---------------------------------------------------------------------------

export type CloneDeckResult =
  | { ok: true; deckId: string; slug: string; copied: number; skipped: number; notice: string }
  | { ok: false; code?: "AUTH_REQUIRED"; formError: string };

type Supabase = Awaited<ReturnType<typeof createClient>>;

/** The entries of another owner's deck the copy writes as "Private card"
 *  for this caller. */
async function maskedEntriesFor(supabase: Supabase, deckId: string, callerId: string, deckOwnerId: string): Promise<string[]> {
  if (callerId === deckOwnerId) return [];
  const { data: rows } = await viaDeckLink(
    supabase
      .from("deck_cards")
      .select("id, card_id, name, type_line, scryfall_id, source")
      .eq("deck_id", deckId)
      .not("scryfall_id", "is", null)
      .not("card_id", "is", null),
    deckId,
  );
  const entries = (rows ?? []) as CloneSourceRow[];
  if (entries.length === 0) return [];
  const cardIds = [...new Set(entries.map((row) => row.card_id).filter((id): id is string => Boolean(id)))];
  const cards: CloneSourceCard[] = [];
  for (const chunk of chunkIds(cardIds)) {
    const { data } = await supabase.from("cards").select("id, owner_id, visibility").in("id", chunk);
    cards.push(...((data ?? []) as CloneSourceCard[]));
  }
  return maskedCloneEntryIds(entries, cards, callerId, deckOwnerId);
}

export async function cloneDeckAction(sourceDeckId: unknown): Promise<CloneDeckResult> {
  if (typeof sourceDeckId !== "string" || !isUuid(sourceDeckId)) {
    return { ok: false, formError: "That deck can't be copied." };
  }
  if (!isSupabaseConfigured()) return { ok: false, formError: "Decks aren't available right now." };
  const user = await getCurrentUser();
  if (!user) return { ok: false, code: "AUTH_REQUIRED", formError: "Sign in to copy this deck." };

  const supabase = await createClient();
  const { data: source } = await viaDeckLink(
    supabase.from("decks").select("id, title, owner_id").eq("id", sourceDeckId),
    sourceDeckId,
  ).maybeSingle();
  if (!source) return { ok: false, formError: cloneErrorMessage({ message: "deck_not_found" }) };

  const title = cloneTitleOf(source.title);
  const masked = await maskedEntriesFor(supabase, sourceDeckId, user.id, source.owner_id);
  const { data, error } = await supabase.rpc("clone_deck", {
    p_source_deck_id: sourceDeckId,
    p_title: title,
    p_slug: cloneSlugOf(title),
    p_masked_entry_ids: masked,
  });
  const result = error ? null : parseCloneResult(data);
  if (!result) return { ok: false, formError: cloneErrorMessage(error) };

  revalidateDeckPaths(result.slug, await getCurrentUsername());
  return { ok: true, ...result, notice: cloneNotice(result) };
}
