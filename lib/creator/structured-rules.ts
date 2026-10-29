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
// And a saga row keeps its MARKER AS STORED for as long as its numbers are
// that marker's (the 3b.25 follow-up, 2026-10-13). The editor holds a
// chapter as numbers and writes them ascending; a stored marker can say
// more — an order of its own ("II, I —"), a numeral the editor has no
// toggle for ("I, XI —", "XI —"). An EDITED save used to write every row
// from its numbers: editing row A re-ordered row B's "II, I" to "I, II" and
// took the XI off "I, XI" — on the card too, the rail draws what the marker
// lists. So the row CARRIES that marker (`marker`, set when the form opens:
// lib/cards/face-content.ts sagaEditorRows — only where the numbers alone
// would not give it back, so an ordinary saga carries none) and the save
// writes it while `numerals` are still the marker's own, whatever else was
// edited — the row's text included:
//
// - a kept marker the rows can store (every numeral I–VI: "II, I" is
//   `numerals: [2, 1]`, which the renderers read back in that order) is
//   written as `face_content` like any other row;
// - one they cannot (the XI) makes the card save as PLAIN TEXT, the path
//   above: `rules_text` is what draws, marker for marker;
// - numbers CHANGED on a row whose marker mixes numerals the editor shows
//   with one it can't ("I, XI": the toggles read "I" and look complete):
//   the save would drop the XI, so the row says so and the save waits
//   (sagaRowsLosingMarker) until the numbers are put back or the maker
//   drops it by name. Changed on a marker that is only out of order, or
//   PICKED on one with no numeral the editor shows ("XI —": an empty row of
//   toggles — the unnumbered row the form asks a number for), the numbers
//   picked are the row's — ascending, as the editor shows them.
//
// Why on the row, not a per-card "plain text passthrough": a row can be
// moved, removed or have its text edited, and its marker has to follow IT —
// an index into the stored text does not survive a removed row; and the
// structured rows stay the storage wherever they can say what is drawn.
//
// Pure: no form, no React (tests/unit/creator/structured-rules.test.ts).

import { resolveSagaCreature } from "@/lib/cards/saga-creature";
import {
  keepsStoredMarker,
  markerNumerals,
  resolveLoyaltyRows,
  resolveSagaChapters,
  romanMarker,
  sagaFromRulesText,
  serializeLoyalty,
  serializeSagaMarkers,
  unreadableMarkerParts,
} from "@/lib/cards/face-content";
import { parseStationText, serializeStation } from "@/lib/cards/station";
import { stationPlatedTier } from "@/lib/creator/station-rows";
import { faceContentSchema } from "@/lib/validation/card";
import type { CardKind } from "@/lib/creator/card-kinds";
import type { FormValues } from "@/lib/creator/form-types";
import type { FaceContent, LoyaltyRowContent, SagaChapterContent } from "@/types/card";

export type StructuredRulesValues = Pick<
  FormValues,
  "rules_text" | "loyalty_abilities" | "saga_intro" | "saga_chapters" | "saga_creature_text"
> & {
  /** The station frame's "which tier carries the P/T" choice (null / absent
   *  = as the text says; lib/creator/station-rows.ts). */
  station_pt_tier?: number | null;
};

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
  /** The card is on a STATION frame (its profile has `tiers`): the tier
   *  editor owns the text, and a save writes its rows. */
  stationFrame?: boolean;
  /** An EDIT of a station card: the stored `rules_text`, which an untouched
   *  save keeps byte for byte — the form may have opened with the stored
   *  ROWS' text where the two disagreed (stationOpenText). */
  storedRulesText?: string | null;
  /** A station card that shows NO power / toughness (a Planet: a land):
   *  `false` — its rows then mark no tier. Absent = it shows one. (A
   *  Planet's rows used to carry `pt: true` on the last tier: never drawn,
   *  noise in the row — the independent check of #549.) */
  stationShowsPt?: boolean;
  /** The card is on the SAGA CREATURE frame (TODO 4.5d): an untouched
   *  edit's dual write must draw the same box too (lib/cards/saga-creature.ts).
   *  (`saga_creature_text` is written after the last chapter on any frame
   *  while it holds a value.) */
  sagaCreatureFrame?: boolean;
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

type SagaFormRow = { numerals: readonly number[]; text: string; marker?: string | null };

/** A saga row as a save WRITES it: its marker (the stored one while the
 *  row keeps it, else its numbers ascending; "" = no chapter number), the
 *  numbers in the marker's order, and its text. */
export type SagaRowOut = { marker: string; numerals: number[]; text: string; kept: boolean };

/** The rows that hold a text, as a save writes them — unnumbered ones
 *  (`marker: ""`) included, in the editor's order. */
export function sagaRowsOut(rows: readonly SagaFormRow[]): SagaRowOut[] {
  return rows
    .map((row) => {
      const text = row.text.trim();
      if (keepsStoredMarker(row)) {
        const marker = row.marker as string;
        return { marker, numerals: markerNumerals(marker), text, kept: true };
      }
      const numerals = [...row.numerals].sort((a, b) => a - b);
      return { marker: romanMarker(numerals), numerals, text, kept: false };
    })
    .filter((row) => row.text.length > 0);
}

/**
 * The rows a KIND SWITCH away from saga folds into the plain rules text
 * (TODO 3b.30): `sagaRowsOut`, except a row the save would hold back
 * (`sagaRowsLosingMarker`: its numbers changed on a stored marker that also
 * names a numeral the editor has no toggle for, "I, XI —" with II picked)
 * KEEPS that numeral — it is written after the numbers picked ("II, XI —"),
 * never dropped without a word. Plain text can say it, and it reads back
 * into the same row (its marker carried) if the card goes back to saga.
 */
export function sagaRowsForKindSwitch(rows: readonly SagaFormRow[]): SagaRowOut[] {
  return rows
    .map((row): SagaRowOut | null => {
      const text = row.text.trim();
      if (!text) return null;
      if (!keepsStoredMarker(row) && row.marker && markerNumerals(row.marker).length > 0) {
        const unreadable = unreadableMarkerParts(row.marker);
        if (unreadable.length > 0) {
          const numerals = [...row.numerals].sort((a, b) => a - b);
          const marker = [romanMarker(numerals), ...unreadable].filter(Boolean).join(",");
          return { marker, numerals, text, kept: true };
        }
      }
      return sagaRowsOut([row])[0] ?? null;
    })
    .filter((row): row is SagaRowOut => row !== null);
}

const carriedMarkersOf = (rows: readonly SagaFormRow[]) =>
  rows.filter((row) => row.text.trim()).map((row) => row.marker ?? null);

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
      // …and the saga creature's box as it opened (TODO 4.5d).
      (from.saga_creature_text ?? "").trim() === (values.saga_creature_text ?? "").trim() &&
      same(sagaTextRowsOf(values.saga_chapters), sagaTextRowsOf(from.saga_chapters)) &&
      // …and each still carries the stored marker it opened with: one the
      // maker dropped by name ("Drop XI") is an edit, whatever the numbers.
      same(carriedMarkersOf(values.saga_chapters), carriedMarkersOf(from.saga_chapters))
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
  // (A row that keeps a stored marker the editor can't number — "XI —" —
  // saves under that marker: it is asked nothing.)
  const unnumbered = values.saga_chapters.flatMap((row, index) =>
    row.text.trim() && row.numerals.length === 0 && !keepsStoredMarker(row) ? [index] : [],
  );
  if (unnumbered.length === 0) return [];
  if (unnumbered.length < sagaTextRowsOf(values.saga_chapters).length) return unnumbered;
  const hidden = sagaFromRulesText(values.rules_text);
  const asHidden =
    (hidden.intro ?? "") === values.saga_intro.trim() &&
    same(sagaTextRowsOf(values.saga_chapters), sagaTextRowsOf(hidden.chapters));
  return asHidden ? [] : unnumbered;
}

/**
 * The saga rows (their indices) whose NUMBERS were changed while their
 * stored marker holds, beside numerals the editor shows, one it has no
 * toggle for ("I, XI —" with II switched on): the save would write the
 * numbers picked and drop that numeral without a word. The form says so on
 * the row and waits — the numbers put back keep the marker, and "Drop XI"
 * (the row's `marker` cleared) makes the numbers picked the row's. Rows with
 * a text only: an emptied row is not saved at all. Not a marker with no
 * numeral the editor shows ("XI —"): its row opens with no number picked,
 * and picking one is the answer the form asks for there.
 */
export function sagaRowsLosingMarker(kind: CardKind, values: StructuredRulesValues): number[] {
  if (kind !== "saga") return [];
  return values.saga_chapters.flatMap((row, index) =>
    row.text.trim() &&
    row.marker &&
    !keepsStoredMarker(row) &&
    markerNumerals(row.marker).length > 0 &&
    unreadableMarkerParts(row.marker).length > 0
      ? [index]
      : [],
  );
}

/** Rows that hold a text but are more than `face_content` stores (seven
 *  walker rows, a chapter VII…): the card saves as plain text. What the
 *  editors say so from. */
export function structuredRowsSaveAsText(kind: CardKind, values: StructuredRulesValues): boolean {
  if (kind === "planeswalker") {
    return values.loyalty_abilities.filter((r) => r.text.trim()).length > MAX_STRUCTURED_ROWS;
  }
  if (kind === "saga") {
    // …and a kept marker with a numeral the rows cannot hold ("I, XI").
    const rows = sagaRowsOut(values.saga_chapters).filter((r) => r.marker);
    return (
      rows.length > MAX_STRUCTURED_ROWS ||
      rows.some((r) => r.numerals.some((n) => n > MAX_STRUCTURED_ROWS) || unreadableMarkerParts(r.marker).length > 0)
    );
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
    const intro = values.saga_intro.trim() || null;
    // The saga creature's box (TODO 4.5d): its lines go after the last
    // chapter — on ANY frame while the field holds them (a card moved off
    // the saga creature frame keeps the text its maker did not touch; the
    // field stays shown and says the frame doesn't print it). Empty on
    // every other saga, whose save is as before.
    const creatureText = (values.saga_creature_text ?? "").trim();
    const withCreature = (rulesText: string) => (creatureText ? `${rulesText}\n${creatureText}` : rulesText);
    if (untouched && chapters.length > 0) {
      const content: FaceContent = { v: 1, saga: { intro, chapters } };
      // Untouched: the dual write only where the rows are storable and
      // say all the text does. A row the chapters cannot carry (a marker
      // the editor can't number beside ones it can), a chapter VII, a
      // seventh row, a marker the rows would re-order: the card stays as
      // it is stored. Writing the numbered rows alone as `face_content` —
      // which the renderers read BEFORE the text — took that chapter off
      // the card on a save that only retitled it.
      // (On the saga creature frame "draws what it draws today" is the box
      // too: beside rows its text is what follows their serialization,
      // lib/cards/saga-creature.ts — a stored text spelled otherwise
      // would lose its box to the dual write.)
      const writable =
        textRows.length === chapters.length &&
        fits(content) &&
        ((!stored && !textarea) ||
          (options.sagaCreatureFrame
            ? same(resolveSagaCreature(content, textarea), resolveSagaCreature(stored, textarea))
            : same(resolveSagaChapters(content, textarea), resolveSagaChapters(stored, textarea))));
      return writable
        ? { rulesText: textarea, faceContent: content }
        : { rulesText: textarea, faceContent: stored, keepsStored: true };
    }
    // EDITED (or new): every row as the editor shows it — and a row whose
    // numbers are still its stored marker's under THAT marker, order and
    // numerals as stored (above). Rows the server stores are written as
    // rows; a marker they cannot hold makes the card plain text.
    const written = untouched ? [] : sagaRowsOut(values.saga_chapters).filter((r) => r.marker);
    if (written.length > 0) {
      const content: FaceContent = {
        v: 1,
        saga: { intro, chapters: written.map((r) => ({ numerals: r.numerals, text: r.text })) },
      };
      const rulesText = withCreature(serializeSagaMarkers(intro, written));
      const storable = written.every((r) => unreadableMarkerParts(r.marker).length === 0) && fits(content);
      return storable ? { rulesText, faceContent: content } : { rulesText, faceContent: null };
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
    const introText = values.saga_intro.trim();
    const hidden = sagaFromRulesText(values.rules_text);
    if (hidden.chapters.length > 0 || (hidden.intro ?? "") !== introText) return { rulesText: introText, faceContent: null };
    return { rulesText: textarea, faceContent: null };
  }

  // A card on a STATION frame (TODO 4.27a, PR 2 — the tier editor). The
  // editor is a view of the rules text, so the text always says the tiers;
  // the rows (`face_content.station`, read BEFORE the text by both
  // renderers) add the one thing it cannot: the P/T on another tier.
  //
  // - UNTOUCHED (the text and the P/T tier as the form opened): the card
  //   stays exactly as stored — its text byte for byte, `face_content` not
  //   sent. A card stored as plain text is NOT given rows by a save that
  //   only retitled it.
  // - EDITED (or new, or a remix): the rows the text holds, the P/T on the
  //   maker's tier, beside the canonical text. PR 1 dropped the rows here —
  //   one word typed anywhere moved the plate back to the tier the text
  //   plates (the independent check of #543); now every edit carries the
  //   choice with it. With no tier left there are no rows (null clears the
  //   column: the maker removed them). Rows the server cannot store (a
  //   tier with no text, thresholds that do not rise — the form asks for
  //   those first, lib/creator/form-schema.ts) save as the text alone,
  //   which draws the same tiers.
  if (options.stationFrame) {
    const choice = values.station_pt_tier ?? null;
    if (options.opened && options.opened.rules_text === values.rules_text && (options.opened.station_pt_tier ?? null) === choice) {
      const kept = options.storedRulesText !== undefined ? (options.storedRulesText ?? "").trim() : textarea;
      return { rulesText: kept, faceContent: stored, keepsStored: true };
    }
    const parsed = parseStationText(values.rules_text);
    if (parsed.tiers.length === 0) return { rulesText: textarea, faceContent: null };
    const plated = options.stationShowsPt === false ? -1 : stationPlatedTier(values.rules_text, choice);
    const content: FaceContent = {
      v: 1,
      station: {
        intro: parsed.intro || null,
        tiers: parsed.tiers.map((t, i) => ({ threshold: t.threshold, text: t.text, ...(i === plated ? { pt: true as const } : {}) })),
      },
    };
    return fits(content)
      ? { rulesText: serializeStation(parsed.intro, parsed.tiers), faceContent: content }
      : { rulesText: textarea, faceContent: null };
  }

  // A card stored WITH station rows that is NOT on a station frame (its
  // frame was changed): an EDIT that left the rules text as it opened keeps
  // them — the column is not sent and the server leaves it alone. An edited
  // text is the card's own from then on: off the frame nothing draws rows.
  if (stored?.station && options.opened && options.opened.rules_text.trim() === textarea) {
    return { rulesText: textarea, faceContent: stored, keepsStored: true };
  }
  return { rulesText: textarea, faceContent: null };
}

/**
 * The station rows the creator's PREVIEW draws (TODO 4.27a): what a save
 * would store (`submittedRulesOf` above) — the stored card's while the edit
 * is untouched, the editor's rows with the maker's P/T tier once it is not,
 * null where the text alone says the card (no tier; off the frame, a text
 * that was edited).
 * Without it the editor drew a card stored with rows from its text alone —
 * the plate on the tier the TEXT plates, other line breaks — while the bake,
 * the card page and the download drew the rows: the preview showed a card
 * the save did not make. Never for a walker or a saga (their rows are the
 * editor's own).
 */
export function keptStationRows(
  kind: CardKind,
  values: StructuredRulesValues,
  options: SubmittedRulesOptions = {},
): FaceContent | null {
  if (kind === "planeswalker" || kind === "saga") return null;
  const out = submittedRulesOf(kind, values, options);
  return out.faceContent?.station ? out.faceContent : null;
}
