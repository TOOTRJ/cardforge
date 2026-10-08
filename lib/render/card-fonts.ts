import "server-only";

import fs from "node:fs";
import path from "node:path";
import { facesOf, type SlotFace } from "@/lib/cards/type-faces";

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

// MPlantin is the body-text font on real MTG cards. The file ships inside
// the mana-font npm package beside the Mana symbol font; the package's
// licence statement does not name it: its README licenses "the Mana font" (SIL OFL
// 1.1) and its CSS (MIT). The file's own name table says only "Converted by
// ALLTYPE" — no copyright line, no licence string — and no licence text
// accompanies it (docs/FRAMES.md "Provenance and legal"). We use it as the default font
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
// The file's own name table: "Beleren Bold", "Version P1.01", "Copyright (c)
// 2013 Wizards of the Coast, a Hasbro Subsidiary. All rights reserved.",
// "Beleren is a trademark of Wizards of the Coast."; no licence string, and
// no licence text accompanies it (docs/FRAMES.md "Provenance and legal").
// The family name + this path are the swap contract. Read with the same
// process.cwd()+literal-segments pattern as the node_modules fonts so
// @vercel/nft bundles it into the function.
const DISPLAY_FONT_PATH = path.join(
  process.cwd(),
  "public",
  "fonts",
  "Beleren-Bold.ttf",
);

// MPlantin Italic — the real italic master for flavor/reminder text (from
// the same Full-Magic-Pack; name table "Converted by ALLTYPE", no licence
// string, no licence text beside it). Satori
// has no synthetic italics, so without this the bake would render italic runs
// upright (or the browser-synthesized oblique wouldn't match the PNG).
const MPLANTIN_ITALIC_FONT_PATH = path.join(
  process.cwd(),
  "public",
  "fonts",
  "mplantin-italic.ttf",
);

// The collector line's face (TODO 4.9b): Montserrat Medium, subset to the
// 67 code points the line prints — every one of them in MPlantin's cmap, so
// registering it (in lib/render/card-image.tsx) can never lend a glyph to
// existing cards' text: Satori walks the requested families and then every
// registered font in registration order, and MPlantin comes first. It is
// registered BEFORE Keyrune, never last: a character NO font has (★, CJK,
// Thai — lib/render/fallback-assets.ts answers those with nothing) is drawn
// with the LAST registered font — its .notdef and advance, and the whole
// word in that face when the word starts with one — so the last font must
// stay the one it was before this face (Keyrune: an empty 1 em .notdef).
// Built by scripts/build-collector-font.mjs (OFL: public/fonts/
// Montserrat-OFL.txt); its metrics table is lib/cards/collector-metrics.ts.
const COLLECTOR_FONT_PATH = path.join(
  process.cwd(),
  "public",
  "fonts",
  "Montserrat-Medium.ttf",
);

export const MANA_FONT_BYTES: Buffer = fs.readFileSync(MANA_FONT_PATH);
export const MPLANTIN_FONT_BYTES: Buffer = fs.readFileSync(MPLANTIN_FONT_PATH);
export const MPLANTIN_ITALIC_FONT_BYTES: Buffer = fs.readFileSync(
  MPLANTIN_ITALIC_FONT_PATH,
);
export const KEYRUNE_FONT_BYTES: Buffer = fs.readFileSync(KEYRUNE_FONT_PATH);
export const DISPLAY_FONT_BYTES: Buffer = fs.readFileSync(DISPLAY_FONT_PATH);
export const COLLECTOR_FONT_BYTES: Buffer = fs.readFileSync(COLLECTOR_FONT_PATH);

// ---------------------------------------------------------------------------
// cardFonts — the Satori fonts array of ONE render (TODO 4.8.0; era design
// D16). renderCardImage registers what this returns, in this order, and
// nothing else:
//
//   MPlantin · MPlantin italic · CardDisplay · [a profile's own faces] ·
//   Mana · CollectorLine · Keyrune
//
// Today that is the same six for every profile — the two faces a slot can
// be set in (lib/cards/type-faces.ts: "body" = MPlantin, "display" =
// CardDisplay) are the two every card already draws (rules text, the brand
// mark), so no profile adds one. A face the repo gains later goes in
// EXTRA_FACE_FONTS and is registered ONLY for the profiles that name it, in
// the bracketed place: after CardDisplay and BEFORE Keyrune, never last —
// Satori resolves a character through the requested families and then every
// registered font in registration order, and draws a character NO font has
// with the LAST one (its .notdef box and advance; COLLECTOR_FONT_PATH above
// says why that must stay Keyrune). tests/unit/render/collector-font.test.ts
// reads this builder for every template and pins the order.
// ---------------------------------------------------------------------------

/** One Satori font registration (satori's `Font`, without importing it). */
export type CardFont = { name: string; data: Buffer; weight: 400 | 500; style: "normal" | "italic" };

/** Fonts of a face a slot can name that is NOT among the base six. None
 *  yet (owner decision 2026-10-07: no new typeface now). */
const EXTRA_FACE_FONTS: Partial<Record<SlotFace, readonly CardFont[]>> = {};

export function cardFonts(profile: Parameters<typeof facesOf>[0]): CardFont[] {
  const extras = facesOf(profile).flatMap((id) => EXTRA_FACE_FONTS[id] ?? []);
  return [
    // MPlantin is the real MTG body font (ships with mana-font); Mana +
    // Keyrune supply the cost pips and set symbol. Satori has no auto-
    // fallback once explicit fonts are provided, so all are registered.
    // A character none of these has goes to lib/render/fallback-assets.ts
    // (bundled Noto Sans for extra Latin/Greek/Cyrillic, emoji stripped,
    // other scripts drawn as missing glyphs) — never to the network.
    { name: "MPlantin", data: MPLANTIN_FONT_BYTES, weight: 400, style: "normal" },
    { name: "MPlantin", data: MPLANTIN_ITALIC_FONT_BYTES, weight: 400, style: "italic" },
    { name: "CardDisplay", data: DISPLAY_FONT_BYTES, weight: 400, style: "normal" },
    ...extras,
    { name: "Mana", data: MANA_FONT_BYTES, weight: 400, style: "normal" },
    // The collector line's face (TODO 4.9b) — after MPlantin and NEVER
    // last. Its glyphs are all in MPlantin's cmap, so no other run
    // resolves a character to it; and Satori draws a character NO font
    // has (★, CJK, Thai…) with the LAST registered font — its .notdef
    // box and advance, and the rest of a word that starts with one in
    // that face — so the last font must stay Keyrune, as it was before
    // this face (tests/unit/render/collector-font.test.ts).
    { name: "CollectorLine", data: COLLECTOR_FONT_BYTES, weight: 500, style: "normal" },
    { name: "Keyrune", data: KEYRUNE_FONT_BYTES, weight: 400, style: "normal" },
  ];
}

/** The TTF a single-line face is drawn from, for the bake's run measure
 *  (lib/render/satori-text.ts). */
export function faceFontBytes(face: SlotFace): Buffer {
  return face === "body" ? MPLANTIN_FONT_BYTES : DISPLAY_FONT_BYTES;
}

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
