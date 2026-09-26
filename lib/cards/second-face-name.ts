// When does a card's SECOND FACE need a name? The second face is the
// Adventure spell, the split / aftermath / flip half (the inline frames
// always paint it), or a legacy double-faced back.
//
// TODO 3b.5 [decide], implemented as the recommendation: a private DRAFT may
// be saved without the second face's name — an Adventure or split card is
// half-built for a while, and demanding a name blocked every draft save —
// while anything other people can see (public or unlisted) needs it.
//
// DRAFTS_MAY_OMIT_SECOND_FACE_NAME is the ONE switch. Flip it to false and
// the name is required on every save again, everywhere at once: the
// creator's form schema, its Save hint and helper copy, and the server's
// create / update / bulk-publish gates all read the functions below. (The
// bulk action never gates "make private": hiding a card needs no name.)
// A flip also means rewriting the tests that encode the recommendation:
//   tests/unit/cards/second-face-name-gate.test.ts — "drafts may omit the
//     name; anything visible needs it", "lets a private draft through with
//     it unnamed", "lets the draft be edited, and published once the patch
//     names it";
//   tests/unit/components/creator-form-reliability.test.tsx — "publishing a
//     split card lists the missing name; a draft saves without it", "a split
//     card saves its untouched second half as an instant";
//   tests/unit/creator/form-schema.test.ts — "3b.5: a draft may leave the
//     second face unnamed".
//
// Shared by client and server; no imports beyond types.

import type { Visibility } from "@/types/card";

export const DRAFTS_MAY_OMIT_SECOND_FACE_NAME = true;

/** True when a card saved at this visibility needs its second face named. */
export function secondFaceNameRequired(visibility: Visibility | string): boolean {
  return !DRAFTS_MAY_OMIT_SECOND_FACE_NAME || visibility !== "private";
}

/** True when a card with this second face, stored at this visibility, would
 *  be missing the name the policy asks for. No second face = nothing to
 *  name. */
export function missingSecondFaceName(
  backFace: { title?: string | null } | null | undefined,
  visibility: Visibility | string,
): boolean {
  if (!backFace) return false;
  return !backFace.title?.trim() && secondFaceNameRequired(visibility);
}

/** The field error for a save the policy refuses. */
export const SECOND_FACE_NAME_ERROR = DRAFTS_MAY_OMIT_SECOND_FACE_NAME
  ? "Name the second face to publish it — a private draft can be saved without one."
  : "The second face needs a name.";

/** Helper copy under the second face's name field. */
export const SECOND_FACE_NAME_HINT = DRAFTS_MAY_OMIT_SECOND_FACE_NAME
  ? "Needed to publish; a draft can be saved without it."
  : "Required.";
