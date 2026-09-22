"use server";

import {
  toggleLike,
  type LikeTarget,
  type ToggleLikeResult,
} from "@/lib/social/like-toggle";

// Set likes — see lib/social/like-toggle. Paths: the set page and the
// owner's profile.

export type ToggleSetLikeResult = ToggleLikeResult;

const SET_LIKES: LikeTarget = {
  table: "set_likes",
  column: "set_id",
  noun: "set",
  paths: (slug, ownerUsername) => [
    ...(slug ? [`/set/${slug}`] : []),
    ...(ownerUsername ? [`/profile/${ownerUsername}`] : []),
  ],
};

export async function toggleSetLikeAction(
  setId: string,
  setSlug?: string,
  ownerUsername?: string | null,
): Promise<ToggleSetLikeResult> {
  return toggleLike(SET_LIKES, setId, setSlug, ownerUsername);
}
