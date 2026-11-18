import "server-only";

import { createClient } from "@/lib/supabase/server";
import { createAdminClient, isAdminConfigured } from "@/lib/supabase/admin";
import { chunkIds } from "@/lib/supabase/select-all-rows";

// ---------------------------------------------------------------------------
// LOCKED cards (migration 0216, deck_reart_locks): a deck entry whose
// picture the tool leaves as it is. A run and a sample skip it and charge
// nothing; a re-roll, an earlier picture, "old art back" and an undo of a
// run are refused until it is unlocked.
//
// Read through the owner's own session for the studio and the plan; with
// the service role (the owner named in every statement) where the caller's
// read of the tool's tables is gated — a step. A read that FAILED is never
// "not locked" where a paint would follow: those callers get `null` and
// stop. A database 0216 hasn't reached (a deploy that lands before its
// migration) has no locks at all.
// ---------------------------------------------------------------------------

/** The table isn't there yet (0216 not applied): Postgres, or PostgREST's
 *  schema cache. */
const missingTable = (error: { code?: string } | null | undefined) => error?.code === "42P01" || error?.code === "PGRST205";

/** The deck's locked entries (the owner's session), or null when the read
 *  failed (the caller decides: the studio shows none, a plan stops). */
export async function readLocks(deckId: string): Promise<Set<string> | null> {
  const supabase = await createClient();
  const { data, error } = await supabase.from("deck_reart_locks").select("entry_id").eq("deck_id", deckId);
  if (error) {
    if (missingTable(error)) return new Set();
    console.error(`[re-art] locks of deck ${deckId} not read: ${error.code ?? ""} ${error.message}`);
    return null;
  }
  return new Set(((data ?? []) as Array<{ entry_id: string }>).map((row) => row.entry_id));
}

/**
 * Whether one entry is locked, as the SERVER reads it (a step) — the entry
 * itself or, when it holds a card (`cardId`), any other entry of the deck
 * that holds the same card: a lock is on the card's picture. Null: a read
 * didn't answer — the step stops before any charge rather than paint a card
 * that may be locked.
 */
export async function isEntryLockedAdmin(userId: string, deckId: string, entryId: string, cardId: string | null = null): Promise<boolean | null> {
  if (!isAdminConfigured()) return null;
  const admin = createAdminClient();
  let entryIds = [entryId];
  if (cardId) {
    const { data: siblings, error: siblingsError } = await admin.from("deck_cards").select("id").eq("deck_id", deckId).eq("card_id", cardId);
    if (siblingsError) {
      console.error(`[re-art] entries of card ${cardId} on deck ${deckId} not read: ${siblingsError.code ?? ""} ${siblingsError.message}`);
      return null;
    }
    entryIds = [...new Set([entryId, ...((siblings ?? []) as Array<{ id: string }>).map((row) => row.id)])];
  }
  // Rows, not a HEAD count: a HEAD answer carries no error body, so a table
  // that isn't there yet (a deploy that lands before 0216) would read as "no
  // answer" and stop every paint, where it means "no locks".
  const { data, error } = await admin
    .from("deck_reart_locks")
    .select("entry_id")
    .in("entry_id", entryIds)
    .eq("deck_id", deckId)
    .eq("owner_id", userId)
    .limit(1);
  if (error) {
    if (missingTable(error)) return false;
    console.error(`[re-art] lock of entry ${entryId} not read: ${error.code ?? ""} ${error.message}`);
    return null;
  }
  return Array.isArray(data) ? data.length > 0 : null;
}

/**
 * Whether the CARD is locked on this deck — any of the deck's entries that
 * hold it (a one-card action names the card). The caller's own session:
 * their entries, their locks. Null: a read didn't answer.
 */
export async function isCardLocked(deckId: string, cardId: string): Promise<boolean | null> {
  const supabase = await createClient();
  const { data: entries, error } = await supabase.from("deck_cards").select("id").eq("deck_id", deckId).eq("card_id", cardId);
  if (error) return null;
  const ids = ((entries ?? []) as Array<{ id: string }>).map((row) => row.id);
  if (ids.length === 0) return false;
  const locks = await readLocks(deckId);
  if (!locks) return null;
  return ids.some((id) => locks.has(id));
}

/**
 * Locks or unlocks the deck's entries named — only entries that ARE this
 * deck's (the caller's own session reads them; the database's trigger holds
 * the rest). An UNLOCK also unlocks every other entry of the deck that holds
 * the same card: a lock is on the card's picture, so the card shown locked
 * through another of its rows is unlocked by the press that says so.
 * Returns how many of the entries asked for belong to the deck, or null when
 * a read or the write failed.
 */
export async function setLocks(userId: string, deckId: string, entryIds: ReadonlyArray<string>, locked: boolean): Promise<number | null> {
  if (!isAdminConfigured()) return null;
  const wanted = [...new Set(entryIds)];
  if (wanted.length === 0) return 0;
  // A selection can be a whole deck: ids go a hundred to a request.
  const supabase = await createClient();
  const entryReads = await Promise.all(
    chunkIds(wanted).map((ids) => supabase.from("deck_cards").select("id, card_id").eq("deck_id", deckId).in("id", ids)),
  );
  if (entryReads.some((read) => read.error)) return null;
  const named = entryReads.flatMap((read) => (read.data ?? []) as Array<{ id: string; card_id: string | null }>);
  const ids = named.map((row) => row.id);
  if (ids.length === 0) return 0;
  const admin = createAdminClient();
  if (locked) {
    const { error } = await admin.from("deck_reart_locks").upsert(
      ids.map((entry_id) => ({ entry_id, deck_id: deckId, owner_id: userId })),
      { onConflict: "entry_id", ignoreDuplicates: true },
    );
    if (error) {
      console.error(`[re-art] locks of deck ${deckId} not set: ${error.code ?? ""} ${error.message}`);
      return null;
    }
    return ids.length;
  }
  // The other rows of the same cards.
  const cardIds = [...new Set(named.map((row) => row.card_id).filter((id): id is string => Boolean(id)))];
  let all = ids;
  if (cardIds.length > 0) {
    const siblingReads = await Promise.all(
      chunkIds(cardIds).map((part) => supabase.from("deck_cards").select("id").eq("deck_id", deckId).in("card_id", part)),
    );
    if (siblingReads.some((read) => read.error)) return null;
    all = [...new Set([...ids, ...siblingReads.flatMap((read) => (read.data ?? []) as Array<{ id: string }>).map((row) => row.id)])];
  }
  // Every part must go: a lock left behind would keep a card the maker
  // unlocked locked (said as a failure; pressing Unlock again finishes it).
  const deletes = await Promise.all(
    chunkIds(all).map((part) => admin.from("deck_reart_locks").delete().in("entry_id", part).eq("deck_id", deckId).eq("owner_id", userId)),
  );
  const failed = deletes.find((result) => result.error)?.error;
  if (failed) {
    console.error(`[re-art] locks of deck ${deckId} not removed: ${failed.code ?? ""} ${failed.message}`);
    return null;
  }
  return ids.length;
}
