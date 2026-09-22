"use server";

import { revalidatePath } from "next/cache";
import { createClient, getCurrentUser, getCurrentUsername } from "@/lib/supabase/server";
import { isSupabaseConfigured } from "@/lib/supabase/env";
import { bakeAndPersistCardRender } from "@/lib/cards/bake-render";
import { listMyCards } from "@/lib/cards/queries";
import { cardToPreviewData } from "@/lib/cards/preview-data";
import { getFrameProfileOverrides } from "@/lib/cards/frame-profile-overrides";
import type { CardPreviewData } from "@/components/cards/card-preview";
import { CARD_LAYOUT_VERSION, hasNewerLook, isRenderStale, templateOfFrameStyle } from "@/lib/cards/layout-version";

// ---------------------------------------------------------------------------
// Owner-driven render updates.
//
// A renderer or frame change bumps CARD_LAYOUT_VERSION; until now the only
// way stored gallery PNGs caught up was the admin sweep (scripts/rebake-
// renders.mjs), which re-renders every stale card in one go. These actions
// let the OWNER do it card by card from the dashboard badge / edit-page
// notice ("Update card") or all at once ("Update all") — the CPU is spread
// across users and time instead of one sweep, and a user who prefers the old
// look simply doesn't click.
//
// Both actions run under the caller's RLS session: the card query only sees
// their own rows, and bakeAndPersistCardRender re-checks ownership.
// ---------------------------------------------------------------------------

export type RebakeOwnCardResult =
  | { ok: true; renderedImageUrl: string | null }
  | { ok: false; error: string };

const STALE_OR = `rendered_image_url.is.null,layout_version.is.null,layout_version.lt.${CARD_LAYOUT_VERSION}`;

type StaleRow = {
  id: string;
  slug: string;
  owner_id: string;
  visibility: string;
  layout_version: number | null;
  rendered_image_url: string | null;
  frame_style: unknown;
  rarity: string | null;
  set_icon_url: string | null;
  set_icon_code: string | null;
};

function revalidateForCard(slug: string, ownerUsername: string | null) {
  revalidatePath("/dashboard");
  revalidatePath("/dashboard/cards");
  revalidatePath(`/card/${slug}/edit`);
  revalidatePath("/gallery");
  if (ownerUsername) {
    revalidatePath(`/profile/${ownerUsername}`);
    revalidatePath(`/card/${ownerUsername}/${slug}`);
  }
}

/** Re-bake ONE of the caller's cards with the current renderer. */
export async function rebakeOwnCardAction(cardId: string): Promise<RebakeOwnCardResult> {
  if (!isSupabaseConfigured()) return { ok: false, error: "Supabase isn't configured." };
  const user = await getCurrentUser();
  if (!user) return { ok: false, error: "Sign in to update your cards." };

  const supabase = await createClient();
  const { data: card } = await supabase
    .from("cards")
    .select("id, slug, owner_id, visibility")
    .eq("id", cardId)
    .maybeSingle();
  if (!card || card.owner_id !== user.id) {
    return { ok: false, error: "Card not found." };
  }
  if (card.visibility === "private") {
    // Private cards never carry a stored render (the save path deletes it);
    // there is nothing to update until the card is published.
    return { ok: false, error: "Private cards render live — nothing to update." };
  }

  const url = await bakeAndPersistCardRender(card.id, user.id);
  if (url === null) {
    return { ok: false, error: "The render didn't complete — try again in a moment." };
  }
  revalidateForCard(card.slug, await getCurrentUsername());
  return { ok: true, renderedImageUrl: url };
}

export type StaleOwnCard = {
  id: string;
  title: string;
  slug: string;
  renderedImageUrl: string | null;
  previewData: CardPreviewData;
};

export type ListStaleOwnCardsResult =
  | { ok: true; cards: StaleOwnCard[] }
  | { ok: false; error: string };

/** Cap so the walkthrough stays a dialog, not a data dump. */
const WIZARD_LIMIT = 200;

/**
 * The caller's published cards whose stored image is stale for their frame,
 * with everything the compare view needs — for the dashboard walkthrough.
 */
export async function listStaleOwnCardsAction(): Promise<ListStaleOwnCardsResult> {
  if (!isSupabaseConfigured()) return { ok: false, error: "Supabase isn't configured." };
  const user = await getCurrentUser();
  if (!user) return { ok: false, error: "Sign in to update your cards." };
  const [cards, profileOverrides] = await Promise.all([
    listMyCards(),
    getFrameProfileOverrides(),
  ]);
  const stale = cards
    .filter((c) => hasNewerLook(c))
    .slice(0, WIZARD_LIMIT)
    .map((c) => ({
      id: c.id,
      title: c.title,
      slug: c.slug,
      renderedImageUrl: c.rendered_image_url,
      previewData: cardToPreviewData(c, profileOverrides),
    }));
  return { ok: true, cards: stale };
}

export type RebakeNextStaleResult =
  | {
      ok: true;
      /** Stale cards left AFTER this step (0 = done). */
      remaining: number;
      /** The card this step re-baked, when it baked one. */
      updated: { id: string; slug: string } | null;
    }
  | { ok: false; error: string };

/**
 * "Update all", one card per call so each request stays a couple of seconds:
 * the client loops until `remaining` is 0. Cards whose template was not
 * touched by any bump since their bake are fast-forwarded (stamped current
 * without a render — the stored PNG is already what the renderer would
 * produce); everything else is re-baked oldest-first.
 */
export async function rebakeNextStaleOwnCardAction(): Promise<RebakeNextStaleResult> {
  if (!isSupabaseConfigured()) return { ok: false, error: "Supabase isn't configured." };
  const user = await getCurrentUser();
  if (!user) return { ok: false, error: "Sign in to update your cards." };

  const supabase = await createClient();
  const candidates = () =>
    supabase
      .from("cards")
      .select("id, slug, owner_id, visibility, layout_version, rendered_image_url, frame_style, rarity, set_icon_url, set_icon_code")
      .eq("owner_id", user.id)
      .in("visibility", ["public", "unlisted"])
      .or(STALE_OR)
      .order("updated_at", { ascending: true });

  const { data: rows, error } = await candidates().limit(25);
  if (error) return { ok: false, error: "Couldn't list your cards." };

  let updated: { id: string; slug: string } | null = null;
  for (const row of (rows ?? []) as StaleRow[]) {
    const template = templateOfFrameStyle(row.frame_style);
    if (
      row.rendered_image_url &&
      !isRenderStale(row.layout_version, template, undefined, undefined, row)
    ) {
      // Untouched template: the stored render already matches — stamp it.
      await supabase
        .from("cards")
        .update({ layout_version: CARD_LAYOUT_VERSION })
        .eq("id", row.id);
      continue;
    }
    const url = await bakeAndPersistCardRender(row.id, user.id);
    if (url === null) {
      return { ok: false, error: "A render didn't complete — try again in a moment." };
    }
    updated = { id: row.id, slug: row.slug };
    break;
  }

  const { count } = await supabase
    .from("cards")
    .select("id", { count: "exact", head: true })
    .eq("owner_id", user.id)
    .in("visibility", ["public", "unlisted"])
    .or(STALE_OR);
  const remaining = count ?? 0;

  if (updated || remaining === 0) {
    revalidateForCard(updated?.slug ?? "", await getCurrentUsername());
  }
  return { ok: true, remaining, updated };
}
