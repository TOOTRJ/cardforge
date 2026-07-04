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
  const lines = chapters.map(
    (ch) =>
      `${ch.numerals.map((n) => ROMAN_BY_NUMBER[n] ?? String(n)).join(", ")} — ${ch.text}`,
  );
  return [intro?.trim() || null, ...lines].filter(Boolean).join("\n");
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
