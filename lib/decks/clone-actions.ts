"use server";

import { createClient, getCurrentUser, getCurrentUsername } from "@/lib/supabase/server";
import { isSupabaseConfigured } from "@/lib/supabase/env";
import { isUuid } from "@/lib/ids";
import { viaDeckLink } from "@/lib/decks/deck-link";
import { revalidateDeckPaths } from "@/lib/decks/revalidate";
import {
  cloneErrorMessage,
  cloneNotice,
  cloneSlugOf,
  cloneTitleOf,
  parseCloneResult,
} from "@/lib/decks/clone";

// ---------------------------------------------------------------------------
// "Copy deck" (TODO DK5.16): the viewer's PRIVATE copy of a deck they can
// open — a public one, an unlisted one by its link, or their own — through
// ONE database call, migration 0164's clone_deck() (the deck, its entries
// by the deck rules, the "remixed from" lineage and the source owner's
// notice in one transaction). The source is read by its id — its link
// (lib/decks/deck-link.ts) — for its name; the database decides the rest.
// ---------------------------------------------------------------------------

export type CloneDeckResult =
  | { ok: true; deckId: string; slug: string; copied: number; skipped: number; notice: string }
  | { ok: false; code?: "AUTH_REQUIRED"; formError: string };

export async function cloneDeckAction(sourceDeckId: unknown): Promise<CloneDeckResult> {
  if (typeof sourceDeckId !== "string" || !isUuid(sourceDeckId)) {
    return { ok: false, formError: "That deck can't be copied." };
  }
  if (!isSupabaseConfigured()) return { ok: false, formError: "Decks aren't available right now." };
  const user = await getCurrentUser();
  if (!user) return { ok: false, code: "AUTH_REQUIRED", formError: "Sign in to copy this deck." };

  const supabase = await createClient();
  const { data: source } = await viaDeckLink(
    supabase.from("decks").select("id, title").eq("id", sourceDeckId),
    sourceDeckId,
  ).maybeSingle();
  if (!source) return { ok: false, formError: cloneErrorMessage({ message: "deck_not_found" }) };

  const title = cloneTitleOf(source.title);
  const { data, error } = await supabase.rpc("clone_deck", {
    p_source_deck_id: sourceDeckId,
    p_title: title,
    p_slug: cloneSlugOf(title),
  });
  const result = error ? null : parseCloneResult(data);
  if (!result) return { ok: false, formError: cloneErrorMessage(error) };

  revalidateDeckPaths(result.slug, await getCurrentUsername());
  return { ok: true, ...result, notice: cloneNotice(result) };
}
