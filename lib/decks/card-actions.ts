"use server";

import { revalidatePath } from "next/cache";
import { z } from "zod";
import { createClient, getCurrentUser } from "@/lib/supabase/server";
import { isSupabaseConfigured } from "@/lib/supabase/env";
import { DECK_BOARD_LABELS, DECK_BOARD_VALUES, isDeckBoard } from "@/types/deck";
import { isUuid } from "@/lib/ids";
import { revalidateProfilePage } from "@/lib/profile/username";
import { bringsCard, canLinkIntoDeck } from "@/lib/decks/entry-status";
import { FEATURED_PICKS_MAX } from "@/lib/decks/featured";
import { createAdminClient, isAdminConfigured } from "@/lib/supabase/admin";
import { recordFunnelEvent } from "@/lib/analytics/funnel-server";
import { chunkIds, selectAllRows } from "@/lib/supabase/select-all-rows";
import { revalidateDeckEntryChange } from "@/lib/decks/revalidate";
import { commitImportLines } from "@/lib/decks/import-commit";
import { changeDeckMembershipAction } from "@/lib/decks/membership-actions";
import { MAX_MEMBERSHIP_BATCH } from "@/lib/decks/membership-copy";
import { MAX_DECKLIST_ENTRIES, MAX_ENTRY_QUANTITY } from "@/lib/decks/parse-decklist";
import {
  chunk,
  groupEntryUpdates,
  newRowOfStagedLine,
  removedEntryOf,
  removeEntriesSchema,
  restoreEntriesSchema,
  restoresAsCard,
  mergedRowOfStagedLine,
  rowMergeKey,
  stagedLineOf,
  stageRestoreLines,
  updateEntriesSchema,
  type RemovedEntry,
  type RestoredEntry,
  type StagedLine,
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
// The cover's picks (TODO DK6.4) — the deck card modal's "Feature on cover",
// "Remove from cover" and its Earlier / Later buttons all send the deck's
// WHOLE list of picks, rank 1 first, and the database replaces them in one
// transaction (migration 0150's set_deck_featured_entries: the deck's
// entry lock, its owner only, five distinct entries of that deck at most).
// ---------------------------------------------------------------------------

export type DeckCoverPicksResult = { ok: true; picks: number } | { ok: false; error: string };

const coverPicksSchema = z
  .array(z.string().refine(isUuid, "Invalid deck entry id."))
  .max(FEATURED_PICKS_MAX, `A cover features at most ${FEATURED_PICKS_MAX} cards.`)
  .refine((ids) => new Set(ids).size === ids.length, "A card is picked twice.");

/** The words for what the database refuses (never its own text). */
function coverPicksError(error: { code?: string | null; message?: string | null }): string {
  const message = error.message ?? "";
  if (error.code === "PGRST202") return "Cover picks aren't available here yet.";
  if (message.includes("deck_featured_limit")) return `A cover features at most ${FEATURED_PICKS_MAX} cards.`;
  if (message.includes("deck_not_owned")) return "Deck not found or not yours.";
  if (message.includes("deck_featured_invalid")) return "That card isn't in this deck any more — reload the page.";
  return "The cover's cards couldn't be saved. Try again.";
}

export async function setDeckCoverPicksAction(
  deckId: string,
  entryIds: unknown,
): Promise<DeckCoverPicksResult> {
  if (!isUuid(deckId)) return { ok: false, error: "Invalid deck id." };
  const parsed = coverPicksSchema.safeParse(entryIds);
  if (!parsed.success) {
    return { ok: false, error: parsed.error.issues[0]?.message ?? "Invalid cover picks." };
  }
  if (!isSupabaseConfigured()) {
    return { ok: false, error: "Supabase isn't configured." };
  }
  const user = await getCurrentUser();
  if (!user) return { ok: false, error: "Sign in to edit decks." };

  const supabase = await createClient();
  // Ownership pre-flight for the slug and a friendly refusal (the RPC and
  // RLS hold the same line).
  const { data: deck } = await supabase.from("decks").select("id, slug, owner_id").eq("id", deckId).maybeSingle();
  if (!deck || deck.owner_id !== user.id) return { ok: false, error: "Deck not found or not yours." };

  const { data, error } = await supabase.rpc("set_deck_featured_entries", {
    p_deck_id: deckId,
    p_entry_ids: parsed.data,
  });
  if (error) return { ok: false, error: coverPicksError(error) };

  await revalidateDeckCardPaths(supabase, user.id, deck.slug);
  return { ok: true, picks: typeof data === "number" ? data : parsed.data.length };
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

/** `stale`: the entries are gone (removed in another tab) — the page's copy
 *  of the deck is out of date, so it asks for the deck again. */
export type DeckEntriesUpdateResult =
  | { ok: true; entries: Array<{ id: string; quantity: number; board: string }> }
  | { ok: false; error: string; stale?: true };

export type DeckEntriesRemoveResult =
  | { ok: true; removed: RemovedEntry[] }
  | { ok: false; error: string; stale?: true };

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
  if (entries.length === 0) return { ok: false, error: "Those cards are no longer in the deck.", stale: true };
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
  if (removed.length === 0) return { ok: false, error: "Those cards are no longer in the deck.", stale: true };
  return { ok: true, removed };
}

type RestoreRow = {
  id: string;
  board: string;
  name: string;
  scryfall_id: string | null;
  card_id: string | null;
  quantity: number;
};

/** Every entry row of the deck, in list order (≤ 500 since 0143) — null
 *  when the deck can't be read. */
async function readRestoreRows(supabase: SessionClient, deckId: string): Promise<RestoreRow[] | null> {
  const { data, error } = await selectAllRows<RestoreRow>((from, to) =>
    supabase
      .from("deck_cards")
      .select("id, board, name, scryfall_id, card_id, quantity", { count: "exact" })
      .eq("deck_id", deckId)
      .order("position", { ascending: true })
      .order("created_at", { ascending: true })
      .order("id", { ascending: true })
      .range(from, to),
  );
  return error ? null : data;
}

/** A restore takes at most this many commits per chunk of lines: a line
 *  waits a round only when every board holds its printing or another line
 *  of the round took the board (stageRestoreLines). */
const MAX_RESTORE_ROUNDS = 4;

/** What a restored row still needs: its own board (it was written onto
 *  another to stay a row of its own), its card and its cover pick — each
 *  written on the NEW row only, and each refused on its own. */
async function settleRestoredRow(
  supabase: SessionClient,
  deckId: string,
  entry: RemovedEntry,
  row: { id: string; board: string; card_id: string | null },
): Promise<RestoredEntry> {
  const notes: string[] = [];
  if (row.board !== entry.board) {
    const { error } = await supabase.from("deck_cards").update({ board: entry.board }).eq("deck_id", deckId).eq("id", row.id);
    if (error) {
      const board = isDeckBoard(row.board) ? DECK_BOARD_LABELS[row.board] : row.board;
      notes.push(`${entry.name} came back on the ${board}.`);
    }
  }
  if (entry.cardId && !row.card_id) {
    // Its card again, judged again (D3, deck_cards_guard_card_link):
    // another creator's card that is no longer public stays out, and the
    // line comes back as the real card.
    const { error } = await supabase
      .from("deck_cards")
      .update({ card_id: entry.cardId })
      .eq("deck_id", deckId)
      .eq("id", row.id)
      .is("card_id", null);
    if (error) notes.push(`${entry.name} came back without its card — that card is no longer available.`);
  }
  if (entry.featuredRank) {
    // The cover pick's place (0150: one entry a rank) — taken meanwhile by
    // another pick, the entry comes back off the cover.
    const { error } = await supabase
      .from("deck_cards")
      .update({ featured_rank: entry.featuredRank })
      .eq("deck_id", deckId)
      .eq("id", row.id);
    if (error) notes.push(`${entry.name} is back, but no longer featured on the cover.`);
  }
  return notes.length > 0 ? { from: entry.id, to: row.id, note: notes.join(" ") } : { from: entry.id, to: row.id };
}

/** A line the commit merged into a row after all (one written meanwhile,
 *  from another tab, took its key): that row's count goes back — only while
 *  it still reads as the merge left it. */
async function takeBackMerge(
  supabase: SessionClient,
  deckId: string,
  line: StagedLine,
  before: readonly RestoreRow[],
  after: readonly RestoreRow[],
): Promise<string> {
  const name = line.entry.name;
  const fallback = `${name} couldn't come back as its own entry. Try again.`;
  const merged = mergedRowOfStagedLine(line, before, after);
  if (!merged) return fallback;
  if (merged.quantity === null) {
    // Merged into a row written meanwhile up to the cap: what it held is
    // unknown, so it is left as it is — and said.
    return `${name} couldn't come back as its own entry, and was added to another ${name} row that is now at ${MAX_ENTRY_QUANTITY} copies — check its count.`;
  }
  await supabase
    .from("deck_cards")
    .update({ quantity: merged.quantity })
    .eq("deck_id", deckId)
    .eq("id", merged.row.id)
    .eq("quantity", merged.row.quantity);
  return fallback;
}

/** Printings and name-only lines back — each a NEW row of its own (see
 *  lib/decks/entry-batch.ts stageRestoreLines), never merged into a row
 *  the deck holds or linked onto one. */
async function restoreLines(
  supabase: SessionClient,
  deckId: string,
  entries: readonly RemovedEntry[],
): Promise<{ restored: RestoredEntry[]; changed: boolean }> {
  const restored: RestoredEntry[] = [];
  let changed = false;
  let waiting: RemovedEntry[] = [...entries];
  let failure: string | null = null;

  for (let round = 0; waiting.length > 0 && round < MAX_RESTORE_ROUNDS && !failure; round += 1) {
    const before = await readRestoreRows(supabase, deckId);
    if (!before) {
      failure = "Couldn't read the deck. Try again.";
      break;
    }
    const { staged, waiting: next } = stageRestoreLines(waiting, new Set(before.map(rowMergeKey)));
    if (staged.length === 0) break;
    waiting = next;

    const written: StagedLine[] = [];
    // Lines whose commit merged something: in such a chunk a row at the
    // 250 cap may be another tab's row the merge filled, not the line's own.
    const mergedChunk = new Set<StagedLine>();
    for (const lines of chunk(staged, MAX_DECKLIST_ENTRIES)) {
      if (failure) {
        for (const line of lines) restored.push({ from: line.entry.id, to: null, note: failure });
        continue;
      }
      // One card back is a single-card call: the `named` quota, never the
      // decklist import's (lib/decks/import-commit.ts).
      const commit = await commitImportLines(
        { deckId, lines: lines.map(stagedLineOf) },
        { quota: "named", revalidate: false },
      );
      if (!commit.ok) {
        failure = commit.error;
        for (const line of lines) restored.push({ from: line.entry.id, to: null, note: failure });
        continue;
      }
      changed = true;
      written.push(...lines);
      if (commit.merged > 0) for (const line of lines) mergedChunk.add(line);
    }
    if (written.length === 0) break;

    const after = await readRestoreRows(supabase, deckId);
    if (!after) {
      for (const line of written) restored.push({ from: line.entry.id, to: null, note: "Couldn't read the deck. Reload the page." });
      failure = "Couldn't read the deck. Try again.";
      break;
    }
    const known = new Set(before.map((row) => row.id));
    const fresh = after.filter((row) => !known.has(row.id));
    const claimed = new Set<string>();
    for (const line of written) {
      const row = newRowOfStagedLine(line, fresh, claimed, mergedChunk.has(line));
      if (!row) {
        restored.push({ from: line.entry.id, to: null, note: await takeBackMerge(supabase, deckId, line, before, after) });
        continue;
      }
      claimed.add(row.id);
      restored.push(await settleRestoredRow(supabase, deckId, line.entry, row));
    }
  }

  for (const entry of waiting) {
    restored.push({ from: entry.id, to: null, note: failure ?? `${entry.name} couldn't come back. Try again.` });
  }
  return { restored, changed };
}

/** PipGlyph cards alone back through the ONE membership writer — a new row
 *  of the card, or "already in the deck" (never a row of another). */
async function restoreCards(
  supabase: SessionClient,
  deckId: string,
  entries: readonly RemovedEntry[],
): Promise<{ restored: RestoredEntry[]; changed: boolean }> {
  const restored: RestoredEntry[] = [];
  let changed = false;
  for (const cards of chunk(entries, MAX_MEMBERSHIP_BATCH)) {
    const result = await changeDeckMembershipAction({ deckId, add: cards.map((entry) => entry.cardId!) });
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
        // The RPC writes the mainboard ×1: then the entry's own count, its
        // board and its cover pick.
        if (entry.quantity !== now.quantity) {
          await supabase.from("deck_cards").update({ quantity: entry.quantity }).eq("deck_id", deckId).eq("id", now.entryId);
        }
        restored.push(
          await settleRestoredRow(supabase, deckId, { ...entry, cardId: null }, { id: now.entryId, board: now.board, card_id: entry.cardId }),
        );
      } else if (outcome?.status === "already") {
        // Another row holds the card now: that row is left as it is, and the
        // removed entry does not become it.
        restored.push({ from: entry.id, to: null, note: `${entry.name} is already in the deck.` });
      } else {
        restored.push({ from: entry.id, to: null, note: outcome?.error ?? `${entry.name} couldn't come back.` });
      }
    }
  }
  return { restored, changed };
}

/** Puts removed entries back — the owner's Undo — through the paths a card
 *  comes INTO a deck by (lib/decks/entry-batch.ts): the decklist commit for
 *  printings and names, the membership writer for a PipGlyph card. Each
 *  entry comes back as a NEW row of its own — never merged into a row the
 *  deck holds, never linked onto one — with its board, card and cover pick.
 *  Never a direct insert. An entry that can't come back (the deck is full,
 *  the card is no longer yours to add) says why, one by one. */
export async function restoreDeckEntriesAction(payload: unknown): Promise<DeckEntriesRestoreResult> {
  const parsed = restoreEntriesSchema.safeParse(payload);
  if (!parsed.success) return { ok: false, error: parsed.error.issues[0]?.message ?? "Invalid change." };
  if (!isSupabaseConfigured()) return { ok: false, error: "Supabase isn't configured." };
  const user = await getCurrentUser();
  if (!user) return { ok: false, error: "Sign in to edit decks." };

  const supabase = await createClient();
  const deck = await getOwnedDeck(supabase, user.id, parsed.data.deckId);
  if (!deck) return { ok: false, error: "Deck not found or not yours." };

  const entries = parsed.data.entries as RemovedEntry[];
  const lines = await restoreLines(
    supabase,
    deck.id,
    entries.filter((entry) => !restoresAsCard(entry)),
  );
  const cards = await restoreCards(
    supabase,
    deck.id,
    entries.filter((entry) => restoresAsCard(entry)),
  );

  if (lines.changed || cards.changed) await revalidateDeckEntryChange(supabase, user.id, deck.slug);
  return { ok: true, restored: [...lines.restored, ...cards.restored] };
}
