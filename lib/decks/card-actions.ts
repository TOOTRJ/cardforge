"use server";

import { revalidatePath } from "next/cache";
import { z } from "zod";
import { createClient, getCurrentUser } from "@/lib/supabase/server";
import { isSupabaseConfigured } from "@/lib/supabase/env";
import { DECK_BOARD_VALUES, type DeckBoard } from "@/types/deck";
import { isUuid } from "@/lib/ids";
import { revalidateProfilePage } from "@/lib/profile/username";
import { bringsCard, canLinkIntoDeck } from "@/lib/decks/entry-status";
import { createAdminClient, isAdminConfigured } from "@/lib/supabase/admin";
import { recordFunnelEvent } from "@/lib/analytics/funnel-server";
import { chunkIds, selectAllRows } from "@/lib/supabase/select-all-rows";
import { revalidateDeckEntryChange } from "@/lib/decks/revalidate";
import { commitDeckImportAction } from "@/lib/decks/import";
import { changeDeckMembershipAction } from "@/lib/decks/membership-actions";
import {
  groupEntryUpdates,
  planRestore,
  removedEntryOf,
  removeEntriesSchema,
  restoreEntriesSchema,
  restoreLineKey,
  updateEntriesSchema,
  type RemovedEntry,
  type RestoredEntry,
} from "@/lib/decks/entry-batch";

// ---------------------------------------------------------------------------
// Deck entry actions — the deck-card modal's mutations: quantity/board
// edits, remove, and linking/unlinking a PipGlyph card. Same
// discriminated-union posture as lib/decks/actions.ts.
// ---------------------------------------------------------------------------

export type DeckCardActionResult =
  | { ok: true; deckCardId: string }
  | { ok: false; error: string };

type OwnedEntry = {
  id: string;
  deck_id: string;
  /** The linked card before this action — null for an entry with none yet
   *  (the funnel's deck_card_customized counts the first). */
  card_id: string | null;
  scryfall_id?: string | null;
  /** Absent on a database 0144 has not reached. */
  source?: string | null;
};

/** Load an entry + prove the caller owns its deck. Returns the deck slug
 *  for revalidation. (`*`: the row reads the same whether or not the
 *  database has 0144's `source` yet.) */
async function getOwnedEntry(
  supabase: Awaited<ReturnType<typeof createClient>>,
  userId: string,
  deckCardId: string,
): Promise<
  | { ok: true; entry: OwnedEntry; deckSlug: string }
  | { ok: false; error: string }
> {
  const { data: entry } = (await supabase
    .from("deck_cards")
    .select("*")
    .eq("id", deckCardId)
    .maybeSingle()) as { data: OwnedEntry | null };
  if (!entry) return { ok: false, error: "Deck entry not found." };

  const { data: deck } = await supabase
    .from("decks")
    .select("id, slug, owner_id")
    .eq("id", entry.deck_id)
    .maybeSingle();
  if (!deck || deck.owner_id !== userId) {
    return { ok: false, error: "Deck not found or not yours." };
  }
  return { ok: true, entry, deckSlug: deck.slug };
}

async function revalidateDeckCardPaths(
  supabase: Awaited<ReturnType<typeof createClient>>,
  userId: string,
  deckSlug: string,
) {
  revalidatePath(`/deck/${deckSlug}`);
  revalidatePath(`/deck/${deckSlug}/edit`);
  revalidatePath("/dashboard/decks");
  revalidatePath("/decks");
  // The profile's "Decks by X" tiles show card counts + "made on PipGlyph" — entry
  // mutations change those numbers too.
  await revalidateProfilePage(supabase, userId);
}

const updateDeckCardSchema = z
  .object({
    quantity: z.number().int().min(1).max(250).optional(),
    board: z.enum(DECK_BOARD_VALUES).optional(),
  })
  .refine((patch) => Object.keys(patch).length > 0, {
    message: "No changes provided.",
  });

export async function updateDeckCardAction(
  deckCardId: string,
  payload: unknown,
): Promise<DeckCardActionResult> {
  if (!isUuid(deckCardId)) {
    return { ok: false, error: "Invalid deck entry id." };
  }
  const parsed = updateDeckCardSchema.safeParse(payload);
  if (!parsed.success) {
    return {
      ok: false,
      error: parsed.error.issues[0]?.message ?? "Invalid change.",
    };
  }
  if (!isSupabaseConfigured()) {
    return { ok: false, error: "Supabase isn't configured." };
  }
  const user = await getCurrentUser();
  if (!user) return { ok: false, error: "Sign in to edit decks." };

  const supabase = await createClient();
  const owned = await getOwnedEntry(supabase, user.id, deckCardId);
  if (!owned.ok) return owned;

  const { error } = await supabase
    .from("deck_cards")
    .update(parsed.data)
    .eq("id", deckCardId);
  if (error) return { ok: false, error: error.message };

  await revalidateDeckCardPaths(supabase, user.id, owned.deckSlug);
  return { ok: true, deckCardId };
}

export async function removeDeckCardAction(
  deckCardId: string,
): Promise<DeckCardActionResult> {
  if (!isUuid(deckCardId)) {
    return { ok: false, error: "Invalid deck entry id." };
  }
  if (!isSupabaseConfigured()) {
    return { ok: false, error: "Supabase isn't configured." };
  }
  const user = await getCurrentUser();
  if (!user) return { ok: false, error: "Sign in to edit decks." };

  const supabase = await createClient();
  const owned = await getOwnedEntry(supabase, user.id, deckCardId);
  if (!owned.ok) return owned;

  const { error } = await supabase
    .from("deck_cards")
    .delete()
    .eq("id", deckCardId);
  if (error) return { ok: false, error: error.message };

  await revalidateDeckCardPaths(supabase, user.id, owned.deckSlug);
  return { ok: true, deckCardId };
}

/** Link a PipGlyph card as this entry's card: one of the caller's own at any
 *  visibility, or another creator's PUBLIC card (owner decision D3, TODO
 *  DK2.9). The database enforces the same rule (migration 0144's
 *  deck_cards_guard_card_link: a NEW card_id is checked, so an entry whose
 *  linked card later went private stays editable); the pre-flight gives a
 *  friendlier error. The entry keeps its source — it still came from where
 *  it came from. `surface` says who linked it — the creator's
 *  /create?deckCard= save (the card was just made from the entry, the only
 *  link the funnel counts) or the deck page's picker (the default) — for
 *  the funnel only. */
export async function linkDeckCardAction(
  deckCardId: string,
  cardId: string,
  options: { surface?: "creator" | "deck" } = {},
): Promise<DeckCardActionResult> {
  if (!isUuid(deckCardId) || !isUuid(cardId)) {
    return { ok: false, error: "Invalid id." };
  }
  if (!isSupabaseConfigured()) {
    return { ok: false, error: "Supabase isn't configured." };
  }
  const user = await getCurrentUser();
  if (!user) return { ok: false, error: "Sign in to edit decks." };

  const supabase = await createClient();
  const owned = await getOwnedEntry(supabase, user.id, deckCardId);
  if (!owned.ok) return owned;

  const { data: card } = await supabase
    .from("cards")
    .select("id, owner_id, visibility")
    .eq("id", cardId)
    .maybeSingle();
  if (!card || !canLinkIntoDeck(card, user.id)) {
    return {
      ok: false,
      error: "You can link your own cards, or another creator's public card.",
    };
  }

  const { error } = await supabase
    .from("deck_cards")
    .update({ card_id: cardId })
    .eq("id", deckCardId);
  if (error) return { ok: false, error: error.message };

  // Funnel (TODO DK3.8): the entry got its FIRST card of the user's, MADE
  // from it in the creator — an imported card customized (owner decision
  // D2: the moment it takes a saved-card slot) or a placeholder filled. A
  // card linked from the deck page already existed (no new slot), and a
  // re-link is not counted.
  if (options.surface === "creator" && owned.entry.card_id === null && isAdminConfigured()) {
    await recordFunnelEvent(createAdminClient(), {
      event: "deck_card_customized",
      userId: user.id,
      props: {
        surface: "creator",
        kind: owned.entry.scryfall_id ? "import" : "placeholder",
      },
    });
  }

  await revalidateDeckCardPaths(supabase, user.id, owned.deckSlug);
  return { ok: true, deckCardId };
}

export async function unlinkDeckCardAction(
  deckCardId: string,
): Promise<DeckCardActionResult> {
  if (!isUuid(deckCardId)) {
    return { ok: false, error: "Invalid deck entry id." };
  }
  if (!isSupabaseConfigured()) {
    return { ok: false, error: "Supabase isn't configured." };
  }
  const user = await getCurrentUser();
  if (!user) return { ok: false, error: "Sign in to edit decks." };

  const supabase = await createClient();
  const owned = await getOwnedEntry(supabase, user.id, deckCardId);
  if (!owned.ok) return owned;

  // An entry the card itself brought (the creator's add, a link, the AI)
  // with no printing is a plain name once its card is unlinked: its source
  // goes too, so it never reads "No longer available" — that is a card the
  // OWNER didn't take away (lib/decks/entry-status.ts deckEntryUnavailable).
  // An import keeps its source: it is the real card again.
  const clearsSource = !owned.entry.scryfall_id && bringsCard(owned.entry.source);
  const { error } = await supabase
    .from("deck_cards")
    .update(clearsSource ? { card_id: null, source: null } : { card_id: null })
    .eq("id", deckCardId);
  if (error) return { ok: false, error: error.message };

  await revalidateDeckCardPaths(supabase, user.id, owned.deckSlug);
  return { ok: true, deckCardId };
}

// ---------------------------------------------------------------------------
// Link picker data — a lite listing of the caller's cards, lazily fetched
// by the deck-card modal's "Link an existing card" panel.
// ---------------------------------------------------------------------------

export type MyCardLite = {
  id: string;
  title: string;
  slug: string;
  /** The HD bake — read only to vouch for the thumb beside it (and drawn
   *  resized by next/image for a bake older than thumbnails). */
  rendered_image_url: string | null;
  /** The 600 px WebP the picker's tiles draw (never the ~3 MB PNG). */
  rendered_thumb_url: string | null;
};

export type ListMyCardsLiteResult =
  | { ok: true; cards: MyCardLite[] }
  | { ok: false; error: string };

export async function listMyCardsLiteAction(): Promise<ListMyCardsLiteResult> {
  if (!isSupabaseConfigured()) {
    return { ok: false, error: "Supabase isn't configured." };
  }
  const user = await getCurrentUser();
  if (!user) return { ok: false, error: "Sign in first." };

  const supabase = await createClient();
  const { data, error } = await supabase
    .from("cards")
    .select("id, title, slug, rendered_image_url, rendered_thumb_url")
    .eq("owner_id", user.id)
    .order("updated_at", { ascending: false })
    .limit(200);
  if (error) return { ok: false, error: error.message };
  return { ok: true, cards: data ?? [] };
}

// ---------------------------------------------------------------------------
// The deck page's batch writes (TODO DK5.4 / DK5.8) — the owner's steppers,
// "Move to" and Remove, one entry or a whole selection: ONE deck per call,
// every entry of it in a handful of statements (lib/decks/entry-batch.ts),
// ONE revalidation — the deck's paths with their IndexNow ping
// (revalidateDeckPaths) and My Cards' "In N decks" chips. The revalidation
// is also how the page gets the server's answer: an action that
// revalidates the page it was called from brings that page back with it,
// so the owner's page needs no router.refresh() after an edit (it draws the
// edit at once, components/decks/use-deck-editor.tsx, and the rows the
// server sends replace it).
// ---------------------------------------------------------------------------

export type DeckEntriesUpdateResult =
  | { ok: true; entries: Array<{ id: string; quantity: number; board: string }> }
  | { ok: false; error: string };

export type DeckEntriesRemoveResult =
  | { ok: true; removed: RemovedEntry[] }
  | { ok: false; error: string };

export type DeckEntriesRestoreResult =
  | { ok: true; restored: RestoredEntry[] }
  | { ok: false; error: string };

type SessionClient = Awaited<ReturnType<typeof createClient>>;
type OwnedDeck = { id: string; slug: string; title: string; owner_id: string };

async function getOwnedDeck(supabase: SessionClient, userId: string, deckId: string): Promise<OwnedDeck | null> {
  const { data: deck } = await supabase
    .from("decks")
    .select("id, slug, title, owner_id")
    .eq("id", deckId)
    .maybeSingle();
  return deck && deck.owner_id === userId ? deck : null;
}

/** Quantities and boards, many entries of ONE deck at once. Every
 *  statement is held to the deck (`deck_id`) as well as to RLS, so an id
 *  from another deck changes nothing; the answer is the rows as they now
 *  are. A statement that fails after another landed still revalidates. */
export async function updateDeckEntriesAction(payload: unknown): Promise<DeckEntriesUpdateResult> {
  const parsed = updateEntriesSchema.safeParse(payload);
  if (!parsed.success) return { ok: false, error: parsed.error.issues[0]?.message ?? "Invalid change." };
  if (!isSupabaseConfigured()) return { ok: false, error: "Supabase isn't configured." };
  const user = await getCurrentUser();
  if (!user) return { ok: false, error: "Sign in to edit decks." };

  const supabase = await createClient();
  const deck = await getOwnedDeck(supabase, user.id, parsed.data.deckId);
  if (!deck) return { ok: false, error: "Deck not found or not yours." };

  const entries: Array<{ id: string; quantity: number; board: string }> = [];
  let failure: string | null = null;
  outer: for (const { patch, ids } of groupEntryUpdates(parsed.data.updates)) {
    for (const chunk of chunkIds(ids)) {
      const { data, error } = await supabase
        .from("deck_cards")
        .update(patch)
        .eq("deck_id", deck.id)
        .in("id", chunk)
        .select("id, quantity, board");
      if (error) {
        failure = error.message;
        break outer;
      }
      entries.push(...(data ?? []));
    }
  }

  if (entries.length > 0) await revalidateDeckEntryChange(supabase, user.id, deck.slug);
  if (failure) return { ok: false, error: failure };
  // Nothing matched: the entries are gone (removed in another tab).
  if (entries.length === 0) return { ok: false, error: "Those cards are no longer in the deck." };
  return { ok: true, entries };
}

/** Removes entries of ONE deck — and hands back each line as it was, the
 *  owner's undo (restoreDeckEntriesAction). */
export async function removeDeckEntriesAction(payload: unknown): Promise<DeckEntriesRemoveResult> {
  const parsed = removeEntriesSchema.safeParse(payload);
  if (!parsed.success) return { ok: false, error: parsed.error.issues[0]?.message ?? "Invalid change." };
  if (!isSupabaseConfigured()) return { ok: false, error: "Supabase isn't configured." };
  const user = await getCurrentUser();
  if (!user) return { ok: false, error: "Sign in to edit decks." };

  const supabase = await createClient();
  const deck = await getOwnedDeck(supabase, user.id, parsed.data.deckId);
  if (!deck) return { ok: false, error: "Deck not found or not yours." };

  const removed: RemovedEntry[] = [];
  let failure: string | null = null;
  for (const chunk of chunkIds(Array.from(new Set(parsed.data.entryIds)))) {
    // The delete RETURNS the rows, so the undo is exactly what went (`*`:
    // the row reads the same with or without 0144's `source`).
    const { data, error } = await supabase
      .from("deck_cards")
      .delete()
      .eq("deck_id", deck.id)
      .in("id", chunk)
      .select("*");
    if (error) {
      failure = error.message;
      break;
    }
    for (const row of (data ?? []) as Array<Parameters<typeof removedEntryOf>[0]>) removed.push(removedEntryOf(row));
  }

  if (removed.length > 0) await revalidateDeckEntryChange(supabase, user.id, deck.slug);
  if (failure) return { ok: false, error: failure };
  if (removed.length === 0) return { ok: false, error: "Those cards are no longer in the deck." };
  return { ok: true, removed };
}

type RestoreRow = { id: string; board: string; name: string; scryfall_id: string | null; card_id: string | null };

/** Every entry row of the deck, in list order (≤ 500 since 0143). */
async function readRestoreRows(supabase: SessionClient, deckId: string): Promise<RestoreRow[]> {
  const { data } = await selectAllRows<RestoreRow>((from, to) =>
    supabase
      .from("deck_cards")
      .select("id, board, name, scryfall_id, card_id", { count: "exact" })
      .eq("deck_id", deckId)
      .order("position", { ascending: true })
      .order("created_at", { ascending: true })
      .order("id", { ascending: true })
      .range(from, to),
  );
  return data;
}

/** Puts removed entries back — the owner's Undo — through the paths a card
 *  comes INTO a deck by (lib/decks/entry-batch.ts planRestore): the
 *  decklist commit for printings and names, the membership writer for a
 *  PipGlyph card, then each line's card, board and quantity. Never a direct
 *  insert. An entry that can't come back (the deck is full, the card is no
 *  longer yours to add) says why, one by one. */
export async function restoreDeckEntriesAction(payload: unknown): Promise<DeckEntriesRestoreResult> {
  const parsed = restoreEntriesSchema.safeParse(payload);
  if (!parsed.success) return { ok: false, error: parsed.error.issues[0]?.message ?? "Invalid change." };
  if (!isSupabaseConfigured()) return { ok: false, error: "Supabase isn't configured." };
  const user = await getCurrentUser();
  if (!user) return { ok: false, error: "Sign in to edit decks." };

  const supabase = await createClient();
  const deck = await getOwnedDeck(supabase, user.id, parsed.data.deckId);
  if (!deck) return { ok: false, error: "Deck not found or not yours." };

  const plan = planRestore(parsed.data.entries);
  const restored: RestoredEntry[] = [];
  let changed = false;

  // ---- printings and names: the decklist commit -------------------------
  let lineFailure: string | null = null;
  for (const lines of plan.lineChunks) {
    const commit = await commitDeckImportAction({ deckId: deck.id, lines });
    if (!commit.ok) {
      lineFailure = commit.error;
      break;
    }
    changed = true;
  }
  if (plan.lineEntries.length > 0) {
    // Each line's row is the one its merge key names now (the commit merged
    // into it or wrote it) — the first of a key, as the commit's merge
    // picks it.
    const rows = changed ? await readRestoreRows(supabase, deck.id) : [];
    const rowByKey = new Map<string, RestoreRow>();
    for (const row of rows) {
      const key = restoreLineKey({ board: row.board, scryfallId: row.scryfall_id, name: row.name });
      if (!rowByKey.has(key)) rowByKey.set(key, row);
    }
    for (const { entry, key } of plan.lineEntries) {
      const row = rowByKey.get(key);
      if (!row) {
        restored.push({ from: entry.id, to: null, note: lineFailure ?? `${entry.name} couldn't come back.` });
        continue;
      }
      if (entry.cardId && !row.card_id) {
        // Its card again, judged again (D3, deck_cards_guard_card_link):
        // another creator's card that is no longer public stays out, and
        // the line comes back as the real card.
        const { error } = await supabase
          .from("deck_cards")
          .update({ card_id: entry.cardId })
          .eq("deck_id", deck.id)
          .eq("id", row.id)
          .is("card_id", null);
        if (error) {
          restored.push({ from: entry.id, to: row.id, note: `${entry.name} came back without its card — that card is no longer available.` });
          continue;
        }
        row.card_id = entry.cardId;
      }
      restored.push({ from: entry.id, to: row.id });
    }
  }

  // ---- PipGlyph cards: the membership writer ----------------------------
  for (const cards of plan.cardChunks) {
    const result = await changeDeckMembershipAction({ deckId: deck.id, add: cards.map((entry) => entry.cardId!) });
    if (!result.ok) {
      for (const entry of cards) restored.push({ from: entry.id, to: null, note: result.error });
      continue;
    }
    for (const entry of cards) {
      const id = entry.cardId!.toLowerCase();
      const outcome = result.results.find((row) => row.cardId.toLowerCase() === id);
      const now = result.entries.find((row) => row.cardId.toLowerCase() === id);
      if (outcome?.status === "added" && now) {
        changed = true;
        // The RPC writes the mainboard ×1: then the entry's own board and count.
        const patch: { board?: DeckBoard; quantity?: number } = {};
        if (entry.board !== now.board) patch.board = entry.board;
        if (entry.quantity !== now.quantity) patch.quantity = entry.quantity;
        const { error } =
          Object.keys(patch).length > 0
            ? await supabase.from("deck_cards").update(patch).eq("deck_id", deck.id).eq("id", now.entryId)
            : { error: null };
        restored.push(
          error
            ? { from: entry.id, to: now.entryId, note: `${entry.name} came back on the Mainboard, ×1.` }
            : { from: entry.id, to: now.entryId },
        );
      } else if (outcome?.status === "already") {
        restored.push({ from: entry.id, to: now?.entryId ?? null, note: `${entry.name} is already in the deck.` });
      } else {
        restored.push({ from: entry.id, to: null, note: outcome?.error ?? `${entry.name} couldn't come back.` });
      }
    }
  }

  if (changed) await revalidateDeckEntryChange(supabase, user.id, deck.slug);
  return { ok: true, restored };
}
