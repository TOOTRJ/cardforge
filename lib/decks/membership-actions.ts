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
  readVisibilityPreflight,
  storedLanguageBlocks,
  type VisibilityPreflightRow,
} from "@/lib/cards/visibility-preflight";
import {
  FRAME_PREVIEW_MESSAGE,
  MAX_MEMBERSHIP_BATCH,
  PUBLISH_REFUSED_MESSAGE,
  MAX_PICKER_CARDS,
  NOT_LINKABLE_MESSAGE,
  deckFullMessage,
  deckShowsPrivateCards,
  privateCardLanguageReason,
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
//
// The caller's own PRIVATE card joining a deck others can open (public or
// unlisted) shows there as "Private card" to visitors (D11). TODO DK0.13
// (owner 2026-10-29) offers to make it public first — decided HERE, from
// the rows, never from the client:
//   privateCards "ask"   such a card is NOT added: its result is
//                        "private_card" (with the reason it can't go public
//                        when its text holds strong language), and the
//                        picker asks "Make it public" / "Add as private".
//   privateCards "keep"  (the default: an Undo, a new deck's first card)
//                        added as it is — today's behaviour.
//   publish [ids]        cards (a subset of `add`) to make public BEFORE the
//                        add, through THE site's visibility change
//                        (updateCardsVisibilityAction — ownership, frame
//                        previews, the strong-language rule, a second
//                        face's name, the bake and the revalidation, as My
//                        Cards' bulk bar). One still private after it is
//                        "publish_refused" and NOT added — the maker picks
//                        "Add as private" for that. Publish first, then
//                        add: a publish that lands and an add that then
//                        fails (the deck full) says both (`published`).
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
    privateCards: z.enum(["ask", "keep"]).default("keep"),
    publish: cardIdsSchema(MAX_MEMBERSHIP_BATCH).default([]),
  })
  .refine((input) => input.add.length + input.remove.length > 0, { message: "No cards to change." })
  // The cap is the CALL's (one RPC or write per card), adds and removes
  // together.
  .refine((input) => input.add.length + input.remove.length <= MAX_MEMBERSHIP_BATCH, {
    message: `At most ${MAX_MEMBERSHIP_BATCH} cards at a time.`,
  })
  .refine((input) => !input.add.some((id) => input.remove.includes(id)), {
    message: "A card can't join and leave a deck at once.",
  })
  .refine(
    (input) => {
      const adding = new Set(input.add.map((id) => id.toLowerCase()));
      return input.publish.every((id) => adding.has(id.toLowerCase()));
    },
    { message: "Only a card being added can be made public here." },
  );

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

/** Of `cards`, the caller's own PRIVATE ones (never a frame preview) that a
 *  deck of `deckVisibility` would show as "Private card" (TODO DK0.13) —
 *  lower-cased ids — and, for each that its text keeps private, why. Read
 *  from the rows, with the caller's session. */
async function privateCardsOf(
  supabase: Awaited<ReturnType<typeof createClient>>,
  userId: string,
  deckVisibility: string | null | undefined,
  cards: readonly CardRow[],
): Promise<{ privateOwn: Set<string>; languageReason: Map<string, string> }> {
  const privateOwn = new Set(
    deckShowsPrivateCards(deckVisibility)
      ? cards
          .filter((card) => card.owner_id === userId && card.visibility === "private" && card.frame_preview !== true)
          .map((card) => card.id.toLowerCase())
      : [],
  );
  const languageReason = new Map<string, string>();
  if (privateOwn.size === 0) return { privateOwn, languageReason };
  const read = await readVisibilityPreflight(supabase, [...privateOwn]);
  const rows = new Map<string, VisibilityPreflightRow>((read.rows ?? []).map((row) => [row.id.toLowerCase(), row]));
  for (const cardId of privateOwn) {
    const row = rows.get(cardId);
    const fields = row ? storedLanguageBlocks(row, "public") : [];
    if (fields.length > 0) languageReason.set(cardId, privateCardLanguageReason(fields));
  }
  return { privateOwn, languageReason };
}

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
    .select("id, slug, title, owner_id, visibility")
    .eq("id", parsed.data.deckId)
    .maybeSingle();
  if (!deck || deck.owner_id !== user.id) {
    return { ok: false, error: "Deck not found or not yours." };
  }

  const addIds = unique(parsed.data.add);
  const publishIds = new Set(unique(parsed.data.publish));
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
  // ---- the caller's private cards in a deck others can open (DK0.13) ----
  const asking = parsed.data.privateCards === "ask";
  const { privateOwn, languageReason } = await privateCardsOf(
    supabase,
    user.id,
    deck.visibility,
    addIds.filter((cardId) => asking || publishIds.has(cardId)).flatMap((cardId) => cardById.get(cardId) ?? []),
  );
  const published = new Set<string>();
  /** The publish's refusal, for every card it was asked for. */
  let publishError: string | null = null;
  if (privateOwn.size > 0) {
    // Publish first (a card its text keeps private is never sent: it would
    // only be skipped), then add.
    const sendable = [...privateOwn].filter((cardId) => publishIds.has(cardId) && !languageReason.has(cardId));
    if (sendable.length > 0) {
      // Loaded when used: the card actions are a large module every deck
      // action would otherwise pull in.
      const { updateCardsVisibilityAction } = await import("@/lib/cards/actions");
      const outcome = await updateCardsVisibilityAction(
        sendable.map((cardId) => cardById.get(cardId)!.id),
        "public",
      );
      if (!outcome.ok) {
        publishError = outcome.error;
      } else {
        // What the publish really did, read back — never its count alone.
        for (const ids of chunkIds(sendable)) {
          const { data } = await supabase.from("cards").select("id, visibility").in("id", ids);
          for (const row of (data ?? []) as Array<{ id: string; visibility: string }>) {
            if (row.visibility === "public") published.add(row.id.toLowerCase());
          }
        }
        if (published.size > 0) changed = true;
      }
    }
  }

  let full = false;
  const inDeck: string[] = [];
  for (const cardId of addIds) {
    const publishedFlag = published.has(cardId) ? { published: true as const } : {};
    if (full) {
      results.push({ cardId, status: "deck_full", error: deckFullMessage(deck.title), ...publishedFlag });
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
    if (privateOwn.has(cardId) && !published.has(cardId)) {
      const reason = languageReason.get(cardId);
      if (publishIds.has(cardId)) {
        // Asked to go public and still private: not added (the maker may
        // add it as private instead).
        results.push({
          cardId,
          status: "publish_refused",
          error: reason ?? publishError ?? PUBLISH_REFUSED_MESSAGE,
        });
        continue;
      }
      if (asking) {
        results.push({ cardId, status: "private_card", ...(reason ? { languageReason: reason } : {}) });
        continue;
      }
    }
    const { added: wasAdded, error } = await addCardEntryRpc(supabase, deck.id, card.id, card.title, {
      source: "link",
    });
    if (error) {
      if (error.message.includes("deck_entry_limit")) {
        full = true;
        results.push({ cardId, status: "deck_full", error: deckFullMessage(deck.title), ...publishedFlag });
      } else if (error.message.includes("deck_card_not_linkable")) {
        results.push({ cardId, status: "refused", error: NOT_LINKABLE_MESSAGE, ...publishedFlag });
      } else {
        results.push({ cardId, status: "failed", error: error.message, ...publishedFlag });
      }
      continue;
    }
    if (wasAdded === false) {
      results.push({ cardId, status: "already", ...publishedFlag });
      inDeck.push(card.id);
      continue;
    }
    results.push({ cardId, status: "added", ...publishedFlag });
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

export type PrivateCardOfferResult =
  | {
      ok: true;
      /** The cards the deck would show as "Private card" — each with the
       *  reason it can't be made public, when its text keeps it private.
       *  Empty: nothing to ask. */
      cards: Array<{ cardId: string; languageReason?: string }>;
    }
  | { ok: false; error: string };

/**
 * Would adding these cards to this deck show any as "Private card" (TODO
 * DK0.13)? A READ, nothing written — for a surface that adds through its own
 * path and asks first (the deck page's add box: its add is drawn at once,
 * so it asks before it draws). The same answer changeDeckMembershipAction's
 * `privateCards: "ask"` gives.
 */
export async function privateCardOfferAction(payload: unknown): Promise<PrivateCardOfferResult> {
  const parsed = z
    .object({
      deckId: z.string().refine((id) => isUuid(id), "Invalid deck id."),
      cardIds: cardIdsSchema(MAX_MEMBERSHIP_BATCH).min(1, "No cards."),
    })
    .safeParse(payload);
  if (!parsed.success) return { ok: false, error: parsed.error.issues[0]?.message ?? "Invalid cards." };
  if (!isSupabaseConfigured()) return { ok: false, error: "Supabase isn't configured." };
  const user = await getCurrentUser();
  if (!user) return { ok: false, error: "Sign in to add cards to decks." };

  const supabase = await createClient();
  const { data: deck } = await supabase
    .from("decks")
    .select("id, owner_id, visibility")
    .eq("id", parsed.data.deckId)
    .maybeSingle();
  if (!deck || deck.owner_id !== user.id) return { ok: false, error: "Deck not found or not yours." };
  if (!deckShowsPrivateCards(deck.visibility)) return { ok: true, cards: [] };

  const ids = unique(parsed.data.cardIds);
  const rows: CardRow[] = [];
  for (const chunk of chunkIds(ids)) {
    const { data } = await supabase
      .from("cards")
      .select("id, title, owner_id, visibility, frame_preview")
      .in("id", chunk);
    rows.push(...((data ?? []) as CardRow[]));
  }
  const { privateOwn, languageReason } = await privateCardsOf(supabase, user.id, deck.visibility, rows);
  return {
    ok: true,
    cards: ids
      .filter((cardId) => privateOwn.has(cardId))
      .map((cardId) => {
        const reason = languageReason.get(cardId);
        return { cardId, ...(reason ? { languageReason: reason } : {}) };
      }),
  };
}
