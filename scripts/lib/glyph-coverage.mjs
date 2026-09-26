// ---------------------------------------------------------------------------
// Which characters can a card bake actually draw? Shared by
// scripts/build-glyph-coverage.mjs (writes lib/render/glyph-coverage.ts),
// scripts/build-noto-fallback.mjs and the unit test that keeps the generated
// table in step with the committed font files.
//
// The bake registers five fonts (lib/render/card-image.tsx). Satori draws a
// character from the first of them (in the text face's order) that MAPS it —
// with ink or not; a character none maps goes to
// lib/render/fallback-assets.ts, which answers satori's "unknown" class
// (extra Latin/Greek/Cyrillic…) from public/fonts/NotoSans-Fallback.ttf.
// ---------------------------------------------------------------------------

import { readFileSync } from "node:fs";
import { createRequire } from "node:module";
import path from "node:path";

const require = createRequire(import.meta.url);
const fontkit = require("@pdf-lib/fontkit");

// satori 0.25's language detector (`va()` in its source): a character that
// matches one of these is requested under that class, never as "unknown".
const Da = String.raw;
const EMOJI_ATOM = Da`\p{Emoji}(?:\p{EMod}|[\u{E0020}-\u{E007E}]+\u{E007F}|️?⃣?)`;
export const SATORI_EMOJI = new RegExp(
  Da`\p{RI}{2}|(?![#*\d](?!️?⃣))${EMOJI_ATOM}(?:‍${EMOJI_ATOM})*`,
  "u",
);
export const SATORI_OTHER_CLASSES = [
  SATORI_EMOJI,
  /\p{Symbol}/u,
  /\p{Math}/u,
  /\p{scx=Hira}|\p{scx=Kana}|\p{scx=Han}|[　]|[＀-￯]/u,
  /\p{scx=Hangul}/u,
  /\p{scx=Thai}/u,
  /\p{scx=Bengali}/u,
  /\p{scx=Arabic}/u,
  /\p{scx=Tamil}/u,
  /\p{scx=Malayalam}/u,
  /\p{scx=Hebrew}/u,
  /\p{scx=Telugu}/u,
  /\p{scx=Devanagari}/u,
  /\p{scx=Kannada}/u,
];

/** True when satori would request `cp` under its "unknown" class. */
export function isUnknownClass(cp) {
  const ch = String.fromCodePoint(cp);
  return !SATORI_OTHER_CLASSES.some((re) => re.test(ch));
}

/** The bake's registered fonts, in registration order (card-image.tsx). */
export const BAKE_FONT_FILES = {
  mplantin: "node_modules/mana-font/fonts/mplantin.ttf",
  mplantinItalic: "public/fonts/mplantin-italic.ttf",
  cardDisplay: "public/fonts/Beleren-Bold.ttf",
  mana: "node_modules/mana-font/fonts/mana.ttf",
  keyrune: "node_modules/keyrune/fonts/keyrune.ttf",
};
export const NOTO_FALLBACK_FILE = "public/fonts/NotoSans-Fallback.ttf";

/** Characters that draw nothing on purpose (spaces, zero-width and format
 *  characters): mapped is enough, no ink expected. */
const INKLESS_BY_DESIGN = /[\p{Zs}\p{Zl}\p{Zp}\p{Cf}\p{Cc}]/u;

/** A font as satori's resolver sees it: does it MAP a character (a non-zero
 *  glyph id — satori then uses this font and looks no further), and does
 *  that glyph DRAW anything? MPlantin, for one, maps 181 code points (Č, °,
 *  ×, →, đ…) to empty glyphs, so those vanish from rules text. */
function loadFont(file) {
  const font = fontkit.create(readFileSync(file));
  const mapped = new Set(font.characterSet.filter((cp) => font.glyphForCodePoint(cp).id !== 0));
  return {
    maps: (cp) => mapped.has(cp),
    draws: (cp) =>
      mapped.has(cp) &&
      (INKLESS_BY_DESIGN.test(String.fromCodePoint(cp)) || font.glyphForCodePoint(cp).path.commands.length > 0),
    codepoints: [...mapped],
  };
}

/** Sorted, merged [start, end] ranges for a set of code points. */
export function toRanges(codepoints) {
  const sorted = [...new Set(codepoints)].sort((a, b) => a - b);
  const ranges = [];
  for (const cp of sorted) {
    const last = ranges[ranges.length - 1];
    if (last && cp === last[1] + 1) last[1] = cp;
    else ranges.push([cp, cp]);
  }
  return ranges;
}

/**
 * The three coverage sets the creator's warnings use — one per text face,
 * each in satori's resolution order for that face: the face's own font, then
 * every other registered family in registration order (lib/render/
 * card-image.tsx). Satori draws a character from the FIRST font that maps
 * it, so a character that font maps to an empty glyph vanishes even when a
 * later font has it.
 *   display — CardDisplay (Beleren Bold), then MPlantin: titles, type lines,
 *             the footer and stats. The Noto fallback is not counted: in
 *             these lines its characters draw in some words and as boxes in
 *             others, so the creator says they "may not show".
 *   rules   — MPlantin regular first, then the Noto fallback's requestable
 *             characters for what no registered font maps (real bakes draw
 *             "Ǵoran" in rules text from Noto).
 *   italic  — MPlantin italic first (flavor text, reminder text, a saga's
 *             intro), with NO Noto fallback: real bakes leave Noto-only
 *             characters blank in italic runs ("“Ǵoran…”" → "“ oran…").
 */
export function computeCoverage(root, googleRanges) {
  const at = (file) => path.join(root, file);
  const F = Object.fromEntries(
    Object.entries(BAKE_FONT_FILES).map(([key, file]) => [key, loadFont(at(file))]),
  );
  const noto = loadFont(at(NOTO_FALLBACK_FILE));
  const inGoogle = (cp) => googleRanges.some(([a, b]) => cp >= a && cp <= b);
  const candidates = new Set([...Object.values(F).flatMap((f) => f.codepoints), ...noto.codepoints]);
  const face = (order, withNoto) => {
    const out = [];
    for (const cp of candidates) {
      const first = order.find((f) => f.maps(cp));
      // Combining marks count whatever satori's class for them: decomposed
      // letters get the Noto answer too (lib/render/fallback-assets.ts).
      const requestable = isUnknownClass(cp) || /\p{M}/u.test(String.fromCodePoint(cp));
      const drawn = first
        ? first.draws(cp)
        : withNoto && inGoogle(cp) && requestable && noto.draws(cp);
      if (drawn) out.push(cp);
    }
    return toRanges(out);
  };
  return {
    display: face([F.cardDisplay, F.mplantin, F.mana, F.keyrune], false),
    rules: face([F.mplantin, F.cardDisplay, F.mana, F.keyrune], true),
    italic: face([F.mplantinItalic, F.cardDisplay, F.mana, F.keyrune], false),
  };
}

const hex = (n) => `0x${n.toString(16).toUpperCase()}`;
const rangeList = (ranges) => {
  const items = ranges.map(([a, b]) => (a === b ? `${hex(a)}` : `[${hex(a)}, ${hex(b)}]`));
  const lines = [];
  for (let i = 0; i < items.length; i += 8) lines.push(`  ${items.slice(i, i + 8).join(", ")},`);
  return lines.join("\n");
};

/** Source of lib/render/glyph-coverage.ts. */
export function renderCoverageModule({ display, rules, italic }) {
  return `// GENERATED by scripts/build-glyph-coverage.mjs from the committed font
// files — do not edit by hand (tests/unit/render/glyph-coverage.test.ts
// fails when it drifts from the fonts).
//
// What a card bake draws WITH INK, per text face, in satori's font order
// (scripts/lib/glyph-coverage.mjs): DISPLAY = titles, type lines, the footer
// and stats (Beleren Bold, then MPlantin); RULES = rules text (MPlantin, then
// the bundled Noto Sans fallback); ITALIC = flavor text, reminder text and a
// saga's intro (MPlantin italic, no Noto). A number is one code point, a pair
// an inclusive range. Client-safe (no fs).

export type CodepointRanges = ReadonlyArray<number | readonly [number, number]>;

export const CARD_DISPLAY_COVERAGE: CodepointRanges = [
${rangeList(display)}
];

export const CARD_RULES_COVERAGE: CodepointRanges = [
${rangeList(rules)}
];

export const CARD_ITALIC_COVERAGE: CodepointRanges = [
${rangeList(italic)}
];
`;
}
