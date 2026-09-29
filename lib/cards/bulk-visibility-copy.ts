import type { Visibility } from "@/types/card";

// ---------------------------------------------------------------------------
// The words for a bulk visibility change in My Cards — one copy source for
// the server action (its refusal) and the bulk bar (its toast). An admin's
// frame preview (TODO 2.3, migration 0121) always stays private, so a bulk
// "make public / unlisted" skips the previews in the batch and changes the
// rest (owner, 2026-09-28); these say so plainly. Pure.
// ---------------------------------------------------------------------------

const plural = (n: number, one: string, many: string) => (n === 1 ? one : many);

const cards = (n: number) => `${n} ${plural(n, "card", "cards")}`;

/** What the batch did, e.g. "Published 5 cards. Skipped 2 frame previews —
 *  they stay private." A batch with no previews keeps the old wording. */
export function bulkVisibilityMessage(
  visibility: Visibility,
  count: number,
  skippedPreviews: number,
): string {
  if (skippedPreviews <= 0) return `${cards(count)} → ${visibility}.`;
  const done =
    visibility === "public"
      ? `Published ${cards(count)}.`
      : visibility === "unlisted"
        ? `Made ${cards(count)} unlisted.`
        : `${cards(count)} → ${visibility}.`;
  return `${done} Skipped ${skippedPreviews} frame ${plural(
    skippedPreviews,
    "preview — it stays",
    "previews — they stay",
  )} private.`;
}

/** Every selected card is a frame preview: nothing changed, and why. */
export function allFramePreviewsMessage(visibility: Visibility, previews: number): string {
  const nothing =
    visibility === "public" ? "Nothing was published" : `Nothing was made ${visibility}`;
  return previews === 1
    ? `${nothing}: the selected card is a frame preview, and frame previews stay private.`
    : `${nothing}: all ${previews} selected cards are frame previews, and frame previews stay private.`;
}
