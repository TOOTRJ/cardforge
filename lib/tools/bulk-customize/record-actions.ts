"use server";

import { createClient, getCurrentUser } from "@/lib/supabase/server";
import { isAdminConfigured } from "@/lib/supabase/admin";
import { writeCollectionCustomized } from "@/lib/tools/bulk-customize/server";
import { isUuid } from "@/lib/ids";
import { revalidatePath } from "next/cache";
import { toolHref } from "@/lib/tools/catalog";

// ---------------------------------------------------------------------------
// A collection row records the card it was customized into (migration 0186:
// `collection_cards.customized_card_id`, written by the server only — the
// API roles may UPDATE a row's quantity alone). The creator calls this after
// a one-card customize from the Collection page saves; the batch writes the
// same columns in its step (lib/tools/bulk-customize/step.ts).
//
// The row is read through the caller's OWN session first (RLS: their rows,
// while the Collection Deck Builder is open to them) and the card must be
// theirs — the 0186 trigger holds the second rule in the database too.
// ---------------------------------------------------------------------------

export async function recordCollectionCustomizedAction(
  collectionRowId: unknown,
  cardId: unknown,
): Promise<{ ok: boolean }> {
  if (typeof collectionRowId !== "string" || typeof cardId !== "string") return { ok: false };
  if (!isUuid(collectionRowId) || !isUuid(cardId) || !isAdminConfigured()) return { ok: false };
  const user = await getCurrentUser();
  if (!user) return { ok: false };
  const supabase = await createClient();
  const [{ data: row }, { data: card }] = await Promise.all([
    supabase.from("collection_cards").select("id").eq("id", collectionRowId).eq("owner_id", user.id).maybeSingle(),
    supabase.from("cards").select("id").eq("id", cardId).eq("owner_id", user.id).maybeSingle(),
  ]);
  if (!row || !card) return { ok: false };
  if (!(await writeCollectionCustomized(user.id, collectionRowId, cardId))) return { ok: false };
  revalidatePath(toolHref("collection-builder"));
  return { ok: true };
}
