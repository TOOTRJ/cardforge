import "server-only";

import fs from "node:fs";
import path from "node:path";

// ---------------------------------------------------------------------------
// Card-fonts loader — reads the Mana and Keyrune TTFs from node_modules at
// module load and parses mana.css to build a {class-suffix → codepoint} map
// at runtime. Used by the Satori card renderer so its mana-cost glyphs and
// set-symbol render with the same fonts the live preview uses.
//
// Why parse the CSS instead of hardcoding the map:
//   * stays in sync with the installed mana-font version
//   * one source of truth — the same file the browser pulls from
//   * no need to maintain a parallel codepoint table by hand
//
// Why fs.readFileSync at module-import time:
//   * Vercel includes files referenced this way in the function bundle,
//     so the read works in production too
//   * happens once per cold start, never on the hot path
//   * Satori needs the binary as a Buffer/ArrayBuffer, not a stream
// ---------------------------------------------------------------------------

const MANA_FONT_PATH = path.join(
  process.cwd(),
  "node_modules",
  "mana-font",
  "fonts",
  "mana.ttf",
);

const MANA_CSS_PATH = path.join(
  process.cwd(),
  "node_modules",
  "mana-font",
  "css",
  "mana.css",
);

// MPlantin is the body-text font on real MTG cards. It ships alongside the
// Mana symbol font in the same npm package. We use it as the default font
// for the Satori bake so providing explicit `fonts: [...]` to ImageResponse
// doesn't strand the regular body text (Satori has no auto-fallback once
// you opt into custom fonts).
const MPLANTIN_FONT_PATH = path.join(
  process.cwd(),
  "node_modules",
  "mana-font",
  "fonts",
  "mplantin.ttf",
);

const KEYRUNE_FONT_PATH = path.join(
  process.cwd(),
  "node_modules",
  "keyrune",
  "fonts",
  "keyrune.ttf",
);

// CardDisplay — the title/type/footer/stat face: Beleren Bold, the face real
// cards use, vendored in public/fonts from the same non-commercial
// Full-Magic-Pack the frame trade dress comes from (see 12_CREATION_AUDIT.md).
// The family name + this path are the swap contract. Read with the same
// process.cwd()+literal-segments pattern as the node_modules fonts so
// @vercel/nft bundles it into the function.
const DISPLAY_FONT_PATH = path.join(
  process.cwd(),
  "public",
  "fonts",
  "Beleren-Bold.ttf",
);

// MPlantin Italic — the real italic master for flavor/reminder text. Satori
// has no synthetic italics, so without this the bake would render italic runs
// upright (or the browser-synthesized oblique wouldn't match the PNG).
const MPLANTIN_ITALIC_FONT_PATH = path.join(
  process.cwd(),
  "public",
  "fonts",
  "mplantin-italic.ttf",
);

export const MANA_FONT_BYTES: Buffer = fs.readFileSync(MANA_FONT_PATH);
export const MPLANTIN_FONT_BYTES: Buffer = fs.readFileSync(MPLANTIN_FONT_PATH);
export const MPLANTIN_ITALIC_FONT_BYTES: Buffer = fs.readFileSync(
  MPLANTIN_ITALIC_FONT_PATH,
);
export const KEYRUNE_FONT_BYTES: Buffer = fs.readFileSync(KEYRUNE_FONT_PATH);
export const DISPLAY_FONT_BYTES: Buffer = fs.readFileSync(DISPLAY_FONT_PATH);

// ---------------------------------------------------------------------------
// Per-color tints for the monochrome Mana font glyphs.
//
// The Mana font is single-color; the W/U/B/R/G/C colorization on a real
// pip comes from CSS variables (--ms-mana-w etc.) the live preview gets
// for free. Satori doesn't honor CSS variables, so we tint manually using
// the same hex values mana-font publishes.
// ---------------------------------------------------------------------------

export const MANA_GLYPH_COLOR: Record<string, string> = {
  w: "#fdfbce",
  u: "#bcdaf7",
  b: "#a7999e",
  r: "#f19b79",
  g: "#9fcba6",
  c: "#d0c6bb",
};

// ---------------------------------------------------------------------------
// Codepoint extraction
//
// mana.css blocks look like:
//   .ms-w::before {
//     content: "\e600";
//   }
//   .ms-w-original::before {
//     content: "\e997";
//   }
//
// Some blocks group multiple selectors:
//   .ms-e::before, .ms-energy::before {
//     content: "\e618";
//   }
//
// The regex below captures `(ms-<suffix>::before)` (one per selector in the
// list) and pairs it with the `\eXXX` codepoint inside the same block.
// ---------------------------------------------------------------------------

function buildManaCodepointMap(): Map<string, string> {
  const css = fs.readFileSync(MANA_CSS_PATH, "utf8");
  const map = new Map<string, string>();

  // Match a CSS block whose selectors include one or more `.ms-<suffix>::before`
  // entries, and whose body contains `content: "\<hex>"`.
  const blockPattern = /([^{}]+)\{[^}]*content:\s*"(\\[\da-f]+)"[^}]*\}/gi;

  for (const block of css.matchAll(blockPattern)) {
    const selectorList = block[1];
    const escaped = block[2]; // e.g. "\\e600"
    // The codepoint string the CSS uses includes the backslash; we want the
    // raw Unicode character so JSX can render it directly.
    const codepoint = String.fromCodePoint(parseInt(escaped.slice(1), 16));

    for (const sel of selectorList.split(",")) {
      const match = sel.match(/\.ms-([\w-]+)::before/);
      if (match) {
        map.set(match[1].toLowerCase(), codepoint);
      }
    }
  }

  return map;
}

const MANA_CODEPOINTS = buildManaCodepointMap();

/**
 * Resolve a mana-font class suffix (e.g. "w", "wu", "2", "tap", "wp") to the
 * Unicode character the font uses for that glyph. Returns null if the suffix
 * isn't a known mana-font class — callers should fall back to plain text.
 */
export function getManaCodepoint(suffix: string): string | null {
  return MANA_CODEPOINTS.get(suffix.toLowerCase()) ?? null;
}

/**
 * The Keyrune default glyph — what `<i class="ss"></i>` renders when no
 * specific set code is set. Used as the Phase-1 fallback set symbol until
 * users can pick a real set.
 */
export const KEYRUNE_DEFAULT_GLYPH: string = String.fromCodePoint(0xe684);

// ---------------------------------------------------------------------------
// Keyrune codepoints — same idea as the mana map: parse keyrune.css so the
// Satori bake renders the SAME set glyph the preview's `ss ss-{code}` class
// shows, instead of the generic default mark. Keyrune uses single-colon
// `:before` selectors (vs mana.css's `::before`), so the regex accepts both.
// ---------------------------------------------------------------------------

const KEYRUNE_CSS_PATH = path.join(
  process.cwd(),
  "node_modules",
  "keyrune",
  "css",
  "keyrune.css",
);

function buildKeyruneCodepointMap(): Map<string, string> {
  const css = fs.readFileSync(KEYRUNE_CSS_PATH, "utf8");
  const map = new Map<string, string>();
  const blockPattern = /([^{}]+)\{[^}]*content:\s*"(\\[\da-f]+)"[^}]*\}/gi;
  for (const block of css.matchAll(blockPattern)) {
    const codepoint = String.fromCodePoint(parseInt(block[2].slice(1), 16));
    for (const sel of block[1].split(",")) {
      const match = sel.match(/\.ss-([\w-]+):{1,2}before/);
      if (match) map.set(match[1].toLowerCase(), codepoint);
    }
  }
  return map;
}

const KEYRUNE_CODEPOINTS = buildKeyruneCodepointMap();

/** Resolve a Keyrune set code ("dom", "mh3", "ss-dom" also tolerated) to the
 *  font's glyph, or null when unknown — callers fall back to the default. */
export function getKeyruneCodepoint(setCode: string): string | null {
  const key = setCode.toLowerCase().replace(/^ss-/, "");
  return KEYRUNE_CODEPOINTS.get(key) ?? null;
}
