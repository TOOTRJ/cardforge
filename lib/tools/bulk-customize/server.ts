import "server-only";

import { createClient } from "@/lib/supabase/server";
import { createAdminClient, isAdminConfigured } from "@/lib/supabase/admin";
import {
  SCRYFALL_COLLECTION_MAX,
  getCardCollection,
  getScryfallSet,
  type ScryfallCard,
} from "@/lib/scryfall/client";
import { mapScryfallToFormPatch, needsScryfallSet, type ScryfallImportPatch } from "@/lib/scryfall/import-mapper";
import { finalizeImportMatch } from "@/lib/creator/frame-resolve";
import { isUuid } from "@/lib/ids";
import { bulkSourceKey, type BulkSource } from "@/lib/tools/bulk-customize/model";

// ---------------------------------------------------------------------------
// Bulk Customize's reads (server only). Every source is resolved from the
// caller's OWN rows through their session (RLS): a deck entry of a deck they
// own, a collection row of theirs — or a Scryfall id. The browser names a
// source; what it is (its printing, its name) is read here, never taken
// from the request.
// ---------------------------------------------------------------------------

/** A source resolved to the printing it stands for. */
export type ResolvedBulkSource = {
  key: string;
  source: BulkSource;
  scryfallId: string;
  /** The name the caller's row gives it (a Scryfall source: the card's). */
  name: string;
  /** Set on a deck entry: the entry the new card is linked to. */
  deckEntryId?: string;
  /** Set on a collection row: the row that records the new card. */
  collectionId?: string;
};

export type SkippedBulkSource = { key: string; name: string; reason: string };

const SCRYFALL_ID_RE = /^[0-9a-f-]{8,64}$/i;

/** The caller's sources, each resolved from their own rows — or skipped with
 *  a reason the dialog shows. Order and de-duplication follow the request. */
export async function resolveBulkSources(
  userId: string,
  sources: readonly BulkSource[],
): Promise<{ resolved: ResolvedBulkSource[]; skipped: SkippedBulkSource[] }> {
  const seen = new Set<string>();
  const unique = sources.filter((source) => {
    const key = bulkSourceKey(source);
    if (seen.has(key)) return false;
    seen.add(key);
    return true;
  });

  const entryIds = unique.filter((s) => s.kind === "deck_entry" && isUuid(s.id)).map((s) => s.id);
  const collectionIds = unique.filter((s) => s.kind === "collection" && isUuid(s.id)).map((s) => s.id);
  const supabase = await createClient();

  const entries = new Map<string, { scryfall_id: string | null; name: string; card_id: string | null }>();
  if (entryIds.length > 0) {
    // The entry's deck must be the caller's own (a public deck's entries are
    // readable by anyone; customizing one is the owner's).
    const { data } = await supabase
      .from("deck_cards")
      .select("id, name, scryfall_id, card_id, decks!inner(owner_id)")
      .in("id", entryIds)
      .eq("decks.owner_id", userId);
    for (const row of data ?? []) {
      entries.set(row.id, { scryfall_id: row.scryfall_id, name: row.name, card_id: row.card_id });
    }
  }

  const rows = new Map<string, { scryfall_id: string; name: string }>();
  if (collectionIds.length > 0) {
    const { data } = await supabase
      .from("collection_cards")
      .select("id, name, scryfall_id")
      .in("id", collectionIds)
      .eq("owner_id", userId);
    for (const row of data ?? []) rows.set(row.id, { scryfall_id: row.scryfall_id, name: row.name });
  }

  const resolved: ResolvedBulkSource[] = [];
  const skipped: SkippedBulkSource[] = [];
  for (const source of unique) {
    const key = bulkSourceKey(source);
    if (source.kind === "deck_entry") {
      const entry = entries.get(source.id);
      if (!entry) {
        skipped.push({ key, name: "A deck entry", reason: "Not found in your decks." });
      } else if (entry.card_id) {
        skipped.push({ key, name: entry.name, reason: "Already one of your PipGlyph cards." });
      } else if (!entry.scryfall_id || !SCRYFALL_ID_RE.test(entry.scryfall_id)) {
        skipped.push({ key, name: entry.name, reason: "Not a real card's printing yet." });
      } else {
        resolved.push({ key, source, scryfallId: entry.scryfall_id, name: entry.name, deckEntryId: source.id });
      }
    } else if (source.kind === "collection") {
      const row = rows.get(source.id);
      if (!row) skipped.push({ key, name: "A collection card", reason: "Not found in your collection." });
      else resolved.push({ key, source, scryfallId: row.scryfall_id, name: row.name, collectionId: source.id });
    } else if (SCRYFALL_ID_RE.test(source.id)) {
      resolved.push({ key, source, scryfallId: source.id.toLowerCase(), name: "" });
    } else {
      skipped.push({ key, name: "A card", reason: "Not a Scryfall printing." });
    }
  }
  return { resolved, skipped };
}

/** The printings of the resolved sources, by Scryfall id (/cards/collection,
 *  ≤ 75 a call). Null when Scryfall didn't answer. */
export async function fetchBulkPrintings(scryfallIds: readonly string[]): Promise<Map<string, ScryfallCard> | null> {
  const unique = [...new Set(scryfallIds.map((id) => id.toLowerCase()))];
  const cards = new Map<string, ScryfallCard>();
  for (let i = 0; i < unique.length; i += SCRYFALL_COLLECTION_MAX) {
    const chunk = unique.slice(i, i + SCRYFALL_COLLECTION_MAX);
    const result = await getCardCollection(chunk.map((id) => ({ id })), { timeoutMs: 20_000 });
    if (!result) return null;
    for (const card of result.cards) cards.set(card.id.toLowerCase(), card);
  }
  return cards;
}

/** The creator's import of a printing: mapped (with its set object where
 *  the collector line needs it — cached a day) and finalized against the
 *  verified combos, as POST /api/scryfall/named answers it. */
export async function importPatchOf(card: ScryfallCard, verifiedKeys: ReadonlySet<string>): Promise<ScryfallImportPatch> {
  const set = needsScryfallSet(card) && card.set ? await getScryfallSet(card.set) : undefined;
  const mapped = mapScryfallToFormPatch(card, { set: set ?? undefined });
  return mapped.frame_match ? finalizeImportMatch(mapped, verifiedKeys) : mapped;
}

/** A printing's small picture for the dialog's list (Scryfall's own). */
export function printingThumbOf(card: ScryfallCard): string | null {
  return card.image_uris?.small ?? card.card_faces?.[0]?.image_uris?.small ?? null;
}

/** A collection row records the card it was customized into (0186: the
 *  server writes `customized_card_id`; the API roles may UPDATE a row's
 *  quantity alone, and a trigger holds the card to the row's owner). The
 *  caller has checked the row is `userId`'s. True when it landed. */
export async function writeCollectionCustomized(userId: string, collectionRowId: string, cardId: string): Promise<boolean> {
  if (!isAdminConfigured()) return false;
  const { error } = await createAdminClient()
    .from("collection_cards")
    .update({ customized_card_id: cardId, customized_at: new Date().toISOString() })
    .eq("id", collectionRowId)
    .eq("owner_id", userId);
  if (error) console.warn(`[bulk-customize] collection row ${collectionRowId} not recorded: ${error.message}`);
  return !error;
}

/** A past batch on the tool page: when, how many cards, how many landed. */
export type RecentBulkBatch = {
  id: string;
  createdAt: string;
  cards: number;
  made: number;
  failed: number;
};

/** The caller's last few batches (their own job rows, through their session;
 *  never the plan — 0163: no API role reads it). */
export async function listRecentBulkBatches(userId: string, limit = 5): Promise<RecentBulkBatch[]> {
  const supabase = await createClient();
  const { data } = await supabase
    .from("ai_generation_jobs")
    .select("id, created_at, steps")
    .eq("owner_id", userId)
    .eq("kind", "bulk_customize")
    .order("created_at", { ascending: false })
    .limit(limit);
  return (data ?? []).map((row) => {
    const steps = Array.isArray(row.steps) ? (row.steps as Array<{ status?: unknown }>) : [];
    return {
      id: row.id,
      createdAt: row.created_at,
      cards: steps.length,
      made: steps.filter((step) => step?.status === "done").length,
      failed: steps.filter((step) => step?.status === "failed").length,
    };
  });
}
