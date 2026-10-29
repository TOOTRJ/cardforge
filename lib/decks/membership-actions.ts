"use server";

import { revalidatePath } from "next/cache";
import { z } from "zod";
import { createClient, getCurrentUser } from "@/lib/supabase/server";
import { isSupabaseConfigured } from "@/lib/supabase/env";
import { isUuid } from "@/lib/ids";
import { isDeckBoard } from "@/types/deck";
import { revalidateProfilePage } from "@/lib/profile/username";
import { addCardEntryRpc } from "@/lib/decks/membership";
import { bringsCard, canLinkIntoDeck } from "@/lib/decks/entry-status";
import { listDeckMemberships, listPickerDecks } from "@/lib/decks/membership-queries";
import { chunkIds } from "@/lib/supabase/select-all-rows";
import {
  FRAME_PREVIEW_MESSAGE,
  MAX_MEMBERSHIP_BATCH,
  MAX_PICKER_CARDS,
  NOT_LINKABLE_MESSAGE,
  deckFullMessage,
  type MembershipCardResult,
} from "@/lib/decks/membership-copy";
import type {
  DeckMemberships,
  MembershipEntryWithCard,
  PickerDeck,
} from "@/lib/decks/membership-state";

// ---------------------------------------------------------------------------
// Cards in and out of the owner's decks, many at a time (TODO DK9.2): My
// Cards' "Add to deck…", the creator's box on an edit (owner decision D13:
// it acts right away, apart from Save) and the gallery's picker. ONE deck
// per call, up to MAX_MEMBERSHIP_BATCH cards, a result per card, ONE
// revalidation.
//
//   add      every card through add_custom_deck_entry (migration 0144, its
//            entry lock and `source` 'link': an existing card added to the
//            deck), in order — never a direct insert. The caller's own card
//            at any visibility, or another creator's PUBLIC card (owner
//            decision D3, canLinkIntoDeck; the database's guard says the
//            same). An admin's frame preview never joins a deck. Already in
//            the deck on any board → "already", nothing written. The deck
//            at its 500 entries (`deck_entry_limit`) → that card and every
//            one after it "deck_full", in words (deckFullMessage) — the
//            calls stop there. A new entry is the RPC's: main board, ×1
//            (one card's picker then edits it through updateDeckCardAction).
//   remove   the card's entries in the deck. An entry whose source says the
//            card BROUGHT it (the creator's add, a link, the AI) with no
//            printing goes; every other one — a printing (an import, an AI
//            restyle), an import / manual source, or NO source (a row from
//            before 0144: unknown, so the line stays) — keeps its line and
//            loses the card, as the deck page's Unlink does
//            (unlinkDeckCardAction). Each write counts on its own: one that
//            lands is revalidated even if the other fails.
// ---------------------------------------------------------------------------

export type DeckMembershipActionResult =
  | {
      ok: true;
      deckId: string;
      deckTitle: string;
      deckSlug: string;
      results: MembershipCardResult[];
      /** The deck's entries for every card asked to join it that is in it
       *  now (added, or already there) — the picker's board and quantity. */
      entries: MembershipEntryWithCard[];
    }
  | { ok: false; error: string };

export type DeckPickerDataResult =
  | {
      ok: true;
      decks: PickerDeck[];
      memberships: DeckMemberships;
    }
  | { ok: false; error: string; signedOut?: true };

const cardIdsSchema = (max: number) =>
  z.array(z.string().refine((id) => isUuid(id), "Invalid card id.")).max(max, `At most ${max} cards at a time.`);

const membershipSchema = z
  .object({
    deckId: z.string().refine((id) => isUuid(id), "Invalid deck id."),
    add: cardIdsSchema(MAX_MEMBERSHIP_BATCH).default([]),
    remove: cardIdsSchema(MAX_MEMBERSHIP_BATCH).default([]),
  })
  .refine((input) => input.add.length + input.remove.length > 0, { message: "No cards to change." })
  // The cap is the CALL's (one RPC or write per card), adds and removes
  // together.
  .refine((input) => input.add.length + input.remove.length <= MAX_MEMBERSHIP_BATCH, {
    message: `At most ${MAX_MEMBERSHIP_BATCH} cards at a time.`,
  })
  .refine((input) => !input.add.some((id) => input.remove.includes(id)), {
    message: "A card can't join and leave a deck at once.",
  });

type CardRow = { id: string; title: string; owner_id: string; visibility: string; frame_preview: boolean | null };
type EntryRow = { id: string; deck_id: string; card_id: string | null; board: string; quantity: number };
type RemovableEntry = { id: string; card_id: string | null; scryfall_id: string | null; source?: string | null };

/** The entry may hold a decklist line the deck keeps without the card. Only
 *  an entry whose source SAYS the card brought it, with no printing, is the
 *  card's alone: a NULL / missing source is unknown — a pre-0144 import line
 *  linked to a card later reads the same as the creator's add — and in
 *  doubt the line stays (a leftover name can be removed by hand; a deleted
 *  line can't be brought back). */
function keepsLine(entry: RemovableEntry): boolean {
  if (entry.scryfall_id) return true;
  return !bringsCard(entry.source);
}

const unique = (ids: readonly string[]) => Array.from(new Set(ids.map((id) => id.toLowerCase())));

export async function changeDeckMembershipAction(payload: unknown): Promise<DeckMembershipActionResult> {
  const parsed = membershipSchema.safeParse(payload);
  if (!parsed.success) {
    return { ok: false, error: parsed.error.issues[0]?.message ?? "Invalid change." };
  }
  if (!isSupabaseConfigured()) return { ok: false, error: "Supabase isn't configured." };
  const user = await getCurrentUser();
  if (!user) return { ok: false, error: "Sign in to add cards to decks." };

  const supabase = await createClient();
  const { data: deck } = await supabase
    .from("decks")
    .select("id, slug, title, owner_id")
    .eq("id", parsed.data.deckId)
    .maybeSingle();
  if (!deck || deck.owner_id !== user.id) {
    return { ok: false, error: "Deck not found or not yours." };
  }

  const addIds = unique(parsed.data.add);
  const removeIds = unique(parsed.data.remove);
  const results: MembershipCardResult[] = [];
  let changed = false;

  // ---- add -------------------------------------------------------------
  const cardById = new Map<string, CardRow>();
  for (const ids of chunkIds(addIds)) {
    const { data } = await supabase
      .from("cards")
      .select("id, title, owner_id, visibility, frame_preview")
      .in("id", ids);
    for (const card of (data ?? []) as CardRow[]) cardById.set(card.id.toLowerCase(), card);
  }
  let full = false;
  const inDeck: string[] = [];
  for (const cardId of addIds) {
    if (full) {
      results.push({ cardId, status: "deck_full", error: deckFullMessage(deck.title) });
      continue;
    }
    // RLS hides another creator's private card: it reads as missing.
    const card = cardById.get(cardId);
    if (!card) {
      results.push({ cardId, status: "refused", error: "That card isn't available — it may be private or deleted." });
      continue;
    }
    if (card.frame_preview === true) {
      results.push({ cardId, status: "refused", error: FRAME_PREVIEW_MESSAGE });
      continue;
    }
    if (!canLinkIntoDeck(card, user.id)) {
      results.push({ cardId, status: "refused", error: NOT_LINKABLE_MESSAGE });
      continue;
    }
    const { added: wasAdded, error } = await addCardEntryRpc(supabase, deck.id, card.id, card.title, {
      source: "link",
    });
    if (error) {
      if (error.message.includes("deck_entry_limit")) {
        full = true;
        results.push({ cardId, status: "deck_full", error: deckFullMessage(deck.title) });
      } else if (error.message.includes("deck_card_not_linkable")) {
        results.push({ cardId, status: "refused", error: NOT_LINKABLE_MESSAGE });
      } else {
        results.push({ cardId, status: "failed", error: error.message });
      }
      continue;
    }
    if (wasAdded === false) {
      results.push({ cardId, status: "already" });
      inDeck.push(card.id);
      continue;
    }
    results.push({ cardId, status: "added" });
    inDeck.push(card.id);
    changed = true;
  }

  const entries: MembershipEntryWithCard[] = [];
  for (const ids of chunkIds(inDeck)) {
    const { data } = await supabase
      .from("deck_cards")
      .select("id, deck_id, card_id, board, quantity")
      .eq("deck_id", deck.id)
      .in("card_id", ids)
      .order("id", { ascending: true });
    for (const row of (data ?? []) as EntryRow[]) {
      if (!row.card_id) continue;
      entries.push({
        cardId: row.card_id,
        deckId: row.deck_id,
        entryId: row.id,
        board: isDeckBoard(row.board) ? row.board : "main",
        quantity: row.quantity,
      });
    }
  }

  // ---- remove ----------------------------------------------------------
  if (removeIds.length > 0) {
    const found: RemovableEntry[] = [];
    let readFailed = false;
    for (const ids of chunkIds(removeIds)) {
      // `*`: the row reads the same whether or not the database has 0144's
      // `source` yet.
      const { data, error } = await supabase
        .from("deck_cards")
        .select("*")
        .eq("deck_id", deck.id)
        .in("card_id", ids);
      if (error) readFailed = true;
      found.push(...((data ?? []) as RemovableEntry[]));
    }
    const unlink = found.filter(keepsLine).map((entry) => entry.id);
    const drop = found.filter((entry) => !keepsLine(entry)).map((entry) => entry.id);
    // Each write on its own: one that lands is a change (revalidated, its
    // cards reported removed) even when the other fails.
    const failedEntries = new Map<string, string>();
    const write = async (ids: string[], run: (ids: string[]) => PromiseLike<{ error: { message: string } | null }>) => {
      if (ids.length === 0) return;
      const { error } = await run(ids);
      if (error) for (const id of ids) failedEntries.set(id, error.message);
      else changed = true;
    };
    if (!readFailed) {
      await write(unlink, (ids) => supabase.from("deck_cards").update({ card_id: null }).in("id", ids));
      await write(drop, (ids) => supabase.from("deck_cards").delete().in("id", ids));
    }
    for (const cardId of removeIds) {
      const own = found.filter((entry) => entry.card_id?.toLowerCase() === cardId);
      const failure = own.map((entry) => failedEntries.get(entry.id)).find(Boolean);
      if (readFailed) results.push({ cardId, status: "failed", error: "Couldn't read the deck." });
      else if (failure) results.push({ cardId, status: "failed", error: failure });
      else results.push({ cardId, status: own.length > 0 ? "removed" : "not_in_deck" });
    }
  }

  if (changed) {
    revalidatePath(`/deck/${deck.slug}`);
    revalidatePath(`/deck/${deck.slug}/edit`);
    revalidatePath("/dashboard/decks");
    // My Cards' "In N decks" chips.
    revalidatePath("/dashboard/cards");
    revalidatePath("/decks");
    // The profile's deck tiles show card counts.
    await revalidateProfilePage(supabase, user.id);
  }

  return {
    ok: true,
    deckId: deck.id,
    deckTitle: deck.title,
    deckSlug: deck.slug,
    results,
    entries,
  };
}

/**
 * What the picker needs, read with the caller's session: their decks, and
 * which of them hold these cards. Read when a picker opens — never on a public page's
 * render (the card page stays free of a deck read for every visitor).
 */
export async function getDeckPickerDataAction(cardIds: unknown): Promise<DeckPickerDataResult> {
  const parsed = cardIdsSchema(MAX_PICKER_CARDS).safeParse(cardIds);
  if (!parsed.success) return { ok: false, error: parsed.error.issues[0]?.message ?? "Invalid cards." };
  if (!isSupabaseConfigured()) return { ok: false, error: "Supabase isn't configured." };
  const user = await getCurrentUser();
  if (!user) return { ok: false, error: "Sign in to add cards to decks.", signedOut: true };

  const supabase = await createClient();
  const decks = await listPickerDecks(supabase, user.id);
  if (!decks) return { ok: false, error: "Couldn't read your decks." };
  const memberships = await listDeckMemberships(
    supabase,
    decks.map((deck) => deck.id),
    unique(parsed.data),
  );
  if (!memberships) return { ok: false, error: "Couldn't read your decks." };
  return { ok: true, decks, memberships };
}
