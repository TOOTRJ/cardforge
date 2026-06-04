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

// CardDisplay — the title/type/footer/stat face: an OFL Goudy-derived display
// serif (Sorts Mill Goudy) vendored in public/fonts, standing in for the
// proprietary Beleren. Read with the same process.cwd()+literal-segments pattern
// as the node_modules fonts so @vercel/nft bundles it into the function.
const DISPLAY_FONT_PATH = path.join(
  process.cwd(),
  "public",
  "fonts",
  "SortsMillGoudy-Regular.ttf",
);

export const MANA_FONT_BYTES: Buffer = fs.readFileSync(MANA_FONT_PATH);
export const MPLANTIN_FONT_BYTES: Buffer = fs.readFileSync(MPLANTIN_FONT_PATH);
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
