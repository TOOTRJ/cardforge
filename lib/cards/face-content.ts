// Round-trip contract between structured face content (cards.face_content)
// and the rules_text conventions the renderers have always parsed.
//
// The invariant everything hangs on: for any structured rows,
//   parse(serialize(rows)) === rows
// and resolving (faceContent, serialize(faceContent)) renders IDENTICALLY to
// resolving (null, sameText). That's what lets legacy cards keep re-baking
// byte-identically while new cards store structured data — the renderers
// call resolve* and never care which representation a card has.
//
// Pure + framework-free; shared by the form (serialize on save), the
// renderers (resolve*), and tests.

import type {
  FaceContent,
  LoyaltyRowContent,
  SagaChapterContent,
} from "@/types/card";
import {
  parseChapters,
  parseLoyaltyAbilities,
  parseSagaIntro,
  type LoyaltyAbility,
  type SagaChapter,
} from "@/lib/cards/card-display";

// ---------------------------------------------------------------------------
// Roman numerals ↔ chapter numbers
// ---------------------------------------------------------------------------

// Sagas cap out at VI on real cards (Long List of the Ents); parseChapters
// tolerates any [ivx]+ run, so decode defensively past that.
const ROMAN: Record<string, number> = {
  I: 1,
  II: 2,
  III: 3,
  IV: 4,
  V: 5,
  VI: 6,
  VII: 7,
  VIII: 8,
  IX: 9,
  X: 10,
};
const ROMAN_BY_NUMBER = Object.fromEntries(
  Object.entries(ROMAN).map(([k, v]) => [v, k]),
) as Record<number, string>;

/** [1, 2] → "I,II" — EXACTLY parseChapters' marker normalization (uppercase,
 *  comma-joined, no spaces), so structured chapters render with the same
 *  marker string a parsed legacy card produces. */
export function romanMarker(numerals: number[]): string {
  return numerals
    .map((n) => ROMAN_BY_NUMBER[n] ?? String(n))
    .join(",");
}

function numeralsFromMarker(marker: string): number[] {
  return marker
    .split(",")
    .map((r) => ROMAN[r.trim().toUpperCase()] ?? 0)
    .filter((n) => n > 0);
}

// ---------------------------------------------------------------------------
// A chapter marker AS STORED (the TODO 3b.25 follow-up, 2026-10-13).
//
// The row editor holds a chapter as NUMBERS (its I–X toggles) and writes
// them ascending. A stored marker can say more than that: an order of its
// own ("II, I —") and numerals the editor has no toggle for ("I, XI —": the
// renderers draw whatever the marker lists). The row therefore carries the
// marker itself beside its numbers — only where the numbers alone would not
// give it back — and keeps it for as long as the numbers are the marker's.
// ---------------------------------------------------------------------------

/** A marker's parts as written, in order ("I,XI" → ["I", "XI"]). */
function markerParts(marker: string): string[] {
  return marker
    .split(",")
    .map((r) => r.trim().toUpperCase())
    .filter(Boolean);
}

/** The numerals of a marker the editor can show (I–X), in the marker's
 *  order. */
export function markerNumerals(marker: string): number[] {
  return numeralsFromMarker(marker);
}

/** The parts of a marker the editor has no number for ("XI", "IIII"). */
export function unreadableMarkerParts(marker: string): string[] {
  return markerParts(marker).filter((part) => !(part in ROMAN));
}

/** A marker the way a rules line spells it: "II,I" → "II, I". */
export function markerText(marker: string): string {
  return markerParts(marker).join(", ");
}

/**
 * The marker a row must CARRY to save as it is stored, or undefined when
 * its numbers say it all (ascending numerals the editor reads — every
 * ordinary saga). Normalized as the renderers hold it: upper case, comma
 * joined, no spaces.
 */
export function storedMarkerOf(marker: string): string | undefined {
  const normal = markerParts(marker).join(",");
  const canonical = romanMarker([...numeralsFromMarker(normal)].sort((a, b) => a - b));
  return normal && normal !== canonical ? normal : undefined;
}

/** A row's numbers are still its stored marker's (in any order): the marker
 *  is kept. False for a row that carries none. */
export function keepsStoredMarker(row: { numerals: readonly number[]; marker?: string | null }): boolean {
  if (!row.marker) return false;
  const stored = [...numeralsFromMarker(row.marker)].sort((a, b) => a - b);
  const now = [...row.numerals].sort((a, b) => a - b);
  return stored.length === now.length && stored.every((n, i) => n === now[i]);
}

// ---------------------------------------------------------------------------
// Serialize: structured rows → canonical rules_text
// ---------------------------------------------------------------------------

/** Loyalty rows → the "+1: Draw a card." line convention. Static rows
 *  (cost null) serialize as bare lines, exactly what the parser emits for
 *  unbadged rows. Costs are already ASCII-normalized by the zod schema. */
export function serializeLoyalty(rows: LoyaltyRowContent[]): string {
  return rows
    .map((row) => (row.cost ? `${row.cost}: ${row.text}` : row.text))
    .join("\n");
}

/** Saga intro + chapter rows → the "I, II — Effect" line convention (spaced
 *  em dash — matching Scryfall's oracle formatting; parseChapters accepts
 *  it and normalizes the marker). */
export function serializeSaga(
  intro: string | null | undefined,
  chapters: SagaChapterContent[],
): string {
  return serializeSagaMarkers(
    intro,
    chapters.map((ch) => ({ marker: romanMarker(ch.numerals), text: ch.text })),
  );
}

/** The same lines from rows that name their MARKER ("II,I", "I,XI" — a
 *  stored marker kept as it is): what `parseChapters` reads back as those
 *  markers. For numbered rows it is serializeSaga, character for character. */
export function serializeSagaMarkers(
  intro: string | null | undefined,
  rows: readonly { marker: string; text: string }[],
): string {
  const lines = rows.map((row) => `${markerText(row.marker)} — ${row.text}`);
  return [intro?.trim() || null, ...lines].filter(Boolean).join("\n");
}

/** A saga's rules text as its intro and marker rows — what
 *  serializeSagaMarkers writes, read back. */
export function sagaMarkersFromRulesText(rulesText: string | null | undefined): {
  intro: string | null;
  rows: { marker: string; text: string }[];
} {
  return { intro: parseSagaIntro(rulesText), rows: parseChapters(rulesText) };
}

/** The rows the EDITOR opens with (an edit, a remix, a kind switch): the
 *  chapters as numbers, each with its stored marker where the numbers alone
 *  would not give it back (storedMarkerOf). */
export function sagaEditorRows(
  faceContent: FaceContent | null | undefined,
  rulesText: string | null | undefined,
): { intro: string | null; chapters: { numerals: number[]; text: string; marker?: string }[] } {
  const saga = faceContent?.saga;
  const intro = saga ? (saga.intro ?? null) : parseSagaIntro(rulesText);
  const rows = saga
    ? saga.chapters.map((ch) => ({ marker: romanMarker(ch.numerals), numerals: [...ch.numerals], text: ch.text }))
    : parseChapters(rulesText).map((ch) => ({ marker: ch.marker, numerals: numeralsFromMarker(ch.marker), text: ch.text }));
  return {
    intro,
    chapters: rows.map(({ marker, numerals, text }) => {
      const stored = storedMarkerOf(marker);
      return stored ? { numerals, text, marker: stored } : { numerals, text };
    }),
  };
}

// ---------------------------------------------------------------------------
// Parse: legacy rules_text → structured rows (editor hydration)
// ---------------------------------------------------------------------------

export function loyaltyFromRulesText(
  rulesText: string | null | undefined,
): LoyaltyRowContent[] {
  return parseLoyaltyAbilities(rulesText).map((a) => ({
    cost: a.cost,
    text: a.text,
  }));
}

export function sagaFromRulesText(rulesText: string | null | undefined): {
  intro: string | null;
  chapters: SagaChapterContent[];
} {
  return {
    intro: parseSagaIntro(rulesText),
    chapters: parseChapters(rulesText).map((ch) => ({
      numerals: numeralsFromMarker(ch.marker),
      text: ch.text,
    })),
  };
}

// ---------------------------------------------------------------------------
// Resolve: what the RENDERERS call — structured-first, parse fallback.
// Returns the exact card-display shapes so preview + bake change by one
// call-site swap each.
// ---------------------------------------------------------------------------

export function resolveLoyaltyRows(
  faceContent: FaceContent | null | undefined,
  rulesText: string | null | undefined,
): LoyaltyAbility[] {
  const rows = faceContent?.loyalty?.abilities;
  if (rows && rows.length > 0) {
    return rows.map((r) => ({ cost: r.cost, text: r.text }));
  }
  return parseLoyaltyAbilities(rulesText);
}

export function resolveSagaChapters(
  faceContent: FaceContent | null | undefined,
  rulesText: string | null | undefined,
): { intro: string | null; chapters: SagaChapter[] } {
  const saga = faceContent?.saga;
  if (saga && saga.chapters.length > 0) {
    return {
      intro: saga.intro?.trim() || null,
      chapters: saga.chapters.map((ch) => ({
        marker: romanMarker(ch.numerals),
        text: ch.text,
      })),
    };
  }
  return {
    intro: parseSagaIntro(rulesText),
    chapters: parseChapters(rulesText),
  };
}
