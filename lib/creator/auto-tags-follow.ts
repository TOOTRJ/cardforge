// ---------------------------------------------------------------------------
// A NEW card's Tags field follows its words (owner 2026-10-30): while the
// maker has not touched the field, it holds the tags it started with (blank,
// or a challenge's tag from /create?tag=…) followed by what the card's rules
// text and subtypes — every face's — suggest (lib/cards/auto-tags.ts). The first change
// to the field the follow did not write — the maker typing, a challenge
// toggle, an AI fill that writes tags — ends it for that card, as every
// creator follow ends at a pick (followTokenTextBox, the pair follow); Start
// over starts it again. Never on an edit or a remix (a stored card's tags,
// and a remix's parent's, are a maker's choice): an edit never rewrites a
// stored card's tags; nor on a deck-card proxy. The hook is
// components/creator/use-auto-tags.ts; these are its pure parts.
// ---------------------------------------------------------------------------

import { autoTagsFor, type AutoTagInput } from "@/lib/cards/auto-tags";
import { parseTags } from "@/lib/creator/card-fields";

/** The most tags a card holds (cardTagsSchema, migration 0034). */
const CARD_TAG_MAX = 12;

/** The Tags field the follow writes: the tags the field started with, then
 *  the suggestions, each once, at most twelve — typed as the field types
 *  them ("dragons, flying"). */
export function followedTagsText(baseTags: readonly string[], input: AutoTagInput): string {
  const out: string[] = [];
  for (const tag of [...baseTags, ...autoTagsFor(input)]) {
    if (!out.includes(tag)) out.push(tag);
  }
  return out.slice(0, CARD_TAG_MAX).join(", ");
}

export type AutoTagsFollow = {
  /** False once the field changed under something other than the follow. */
  following: boolean;
  /** What the field held when the follow last saw it or wrote it; null =
   *  not read yet (the next value is the start). */
  seen: string | null;
  /** The tags the field started with — kept in front of the suggestions. */
  base: string[];
};

export const NEW_AUTO_TAGS_FOLLOW: AutoTagsFollow = Object.freeze({ following: true, seen: null, base: [] }) as AutoTagsFollow;

/**
 * One step of the follow for the field's current value: the next state, and
 * the text to write (null = leave the field alone).
 */
export function stepAutoTagsFollow(
  state: AutoTagsFollow,
  tagsText: string,
  input: AutoTagInput,
): { state: AutoTagsFollow; write: string | null } {
  if (!state.following) return { state, write: null };
  const start = state.seen === null;
  if (!start && tagsText !== state.seen) return { state: { ...state, following: false, seen: tagsText }, write: null };
  const base = start ? parseTags(tagsText) : state.base;
  const next = followedTagsText(base, input);
  if (next === tagsText || (next === "" && tagsText.trim() === "")) return { state: { following: true, seen: tagsText, base }, write: null };
  return { state: { following: true, seen: next, base }, write: next };
}
