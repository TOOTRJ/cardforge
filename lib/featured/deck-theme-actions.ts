"use server";

import { revalidatePath } from "next/cache";
import { getCurrentProfile } from "@/lib/supabase/server";
import { createAdminClient, isAdminConfigured } from "@/lib/supabase/admin";
import { isUuid } from "@/lib/ids";
import {
  DECK_THEME_DECKS_MAX,
  DECK_THEMES_MAX,
  deckSlugFromUrl,
  deckThemeSchema,
  type DeckThemeInput,
} from "@/lib/validation/deck-theme";

// ---------------------------------------------------------------------------
// "Featured themed decks" (migration 0167) — the admin's writes, from
// /admin/featured. The two tables grant the API roles nothing, so every
// write goes through the service role behind the is_admin check here (the
// featured cards' posture). A pick must be PUBLIC, NON-EMPTY and a REAL
// CREATOR's deck when it is added — the read (list_featured_deck_themes)
// applies the same rule again at every visit, so a deck that later turns
// private, empties or loses its maker's last public card just drops out.
// Each write purges the two ISR'd pages that draw the section.
// ---------------------------------------------------------------------------

export type DeckThemeActionResult = { ok: true } | { ok: false; error: string };

type Admin = ReturnType<typeof createAdminClient>;

async function adminOrError(): Promise<{ admin: Admin } | { error: string }> {
  const profile = await getCurrentProfile();
  if (!profile?.is_admin) return { error: "Not authorized." };
  if (!isAdminConfigured()) return { error: "Admin client isn't configured." };
  return { admin: createAdminClient() };
}

function purge() {
  revalidatePath("/");
  revalidatePath("/decks");
  revalidatePath("/admin/featured");
}

export async function createDeckThemeAction(input: DeckThemeInput): Promise<DeckThemeActionResult> {
  const gate = await adminOrError();
  if ("error" in gate) return { ok: false, error: gate.error };
  const parsed = deckThemeSchema.safeParse(input);
  if (!parsed.success) return { ok: false, error: parsed.error.issues[0]?.message ?? "Check the theme." };

  const { data: themes, error: readError } = await gate.admin
    .from("deck_themes")
    .select("position")
    .order("position", { ascending: false });
  if (readError) return { ok: false, error: "Couldn't read the themes." };
  if ((themes ?? []).length >= DECK_THEMES_MAX) {
    return { ok: false, error: `At most ${DECK_THEMES_MAX} themes — delete one first.` };
  }
  const position = (themes?.[0]?.position ?? -1) + 1;
  const { error } = await gate.admin
    .from("deck_themes")
    .insert({ title: parsed.data.title, blurb: parsed.data.blurb, position });
  if (error) {
    console.warn("createDeckThemeAction:", error.message);
    return { ok: false, error: "Couldn't create the theme." };
  }
  purge();
  return { ok: true };
}

export async function updateDeckThemeAction(
  themeId: string,
  input: DeckThemeInput,
): Promise<DeckThemeActionResult> {
  const gate = await adminOrError();
  if ("error" in gate) return { ok: false, error: gate.error };
  if (!isUuid(themeId)) return { ok: false, error: "Unknown theme." };
  const parsed = deckThemeSchema.safeParse(input);
  if (!parsed.success) return { ok: false, error: parsed.error.issues[0]?.message ?? "Check the theme." };

  const { error } = await gate.admin
    .from("deck_themes")
    .update({
      title: parsed.data.title,
      blurb: parsed.data.blurb,
      updated_at: new Date().toISOString(),
    })
    .eq("id", themeId);
  if (error) {
    console.warn("updateDeckThemeAction:", error.message);
    return { ok: false, error: "Couldn't save the theme." };
  }
  purge();
  return { ok: true };
}

export async function setDeckThemeLiveAction(themeId: string, isLive: boolean): Promise<DeckThemeActionResult> {
  const gate = await adminOrError();
  if ("error" in gate) return { ok: false, error: gate.error };
  if (!isUuid(themeId)) return { ok: false, error: "Unknown theme." };
  const { error } = await gate.admin
    .from("deck_themes")
    .update({ is_live: isLive, updated_at: new Date().toISOString() })
    .eq("id", themeId);
  if (error) return { ok: false, error: "Couldn't change the theme." };
  purge();
  return { ok: true };
}

export async function deleteDeckThemeAction(themeId: string): Promise<DeckThemeActionResult> {
  const gate = await adminOrError();
  if ("error" in gate) return { ok: false, error: gate.error };
  if (!isUuid(themeId)) return { ok: false, error: "Unknown theme." };
  const { error } = await gate.admin.from("deck_themes").delete().eq("id", themeId);
  if (error) return { ok: false, error: "Couldn't delete the theme." };
  purge();
  return { ok: true };
}

/** Swap a theme with its neighbour (`-1` = up, `1` = down). Positions are
 *  rewritten 0…n-1 in the new order, so ties and gaps never stick. */
export async function moveDeckThemeAction(themeId: string, direction: -1 | 1): Promise<DeckThemeActionResult> {
  const gate = await adminOrError();
  if ("error" in gate) return { ok: false, error: gate.error };
  const { data, error } = await gate.admin
    .from("deck_themes")
    .select("id")
    .order("position")
    .order("created_at")
    .order("id");
  if (error || !data) return { ok: false, error: "Couldn't read the themes." };
  const ids = reorder(data.map((row) => row.id), themeId, direction);
  if (!ids) return { ok: true };
  const results = await Promise.all(
    ids.map((id, position) => gate.admin.from("deck_themes").update({ position }).eq("id", id)),
  );
  if (results.some((result) => result.error)) return { ok: false, error: "Couldn't reorder the themes." };
  purge();
  return { ok: true };
}

/** Add a deck to a theme from a pasted deck link (`/deck/<slug>`; an old
 *  slug of a renamed deck works too). */
export async function addDeckToThemeAction(themeId: string, deckUrl: string): Promise<DeckThemeActionResult> {
  const gate = await adminOrError();
  if ("error" in gate) return { ok: false, error: gate.error };
  if (!isUuid(themeId)) return { ok: false, error: "Unknown theme." };
  const slug = deckSlugFromUrl(deckUrl);
  if (!slug) return { ok: false, error: "Paste a deck page link, e.g. /deck/deck-slug." };
  const { admin } = gate;

  let { data: deck } = await admin
    .from("decks")
    .select("id, owner_id, visibility, card_count")
    .eq("slug", slug)
    .maybeSingle();
  if (!deck) {
    const { data: history } = await admin.from("deck_slug_history").select("deck_id").eq("old_slug", slug).maybeSingle();
    if (history) {
      ({ data: deck } = await admin
        .from("decks")
        .select("id, owner_id, visibility, card_count")
        .eq("id", history.deck_id)
        .maybeSingle());
    }
  }
  if (!deck) return { ok: false, error: "No deck at that link." };
  if (deck.visibility !== "public") return { ok: false, error: "That deck isn't public — feature public decks only." };
  if (deck.card_count <= 0) return { ok: false, error: "That deck has no cards yet." };
  const { data: creator } = await admin.rpc("owner_is_creator", { p_owner_id: deck.owner_id });
  if (creator !== true) {
    return {
      ok: false,
      error: "That deck's maker has no public card (or is an admin) — the section shows real creators' decks only.",
    };
  }

  const { data: picks, error: picksError } = await admin
    .from("deck_theme_decks")
    .select("deck_id, position")
    .eq("theme_id", themeId)
    .order("position", { ascending: false });
  if (picksError) return { ok: false, error: "Couldn't read the theme." };
  if ((picks ?? []).some((pick) => pick.deck_id === deck.id)) return { ok: false, error: "That deck is already in this theme." };
  if ((picks ?? []).length >= DECK_THEME_DECKS_MAX) {
    return { ok: false, error: `A theme holds at most ${DECK_THEME_DECKS_MAX} decks — remove one first.` };
  }
  const { error } = await admin
    .from("deck_theme_decks")
    .insert({ theme_id: themeId, deck_id: deck.id, position: (picks?.[0]?.position ?? -1) + 1 });
  if (error) {
    console.warn("addDeckToThemeAction:", error.message);
    return { ok: false, error: "Couldn't add the deck." };
  }
  purge();
  return { ok: true };
}

export async function removeDeckFromThemeAction(themeId: string, deckId: string): Promise<DeckThemeActionResult> {
  const gate = await adminOrError();
  if ("error" in gate) return { ok: false, error: gate.error };
  if (!isUuid(themeId) || !isUuid(deckId)) return { ok: false, error: "Unknown deck." };
  const { error } = await gate.admin.from("deck_theme_decks").delete().eq("theme_id", themeId).eq("deck_id", deckId);
  if (error) return { ok: false, error: "Couldn't remove the deck." };
  purge();
  return { ok: true };
}

export async function moveDeckInThemeAction(
  themeId: string,
  deckId: string,
  direction: -1 | 1,
): Promise<DeckThemeActionResult> {
  const gate = await adminOrError();
  if ("error" in gate) return { ok: false, error: gate.error };
  if (!isUuid(themeId)) return { ok: false, error: "Unknown theme." };
  const { data, error } = await gate.admin
    .from("deck_theme_decks")
    .select("deck_id")
    .eq("theme_id", themeId)
    .order("position")
    .order("created_at")
    .order("deck_id");
  if (error || !data) return { ok: false, error: "Couldn't read the theme." };
  const ids = reorder(data.map((row) => row.deck_id), deckId, direction);
  if (!ids) return { ok: true };
  const results = await Promise.all(
    ids.map((id, position) =>
      gate.admin.from("deck_theme_decks").update({ position }).eq("theme_id", themeId).eq("deck_id", id),
    ),
  );
  if (results.some((result) => result.error)) return { ok: false, error: "Couldn't reorder the decks." };
  purge();
  return { ok: true };
}

/** `ids` with `id` swapped one place up or down; null when it can't move. */
function reorder(ids: string[], id: string, direction: -1 | 1): string[] | null {
  const from = ids.indexOf(id);
  const to = from + direction;
  if (from < 0 || to < 0 || to >= ids.length) return null;
  const next = [...ids];
  [next[from], next[to]] = [next[to], next[from]];
  return next;
}
