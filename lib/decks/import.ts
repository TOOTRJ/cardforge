"use server";

import { z } from "zod";
import { getCurrentUser } from "@/lib/supabase/server";
import { isSupabaseConfigured } from "@/lib/supabase/env";
import {
  getCardByName,
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
  parseDecklist,
  frontFaceName,
  type ParseWarning,
} from "@/lib/decks/parse-decklist";
import {
  cardNameMatchesEntry,
  chunkIdentifiers,
  identifierFor,
  lookupEntry,
  nameFallbackIdentifiers,
  reconcileCollection,
  toResolvedCardData,
  type ResolvedCardData,
} from "@/lib/decks/import-resolution";
import { DECK_BOARD_VALUES } from "@/types/deck";
import { collectionOrNull, commitImportLines, type CommitImportResult } from "@/lib/decks/import-commit";

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

// The core is lib/decks/import-commit.ts (shared with the deck page's add
// and undo, which spend the single-card quota): a decklist's commit spends
// its OWN quota, `deck_import_commit`. The browser sends the review lines
// back; of the card data only the printing's id is READ — every other field
// is fetched again from Scryfall by that id (DK0.3).
export type CommitDeckImportResult = CommitImportResult;

export async function commitDeckImportAction(
  payload: unknown,
): Promise<CommitDeckImportResult> {
  return commitImportLines(payload, { quota: "deck_import_commit" });
}
