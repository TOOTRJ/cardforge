"use server";

import { revalidatePath } from "next/cache";
import { z } from "zod";
import { createClient, getCurrentUser } from "@/lib/supabase/server";
import { isSupabaseConfigured } from "@/lib/supabase/env";
import {
  getCardByName,
  getCardCollection,
  SCRYFALL_COLLECTION_MAX,
  type ScryfallCard,
} from "@/lib/scryfall/client";
import {
  checkScryfallRateLimit,
  logScryfallCall,
} from "@/lib/scryfall/rate-limit";
import {
  MAX_DECKLIST_CHARS,
  MAX_DECKLIST_ENTRIES,
  MAX_ENTRY_QUANTITY,
  parseDecklist,
  frontFaceName,
  type ParseWarning,
} from "@/lib/decks/parse-decklist";
import {
  cardNameMatchesEntry,
  chunkIdentifiers,
  commitScryfallIds,
  identifierFor,
  lookupEntry,
  nameFallbackIdentifiers,
  reconcileCollection,
  scryfallIdBatches,
  serverResolvedLines,
  toResolvedCardData,
  type ResolvedCardData,
} from "@/lib/decks/import-resolution";
import { getDeckById } from "@/lib/decks/queries";
import { isUuid } from "@/lib/ids";
import { DECK_BOARD_VALUES } from "@/types/deck";
import { revalidateProfilePage } from "@/lib/profile/username";
import {
  deckEntryLimitMessage,
  isDeckNotOwnedError,
  planImportEntries,
} from "@/lib/decks/import-plan";

// ---------------------------------------------------------------------------
// Decklist import — two-step, review-before-commit:
//   1. resolveDecklistAction(text): parse + resolve against Scryfall,
//      returning a review payload. NO WRITES.
//   2. commitDeckImportAction(deckId, lines): re-fetch the confirmed lines'
//      printings from Scryfall by id (the browser's copy is never stored)
//      and write them in ONE transaction (`import_deck_entries`, migration
//      0143), merging quantities into existing rows.
// A resolve run costs a handful of /cards/collection calls (75 identifiers
// each, 500ms spacing) plus a bounded fuzzy rescue — all server-side.
// ---------------------------------------------------------------------------

type ImportLineStatus = "resolved" | "fuzzy" | "unresolved";

export type ImportReviewLine = {
  /** 1-based source line (first occurrence when duplicates merged). */
  line: number;
  raw: string;
  name: string;
  quantity: number;
  board: (typeof DECK_BOARD_VALUES)[number];
  status: ImportLineStatus;
  /** Set when status is resolved/fuzzy. */
  resolved: ResolvedCardData | null;
};

export type ResolveDecklistResult =
  | {
      ok: true;
      title: string | null;
      lines: ImportReviewLine[];
      parseWarnings: ParseWarning[];
    }
  | { ok: false; error: string; retryAfterSeconds?: number };

// Bound the per-run fuzzy rescue so a garbage paste can't burn function
// time at 500ms per /cards/named call.
const MAX_FUZZY_RESCUES = 15;

/** One /cards/collection request; a transport failure (a rejected fetch:
 *  DNS, reset, timeout) reads as "Scryfall didn't answer" like a bad
 *  response does, instead of rejecting the server action into the error
 *  boundary. */
async function collectionOrNull(
  batch: Parameters<typeof getCardCollection>[0],
): Promise<Awaited<ReturnType<typeof getCardCollection>>> {
  try {
    return await getCardCollection(batch);
  } catch {
    return null;
  }
}

export async function resolveDecklistAction(
  payload: unknown,
): Promise<ResolveDecklistResult> {
  const parsedPayload = z
    .object({ text: z.string().min(1).max(MAX_DECKLIST_CHARS) })
    .safeParse(payload);
  if (!parsedPayload.success) {
    return {
      ok: false,
      error: `Paste a decklist (up to ${MAX_DECKLIST_CHARS.toLocaleString()} characters).`,
    };
  }

  if (!isSupabaseConfigured()) {
    return { ok: false, error: "Supabase isn't configured." };
  }
  const user = await getCurrentUser();
  if (!user) {
    return { ok: false, error: "Sign in to import a decklist." };
  }

  const { title, entries, warnings } = parseDecklist(parsedPayload.data.text);
  if (entries.length === 0) {
    return {
      ok: false,
      error:
        warnings[0]?.reason ??
        "No cards found — expected lines like “4 Lightning Bolt”.",
    };
  }
  if (entries.length > MAX_DECKLIST_ENTRIES) {
    return {
      ok: false,
      error: `That list has ${entries.length} distinct cards — the importer caps at ${MAX_DECKLIST_ENTRIES}.`,
    };
  }

  // One quota row per RUN (not per API call) — see SCRYFALL_LIMITS.
  const rate = await checkScryfallRateLimit(user.id, "deck_import");
  if (!rate.ok) {
    return {
      ok: false,
      error: rate.message,
      retryAfterSeconds: rate.retryAfterSeconds,
    };
  }
  await logScryfallCall(user.id, "deck_import");

  // Pass 1: batch the preferred identifiers (printing when known, else name).
  const uniqueIdentifiers = new Map<string, ReturnType<typeof identifierFor>>();
  for (const entry of entries) {
    const id = identifierFor(entry);
    uniqueIdentifiers.set(JSON.stringify(id), id);
  }
  const allCards: ScryfallCard[] = [];
  for (const batch of chunkIdentifiers(
    Array.from(uniqueIdentifiers.values()),
    SCRYFALL_COLLECTION_MAX,
  )) {
    const result = await collectionOrNull(batch);
    if (result === null) {
      return {
        ok: false,
        error:
          "Scryfall didn't respond — nothing was imported. Try again in a moment.",
      };
    }
    allCards.push(...result.cards);
  }
  let { byKey } = reconcileCollection([], allCards);

  // Pass 2: printings that missed (bad set codes) retry as bare names.
  const fallbacks = nameFallbackIdentifiers(entries, byKey);
  if (fallbacks.length > 0) {
    for (const batch of chunkIdentifiers(fallbacks, SCRYFALL_COLLECTION_MAX)) {
      const result = await collectionOrNull(batch);
      if (result) allCards.push(...result.cards);
    }
    byKey = reconcileCollection([], allCards).byKey;
  }

  // Pass 3: bounded fuzzy rescue for whatever's still missing (typos).
  // Name-mismatched printing hits don't count as found — they get the
  // fuzzy treatment too so the user is told to double-check.
  let fuzzyBudget = MAX_FUZZY_RESCUES;
  const fuzzyByName = new Map<string, ScryfallCard | null>();
  for (const entry of entries) {
    const hit = lookupEntry(byKey, entry);
    if (hit && cardNameMatchesEntry(hit, entry.name)) continue;
    if (fuzzyBudget <= 0) break;
    const name = frontFaceName(entry.name) ?? entry.name;
    const cacheKey = name.toLowerCase();
    if (fuzzyByName.has(cacheKey)) continue;
    fuzzyBudget -= 1;
    fuzzyByName.set(
      cacheKey,
      await getCardByName({ fuzzy: name }).catch(() => null),
    );
  }

  const lines: ImportReviewLine[] = entries.map((entry) => {
    const exact = lookupEntry(byKey, entry);
    if (exact && cardNameMatchesEntry(exact, entry.name)) {
      return {
        line: entry.line,
        raw: entry.raw,
        name: entry.name,
        quantity: entry.quantity,
        board: entry.board,
        status: "resolved",
        resolved: toResolvedCardData(exact),
      };
    }
    // Best guesses, in preference order: a fuzzy name rescue, then a
    // name-mismatched printing hit (wrong collector number on the line).
    const fuzzyKey = (frontFaceName(entry.name) ?? entry.name).toLowerCase();
    const guess = fuzzyByName.get(fuzzyKey) ?? exact ?? null;
    if (guess) {
      return {
        line: entry.line,
        raw: entry.raw,
        name: entry.name,
        quantity: entry.quantity,
        board: entry.board,
        status: "fuzzy",
        resolved: toResolvedCardData(guess),
      };
    }
    return {
      line: entry.line,
      raw: entry.raw,
      name: entry.name,
      quantity: entry.quantity,
      board: entry.board,
      status: "unresolved",
      resolved: null,
    };
  });

  return { ok: true, title, lines, parseWarnings: warnings };
}


// ---------------------------------------------------------------------------
// Commit
// ---------------------------------------------------------------------------

// The browser sends the review lines back; of the card data only the
// printing's id is READ (validated as a uuid) — every other field is fetched
// again from Scryfall by that id below and only Scryfall's answer is stored
// (DK0.3). The rest of the `resolved` object the dialog posts is dropped.
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

export type CommitDeckImportResult =
  | { ok: true; added: number; merged: number; placeholders: number }
  | {
      ok: false;
      error: string;
      retryAfterSeconds?: number;
      /** firstImportOnly found the list already in the deck. */
      alreadyImported?: true;
    };

const SCRYFALL_DOWN =
  "Scryfall didn't respond — nothing was imported. Try again in a moment.";

export async function commitDeckImportAction(
  payload: unknown,
): Promise<CommitDeckImportResult> {
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
  // throttle spaces them per Scryfall's limits). The commit has its OWN
  // quota (`deck_import_commit`, SCRYFALL_LIMITS — twice the resolve's, so
  // the commit right after a resolve is never the one refused), and a list
  // of placeholders only makes no call and spends none of it.
  const ids = commitScryfallIds(parsed.data.lines);
  const cards: ScryfallCard[] = [];
  if (ids.length > 0) {
    const rate = await checkScryfallRateLimit(user.id, "deck_import_commit");
    if (!rate.ok) {
      return {
        ok: false,
        error: rate.message,
        retryAfterSeconds: rate.retryAfterSeconds,
      };
    }
    await logScryfallCall(user.id, "deck_import_commit");
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

  revalidatePath(`/deck/${deck.slug}`);
  revalidatePath(`/deck/${deck.slug}/edit`);
  revalidatePath("/dashboard/decks");
  revalidatePath("/decks");
  // Profile "Decks by X" tiles show card counts — imports change them.
  await revalidateProfilePage(supabase, user.id);

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
