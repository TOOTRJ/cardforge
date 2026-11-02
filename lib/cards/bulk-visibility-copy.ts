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

/** The cards a publish / unlist left as they were because their text holds
 *  strong language (owner policy 2026-10-28, lib/moderation/profanity.ts),
 *  as a sentence the toast adds — "" when there were none. */
export function strongLanguageSkippedLine(skipped: number | undefined): string {
  if (!skipped || skipped <= 0) return "";
  return skipped === 1
    ? "1 card stayed as it was: its text includes strong language. Remove it to publish."
    : `${skipped} cards stayed as they were: their text includes strong language. Remove it to publish.`;
}

/** Every selected card is held back — by its text, or as a frame preview. */
export function allStrongLanguageMessage(visibility: Visibility, strongLanguage: number, previews: number): string {
  const nothing =
    visibility === "public" ? "Nothing was published" : `Nothing was made ${visibility}`;
  const text =
    strongLanguage === 1 && previews === 0
      ? "the selected card's text includes strong language"
      : `${cards(strongLanguage)} ${plural(strongLanguage, "has", "have")} strong language in ${plural(strongLanguage, "its", "their")} text`;
  const rest = previews > 0 ? `, and ${previews} ${plural(previews, "is a frame preview", "are frame previews")}` : "";
  return `${nothing}: ${text}${rest}. Remove the strong language to publish.`;
}

/** The cards a PUBLISH left as they were because they have no artwork (or
 *  a double-faced card's back has none) — the single-card rule, no artwork →
 *  no gallery — as a sentence the toast adds; "" when there were none. */
export function artlessSkippedLine(skipped: number | undefined): string {
  if (!skipped || skipped <= 0) return "";
  return skipped === 1
    ? "1 card stayed as it was: it has no artwork yet. Add artwork before publishing."
    : `${skipped} cards stayed as they were: they have no artwork yet. Add artwork before publishing.`;
}

/** Every selected card is held back — by the moderation lock (migration
 *  0156, lib/moderation/lock.ts), its missing artwork, its text, or as a
 *  frame preview — and at least one of them by the lock or the artwork:
 *  nothing changed, and every reason in ONE sentence. "Add artwork before
 *  publishing." only when a card has none. */
export function allHeldBackMessage(
  visibility: Visibility,
  held: { moderation?: number; strongLanguage: number; previews: number; artless?: number },
): string {
  const moderation = held.moderation ?? 0;
  const artless = held.artless ?? 0;
  const nothing =
    visibility === "public" ? "Nothing was published" : `Nothing was made ${visibility}`;
  const alone = (n: number) => n === 1 && moderation + artless + held.strongLanguage + held.previews === 1;
  const reasons = [
    moderation > 0
      ? alone(moderation)
        ? "the selected card was hidden by moderation and stays private until our team reviews it"
        : `${cards(moderation)} ${plural(moderation, "was", "were")} hidden by moderation`
      : "",
    artless > 0
      ? alone(artless)
        ? "the selected card has no artwork yet"
        : `${cards(artless)} ${plural(artless, "has", "have")} no artwork yet`
      : "",
    held.strongLanguage > 0
      ? `${cards(held.strongLanguage)} ${plural(held.strongLanguage, "has", "have")} strong language in ${plural(held.strongLanguage, "its", "their")} text`
      : "",
    held.previews > 0 ? `${held.previews} ${plural(held.previews, "is a frame preview", "are frame previews")}` : "",
  ].filter(Boolean);
  const list = reasons.length > 1 ? `${reasons.slice(0, -1).join(", ")} and ${reasons[reasons.length - 1]}` : reasons[0];
  return `${nothing}: ${list}.${artless > 0 ? " Add artwork before publishing." : ""}`;
}
