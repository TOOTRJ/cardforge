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
//
// And the rows are written as `face_content` — which the renderers read
// BEFORE the text — only where they are something the server stores AND say
// what the card draws (the #528 follow-up, 2026-10-13):
//
// - `face_content` holds at most 6 rows, chapters I–VI, costs of three
//   digits, 600 characters a row (`faceContentSchema`, the printed extremes).
//   A stored plain-text card past one of those — a walker of seven lines, a
//   saga with a chapter VII — was refused whole by its own dual write: it
//   could not even be retitled;
// - the rows can say less than the text: a marker the editor cannot number
//   ("XI —", or the XI of "I, XI —"), a marker written out of order
//   ("II, I —" — the rows sort it).
//   UNTOUCHED, such a card stays exactly as it is stored: its text byte for
//   byte, its `face_content` not sent at all (`keepsStored`: the server
//   leaves an omitted column alone). EDITED (or new) past the limits, it
//   saves as PLAIN TEXT — the rows serialized, no `face_content` — which
//   both renderers parse back into the same rows (`resolve*`, the path every
//   plain-text walker and saga has always drawn through). The limits stay:
//   no print has a seventh walker row or a chapter VII, and what a stored
//   card draws is unchanged.
//
// Pure: no form, no React (tests/unit/creator/structured-rules.test.ts).

import {
  resolveLoyaltyRows,
  resolveSagaChapters,
  sagaFromRulesText,
  serializeLoyalty,
  serializeSaga,
} from "@/lib/cards/face-content";
import { faceContentSchema } from "@/lib/validation/card";
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
  /** The structured rows, or null (every other kind; no row survives; rows
   *  past what `face_content` stores, saved as plain text). With
   *  `keepsStored`, the STORED value — what the preview draws. */
  faceContent: FaceContent | null;
  /** An untouched edit whose rows cannot be written as `face_content`
   *  (above): the save must not send `face_content` at all. */
  keepsStored?: true;
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

/** `faceContentSchema`'s row count and highest chapter (a test holds them
 *  to the schema). */
export const MAX_STRUCTURED_ROWS = 6;

const same = (a: unknown, b: unknown) => JSON.stringify(a) === JSON.stringify(b);

/** Something the server stores as `face_content` (its own schema). */
const fits = (content: FaceContent) => faceContentSchema.safeParse(content).success;

/** The stored text is still the hidden textarea's (an AI fill replaces it —
 *  and the rows with it). */
function openedOf(values: StructuredRulesValues, options: SubmittedRulesOptions): StructuredRulesValues | null {
  return options.opened && options.opened.rules_text === values.rules_text ? options.opened : null;
}

/** An EDIT whose walker / saga rows still read as the rows the form opened
 *  with — the save keeps the stored text, and nothing about those rows is
 *  the maker's to fix (lib/creator/form-schema.ts skips their checks: a
 *  stored card always opens and retitles). False for every other kind, a new
 *  card and a remix. */
export function structuredRowsUntouched(
  kind: CardKind,
  values: StructuredRulesValues,
  opened: StructuredRulesValues | null | undefined,
): boolean {
  const from = openedOf(values, { opened });
  if (!from) return false;
  if (kind === "planeswalker") {
    return same(loyaltyRowsOf(values.loyalty_abilities), loyaltyRowsOf(from.loyalty_abilities));
  }
  if (kind === "saga") {
    return (
      (from.saga_intro.trim() || null) === (values.saga_intro.trim() || null) &&
      same(sagaTextRowsOf(values.saga_chapters), sagaTextRowsOf(from.saga_chapters))
    );
  }
  return false;
}

/**
 * The saga rows (their indices in `values.saga_chapters`) that hold a text
 * and NO chapter number, and whose text the save would not carry — what the
 * form asks a number for instead of dropping them without a word:
 * - beside a numbered chapter, such a row is simply left out of the save;
 * - alone, the save keeps the hidden text — fine while the rows still read
 *   as that text (a marker the editor can't number, "XI —", on a remix),
 *   and a lost edit once the row or the intro was changed.
 * Never on an edit whose rows are untouched: that save keeps the stored
 * text whole.
 */
export function sagaRowsNeedingNumber(
  kind: CardKind,
  values: StructuredRulesValues,
  opened?: StructuredRulesValues | null,
): number[] {
  if (kind !== "saga" || structuredRowsUntouched(kind, values, opened)) return [];
  const unnumbered = values.saga_chapters.flatMap((row, index) =>
    row.text.trim() && row.numerals.length === 0 ? [index] : [],
  );
  if (unnumbered.length === 0) return [];
  if (unnumbered.length < sagaTextRowsOf(values.saga_chapters).length) return unnumbered;
  const hidden = sagaFromRulesText(values.rules_text);
  const asHidden =
    (hidden.intro ?? "") === values.saga_intro.trim() &&
    same(sagaTextRowsOf(values.saga_chapters), sagaTextRowsOf(hidden.chapters));
  return asHidden ? [] : unnumbered;
}

/** Rows that hold a text but are more than `face_content` stores (seven
 *  walker rows, a chapter VII…): the card saves as plain text. What the
 *  editors say so from. */
export function structuredRowsSaveAsText(kind: CardKind, values: StructuredRulesValues): boolean {
  if (kind === "planeswalker") {
    return values.loyalty_abilities.filter((r) => r.text.trim()).length > MAX_STRUCTURED_ROWS;
  }
  if (kind === "saga") {
    const rows = sagaTextRowsOf(values.saga_chapters).filter((r) => r.numerals.length > 0);
    return rows.length > MAX_STRUCTURED_ROWS || rows.some((r) => r.numerals.some((n) => n > MAX_STRUCTURED_ROWS));
  }
  return false;
}

export function submittedRulesOf(
  kind: CardKind,
  values: StructuredRulesValues,
  options: SubmittedRulesOptions = {},
): SubmittedRules {
  const textarea = values.rules_text.trim();
  const untouched = structuredRowsUntouched(kind, values, options.opened);
  const stored = options.storedFaceContent ?? null;

  if (kind === "planeswalker") {
    const rows = loyaltyRowsOf(values.loyalty_abilities);
    if (rows.length > 0) {
      const content: FaceContent = { v: 1, loyalty: { abilities: rows } };
      if (untouched) {
        // The dual write of a card stored as plain text — only where the
        // rows are storable and draw what the card draws today.
        // (A card with neither a text nor stored rows draws nothing to
        // compare with — the rows are all there is.)
        const writable =
          fits(content) &&
          ((!stored && !textarea) ||
            same(resolveLoyaltyRows(content, textarea), resolveLoyaltyRows(stored, textarea)));
        return writable
          ? { rulesText: textarea, faceContent: content }
          : { rulesText: textarea, faceContent: stored, keepsStored: true };
      }
      return fits(content)
        ? { rulesText: serializeLoyalty(rows), faceContent: content }
        : { rulesText: serializeLoyalty(rows), faceContent: null };
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
      const content: FaceContent = { v: 1, saga: { intro, chapters } };
      if (untouched) {
        // Untouched: the dual write only where the rows are storable and
        // say all the text does. A row the chapters cannot carry (a marker
        // the editor can't number beside ones it can), a chapter VII, a
        // seventh row, a marker the rows would re-order: the card stays as
        // it is stored. Writing the numbered rows alone as `face_content` —
        // which the renderers read BEFORE the text — took that chapter off
        // the card on a save that only retitled it.
        const writable =
          textRows.length === chapters.length &&
          fits(content) &&
          ((!stored && !textarea) ||
            same(resolveSagaChapters(content, textarea), resolveSagaChapters(stored, textarea)));
        return writable
          ? { rulesText: textarea, faceContent: content }
          : { rulesText: textarea, faceContent: stored, keepsStored: true };
      }
      return fits(content)
        ? { rulesText: serializeSaga(intro, chapters), faceContent: content }
        : { rulesText: serializeSaga(intro, chapters), faceContent: null };
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
