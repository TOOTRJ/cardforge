"use server";

import { z } from "zod";
import { createClient, getCurrentUser } from "@/lib/supabase/server";
import { isSupabaseConfigured } from "@/lib/supabase/env";
import { isUuid } from "@/lib/ids";
import { selectAllRows } from "@/lib/supabase/select-all-rows";
import { addTargetEntry, cardElsewhere, type AddPick } from "@/lib/decks/add-search";
import { restoreLineKey } from "@/lib/decks/entry-batch";
import { changeDeckMembershipAction } from "@/lib/decks/membership-actions";
import { commitDeckImportAction } from "@/lib/decks/import";
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
//            card as a one-line decklist (commitDeckImportAction — the
//            printing fetched again from Scryfall, the import RPC), never a
//            client-side insert. A PipGlyph card already on ANOTHER board
//            stays where it is: the answer says where (a deck holds one
//            entry a card).
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
});

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
    if (target.quantity >= MAX_ENTRY_QUANTITY) {
      return { ok: false, error: `${target.name} is already in the deck ${MAX_ENTRY_QUANTITY} times.` };
    }
    const { data, error } = await supabase
      .from("deck_cards")
      .update({ quantity: target.quantity + 1 })
      .eq("deck_id", deck.id)
      .eq("id", target.id)
      .select("id, quantity")
      .maybeSingle();
    if (error || !data) return { ok: false, error: error?.message ?? "Couldn't add the card. Try again." };
    await revalidateDeckEntryChange(supabase, user.id, deck.slug);
    return { ok: true, entryId: data.id, board, quantity: data.quantity, merged: true, name: target.name };
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
    const result = await changeDeckMembershipAction({ deckId: deck.id, add: [pick.cardId] });
    if (!result.ok) return { ok: false, error: result.error };
    const outcome = result.results[0];
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
    };
  }

  // ---- a real card: a one-line decklist ----------------------------------
  const commit = await commitDeckImportAction({
    deckId: deck.id,
    lines: [{ name: pick.name, quantity: 1, board, resolved: { scryfall_id: pick.scryfallId } }],
  });
  if (!commit.ok) return { ok: false, error: commit.error };
  const after = (await readDeckRows(supabase, deck.id)) ?? [];
  // The printing's row — or, when Scryfall no longer has that printing, the
  // name the line went in under.
  const keys = [
    restoreLineKey({ board, scryfallId: pick.scryfallId, name: pick.name }),
    restoreLineKey({ board, scryfallId: null, name: pick.name }),
  ];
  const row = keys.map((key) => after.find((r) => restoreLineKey({ board: r.board, scryfallId: r.scryfall_id, name: r.name }) === key)).find(Boolean);
  await revalidateDeckEntryChange(supabase, user.id, deck.slug);
  if (!row) return { ok: false, error: "Added, but the deck didn't show it yet — reload the page." };
  return { ok: true, entryId: row.id, board, quantity: row.quantity, merged: commit.merged > 0, name: row.name };
}
