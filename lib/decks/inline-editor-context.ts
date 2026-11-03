import "server-only";
import { isDesignAiConfigured } from "@/lib/ai/provider";
import { getDeckAiSeeds } from "@/lib/ai/generation-jobs";
import { getEntitlements, ownerExportStamp } from "@/lib/billing/entitlements";
import { getCardCapacity } from "@/lib/cards/capacity";
import { getFrameProfileOverrides } from "@/lib/cards/frame-profile-overrides";
import { getVerifiedFrameKeys } from "@/lib/cards/frame-reviews";
import { getCardById, getFantasyGameSystem } from "@/lib/cards/queries";
import { getCurrentChallenge } from "@/lib/challenges/queries";
import { getMyDeckCardWithDeck, listMyDecks } from "@/lib/decks/queries";
import { getDeckInlineEditorMode } from "@/lib/decks/inline-editor";
import {
  canUseDeckInlineEditor,
  DECK_EDIT_NEW,
  type DeckEditShared,
  type DeckEditTarget,
} from "@/lib/decks/inline-editor-shared";
import { entryEditTarget } from "@/lib/decks/return-to";
import { isModerationLocked, MODERATION_LOCKED_REMIX_MESSAGE } from "@/lib/moderation/lock";
import { getPipOverrides } from "@/lib/pips/queries";
import { createClient, getCurrentProfile } from "@/lib/supabase/server";
import type { Card } from "@/types/card";
import type { Deck, DeckRemixContext } from "@/types/deck";

// ---------------------------------------------------------------------------
// The deck's edit drawer, server side (TODO DK5.18): what the creator gets
// when it opens on an entry of the OWNER's deck — the same props /create
// and /card/…/edit hand it, decided the way DK5.5's Edit decides where it
// goes (lib/decks/return-to.ts entryEditTarget), from the database:
//
//   the owner's own card          → edit it
//   another creator's card (D3)   → a remix of it, taking the entry's place
//                                    (read through RLS, as /create?remix=)
//   no card (a printing, a gone
//   card, a placeholder)          → a new card on the entry (deckRemix)
//   "new"                          → a new card, this deck picked in its box
//
// Nothing here widens a read: the deck must be the caller's (owner_id), the
// entry that deck's, a card the caller's own to be edited; a viewer the
// switch doesn't allow gets nothing (the route's 404).
// ---------------------------------------------------------------------------

export type DeckEditRefusal = { status: 401 | 404 | 409; error: string };

/** The switch allows this signed-in viewer, and they own the deck. */
export async function ownDeckForInlineEditor(deckId: string): Promise<{ deck: Pick<Deck, "id" | "slug" | "title" | "visibility">; userId: string } | DeckEditRefusal> {
  const profile = await getCurrentProfile();
  if (!profile) return { status: 401, error: "Sign in to edit your deck." };
  const mode = await getDeckInlineEditorMode();
  if (!canUseDeckInlineEditor(mode, Boolean(profile.is_admin))) return { status: 404, error: "Not found." };
  const supabase = await createClient();
  const { data } = await supabase
    .from("decks")
    .select("id, slug, title, visibility")
    .eq("id", deckId)
    .eq("owner_id", profile.id)
    .maybeSingle();
  if (!data) return { status: 404, error: "That deck isn't yours to edit." };
  return { deck: data as Pick<Deck, "id" | "slug" | "title" | "visibility">, userId: profile.id };
}

/** The page-wide part of the creator's props (read once per page visit). */
export async function deckEditShared(userId: string): Promise<DeckEditShared | null> {
  const [gameSystem, profile, entitlements, myDecks, exportStamp, verifiedFrameKeys, profileOverrides, pipOverrides, activeChallenge, capacity] =
    await Promise.all([
      getFantasyGameSystem(),
      getCurrentProfile(),
      getEntitlements(),
      listMyDecks(),
      ownerExportStamp(userId),
      getVerifiedFrameKeys(),
      getFrameProfileOverrides(),
      getPipOverrides(userId),
      getCurrentChallenge(),
      getCardCapacity(),
    ]);
  if (!gameSystem) return null;
  const deckSeeds = await getDeckAiSeeds(myDecks.map((deck) => deck.id));
  return {
    userId,
    ownerUsername: profile?.username ?? null,
    gameSystems: [gameSystem],
    myDecks: myDecks.map((deck) => ({
      id: deck.id,
      title: deck.title,
      format: deck.format,
      slug: deck.slug,
      visibility: deck.visibility,
      theme: deckSeeds.get(deck.id)?.theme ?? null,
      style: deckSeeds.get(deck.id)?.style ?? null,
    })),
    canDesignForDeck: entitlements.effectiveTier === "pro",
    aiConfigured: isDesignAiConfigured(),
    pipOverrides,
    verifiedFrameKeys,
    profileOverrides,
    activeChallenge,
    capacity,
    defaultArtistCredit: profile?.display_name || profile?.username || "",
    isPaid: entitlements.removeWatermark,
    defaultFooterText: exportStamp.footerText,
  };
}

/** The first entry of this deck that holds `cardId` (a new card's, after
 *  its save put it in the deck). */
export async function entryIdForCard(deckId: string, cardId: string): Promise<string | null> {
  const supabase = await createClient();
  const { data } = await supabase
    .from("deck_cards")
    .select("id")
    .eq("deck_id", deckId)
    .eq("card_id", cardId)
    .order("position", { ascending: true })
    .limit(1)
    .maybeSingle();
  return (data?.id as string | undefined) ?? null;
}

/** What `?edit=<target>` opens on this deck, or why not. */
export async function deckEditTarget(
  deck: Pick<Deck, "id" | "slug" | "title" | "visibility">,
  userId: string,
  target: string,
): Promise<DeckEditTarget | DeckEditRefusal> {
  if (target === DECK_EDIT_NEW) {
    return {
      mode: "create",
      card: null,
      deckRemix: null,
      entryId: null,
      initialDeckId: deck.id,
      title: "New card",
      fullPageHref: "/create",
    };
  }
  const found = await getMyDeckCardWithDeck(target);
  if (!found || found.deck.id !== deck.id) return { status: 404, error: "That card isn't in this deck any more." };
  const { entry } = found;
  const deckRemix: DeckRemixContext = {
    deckCardId: entry.id,
    scryfallId: entry.scryfall_id,
    deckSlug: deck.slug,
    deckTitle: deck.title,
    entryName: entry.name,
    deckVisibility: deck.visibility,
  };
  // The entry's card as THIS viewer may read it (RLS) — null for a card
  // that's gone or another creator's private one: then, as DK5.5, a new
  // card of the owner's own takes the entry's place.
  const card: Card | null = entry.card_id ? await getCardById(entry.card_id) : null;
  const own = Boolean(card && card.owner_id === userId);
  const fullPageHref = entryEditTarget(
    { entry, card: card ? { id: card.id, slug: card.slug } : null, cardOwner: card && !own ? card.owner_id : null },
    deck.slug,
  ).href;
  if (card && own) {
    return { mode: "edit", card, deckRemix: null, entryId: entry.id, initialDeckId: null, title: card.title, fullPageHref };
  }
  if (card) {
    // A card moderation hid (0156) is never remixed (createCardAction too).
    if (isModerationLocked(card)) return { status: 409, error: MODERATION_LOCKED_REMIX_MESSAGE };
    return { mode: "remix", card, deckRemix, entryId: entry.id, initialDeckId: null, title: card.title, fullPageHref };
  }
  return { mode: "create", card: null, deckRemix, entryId: entry.id, initialDeckId: null, title: entry.name, fullPageHref };
}
