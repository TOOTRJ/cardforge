// ---------------------------------------------------------------------------
// What a card still needs before it can be saved (TODO 5.14, quick fix 2).
//
// ONE rule, read twice: the creator's Save button is disabled while this
// list is non-empty, and the line above the button shows the SAME list —
// each item a link to its field. The rule itself is unchanged from the
// sentence the form used to build inline:
//   * every card needs a title;
//   * anything other people can see (not a draft) needs artwork — and a
//     double-faced card its back face's artwork too (TODO 5.2, D13);
//   * a second part (back face, half, adventure spell) needs a name unless
//     the card is a private draft (lib/cards/second-face-name.ts).
// Pure: no React, no form state.
// ---------------------------------------------------------------------------

import { missingSecondFaceName } from "@/lib/cards/second-face-name";
import type { SecondPartWords } from "@/lib/creator/second-part";
import type { Visibility } from "@/types/card";

/** The form field an item lives in — where its link puts the cursor. */
export type SaveNeedField = "title" | "art_url" | "back_face.art_url" | "back_face.title";

export type SaveNeed = {
  id: "title" | "art" | "second-art" | "second-name";
  /** The item inside the sentence: "a title", "the right half's name". */
  label: string;
  field: SaveNeedField;
};

/** "a, b and c". */
export function listPhrase(parts: readonly string[]): string {
  return parts.length <= 1
    ? parts.join("")
    : `${parts.slice(0, -1).join(", ")} and ${parts[parts.length - 1]}`;
}

export function saveNeedsOf(input: {
  title: string;
  artUrl: string;
  hasBackFace: boolean;
  backFace: { title?: string | null; art_url?: string | null };
  /** A private draft, or an admin's frame preview (saved private). */
  savesAsDraft: boolean;
  visibility: Visibility | string;
  /** The card is on a double-faced front body (its back has its own art). */
  doubleFaced: boolean;
  /** The words for this card's second part (lib/creator/second-part.ts). */
  words: SecondPartWords;
}): SaveNeed[] {
  const needs: SaveNeed[] = [];
  if (!input.title.trim()) needs.push({ id: "title", label: "a title", field: "title" });
  if (!input.savesAsDraft && !input.artUrl.trim()) {
    needs.push({ id: "art", label: "artwork", field: "art_url" });
  }
  if (!input.savesAsDraft && input.doubleFaced && !(input.backFace.art_url ?? "").trim()) {
    needs.push({ id: "second-art", label: `${input.words.phrase}'s artwork`, field: "back_face.art_url" });
  }
  if (
    input.hasBackFace &&
    missingSecondFaceName(input.backFace, input.savesAsDraft ? "private" : input.visibility)
  ) {
    needs.push({ id: "second-name", label: `${input.words.phrase}'s name`, field: "back_face.title" });
  }
  return needs;
}

/** The whole sentence — the Save button's hover text, and what the linked
 *  line reads as. */
export function saveNeedsSentence(needs: readonly SaveNeed[]): string | null {
  return needs.length > 0 ? `Add ${listPhrase(needs.map((need) => need.label))} to enable Save.` : null;
}
