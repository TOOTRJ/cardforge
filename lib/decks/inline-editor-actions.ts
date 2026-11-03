"use server";

import { revalidatePath, updateTag } from "next/cache";
import { createClient, getCurrentProfile } from "@/lib/supabase/server";
import { isUuid } from "@/lib/ids";
import { DECK_INLINE_EDITOR_TAG } from "@/lib/decks/inline-editor";
import { ownDeckForInlineEditor } from "@/lib/decks/inline-editor-context";
import { revalidateDeckEntryChange } from "@/lib/decks/revalidate";
import { DECK_INLINE_EDITOR_SETTING_KEY, isDeckInlineEditorMode } from "@/lib/decks/inline-editor-shared";

export type DeckInlineEditorActionResult = { ok: true } | { ok: false; error: string };

/** Admin: who edits a deck's cards in the drawer (site_settings.deck_inline_editor). */
export async function setDeckInlineEditorModeAction(mode: unknown): Promise<DeckInlineEditorActionResult> {
  const profile = await getCurrentProfile();
  if (!profile?.is_admin) return { ok: false, error: "Not authorized." };
  if (!isDeckInlineEditorMode(mode)) return { ok: false, error: "Unknown mode." };
  const supabase = await createClient();
  const { error } = await supabase.from("site_settings").upsert(
    {
      key: DECK_INLINE_EDITOR_SETTING_KEY,
      value: { mode },
      updated_at: new Date().toISOString(),
      updated_by: profile.id,
    },
    { onConflict: "key" },
  );
  if (error) {
    console.warn("setDeckInlineEditorModeAction:", error.message);
    return { ok: false, error: "Couldn't change the deck editor setting." };
  }
  // updateTag, not revalidateTag(…, "max"): the admin page and the next deck
  // page read the switch on the very next request and must see this write.
  updateTag(DECK_INLINE_EDITOR_TAG);
  revalidatePath("/admin/deck-editor");
  return { ok: true };
}

/** The deck's edit drawer saved a card (TODO DK5.18): the deck's paths are
 *  revalidated — as its entry writes do — so this action's answer brings the
 *  deck's rows back with the saved card's title, badge and picture (no
 *  router.refresh()). The OWNER's deck only, while the switch allows them. */
export async function revalidateDeckAfterInlineSaveAction(deckId: unknown): Promise<DeckInlineEditorActionResult> {
  if (typeof deckId !== "string" || !isUuid(deckId)) return { ok: false, error: "Not found." };
  const owned = await ownDeckForInlineEditor(deckId);
  if ("status" in owned) return { ok: false, error: owned.error };
  const supabase = await createClient();
  await revalidateDeckEntryChange(supabase, owned.userId, owned.deck.slug);
  return { ok: true };
}
