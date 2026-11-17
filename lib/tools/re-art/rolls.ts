import "server-only";

import { createClient } from "@/lib/supabase/server";
import { createAdminClient, isAdminConfigured } from "@/lib/supabase/admin";
import type { Json } from "@/types/supabase";
import { REART_ROLLS_KEPT, type ReartMethod, type ReartRoll } from "@/lib/tools/re-art/model";
import { discardReartArtIfUnused } from "@/lib/tools/re-art/server";

// ---------------------------------------------------------------------------
// A card's EARLIER PICTURES (migration 0215, deck_reart_rolls). A re-roll and
// "Put the old art back" keep the picture they take off a card — a few per
// card and deck (REART_ROLLS_KEPT), the oldest dropped past that — and the
// maker can go back to any of them.
//
// Who names a picture, at every moment (the guarded discard in server.ts
// asks all three, so a picture is removed only when none does):
//
//   * the CARD that shows it;
//   * the deck's ROW (deck_reart_cards.art_url: the picture Re-art painted
//     last, and previous_*: the art to put back);
//   * a kept picture's row HERE.
//
// So the order of every move is "name it in the new place, then stop naming
// it in the old one":
//
//   * a paint KEEPS the row's picture here before the row is overwritten,
//     and prunes only after the new picture has landed on the card (a paint
//     that never lands drops the row it just kept, and nothing was removed);
//   * a pick CLAIMS its row here first (delete … returning: two tabs, or a
//     prune, can't both hold it), writes the deck's row to name it, keeps
//     the picture it replaces, then edits the card — and puts all of it back
//     if the edit is refused.
//
// Written with the service role, the owner named in every statement; the
// owner's own session reads the list. A database 0215 hasn't reached (a
// deploy that lands before its migration) keeps nothing and lists nothing —
// never an error a paint could fail on.
// ---------------------------------------------------------------------------

type RollRow = {
  id: string;
  card_id: string;
  style_version: number;
  job_id: string | null;
  art_url: string;
  art_position: Json | null;
  artist_credit: string | null;
  back_art_url: string | null;
  back_art_position: Json | null;
  back_artist_credit: string | null;
  image_model: string | null;
  method: string | null;
  painted_at: string;
};

const ROLL_COLUMNS =
  "id, card_id, style_version, job_id, art_url, art_position, artist_credit, back_art_url, back_art_position, back_artist_credit, image_model, method, painted_at";

/** The table isn't there yet (0215 not applied): Postgres, or PostgREST's
 *  schema cache. */
const missingTable = (error: { code?: string } | null | undefined) => error?.code === "42P01" || error?.code === "PGRST205";

function rollOf(row: RollRow): ReartRoll {
  return {
    id: row.id,
    cardId: row.card_id,
    styleVersion: row.style_version,
    jobId: row.job_id,
    artUrl: row.art_url,
    artPosition: row.art_position,
    artistCredit: row.artist_credit,
    backArtUrl: row.back_art_url,
    backArtPosition: row.back_art_position,
    backArtistCredit: row.back_artist_credit,
    imageModel: row.image_model,
    method: row.method === "restyle" || row.method === "paint" ? (row.method as ReartMethod) : null,
    paintedAt: row.painted_at,
  };
}

/** The deck's kept pictures (the owner's session), by card id. A read that
 *  failed lists none (the studio then offers none — never a wrong one). */
export async function readRolls(deckId: string): Promise<Map<string, ReartRoll[]>> {
  const byCard = new Map<string, ReartRoll[]>();
  const supabase = await createClient();
  const { data, error } = await supabase.from("deck_reart_rolls").select(ROLL_COLUMNS).eq("deck_id", deckId).order("painted_at", { ascending: false });
  if (error) {
    if (!missingTable(error)) console.error(`[re-art] kept pictures of deck ${deckId} not read: ${error.code ?? ""} ${error.message}`);
    return byCard;
  }
  for (const row of (data ?? []) as unknown as RollRow[]) {
    byCard.set(row.card_id, [...(byCard.get(row.card_id) ?? []), rollOf(row)]);
  }
  return byCard;
}

/** A picture to keep: everything a kept row holds but its id. */
export type RollToKeep = Omit<ReartRoll, "id">;

const rowOf = (userId: string, deckId: string, roll: RollToKeep) => ({
  deck_id: deckId,
  card_id: roll.cardId,
  owner_id: userId,
  style_version: roll.styleVersion,
  job_id: roll.jobId,
  art_url: roll.artUrl,
  art_position: (roll.artPosition ?? null) as Json | null,
  artist_credit: roll.artistCredit?.slice(0, 200) || null,
  back_art_url: roll.backArtUrl,
  back_art_position: (roll.backArtPosition ?? null) as Json | null,
  back_artist_credit: roll.backArtistCredit?.slice(0, 200) || null,
  image_model: roll.imageModel?.trim().slice(0, 200) || null,
  method: roll.method,
  painted_at: roll.paintedAt,
});

/**
 * Keeps a picture for the card on the deck. `inserted` is false when it was
 * kept already (the same picture, deck and card: one row). Null when it
 * couldn't be kept — the caller goes on (the picture is then nobody's, and
 * the storage sweep's in time), and never fails a paint for it.
 *
 * Never prunes: the caller does, once whatever replaced the picture has
 * landed (pruneRolls).
 */
export async function keepRoll(userId: string, deckId: string, roll: RollToKeep): Promise<{ id: string; inserted: boolean } | null> {
  if (!isAdminConfigured() || !roll.artUrl) return null;
  const admin = createAdminClient();
  const { data, error } = await admin.from("deck_reart_rolls").insert(rowOf(userId, deckId, roll)).select("id").maybeSingle();
  if (!error && data) return { id: data.id, inserted: true };
  if (error?.code === "23505") {
    // Kept already (the unique picture per deck and card).
    const { data: kept } = await admin
      .from("deck_reart_rolls")
      .select("id")
      .eq("deck_id", deckId)
      .eq("card_id", roll.cardId)
      .eq("owner_id", userId)
      .eq("art_url", roll.artUrl)
      .maybeSingle();
    return kept ? { id: kept.id, inserted: false } : null;
  }
  if (!missingTable(error)) console.warn(`[re-art] earlier picture of card ${roll.cardId} on deck ${deckId} not kept: ${error?.code ?? ""} ${error?.message ?? "no row"}`);
  return null;
}

/**
 * CLAIMS a kept picture: its row is taken out and handed back (delete …
 * returning), so exactly one caller holds it — a pick in another tab, or a
 * prune, finds it gone. Null: not kept (any more), not the caller's, or the
 * read failed.
 */
export async function claimRoll(userId: string, deckId: string, cardId: string, rollId: string): Promise<ReartRoll | null> {
  if (!isAdminConfigured()) return null;
  const { data, error } = await createAdminClient()
    .from("deck_reart_rolls")
    .delete()
    .eq("id", rollId)
    .eq("deck_id", deckId)
    .eq("card_id", cardId)
    .eq("owner_id", userId)
    .select(ROLL_COLUMNS)
    .maybeSingle();
  if (error) {
    if (!missingTable(error)) console.error(`[re-art] kept picture ${rollId} not claimed: ${error.code ?? ""} ${error.message}`);
    return null;
  }
  return data ? rollOf(data as unknown as RollRow) : null;
}

/** Takes a kept row out WITHOUT touching its picture (a paint that never
 *  landed un-keeps the picture it had just kept: the deck's row names it
 *  again). Best effort. */
export async function dropRoll(userId: string, rollId: string): Promise<void> {
  if (!isAdminConfigured()) return;
  const { error } = await createAdminClient().from("deck_reart_rolls").delete().eq("id", rollId).eq("owner_id", userId);
  if (error && !missingTable(error)) console.warn(`[re-art] kept picture ${rollId} not taken back out: ${error.message}`);
}

/**
 * Past REART_ROLLS_KEPT, the card's OLDEST kept pictures on this deck are
 * dropped: their rows first (delete … returning — only a row this call
 * took out is its to remove), then each picture through the guarded discard
 * (never one a card still shows, a deck's row names, or another kept row
 * holds). Returns how many rows were dropped. Never throws.
 */
export async function pruneRolls(userId: string, deckId: string, cardId: string): Promise<number> {
  if (!isAdminConfigured()) return 0;
  try {
    const admin = createAdminClient();
    const { data, error } = await admin
      .from("deck_reart_rolls")
      .select("id")
      .eq("deck_id", deckId)
      .eq("card_id", cardId)
      .eq("owner_id", userId)
      .order("painted_at", { ascending: false })
      .order("kept_at", { ascending: false });
    if (error || !data) return 0;
    const extra = data.slice(REART_ROLLS_KEPT).map((row) => row.id);
    if (extra.length === 0) return 0;
    const { data: dropped, error: dropError } = await admin
      .from("deck_reart_rolls")
      .delete()
      .in("id", extra)
      .eq("owner_id", userId)
      .select("art_url, back_art_url");
    if (dropError || !dropped) return 0;
    for (const row of dropped as Array<{ art_url: string; back_art_url: string | null }>) {
      await discardReartArtIfUnused(userId, row.art_url);
      await discardReartArtIfUnused(userId, row.back_art_url);
    }
    return dropped.length;
  } catch (error) {
    console.warn(`[re-art] earlier pictures of card ${cardId} on deck ${deckId} not pruned:`, error);
    return 0;
  }
}
