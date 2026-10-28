// ---------------------------------------------------------------------------
// Flavour text's ONE markup: `*…*` = the words printed UPRIGHT (roman)
// inside the italic flavour, as real cards set a book's title, a ship's name
// or a stressed word ("—*Heroics: A Book of Fables*", "Are *we* the wrong
// sort of people?"). Scryfall writes it that way in `flavor_text` (2,059
// printings on 2026-10-28: every pair balanced on its line, never `**`,
// never a space inside the stars' edges — and never a star in oracle text),
// so an import keeps it as typed and the STORED text holds the markup: no
// migration, nothing converted.
//
// A span is a balanced pair on ONE source line: a star with a non-space,
// non-star character after it, the nearest star on the line with a
// non-space, non-star character before it, and no star between them. It can
// start or end inside a word ("Oracle *en*-Vec", "stalac-*tites*"). Every
// other star — alone, an odd one out, "**", "2 * 3", a pair split by a line
// break — is plain text, printed as typed.
//
// The rules layout (lib/cards/rules-layout.ts flavorRuns) reads the spans
// and sets their words without emphasis: both renderers draw an item without
// `em` in the roman face, and the layout measures it with the roman face's
// advances (lib/cards/rules-metrics.ts), so the line breaks are the
// renderers' own. The stars of a span are never drawn. Rules text has no
// markup: a star there is printed (and "* Draw" at a line's start is
// print typography's bullet, lib/validation/print-typography.ts).
//
// The production predicate the sweep and the owner's count use is this
// regex in SQL — keep the two together (lib/cards/layout-version.ts
// flavorMarkupChanged; the PR's SQL):
//   flavor_text ~ '\*[^[:space:]*]([^*\n]*[^[:space:]*])?\*'
// ---------------------------------------------------------------------------

/** One balanced span: the stars, and the text between them as group 1. */
const SPAN = /\*([^\s*](?:[^*\n]*[^\s*])?)\*/g;

/** A piece of one flavour line: its text (stars of a span removed) and
 *  whether it prints upright. */
export type FlavorSegment = { text: string; upright: boolean };

/** One flavour source line as its pieces, in order: the italic text and the
 *  upright spans. A line with no span is one italic piece (none if empty). */
export function flavorSegments(line: string): FlavorSegment[] {
  const out: FlavorSegment[] = [];
  let cursor = 0;
  for (const m of line.matchAll(SPAN)) {
    const at = m.index ?? 0;
    if (at > cursor) out.push({ text: line.slice(cursor, at), upright: false });
    out.push({ text: m[1], upright: true });
    cursor = at + m[0].length;
  }
  if (cursor < line.length) out.push({ text: line.slice(cursor), upright: false });
  return out;
}

/** Whether a flavour text holds at least one upright span. */
export function hasFlavorMarkup(text: string | null | undefined): boolean {
  if (!text || !text.includes("*")) return false;
  SPAN.lastIndex = 0;
  const found = SPAN.test(text);
  SPAN.lastIndex = 0;
  return found;
}

/** A flavour text as plain words — each span's stars dropped, every other
 *  character kept — for the surfaces that print it as text without styles
 *  (a page's meta description, its JSON-LD). Never stored. */
export function stripFlavorMarkup(text: string): string {
  return text.includes("*") ? text.replace(SPAN, "$1") : text;
}

/** The creator's note under a flavour field: how a maker asks for it. */
export const FLAVOR_MARKUP_HINT = "Words between *asterisks* print upright, as a book’s title does on a card.";
