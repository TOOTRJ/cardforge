"use server";

import { revalidatePath } from "next/cache";
import { z } from "zod";
import { createClient, getCurrentUser } from "@/lib/supabase/server";
import { isSupabaseConfigured } from "@/lib/supabase/env";
import { DECK_BOARD_VALUES } from "@/types/deck";
import { isUuid } from "@/lib/ids";
import { revalidateProfilePage } from "@/lib/profile/username";
import { bringsCard, canLinkIntoDeck } from "@/lib/decks/entry-status";
import { FEATURED_PICKS_MAX } from "@/lib/decks/featured";
import { createAdminClient, isAdminConfigured } from "@/lib/supabase/admin";
import { recordFunnelEvent } from "@/lib/analytics/funnel-server";

// ---------------------------------------------------------------------------
// Deck entry actions — the deck-card modal's mutations: quantity/board
// edits, remove, and linking/unlinking a PipGlyph card. Same
// discriminated-union posture as lib/decks/actions.ts.
// ---------------------------------------------------------------------------

export type DeckCardActionResult =
  | { ok: true; deckCardId: string }
  | { ok: false; error: string };

type OwnedEntry = {
  id: string;
  deck_id: string;
  /** The linked card before this action — null for an entry with none yet
   *  (the funnel's deck_card_customized counts the first). */
  card_id: string | null;
  scryfall_id?: string | null;
  /** Absent on a database 0144 has not reached. */
  source?: string | null;
};

/** Load an entry + prove the caller owns its deck. Returns the deck slug
 *  for revalidation. (`*`: the row reads the same whether or not the
 *  database has 0144's `source` yet.) */
async function getOwnedEntry(
  supabase: Awaited<ReturnType<typeof createClient>>,
  userId: string,
  deckCardId: string,
): Promise<
  | { ok: true; entry: OwnedEntry; deckSlug: string }
  | { ok: false; error: string }
> {
  const { data: entry } = (await supabase
    .from("deck_cards")
    .select("*")
    .eq("id", deckCardId)
    .maybeSingle()) as { data: OwnedEntry | null };
  if (!entry) return { ok: false, error: "Deck entry not found." };

  const { data: deck } = await supabase
    .from("decks")
    .select("id, slug, owner_id")
    .eq("id", entry.deck_id)
    .maybeSingle();
  if (!deck || deck.owner_id !== userId) {
    return { ok: false, error: "Deck not found or not yours." };
  }
  return { ok: true, entry, deckSlug: deck.slug };
}

async function revalidateDeckCardPaths(
  supabase: Awaited<ReturnType<typeof createClient>>,
  userId: string,
  deckSlug: string,
) {
  revalidatePath(`/deck/${deckSlug}`);
  revalidatePath(`/deck/${deckSlug}/edit`);
  revalidatePath("/dashboard/decks");
  revalidatePath("/decks");
  // The profile's "Decks by X" tiles show card counts + "made on PipGlyph" — entry
  // mutations change those numbers too.
  await revalidateProfilePage(supabase, userId);
}

const updateDeckCardSchema = z
  .object({
    quantity: z.number().int().min(1).max(250).optional(),
    board: z.enum(DECK_BOARD_VALUES).optional(),
  })
  .refine((patch) => Object.keys(patch).length > 0, {
    message: "No changes provided.",
  });

export async function updateDeckCardAction(
  deckCardId: string,
  payload: unknown,
): Promise<DeckCardActionResult> {
  if (!isUuid(deckCardId)) {
    return { ok: false, error: "Invalid deck entry id." };
  }
  const parsed = updateDeckCardSchema.safeParse(payload);
  if (!parsed.success) {
    return {
      ok: false,
      error: parsed.error.issues[0]?.message ?? "Invalid change.",
    };
  }
  if (!isSupabaseConfigured()) {
    return { ok: false, error: "Supabase isn't configured." };
  }
  const user = await getCurrentUser();
  if (!user) return { ok: false, error: "Sign in to edit decks." };

  const supabase = await createClient();
  const owned = await getOwnedEntry(supabase, user.id, deckCardId);
  if (!owned.ok) return owned;

  const { error } = await supabase
    .from("deck_cards")
    .update(parsed.data)
    .eq("id", deckCardId);
  if (error) return { ok: false, error: error.message };

  await revalidateDeckCardPaths(supabase, user.id, owned.deckSlug);
  return { ok: true, deckCardId };
}

export async function removeDeckCardAction(
  deckCardId: string,
): Promise<DeckCardActionResult> {
  if (!isUuid(deckCardId)) {
    return { ok: false, error: "Invalid deck entry id." };
  }
  if (!isSupabaseConfigured()) {
    return { ok: false, error: "Supabase isn't configured." };
  }
  const user = await getCurrentUser();
  if (!user) return { ok: false, error: "Sign in to edit decks." };

  const supabase = await createClient();
  const owned = await getOwnedEntry(supabase, user.id, deckCardId);
  if (!owned.ok) return owned;

  const { error } = await supabase
    .from("deck_cards")
    .delete()
    .eq("id", deckCardId);
  if (error) return { ok: false, error: error.message };

  await revalidateDeckCardPaths(supabase, user.id, owned.deckSlug);
  return { ok: true, deckCardId };
}

/** Link a PipGlyph card as this entry's card: one of the caller's own at any
 *  visibility, or another creator's PUBLIC card (owner decision D3, TODO
 *  DK2.9). The database enforces the same rule (migration 0144's
 *  deck_cards_guard_card_link: a NEW card_id is checked, so an entry whose
 *  linked card later went private stays editable); the pre-flight gives a
 *  friendlier error. The entry keeps its source — it still came from where
 *  it came from. `surface` says who linked it — the creator's
 *  /create?deckCard= save (the card was just made from the entry, the only
 *  link the funnel counts) or the deck page's picker (the default) — for
 *  the funnel only. */
export async function linkDeckCardAction(
  deckCardId: string,
  cardId: string,
  options: { surface?: "creator" | "deck" } = {},
): Promise<DeckCardActionResult> {
  if (!isUuid(deckCardId) || !isUuid(cardId)) {
    return { ok: false, error: "Invalid id." };
  }
  if (!isSupabaseConfigured()) {
    return { ok: false, error: "Supabase isn't configured." };
  }
  const user = await getCurrentUser();
  if (!user) return { ok: false, error: "Sign in to edit decks." };

  const supabase = await createClient();
  const owned = await getOwnedEntry(supabase, user.id, deckCardId);
  if (!owned.ok) return owned;

  const { data: card } = await supabase
    .from("cards")
    .select("id, owner_id, visibility")
    .eq("id", cardId)
    .maybeSingle();
  if (!card || !canLinkIntoDeck(card, user.id)) {
    return {
      ok: false,
      error: "You can link your own cards, or another creator's public card.",
    };
  }

  const { error } = await supabase
    .from("deck_cards")
    .update({ card_id: cardId })
    .eq("id", deckCardId);
  if (error) return { ok: false, error: error.message };

  // Funnel (TODO DK3.8): the entry got its FIRST card of the user's, MADE
  // from it in the creator — an imported card customized (owner decision
  // D2: the moment it takes a saved-card slot) or a placeholder filled. A
  // card linked from the deck page already existed (no new slot), and a
  // re-link is not counted.
  if (options.surface === "creator" && owned.entry.card_id === null && isAdminConfigured()) {
    await recordFunnelEvent(createAdminClient(), {
      event: "deck_card_customized",
      userId: user.id,
      props: {
        surface: "creator",
        kind: owned.entry.scryfall_id ? "import" : "placeholder",
      },
    });
  }

  await revalidateDeckCardPaths(supabase, user.id, owned.deckSlug);
  return { ok: true, deckCardId };
}

export async function unlinkDeckCardAction(
  deckCardId: string,
): Promise<DeckCardActionResult> {
  if (!isUuid(deckCardId)) {
    return { ok: false, error: "Invalid deck entry id." };
  }
  if (!isSupabaseConfigured()) {
    return { ok: false, error: "Supabase isn't configured." };
  }
  const user = await getCurrentUser();
  if (!user) return { ok: false, error: "Sign in to edit decks." };

  const supabase = await createClient();
  const owned = await getOwnedEntry(supabase, user.id, deckCardId);
  if (!owned.ok) return owned;

  // An entry the card itself brought (the creator's add, a link, the AI)
  // with no printing is a plain name once its card is unlinked: its source
  // goes too, so it never reads "No longer available" — that is a card the
  // OWNER didn't take away (lib/decks/entry-status.ts deckEntryUnavailable).
  // An import keeps its source: it is the real card again.
  const clearsSource = !owned.entry.scryfall_id && bringsCard(owned.entry.source);
  const { error } = await supabase
    .from("deck_cards")
    .update(clearsSource ? { card_id: null, source: null } : { card_id: null })
    .eq("id", deckCardId);
  if (error) return { ok: false, error: error.message };

  await revalidateDeckCardPaths(supabase, user.id, owned.deckSlug);
  return { ok: true, deckCardId };
}

// ---------------------------------------------------------------------------
// The cover's picks (TODO DK6.4) — the deck card modal's "Feature on cover",
// "Remove from cover" and its Earlier / Later buttons all send the deck's
// WHOLE list of picks, rank 1 first, and the database replaces them in one
// transaction (migration 0150's set_deck_featured_entries: the deck's
// entry lock, its owner only, five distinct entries of that deck at most).
// ---------------------------------------------------------------------------

export type DeckCoverPicksResult = { ok: true; picks: number } | { ok: false; error: string };

const coverPicksSchema = z
  .array(z.string().refine(isUuid, "Invalid deck entry id."))
  .max(FEATURED_PICKS_MAX, `A cover features at most ${FEATURED_PICKS_MAX} cards.`)
  .refine((ids) => new Set(ids).size === ids.length, "A card is picked twice.");

/** The words for what the database refuses (never its own text). */
function coverPicksError(error: { code?: string | null; message?: string | null }): string {
  const message = error.message ?? "";
  if (error.code === "PGRST202") return "Cover picks aren't available here yet.";
  if (message.includes("deck_featured_limit")) return `A cover features at most ${FEATURED_PICKS_MAX} cards.`;
  if (message.includes("deck_not_owned")) return "Deck not found or not yours.";
  if (message.includes("deck_featured_invalid")) return "That card isn't in this deck any more — reload the page.";
  return "The cover's cards couldn't be saved. Try again.";
}

export async function setDeckCoverPicksAction(
  deckId: string,
  entryIds: unknown,
): Promise<DeckCoverPicksResult> {
  if (!isUuid(deckId)) return { ok: false, error: "Invalid deck id." };
  const parsed = coverPicksSchema.safeParse(entryIds);
  if (!parsed.success) {
    return { ok: false, error: parsed.error.issues[0]?.message ?? "Invalid cover picks." };
  }
  if (!isSupabaseConfigured()) {
    return { ok: false, error: "Supabase isn't configured." };
  }
  const user = await getCurrentUser();
  if (!user) return { ok: false, error: "Sign in to edit decks." };

  const supabase = await createClient();
  // Ownership pre-flight for the slug and a friendly refusal (the RPC and
  // RLS hold the same line).
  const { data: deck } = await supabase.from("decks").select("id, slug, owner_id").eq("id", deckId).maybeSingle();
  if (!deck || deck.owner_id !== user.id) return { ok: false, error: "Deck not found or not yours." };

  const { data, error } = await supabase.rpc("set_deck_featured_entries", {
    p_deck_id: deckId,
    p_entry_ids: parsed.data,
  });
  if (error) return { ok: false, error: coverPicksError(error) };

  await revalidateDeckCardPaths(supabase, user.id, deck.slug);
  return { ok: true, picks: typeof data === "number" ? data : parsed.data.length };
}

// ---------------------------------------------------------------------------
// Link picker data — a lite listing of the caller's cards, lazily fetched
// by the deck-card modal's "Link an existing card" panel.
// ---------------------------------------------------------------------------

export type MyCardLite = {
  id: string;
  title: string;
  slug: string;
  /** The HD bake — read only to vouch for the thumb beside it (and drawn
   *  resized by next/image for a bake older than thumbnails). */
  rendered_image_url: string | null;
  /** The 600 px WebP the picker's tiles draw (never the ~3 MB PNG). */
  rendered_thumb_url: string | null;
};

export type ListMyCardsLiteResult =
  | { ok: true; cards: MyCardLite[] }
  | { ok: false; error: string };

export async function listMyCardsLiteAction(): Promise<ListMyCardsLiteResult> {
  if (!isSupabaseConfigured()) {
    return { ok: false, error: "Supabase isn't configured." };
  }
  const user = await getCurrentUser();
  if (!user) return { ok: false, error: "Sign in first." };

  const supabase = await createClient();
  const { data, error } = await supabase
    .from("cards")
    .select("id, title, slug, rendered_image_url, rendered_thumb_url")
    .eq("owner_id", user.id)
    .order("updated_at", { ascending: false })
    .limit(200);
  if (error) return { ok: false, error: error.message };
  return { ok: true, cards: data ?? [] };
}
