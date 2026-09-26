// MPlantin's metrics — the body face both renderers set rules text in
// (public/fonts/mplantin.ttf + mplantin-italic.ttf, the committed masters:
// the bake loads them through lib/render/card-fonts.ts, the preview their
// same-metric web copies through globals.css) — and the line breaks they
// give. Plain tables, so the client preview and the server bake measure with
// the SAME numbers and no font is parsed at runtime.
// tests/unit/cards/rules-metrics.test.ts re-reads both TTFs and keeps every
// table in step with them.
//
// MPlantin has no kerning (no `kern` table, no GPOS), so a word's width is
// the sum of its advances in the browser and in Satori alike, and both
// renderers break a paragraph at the same words — up to the two things the
// wrap below models: how each lays out the gap between words, and the
// bake's whole-pixel rounding. The rules-fit estimate
// (lib/cards/render-tiers.ts) counts characters at an average width and
// deliberately over-counts lines; it can say how tall a block is, not where
// its last line ends. wrapRulesText can: the planeswalker rows use it to
// tell whether a last ability's text would reach the loyalty shield
// (lib/cards/loyalty-rows.ts).

import { groupTightRuns, tokenizeRulesText, type RulesItem } from "@/lib/cards/rules-text";
import { RULES_TEXT } from "@/lib/cards/typography";

/** Advances of printable ASCII (U+0020–U+007E, in code-point order), in
 *  thousandths of an em (both masters have 1000 units per em). */
const REGULAR_ASCII = [
  278, 292, 408, 668, 552, 906, 750, 180, 385, 385, 500, 667, 292, 365, 292, 278, // space … /
  552, 552, 552, 552, 552, 552, 552, 552, 552, 552, 292, 292, 667, 667, 667, 385, // 0 … ?
  921, 719, 688, 781, 844, 677, 656, 833, 854, 375, 354, 802, 677, 1010, 844, 813, // @ … O
  635, 813, 719, 594, 760, 833, 708, 1000, 781, 719, 677, 375, 278, 375, 469, 500, // P … _
  333, 479, 561, 469, 573, 469, 311, 500, 561, 271, 260, 510, 271, 865, 573, 542, // ` … o
  561, 561, 375, 396, 333, 573, 479, 729, 500, 479, 436, 480, 527, 480, 469, //      p … ~
] as const;

const ITALIC_ASCII = [
  238, 311, 420, 668, 490, 875, 948, 214, 448, 436, 521, 667, 311, 365, 311, 278, // space … /
  521, 521, 521, 521, 521, 521, 521, 521, 521, 521, 311, 311, 667, 667, 667, 406, // 0 … ?
  920, 729, 698, 708, 781, 656, 635, 792, 823, 375, 479, 771, 646, 979, 813, 792, // @ … O
  615, 792, 698, 604, 667, 771, 719, 979, 781, 719, 625, 375, 278, 375, 422, 500, // P … _
  333, 521, 469, 385, 500, 385, 281, 448, 521, 271, 240, 521, 240, 771, 531, 448, // ` … o
  490, 448, 344, 333, 292, 531, 521, 688, 490, 479, 490, 400, 527, 400, 429, //      p … ~
] as const;

/** The typographic punctuation rules text uses, in thousandths of an em. */
const REGULAR_EXTRA: Readonly<Record<string, number>> = {
  "‘": 292, "’": 292, "“": 510, "”": 510, "–": 500, "—": 1000, "•": 350, "…": 1000,
};
const ITALIC_EXTRA: Readonly<Record<string, number>> = {
  "‘": 311, "’": 311, "“": 542, "”": 542, "–": 500, "—": 1000, "•": 350, "…": 1031,
};

/** A character neither table knows (another script, an emoji — a fallback
 *  face draws it): a full em, wider than any Latin letter here. */
const UNKNOWN_ADVANCE_EM = 1;

function advancePerMille(ch: string, italic: boolean): number | undefined {
  const code = ch.codePointAt(0) ?? 0;
  if (code >= 0x20 && code <= 0x7e) return (italic ? ITALIC_ASCII : REGULAR_ASCII)[code - 0x20];
  return (italic ? ITALIC_EXTRA : REGULAR_EXTRA)[ch];
}

/** One character's advance in em. MPlantin has no U+2212 minus: the bake
 *  sets it as a hyphen (lib/render/card-image.tsx bakeText), so it measures
 *  as one. An accented letter measures as its base letter (MPlantin draws
 *  é, ñ… on their base's advance); a combining accent as nothing. */
function advanceEm(ch: string, italic: boolean): number {
  if (/\p{M}/u.test(ch)) return 0;
  const c = ch === "−" ? "-" : ch;
  const units = advancePerMille(c, italic) ?? advancePerMille(c.normalize("NFD").charAt(0), italic);
  return units === undefined ? UNKNOWN_ADVANCE_EM : units / 1000;
}

/** The width of `text` set in MPlantin (italic for reminder text and ability
 *  words), in ems of the rules size. */
export function rulesTextWidthEm(text: string, italic = false): number {
  let w = 0;
  for (const ch of text) w += advanceEm(ch, italic);
  return w;
}

/** One unbreakable run (groupTightRuns): its words at their advances, each
 *  inline pip a disc, adjacent pips a hairline apart — as both renderers
 *  draw them. */
function runWidthEm(run: readonly RulesItem[]): number {
  let w = 0;
  run.forEach((item, i) => {
    if (item.t === "m") {
      w += RULES_TEXT.pipDiscEm + (i > 0 && run[i - 1].t === "m" ? RULES_TEXT.pipGapEm : 0);
    } else {
      w += rulesTextWidthEm(item.v, Boolean(item.em));
    }
  });
  return w;
}

/** How one renderer lays out a paragraph's word gaps and sizes its words. */
export type RulesWrapRule = {
  /** The bake gives every run a right margin of one word gap, so a line
   *  must hold its last run's gap too; the preview's `column-gap` only goes
   *  between runs. */
  gapAfterEveryRun: boolean;
  /** Every run's width is multiplied by this, then `runSlackEm` added: the
   *  bake sets its type at a whole-pixel size and its word boxes on the
   *  pixel grid, so it can break a line a word earlier than the advances
   *  alone say. 1 and 0 for the advances as they are. */
  widthScale: number;
  runSlackEm: number;
};

/** The preview's layout: the advances, gaps between runs only. */
export const PREVIEW_WRAP: RulesWrapRule = { gapAfterEveryRun: false, widthScale: 1, runSlackEm: 0 };
/** The bake's layout at the advances. */
export const BAKE_WRAP: RulesWrapRule = { gapAfterEveryRun: true, widthScale: 1, runSlackEm: 0 };
/** The bake's layout with every run a hair wider: its font size rounded up
 *  to the pixel (+0.8 % for 5 pt at either preset) and each word box on the
 *  pixel grid. Measured on real bakes, Satori breaks some lines here and
 *  not at the advances. */
export const BAKE_WRAP_WIDE: RulesWrapRule = { gapAfterEveryRun: true, widthScale: 1.01, runSlackEm: 0.04 };

/**
 * The lines `text` wraps to in a column `columnEm` wide (em of the text
 * size), per paragraph (source line), as each line's width in em — the
 * greedy flex-wrap both renderers run over the SAME unbreakable runs
 * (tokenizeRulesText + groupTightRuns). A blank source line is a paragraph
 * with no lines. A run wider than the column gets a line of its own.
 */
export function wrapRulesText(text: string, columnEm: number, rule: RulesWrapRule): number[][] {
  const gap = RULES_TEXT.wordGapEm;
  return tokenizeRulesText(text).map((items) => {
    const lines: number[] = [];
    let used = 0;
    let runs = 0;
    for (const run of groupTightRuns(items)) {
      const w = runWidthEm(run) * rule.widthScale + rule.runSlackEm;
      const needed = rule.gapAfterEveryRun ? used + w + gap : used + (runs > 0 ? gap : 0) + w;
      if (runs > 0 && needed > columnEm) {
        lines.push(rule.gapAfterEveryRun ? used - gap : used);
        used = 0;
        runs = 0;
      }
      used = rule.gapAfterEveryRun ? used + w + gap : used + (runs > 0 ? gap : 0) + w;
      runs += 1;
    }
    if (runs > 0) lines.push(rule.gapAfterEveryRun ? used - gap : used);
    return lines;
  });
}
