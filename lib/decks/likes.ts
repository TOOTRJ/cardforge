"use server";

import {
  toggleLike,
  type LikeTarget,
  type ToggleLikeResult,
} from "@/lib/social/like-toggle";

// Deck likes — see lib/social/like-toggle. Paths: the deck page and the
// owner's profile. (decks.likes_count is trigger-synced for listings; the
// /decks index catches up through ISR, like the gallery does for cards.)

export type ToggleDeckLikeResult = ToggleLikeResult;

const DECK_LIKES: LikeTarget = {
  table: "deck_likes",
  column: "deck_id",
  noun: "deck",
  paths: (slug, ownerUsername) => [
    ...(slug ? [`/deck/${slug}`] : []),
    ...(ownerUsername ? [`/profile/${ownerUsername}`] : []),
  ],
};

export async function toggleDeckLikeAction(
  deckId: string,
  deckSlug?: string,
  ownerUsername?: string | null,
): Promise<ToggleDeckLikeResult> {
  return toggleLike(DECK_LIKES, deckId, deckSlug, ownerUsername);
}
