import "server-only";
import { cache } from "react";
import { unstable_cache } from "next/cache";
import { createPublicClient } from "@/lib/supabase/public";
import { isSupabaseConfigured } from "@/lib/supabase/env";
import { getCurrentProfile } from "@/lib/supabase/server";
import {
  canUseDeckInlineEditor,
  DECK_INLINE_EDITOR_SETTING_KEY,
  DEFAULT_DECK_INLINE_EDITOR_MODE,
  isDeckInlineEditorMode,
  type DeckInlineEditorMode,
} from "@/lib/decks/inline-editor-shared";

/** Cache tag for the switch (site_settings.deck_inline_editor). */
export const DECK_INLINE_EDITOR_TAG = "deck-inline-editor";

const loadDeckInlineEditorMode = unstable_cache(
  async (): Promise<DeckInlineEditorMode> => {
    if (!isSupabaseConfigured()) return DEFAULT_DECK_INLINE_EDITOR_MODE;
    const supabase = createPublicClient();
    const { data } = await supabase
      .from("site_settings")
      .select("value")
      .eq("key", DECK_INLINE_EDITOR_SETTING_KEY)
      .maybeSingle();
    const value = (data?.value ?? {}) as { mode?: unknown };
    return isDeckInlineEditorMode(value.mode) ? value.mode : DEFAULT_DECK_INLINE_EDITOR_MODE;
  },
  [DECK_INLINE_EDITOR_TAG],
  { revalidate: 300, tags: [DECK_INLINE_EDITOR_TAG] },
);

/** The admin's switch for the deck's inline card editor (TODO DK5.18).
 *  Public-client read (site_settings is readable by everyone); no row = off. */
export const getDeckInlineEditorMode = cache(loadDeckInlineEditorMode);

/** Whether the signed-in viewer edits their deck's cards in the drawer: the
 *  switch, and for "admins" the viewer's own profile (read only then — with
 *  the switch off, nothing more is read than on main). The deck page asks
 *  for its OWNER only; a visitor's page never offers the drawer. */
export async function viewerUsesDeckInlineEditor(): Promise<boolean> {
  const mode = await getDeckInlineEditorMode();
  if (mode === "off") return false;
  if (mode === "everyone") return true;
  const profile = await getCurrentProfile();
  return canUseDeckInlineEditor(mode, Boolean(profile?.is_admin));
}
