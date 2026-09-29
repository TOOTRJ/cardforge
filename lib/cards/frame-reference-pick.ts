import {
  FRAME_REFERENCES,
  findFrameReference,
  frameComboKey,
  type FrameColorKey,
  type FrameReference,
} from "@/lib/cards/frame-reference-registry";
import type { FrameTemplate } from "@/types/card";

// ---------------------------------------------------------------------------
// Which printing stands for a (template, colour) combination — the ONE rule
// the compare view, the score, the stepper walk-through (TODO 2.2) and the
// template sign-off (2.4) share: an explicit registry pick (`?ref=`), else
// the admin-pinned printing (frame_reviews.reference_*), else the registry
// default. Pure: callers pass the review rows they already read.
// ---------------------------------------------------------------------------

/** The part of a frame_reviews row this rule reads. */
export type PinnedReferenceRow = {
  referenceScryfallId: string | null;
  referenceName: string | null;
  referenceSet: string | null;
};

export function pickFrameReference(input: {
  template: FrameTemplate;
  colorKey: FrameColorKey;
  review: PinnedReferenceRow | null | undefined;
  ref?: string | null;
}): FrameReference | null {
  const chosen = findFrameReference(input.template, input.colorKey, input.ref);
  if (chosen) return chosen;
  const review = input.review;
  if (review?.referenceScryfallId && review.referenceName) {
    return {
      name: review.referenceName,
      set: review.referenceSet ?? "",
      scryfallId: review.referenceScryfallId,
    };
  }
  return FRAME_REFERENCES[input.template][input.colorKey] ?? null;
}

/** The same pick from a review map keyed "template/colour". */
export function pickFrameReferenceFrom(
  reviews: ReadonlyMap<string, PinnedReferenceRow>,
  template: FrameTemplate,
  colorKey: FrameColorKey,
  ref?: string | null,
): FrameReference | null {
  return pickFrameReference({
    template,
    colorKey,
    review: reviews.get(frameComboKey(template, colorKey)),
    ref,
  });
}
