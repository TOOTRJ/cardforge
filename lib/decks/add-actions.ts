"use server";

import { z } from "zod";
import { createClient, getCurrentUser } from "@/lib/supabase/server";
import { isSupabaseConfigured } from "@/lib/supabase/env";
import { isUuid } from "@/lib/ids";
import { selectAllRows } from "@/lib/supabase/select-all-rows";
import { addTargetEntry, cardElsewhere, MAX_ADD_BATCH, type AddPick } from "@/lib/decks/add-search";
import { restoreStagingKeys, rowMergeKey } from "@/lib/decks/entry-batch";
import { changeDeckMembershipAction } from "@/lib/decks/membership-actions";
import { commitImportLines } from "@/lib/decks/import-commit";
import { revalidateDeckEntryChange } from "@/lib/decks/revalidate";
import { MAX_ENTRY_QUANTITY } from "@/lib/decks/parse-decklist";
import { DECK_BOARD_LABELS, DECK_BOARD_VALUES, isDeckBoard, type DeckBoard } from "@/types/deck";

// ---------------------------------------------------------------------------
// The deck page's add box's add (TODO DK5.2; its searches:
// lib/decks/add-search-queries.ts and /api/scryfall/search):
//
//   add      ONE card onto ONE board of ONE deck, on the row it lands on
//            (lib/decks/add-search.ts addTargetEntry): a card already on the
//            board gets one copy more; a PipGlyph card comes in through THE
//            membership writer (changeDeckMembershipAction — the RPC, D3,
//            the frame-preview and full-deck refusals in words) and a real
//            card as a one-line decklist (lib/decks/import-commit.ts — the
//            printing fetched again from Scryfall, the import RPC; ONE card,
//            so the single-card `named` quota, never the decklist import's),
//            never a client-side insert. A PipGlyph card already on ANOTHER board
//            stays where it is: the answer says where (a deck holds one
//            entry a card).
//
//   `privateCard: "publish"` (TODO DK0.13): the maker's own private card
//            made public FIRST, through the membership writer's `publish`
//            (the site's visibility change and every gate it has) — still
//            private after it, it is not added and the answer says why.
//            The box asks before it adds (privateCardOfferAction); "keep",
//            the default, adds it as it is.
//
//   addMany  SEVERAL cards onto ONE board (TODO DK5.17: the box's ticked
//            results, "Add N"), up to MAX_ADD_BATCH, a result per card in
//            the order asked, ONE revalidation for the call. Each card lands
//            as `add` lands it: one copy more on its board's row; PipGlyph
//            cards together through ONE membership call (`publish` names
//            the private ones the maker chose to make public first); each
//            real card its own one-line decklist on the `named` quota, as a
//            single add spends it. A card refused (on another board, the
//            quota, the deck full) fails alone — the others still land.
// ---------------------------------------------------------------------------


export type DeckAddResult =
  | {
      ok: true;
      entryId: string;
      board: DeckBoard;
      quantity: number;
      /** One copy more on a row the deck had (false: a new line). */
      merged: boolean;
      /** The entry's name as the deck stores it, where the add read it. */
      name?: string;
      /** The card was made public on the way in (`privateCard: "publish"`). */
      published?: true;
    }
  | {
      ok: false;
      error: string;
      /** The PipGlyph card is already in the deck, on another board. */
      elsewhere?: { entryId: string; board: DeckBoard };
    };

const pickSchema = z.discriminatedUnion("kind", [
  z.object({
    kind: z.literal("card"),
    cardId: z.string().refine((id) => isUuid(id), "Invalid card id."),
  }),
  z.object({
    kind: z.literal("printing"),
    scryfallId: z.string().refine((id) => isUuid(id), "That card's Scryfall id isn't valid."),
    name: z.string().trim().min(1).max(200),
  }),
]);

const addSchema = z.object({
  deckId: z.string().refine((id) => isUuid(id), "Invalid deck id."),
  board: z.enum(DECK_BOARD_VALUES),
  pick: pickSchema,
  privateCard: z.enum(["keep", "publish"]).default("keep"),
});

const addManySchema = z
  .object({
    deckId: z.string().refine((id) => isUuid(id), "Invalid deck id."),
    board: z.enum(DECK_BOARD_VALUES),
    picks: z.array(pickSchema).min(1, "No cards to add.").max(MAX_ADD_BATCH, `At most ${MAX_ADD_BATCH} cards at a time.`),
    /** PipGlyph cards (of `picks`) to make public before the add. */
    publish: z.array(z.string().refine((id) => isUuid(id), "Invalid card id.")).max(MAX_ADD_BATCH).default([]),
  })
  .refine((input) => new Set(input.picks.map(pickKey)).size === input.picks.length, { message: "Each card once." });

function pickKey(pick: z.infer<typeof pickSchema>): string {
  return pick.kind === "card" ? `card:${pick.cardId.toLowerCase()}` : `printing:${pick.scryfallId.toLowerCase()}`;
}

export type DeckAddManyResult =
  | {
      ok: true;
      /** One per pick, in the order asked. */
      results: DeckAddResult[];
    }
  | { ok: false; error: string };

/** A row of the deck as an add reads it. */
type DeckRow = { id: string; board: DeckBoard; quantity: number; name: string; card_id: string | null; scryfall_id: string | null };

async function readDeckRows(supabase: Awaited<ReturnType<typeof createClient>>, deckId: string): Promise<DeckRow[] | null> {
  const { data, error } = await selectAllRows<Omit<DeckRow, "board"> & { board: string }>((from, to) =>
    supabase
      .from("deck_cards")
      .select("id, board, quantity, name, card_id, scryfall_id", { count: "exact" })
      .eq("deck_id", deckId)
      .order("position", { ascending: true })
      .order("created_at", { ascending: true })
      .order("id", { ascending: true })
      .range(from, to),
  );
  return error ? null : data.map((row) => ({ ...row, board: isDeckBoard(row.board) ? row.board : "main" }));
}

type Supabase = Awaited<ReturnType<typeof createClient>>;

/** One copy more on the board's row an add lands on. */
async function bumpRow(supabase: Supabase, deckId: string, target: DeckRow, board: DeckBoard): Promise<DeckAddResult> {
  if (target.quantity >= MAX_ENTRY_QUANTITY) {
    return { ok: false, error: `${target.name} is already in the deck ${MAX_ENTRY_QUANTITY} times.` };
  }
  const { data, error } = await supabase
    .from("deck_cards")
    .update({ quantity: target.quantity + 1 })
    .eq("deck_id", deckId)
    .eq("id", target.id)
    .select("id, quantity")
    .maybeSingle();
  if (error || !data) return { ok: false, error: error?.message ?? "Couldn't add the card. Try again." };
  return { ok: true, entryId: data.id, board, quantity: data.quantity, merged: true, name: target.name };
}

/** A real card in as a one-line decklist — ONE card, the `named` quota —
 *  and the row it landed on: the NEW row first, else the one the commit
 *  merged into (by printing, or by the name when Scryfall no longer has
 *  that printing). */
async function commitPrinting(
  supabase: Supabase,
  deckId: string,
  pick: Extract<AddPick, { kind: "printing" }>,
  board: DeckBoard,
  known: ReadonlySet<string>,
): Promise<{ result: DeckAddResult; wrote: boolean }> {
  const commit = await commitImportLines(
    { deckId, lines: [{ name: pick.name, quantity: 1, board, resolved: { scryfall_id: pick.scryfallId } }] },
    { quota: "named", revalidate: false },
  );
  if (!commit.ok) return { result: { ok: false, error: commit.error }, wrote: false };
  const after = (await readDeckRows(supabase, deckId)) ?? [];
  const keys = new Set(restoreStagingKeys({ scryfallId: pick.scryfallId, name: pick.name }, board));
  const landed = after.filter((r) => keys.has(rowMergeKey(r)));
  const row = landed.find((r) => !known.has(r.id)) ?? landed[0];
  if (!row) return { result: { ok: false, error: "Added, but the deck didn't show it yet — reload the page." }, wrote: true };
  return {
    result: { ok: true, entryId: row.id, board, quantity: row.quantity, merged: commit.merged > 0, name: row.name },
    wrote: true,
  };
}

/** ONE card onto ONE board — see the header. */
export async function addToDeckAction(payload: unknown): Promise<DeckAddResult> {
  const parsed = addSchema.safeParse(payload);
  if (!parsed.success) return { ok: false, error: parsed.error.issues[0]?.message ?? "Invalid card." };
  if (!isSupabaseConfigured()) return { ok: false, error: "Supabase isn't configured." };
  const user = await getCurrentUser();
  if (!user) return { ok: false, error: "Sign in to add cards." };

  const supabase = await createClient();
  const { data: deck } = await supabase
    .from("decks")
    .select("id, slug, title, owner_id")
    .eq("id", parsed.data.deckId)
    .maybeSingle();
  if (!deck || deck.owner_id !== user.id) return { ok: false, error: "Deck not found or not yours." };

  const { board } = parsed.data;
  const rows = await readDeckRows(supabase, deck.id);
  if (!rows) return { ok: false, error: "Couldn't read the deck. Try again." };

  const pick: AddPick =
    parsed.data.pick.kind === "card"
      ? { kind: "card", cardId: parsed.data.pick.cardId, title: "" }
      : { kind: "printing", scryfallId: parsed.data.pick.scryfallId, name: parsed.data.pick.name };

  // ---- one copy more on a row the board has ------------------------------
  const target = addTargetEntry(rows, pick, board);
  if (target) {
    const bumped = await bumpRow(supabase, deck.id, target, board);
    if (bumped.ok) await revalidateDeckEntryChange(supabase, user.id, deck.slug);
    return bumped;
  }

  // ---- a PipGlyph card: the ONE membership writer -------------------------
  if (pick.kind === "card") {
    const elsewhere = cardElsewhere(rows, pick.cardId, board);
    if (elsewhere) {
      return {
        ok: false,
        error: `${elsewhere.name} is already in the deck, on the ${DECK_BOARD_LABELS[elsewhere.board]}. Move it there to change boards.`,
        elsewhere: { entryId: elsewhere.id, board: elsewhere.board },
      };
    }
    const result = await changeDeckMembershipAction({
      deckId: deck.id,
      add: [pick.cardId],
      ...(parsed.data.privateCard === "publish" ? { publish: [pick.cardId] } : {}),
    });
    if (!result.ok) return { ok: false, error: result.error };
    const outcome = result.results[0];
    if (outcome?.published && outcome.status !== "added" && outcome.status !== "already") {
      // Public now, but the deck refused it: both are said.
      await revalidateDeckEntryChange(supabase, user.id, deck.slug);
      return { ok: false, error: `Made public, but not added: ${outcome.error ?? "try again."}` };
    }
    const entry = result.entries.find((row) => row.cardId.toLowerCase() === pick.cardId.toLowerCase());
    if (!outcome || (outcome.status !== "added" && outcome.status !== "already") || !entry) {
      return { ok: false, error: outcome?.error ?? "Couldn't add the card. Try again." };
    }
    let landed: DeckBoard = entry.board;
    if (outcome.status === "added" && entry.board !== board) {
      // The RPC writes the mainboard: then the board the box names.
      const { error } = await supabase.from("deck_cards").update({ board }).eq("deck_id", deck.id).eq("id", entry.entryId);
      if (!error) landed = board;
    }
    await revalidateDeckEntryChange(supabase, user.id, deck.slug);
    return {
      ok: true,
      entryId: entry.entryId,
      board: landed,
      quantity: entry.quantity,
      merged: outcome.status === "already",
      name: rows.find((row) => row.id === entry.entryId)?.name,
      ...(outcome.published ? { published: true as const } : {}),
    };
  }

  // ---- a real card: a one-line decklist ----------------------------------
  const landed = await commitPrinting(supabase, deck.id, pick, board, new Set(rows.map((r) => r.id)));
  // A refused commit wrote nothing; a landed one is revalidated even when
  // its row couldn't be read back.
  if (landed.wrote) await revalidateDeckEntryChange(supabase, user.id, deck.slug);
  return landed.result;
}

/** SEVERAL cards onto ONE board, one revalidation — see the header. */
export async function addManyToDeckAction(payload: unknown): Promise<DeckAddManyResult> {
  const parsed = addManySchema.safeParse(payload);
  if (!parsed.success) return { ok: false, error: parsed.error.issues[0]?.message ?? "Invalid cards." };
  if (!isSupabaseConfigured()) return { ok: false, error: "Supabase isn't configured." };
  const user = await getCurrentUser();
  if (!user) return { ok: false, error: "Sign in to add cards." };

  const supabase = await createClient();
  const { data: deck } = await supabase
    .from("decks")
    .select("id, slug, title, owner_id")
    .eq("id", parsed.data.deckId)
    .maybeSingle();
  if (!deck || deck.owner_id !== user.id) return { ok: false, error: "Deck not found or not yours." };

  const { board } = parsed.data;
  const rows = await readDeckRows(supabase, deck.id);
  if (!rows) return { ok: false, error: "Couldn't read the deck. Try again." };
  const known = new Set(rows.map((r) => r.id));
  const publish = new Set(parsed.data.publish.map((id) => id.toLowerCase()));

  const picks: AddPick[] = parsed.data.picks.map((pick) =>
    pick.kind === "card"
      ? { kind: "card", cardId: pick.cardId.toLowerCase(), title: "" }
      : { kind: "printing", scryfallId: pick.scryfallId, name: pick.name },
  );
  const results: Array<DeckAddResult | null> = picks.map(() => null);
  let changed = false;
  const joining: Array<{ index: number; cardId: string }> = [];
  const printings: Array<{ index: number; pick: Extract<AddPick, { kind: "printing" }> }> = [];

  // ---- one copy more on a row the board has (in order: each bump is read
  // by the next pick that lands on the same row) ----------------------------
  for (const [index, pick] of picks.entries()) {
    const target = addTargetEntry(rows, pick, board);
    if (target) {
      const bumped = await bumpRow(supabase, deck.id, target, board);
      results[index] = bumped;
      if (bumped.ok) {
        changed = true;
        target.quantity = bumped.quantity;
      }
      continue;
    }
    if (pick.kind === "card") {
      const elsewhere = cardElsewhere(rows, pick.cardId, board);
      if (elsewhere) {
        results[index] = {
          ok: false,
          error: `${elsewhere.name} is already in the deck, on the ${DECK_BOARD_LABELS[elsewhere.board]}. Move it there to change boards.`,
          elsewhere: { entryId: elsewhere.id, board: elsewhere.board },
        };
        continue;
      }
      joining.push({ index, cardId: pick.cardId });
    } else {
      printings.push({ index, pick });
    }
  }

  // ---- the PipGlyph cards: ONE membership call ---------------------------
  if (joining.length > 0) {
    const ids = joining.map((row) => row.cardId);
    const publishing = ids.filter((cardId) => publish.has(cardId));
    const membership = await changeDeckMembershipAction({
      deckId: deck.id,
      add: ids,
      ...(publishing.length > 0 ? { publish: publishing } : {}),
    });
    if (!membership.ok) {
      for (const { index } of joining) results[index] = { ok: false, error: membership.error };
    } else {
      const moveToBoard: string[] = [];
      for (const { index, cardId } of joining) {
        const outcome = membership.results.find((row) => row.cardId.toLowerCase() === cardId);
        const entry = membership.entries.find((row) => row.cardId.toLowerCase() === cardId);
        if (outcome?.published) changed = true;
        if (outcome?.published && outcome.status !== "added" && outcome.status !== "already") {
          results[index] = { ok: false, error: `Made public, but not added: ${outcome.error ?? "try again."}` };
          continue;
        }
        if (!outcome || (outcome.status !== "added" && outcome.status !== "already") || !entry) {
          results[index] = { ok: false, error: outcome?.error ?? "Couldn't add the card. Try again." };
          continue;
        }
        if (outcome.status === "added") changed = true;
        // The RPC writes the mainboard: then the board the box names.
        if (outcome.status === "added" && entry.board !== board) moveToBoard.push(entry.entryId);
        results[index] = {
          ok: true,
          entryId: entry.entryId,
          board: entry.board,
          quantity: entry.quantity,
          merged: outcome.status === "already",
          name: rows.find((row) => row.id === entry.entryId)?.name,
          ...(outcome.published ? { published: true as const } : {}),
        };
      }
      if (moveToBoard.length > 0) {
        const { error } = await supabase.from("deck_cards").update({ board }).eq("deck_id", deck.id).in("id", moveToBoard);
        if (!error) {
          for (const result of results) {
            if (result?.ok && moveToBoard.includes(result.entryId)) result.board = board;
          }
        }
      }
    }
  }

  // ---- each real card: its own one-line decklist (the `named` quota) -----
  for (const { index, pick } of printings) {
    const landed = await commitPrinting(supabase, deck.id, pick, board, known);
    if (landed.wrote) changed = true;
    if (landed.result.ok) known.add(landed.result.entryId);
    results[index] = landed.result;
  }

  if (changed) await revalidateDeckEntryChange(supabase, user.id, deck.slug);
  return { ok: true, results: results.map((result) => result ?? { ok: false, error: "Couldn't add the card. Try again." }) };
}
