import "server-only";

import { revalidatePath } from "next/cache";
import { z } from "zod";
import { createClient, getCurrentUser } from "@/lib/supabase/server";
import { isSupabaseConfigured } from "@/lib/supabase/env";
import {
  getCardCollection,
  SCRYFALL_COLLECTION_MAX,
  type ScryfallCard,
} from "@/lib/scryfall/client";
import { checkScryfallRateLimit, logScryfallCall } from "@/lib/scryfall/rate-limit";
import { MAX_DECKLIST_ENTRIES, MAX_ENTRY_QUANTITY } from "@/lib/decks/parse-decklist";
import { commitScryfallIds, scryfallIdBatches, serverResolvedLines } from "@/lib/decks/import-resolution";
import { getDeckById } from "@/lib/decks/queries";
import { isUuid } from "@/lib/ids";
import { DECK_BOARD_VALUES } from "@/types/deck";
import { revalidateProfilePage } from "@/lib/profile/username";
import { deckEntryLimitMessage, isDeckNotOwnedError, planImportEntries } from "@/lib/decks/import-plan";

// ---------------------------------------------------------------------------
// The decklist commit's core — a plain server module, not an endpoint (the
// endpoint is commitDeckImportAction, lib/decks/import.ts). It is shared by
// every path that writes printings INTO a deck: the decklist import, the
// add box's real-card add and the owner's undo of a removal
// (lib/decks/add-actions.ts, lib/decks/card-actions.ts). Each names the
// Scryfall quota it spends — the caller's choice, never the browser's:
//
//   deck_import_commit  a decklist import's commit (20/min, 100/day — twice
//                       the resolve's, so the commit after a resolve is never
//                       the one refused);
//   named               ONE card the owner adds or puts back (30/min,
//                       500/day): a single-card call, the way /cards/named
//                       is one, so building a deck card by card never spends
//                       the import's quota.
//
// The browser sends the lines; of the card data only the printing's id is
// READ (validated as a uuid) — every other field is fetched again from
// Scryfall by that id and only Scryfall's answer is stored (DK0.3).
// ---------------------------------------------------------------------------

export type CommitQuota = "deck_import_commit" | "named";

const commitLineSchema = z.object({
  name: z.string().trim().min(1).max(200),
  quantity: z.number().int().min(1).max(MAX_ENTRY_QUANTITY),
  board: z.enum(DECK_BOARD_VALUES),
  resolved: z
    .object({
      scryfall_id: z.string().refine(isUuid, "That card's Scryfall id isn't valid."),
    })
    .nullable(),
});

const commitSchema = z.object({
  deckId: z.string().uuid("Invalid deck id."),
  lines: z.array(commitLineSchema).min(1).max(MAX_DECKLIST_ENTRIES),
  /** The New deck dialog's commit (TODO DK4.1): refused once the deck holds
   *  an entry the import wrote, so a retry after a lost answer never doubles
   *  the list. The deck page's import never sends it (a second import there
   *  merges, on purpose). */
  firstImportOnly: z.boolean().optional(),
});

export type CommitImportResult =
  | { ok: true; added: number; merged: number; placeholders: number }
  | {
      ok: false;
      error: string;
      retryAfterSeconds?: number;
      /** firstImportOnly found the list already in the deck. */
      alreadyImported?: true;
    };

export type CommitImportOptions = {
  quota: CommitQuota;
  /** false: the caller revalidates once for its whole call (the deck page's
   *  own writes, revalidateDeckEntryChange). */
  revalidate?: boolean;
};

const SCRYFALL_DOWN =
  "Scryfall didn't respond — nothing was imported. Try again in a moment.";

/** One /cards/collection request; a transport failure (a rejected fetch:
 *  DNS, reset, timeout) reads as "Scryfall didn't answer" like a bad
 *  response does, instead of rejecting the server action into the error
 *  boundary. */
export async function collectionOrNull(
  batch: Parameters<typeof getCardCollection>[0],
): Promise<Awaited<ReturnType<typeof getCardCollection>>> {
  try {
    return await getCardCollection(batch);
  } catch {
    return null;
  }
}

export async function commitImportLines(
  payload: unknown,
  options: CommitImportOptions,
): Promise<CommitImportResult> {
  const parsed = commitSchema.safeParse(payload);
  if (!parsed.success) {
    return {
      ok: false,
      error: parsed.error.issues[0]?.message ?? "Invalid import payload.",
    };
  }

  if (!isSupabaseConfigured()) {
    return { ok: false, error: "Supabase isn't configured." };
  }
  const user = await getCurrentUser();
  if (!user) {
    return { ok: false, error: "Sign in to import a decklist." };
  }

  const deck = await getDeckById(parsed.data.deckId);
  if (!deck || deck.owner_id !== user.id) {
    return { ok: false, error: "Deck not found or not yours." };
  }

  // The dialog's retry: an entry the import wrote (deck_cards.source, 0144)
  // means the first commit landed and only its answer was lost. Read before
  // any Scryfall call; an unreadable count lets the commit go on.
  if (parsed.data.firstImportOnly) {
    const { count } = await (await createClient())
      .from("deck_cards")
      .select("id", { count: "exact", head: true })
      .eq("deck_id", deck.id)
      .eq("source", "import");
    if ((count ?? 0) > 0) {
      return { ok: false, error: "The list is already in — open the deck.", alreadyImported: true };
    }
  }

  // Re-resolve every printing on the server, 75 ids a request (the client's
  // throttle spaces them per Scryfall's limits), against the caller's quota
  // (the header); a list of placeholders only makes no call and spends none.
  const ids = commitScryfallIds(parsed.data.lines);
  const cards: ScryfallCard[] = [];
  if (ids.length > 0) {
    const rate = await checkScryfallRateLimit(user.id, options.quota);
    if (!rate.ok) {
      return {
        ok: false,
        error: rate.message,
        retryAfterSeconds: rate.retryAfterSeconds,
      };
    }
    await logScryfallCall(user.id, options.quota);
    for (const batch of scryfallIdBatches(ids, SCRYFALL_COLLECTION_MAX)) {
      const result = await collectionOrNull(batch);
      if (result === null) return { ok: false, error: SCRYFALL_DOWN };
      cards.push(...result.cards);
    }
  }

  const plan = planImportEntries(serverResolvedLines(parsed.data.lines, cards));

  // ONE transaction under a per-deck lock (migration 0143): merges into the
  // rows the deck holds, inserts the rest, refuses past the entry cap. A
  // double submit waits for the first and then merges into its rows.
  const supabase = await createClient();
  const { data, error } = await supabase.rpc("import_deck_entries", {
    p_deck_id: deck.id,
    p_entries: plan.entries,
  });
  if (error) {
    const limit = deckEntryLimitMessage(error);
    if (limit) return { ok: false, error: limit };
    if (isDeckNotOwnedError(error)) {
      return { ok: false, error: "Deck not found or not yours." };
    }
    return { ok: false, error: "Couldn't save the import — nothing was added. Try again." };
  }
  const counts = importCounts(data);

  if (options.revalidate !== false) {
    revalidatePath(`/deck/${deck.slug}`);
    revalidatePath(`/deck/${deck.slug}/edit`);
    revalidatePath("/dashboard/decks");
    revalidatePath("/decks");
    // Profile "Decks by X" tiles show card counts — imports change them.
    await revalidateProfilePage(supabase, user.id);
  }

  return {
    ok: true,
    added: counts.added,
    merged: counts.merged,
    placeholders: plan.placeholders,
  };
}

/** `import_deck_entries` answers {"added": n, "merged": m}. */
function importCounts(data: unknown): { added: number; merged: number } {
  const row = (data ?? {}) as { added?: unknown; merged?: unknown };
  return {
    added: typeof row.added === "number" ? row.added : 0,
    merged: typeof row.merged === "number" ? row.merged : 0,
  };
}
