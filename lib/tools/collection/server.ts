import "server-only";

import type { Json } from "@/types/supabase";
import { createClient } from "@/lib/supabase/server";
import {
  getCardCollection,
  SCRYFALL_COLLECTION_MAX,
  type ScryfallCard,
  type ScryfallCollectionIdentifier,
} from "@/lib/scryfall/client";
import { chunkIdentifiers } from "@/lib/decks/import-resolution";
import { collectionRowFor, collectionRowKey, type CollectionRowInput } from "./card-row";
import { COLLECTION_CARD_CAP } from "./limits";
import type { ImportLine, ImportProblem } from "./parse-import";
import {
  fallbackIdentifier,
  finishFor,
  firstPassIdentifier,
  indexCards,
  matchLine,
  uniqueIdentifiers,
} from "./resolve";

// ---------------------------------------------------------------------------
// The Collection Deck Builder's server half (migration 0185): resolve import
// lines through the shared Scryfall client, and write rows through the ONE
// write (`add_collection_cards`) holding the cap.
// ---------------------------------------------------------------------------

/** Scryfall didn't answer (or answered garbage) — nothing of the chunk is
 *  written, the browser may try it again. */
export class ScryfallUnavailableError extends Error {
  constructor() {
    super("scryfall_unavailable");
    this.name = "ScryfallUnavailableError";
  }
}

async function fetchCards(identifiers: ScryfallCollectionIdentifier[]): Promise<ScryfallCard[]> {
  const cards: ScryfallCard[] = [];
  for (const batch of chunkIdentifiers(identifiers, SCRYFALL_COLLECTION_MAX)) {
    let result: Awaited<ReturnType<typeof getCardCollection>>;
    try {
      result = await getCardCollection(batch);
    } catch {
      result = null;
    }
    if (result === null) throw new ScryfallUnavailableError();
    cards.push(...result.cards);
  }
  return cards;
}

export type ResolvedLines = {
  rows: Array<{ line: ImportLine; row: CollectionRowInput }>;
  unmatched: ImportProblem[];
};

/** Every line → a row Scryfall vouched for, or a problem saying why not. */
export async function resolveImportLines(lines: readonly ImportLine[]): Promise<ResolvedLines> {
  const first = uniqueIdentifiers(lines.map(firstPassIdentifier));
  const cards = await fetchCards(first);
  let index = indexCards(cards);
  let matches = lines.map((line) => matchLine(line, index));

  const retry = uniqueIdentifiers(lines.map((line, i) => (matches[i].ok ? null : fallbackIdentifier(line))));
  if (retry.length > 0) {
    cards.push(...(await fetchCards(retry)));
    index = indexCards(cards);
    matches = lines.map((line, i) => (matches[i].ok ? matches[i] : matchLine(line, index)));
  }

  const rows: ResolvedLines["rows"] = [];
  const unmatched: ImportProblem[] = [];
  lines.forEach((line, i) => {
    const match = matches[i];
    if (!match.ok) {
      unmatched.push({ line: line.line, raw: line.raw, reason: match.reason });
      return;
    }
    rows.push({
      line,
      row: collectionRowFor(match.card, {
        finish: finishFor(match.card, line.finish),
        // A line read by its Scryfall id IS that printing's language.
        lang: line.scryfallId ? match.card.lang : line.lang,
        quantity: line.quantity,
        sourceLine: line.raw,
      }),
    });
  });
  return { rows, unmatched };
}

export type WriteResult =
  | { ok: true; added: number; updated: number; overCap: Array<{ line: ImportLine | null; row: CollectionRowInput }> }
  | { ok: false; error: string };

export const COLLECTION_FULL_MESSAGE = `Your collection is full: it holds at most ${COLLECTION_CARD_CAP.toLocaleString("en-US")} different cards (copies of one card don't count).`;

/**
 * Write rows for the signed-in user, keeping to the cap: rows already in the
 * collection always merge; NEW rows go in while there is room, the rest come
 * back as `overCap`. The database trigger holds the cap whatever happens
 * here (a concurrent write): its refusal reads as the full collection.
 */
export async function writeCollectionRows(
  items: Array<{ line: ImportLine | null; row: CollectionRowInput }>,
  options: { batchId: string | null; mode: "add" | "replace" },
): Promise<WriteResult> {
  if (items.length === 0) return { ok: true, added: 0, updated: 0, overCap: [] };
  const supabase = await createClient();

  const ids = [...new Set(items.map((i) => i.row.scryfall_id))];
  // 100 ids a read: the filter travels in the URL.
  const reads = await Promise.all([
    ...chunkIdentifiers(ids, 100).map((part) =>
      supabase.from("collection_cards").select("scryfall_id, finish, lang").in("scryfall_id", part),
    ),
  ]);
  const { data: stats, error: statsError } = await supabase.rpc("collection_stats");
  const readError = reads.find((r) => r.error)?.error ?? statsError;
  if (readError) {
    console.error("[collection] pre-write read failed:", readError.message);
    return { ok: false, error: "Couldn't read your collection — nothing was added. Try again." };
  }
  const have = new Set(reads.flatMap((r) => r.data ?? []).map((r) => collectionRowKey(r)));
  const count = Number((Array.isArray(stats) ? stats[0] : null)?.cards ?? 0);
  let room = Math.max(0, COLLECTION_CARD_CAP - count);

  const write: CollectionRowInput[] = [];
  const overCap: Array<{ line: ImportLine | null; row: CollectionRowInput }> = [];
  const newKeys = new Set<string>();
  for (const item of items) {
    const key = collectionRowKey(item.row);
    if (have.has(key) || newKeys.has(key)) {
      write.push(item.row);
    } else if (room > 0) {
      room -= 1;
      newKeys.add(key);
      write.push(item.row);
    } else {
      overCap.push(item);
    }
  }
  if (write.length === 0) return { ok: true, added: 0, updated: 0, overCap };

  const { data, error } = await supabase.rpc("add_collection_cards", {
    p_rows: write as unknown as Json,
    p_batch: options.batchId,
    p_mode: options.mode,
  });
  if (error) {
    if (/collection_capacity_exceeded/.test(error.message ?? "")) return { ok: false, error: COLLECTION_FULL_MESSAGE };
    console.error("[collection] write failed:", error.message);
    return { ok: false, error: "Couldn't save those cards — nothing was added. Try again." };
  }
  const result = (data ?? {}) as { added?: number; updated?: number };
  return { ok: true, added: result.added ?? 0, updated: result.updated ?? 0, overCap };
}
