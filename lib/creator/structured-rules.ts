// What a planeswalker's or a saga's row editors SAVE (and so what the live
// preview draws): the structured rows + the rules text that goes with them.
//
// Those two kinds keep their text in rows; the rules textarea is hidden and
// still holds a COPY of the text the rows were read from — the stored text
// on an edit, an import's / a remix's / an AI fill's / a kind switch's on a
// new card. Two rules follow, one answer for a new card, a remix, an edit
// and the preview:
//
// - that copy may travel only while it is what the editor shows. Once every
//   row is removed it would bring them all back (the edit: #524, 2026-10-12;
//   the create flow: its follow-up) — and the preview drew the hidden copy's
//   rows on a card that saves none;
// - on an EDIT, rows the maker did not change are saved with the STORED text,
//   byte for byte — whatever it is. The rows serialize canonically
//   ("-2: …", "I, II — …"), and a stored text spelled another way —
//   Scryfall's U+2212 "−2:", "+1 :", a blank line between abilities,
//   "I,II —" — was rewritten by a save that only retitled the card; so was
//   the NULL of a card stored with its rows alone. "Did not change" = the
//   rows read as the rows the form OPENED with. (A new card has no stored
//   text: it saves the canonical one, as before.)
//
// Pure: no form, no React (tests/unit/creator/structured-rules.test.ts).

import { sagaFromRulesText, serializeLoyalty, serializeSaga } from "@/lib/cards/face-content";
import type { CardKind } from "@/lib/creator/card-kinds";
import type { FormValues } from "@/lib/creator/form-types";
import type { FaceContent, LoyaltyRowContent, SagaChapterContent } from "@/types/card";

export type StructuredRulesValues = Pick<
  FormValues,
  "rules_text" | "loyalty_abilities" | "saga_intro" | "saga_chapters"
>;

export type SubmittedRules = {
  /** The rules text the save carries, trimmed; "" = none. */
  rulesText: string;
  /** The structured rows, or null (every other kind; no row survives). */
  faceContent: FaceContent | null;
};

export type SubmittedRulesOptions = {
  /** An EDIT: the values the form OPENED with (the stored card's — its
   *  `rules_text` is the stored text). Rows that still read as these are
   *  saved with that text unchanged. Absent for a new card and a remix. */
  opened?: StructuredRulesValues | null;
  /** An EDIT: the stored card's `face_content` — what an untouched saga
   *  keeps when its rows cannot say everything its text does (below). */
  storedFaceContent?: FaceContent | null;
};

/** The rows a save carries: trimmed, textless ones dropped, the cost with
 *  the U+2212 minus (and an en dash) as ASCII and upper-cased — what the
 *  server's schema stores. */
function loyaltyRowsOf(rows: readonly { cost?: string | null; text: string }[]): LoyaltyRowContent[] {
  return rows
    .map((r) => ({
      cost: r.cost?.trim() ? r.cost.trim().replace(/[−–]/g, "-").toUpperCase() : null,
      text: r.text.trim(),
    }))
    .filter((r) => r.text.length > 0);
}

/** …and a saga's rows that hold a text, numerals ascending — numbered or
 *  not. A row with no number (a marker the editor can't read, "XI — …"; a
 *  number not picked yet) never saves as a chapter, but it IS a row its
 *  maker can edit or remove: "the rows read as they opened" is judged on
 *  these, the chapters a save carries are the numbered ones. */
function sagaTextRowsOf(rows: readonly { numerals: readonly number[]; text: string }[]): SagaChapterContent[] {
  return rows
    .map((r) => ({ numerals: [...r.numerals].sort((a, b) => a - b), text: r.text.trim() }))
    .filter((r) => r.text.length > 0);
}

const same = (a: unknown, b: unknown) => JSON.stringify(a) === JSON.stringify(b);

export function submittedRulesOf(
  kind: CardKind,
  values: StructuredRulesValues,
  options: SubmittedRulesOptions = {},
): SubmittedRules {
  const textarea = values.rules_text.trim();
  // The stored text is still the hidden textarea's (an AI fill replaces it —
  // and the rows with it).
  const opened = options.opened && options.opened.rules_text === values.rules_text ? options.opened : null;

  if (kind === "planeswalker") {
    const rows = loyaltyRowsOf(values.loyalty_abilities);
    if (rows.length > 0) {
      const untouched = opened !== null && same(rows, loyaltyRowsOf(opened.loyalty_abilities));
      return {
        rulesText: untouched ? textarea : serializeLoyalty(rows),
        faceContent: { v: 1, loyalty: { abilities: rows } },
      };
    }
    // Every row emptied or removed: the hidden textarea still holds the copy
    // of the rows, which would bring them all back. (A rules text always
    // reads as at least one row, so "no row" is never a text the editor
    // failed to show.)
    return { rulesText: "", faceContent: null };
  }

  if (kind === "saga") {
    const textRows = sagaTextRowsOf(values.saga_chapters);
    const chapters = textRows.filter((r) => r.numerals.length > 0);
    if (chapters.length > 0) {
      const intro = values.saga_intro.trim() || null;
      const untouched =
        opened !== null &&
        (opened.saga_intro.trim() || null) === intro &&
        same(textRows, sagaTextRowsOf(opened.saga_chapters));
      // Untouched, with a row the chapters cannot carry (the stored text has
      // a marker the editor can't number beside ones it can): the card stays
      // as it is stored. Writing the numbered rows alone as `face_content` —
      // which the renderers read BEFORE the text — took that chapter off
      // the card on a save that only retitled it.
      if (untouched && textRows.length !== chapters.length) {
        return { rulesText: textarea, faceContent: options.storedFaceContent ?? null };
      }
      return {
        rulesText: untouched ? textarea : serializeSaga(intro, chapters),
        faceContent: { v: 1, saga: { intro, chapters } },
      };
    }
    // A row that holds a text and no chapter number (a marker the editor
    // can't read, "XI — …"; a number not picked yet) is NOT an emptied
    // editor: the hidden text stays — and with no hidden text to keep (a
    // new saga typed here), the intro is the text rather than nothing.
    if (values.saga_chapters.some((r) => r.text.trim())) {
      return { rulesText: textarea || values.saga_intro.trim(), faceContent: null };
    }
    // No chapter row holds a text. The hidden textarea is resent only while
    // it reads as what the editor shows — a text with no chapter, all of it
    // the intro, untouched (so a stored text is never rewritten by a save
    // that didn't edit it: the editor joins its lines). Chapters the hidden
    // text still has, or an intro that was typed, edited or emptied: the
    // editor's intro IS the text ("" = none) — the hidden copy would bring
    // the chapters back and drop the intro.
    const intro = values.saga_intro.trim();
    const hidden = sagaFromRulesText(values.rules_text);
    if (hidden.chapters.length > 0 || (hidden.intro ?? "") !== intro) return { rulesText: intro, faceContent: null };
    return { rulesText: textarea, faceContent: null };
  }

  return { rulesText: textarea, faceContent: null };
}
