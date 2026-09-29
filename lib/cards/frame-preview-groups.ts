import { normalizeFrameTemplate } from "@/lib/cards/card-display";
import { pickFrameColorKey } from "@/components/cards/frame-layer";
import type { FrameColorKey } from "@/lib/cards/frame-reference-registry";
import { PREVIEW_FRAMES_PARAM } from "@/lib/creator/frame-preview";
import { isColorIdentity, type FrameTemplate } from "@/types/card";

// ---------------------------------------------------------------------------
// Walked preview cards (TODO 2.3) as the checklist and the sign-off show
// them: keyed by the frame and colour they were saved on — resolved the way
// the renderers and the verification gate resolve them (a legacy template
// value → its frame, an identity → its frame colour). Pure.
// ---------------------------------------------------------------------------

export type FramePreviewCard = {
  id: string;
  slug: string;
  title: string;
  createdAt: string;
  template: FrameTemplate;
  colorKey: FrameColorKey;
  /** The editor only opens your own cards (/card/<slug>/edit is RLS-bound);
   *  another admin's preview can still be deleted from the list. */
  ownedByViewer: boolean;
};

export type FramePreviewRowInput = {
  id: string;
  slug: string;
  title: string;
  ownerId: string;
  createdAt: string;
  template: string | null | undefined;
  colorIdentity: readonly string[] | null | undefined;
};

export function toFramePreviewCard(
  row: FramePreviewRowInput,
  viewerId: string | null,
): FramePreviewCard {
  return {
    id: row.id,
    slug: row.slug,
    title: row.title,
    createdAt: row.createdAt,
    template: normalizeFrameTemplate(row.template),
    colorKey: pickFrameColorKey((row.colorIdentity ?? []).filter(isColorIdentity)) as FrameColorKey,
    ownedByViewer: viewerId !== null && row.ownerId === viewerId,
  };
}

/** Previews per template, newest first within each (input order kept). */
export function groupFramePreviewsByTemplate<T extends FramePreviewCard>(
  cards: readonly T[],
): Map<FrameTemplate, T[]> {
  const byTemplate = new Map<FrameTemplate, T[]>();
  for (const card of cards) {
    byTemplate.set(card.template, [...(byTemplate.get(card.template) ?? []), card]);
  }
  return byTemplate;
}

/** "Re-verify": the saved preview reopened in the stepper, in preview mode
 *  for its frame, so it renders on today's frame and can be re-walked. */
export function framePreviewEditHref(card: Pick<FramePreviewCard, "slug" | "template">): string {
  const params = new URLSearchParams({ [PREVIEW_FRAMES_PARAM]: card.template });
  return `/card/${card.slug}/edit?${params.toString()}`;
}
