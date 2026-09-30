import "server-only";

import { createAdminClient } from "@/lib/supabase/admin";

// ---------------------------------------------------------------------------
// ONE finish per staged card-art upload (TODO 6.10; review 2026-09-29).
//
// finishCardArtUploadAction (lib/cards/upload-art-server.ts) reads a staged
// file, stores it in card-art and only THEN overwrites the staged key with a
// tombstone — so finishes fired in parallel on one name would all read the
// file first and each store a copy, on ONE counted start (the upload rate
// limit counts the start). Storage can't arbitrate that: racing uploads of
// one key without upsert all succeed. Migration 0132's primary key can:
// claim_card_art_upload(user, name) returns true to exactly one caller per
// (user, name), and the finish reads nothing unless it got that true.
//
// Service role only (0132: the table and function are revoked from every API
// role). Fail-CLOSED: an error, a throw or any answer but `true` is "not
// yours" — the upload is simply started again.
// ---------------------------------------------------------------------------

export async function claimStagedCardArt(userId: string, stagedName: string): Promise<boolean> {
  try {
    const { data, error } = await createAdminClient().rpc("claim_card_art_upload", {
      p_user_id: userId,
      p_staged_name: stagedName,
    });
    if (error) {
      console.error(`[card-art] claim_card_art_upload failed for ${userId}:`, error.message);
      return false;
    }
    return data === true;
  } catch (error) {
    console.error(`[card-art] claim_card_art_upload threw for ${userId}:`, error);
    return false;
  }
}
