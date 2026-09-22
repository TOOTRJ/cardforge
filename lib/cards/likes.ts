"use server";

import {
  toggleLike,
  type LikeTarget,
  type ToggleLikeResult as LikeResult,
} from "@/lib/social/like-toggle";

// Card likes — the "use server" surface over lib/social/like-toggle (the deck
// and set actions are its siblings). Paths: the card page, the owner's
// profile and the legacy slug-only redirector (so old links pick up fresh
// counts).

export type ToggleLikeResult = LikeResult;

const CARD_LIKES: LikeTarget = {
  table: "card_likes",
  column: "card_id",
  noun: "card",
  paths: (slug, ownerUsername) => [
    ...(slug && ownerUsername ? [`/card/${ownerUsername}/${slug}`] : []),
    ...(ownerUsername ? [`/profile/${ownerUsername}`] : []),
    ...(slug ? [`/card/${slug}`] : []),
  ],
};

/** Toggle the current user's like on a card; returns the fresh count for
 *  the optimistic UI to reconcile. */
export async function toggleLikeAction(
  cardId: string,
  cardSlug?: string,
  ownerUsername?: string | null,
): Promise<ToggleLikeResult> {
  return toggleLike(CARD_LIKES, cardId, cardSlug, ownerUsername);
}
