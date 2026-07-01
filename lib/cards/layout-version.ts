// ---------------------------------------------------------------------------
// CARD_LAYOUT_VERSION — stamped onto `cards.layout_version` every time a card
// render is baked (lib/cards/bake-render.ts, app/api/admin/rebake).
//
// BUMP THIS whenever a change alters baked output for existing cards:
//   * frame profile geometry/ink edits (lib/cards/template-layout.ts)
//   * renderer changes (lib/render/card-image.tsx) or shared text logic
//     (rules-text tokenizer, fit sizing, fonts)
//   * frame PNG asset replacements
// then run `node scripts/rebake-renders.mjs` so stored gallery PNGs catch up
// (detail pages and downloads always render live and need no sweep).
//
// History:
//   (null) — renders baked before versioning existed (pre 2026-06-09)
//   2      — creation-audit pass: Beleren/MPlantin-Italic, fit-based text
//            sizing, pip-size contract, M15-family geometry verification
//   3      — PipGlyph rebrand: footer brand line, compass-star default set
//            mark, watermark → pipglyph.com (2026-06-11)
//   4      — M15 type-line nudged down ~2px to true-center on the type bar
//   5      — M15 P/T value lifted ~2px (valueDyEm) to true-center on the plate
//   6      — M15 P/T value nudged ~2px right (valueDxEm) to true-center on the
//            plate horizontally
//   7      — M15 P/T value: a bit more right (valueDxEm 0.09 → 0.18)
//   8      — M15 title nudged down ~1px to true-center on the name bar
//   9      — M15 type line back up a hair (56.5 → 56.35); 56.5 read too low
// (Modern-2003 type nudge — no version bump: zero existing public cards use
//  that frame, so no stored render changed.)
// ---------------------------------------------------------------------------

export const CARD_LAYOUT_VERSION = 9;
