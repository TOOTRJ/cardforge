// ---------------------------------------------------------------------------
// The card faces' metric tables (TODO 3.20 / 4.8.0). Shared by
// scripts/generate-font-metrics.mjs (writes lib/cards/font-metrics.ts) and
// the unit test that keeps the generated module in step with the committed
// fonts (tests/unit/cards/font-metrics.test.ts).
//
// Until 4.8.0 these numbers were kept BY HAND in three modules —
// lib/cards/display-metrics.ts (Beleren Bold's advances and the pairs it
// kerns apart), lib/cards/stat-fit.ts (its advances, side bearings and the
// kerning between stat characters) and lib/cards/rules-metrics.ts (MPlantin's
// advances through Latin Extended-A, its ink above / below the baseline and
// its side ink, both masters) — each held to its TTF by a test. They are now
// ONE generated module, one entry per face, and those three modules read it:
// a face is measured by the same rules whichever face it is, so a slot can
// be set in any face the repo has (lib/cards/type-faces.ts) and a new face
// is a line in FONT_METRIC_FACES plus a regenerate, never a hand table.
//
// What every rule below reproduces is written beside it; the test holds the
// output to a frozen copy of the hand tables (tests/unit/cards/fixtures/
// font-metrics-hand-kept.json), so "regenerating today's must reproduce
// them" is checked on every run.
// ---------------------------------------------------------------------------

import { readFileSync } from "node:fs";
import { createRequire } from "node:module";
import path from "node:path";

const require = createRequire(import.meta.url);
const opentype = require("opentype.js");

/** The faces the tables are generated for, by the id the code reads them
 *  under. `display` = the CardDisplay face; `body` / `bodyItalic` = MPlantin's
 *  two masters. The body master is read from public/fonts (the bytes the
 *  browser is served; the bake's node_modules/mana-font copy is the same
 *  file — lib/render/card-fonts.ts, tests/unit/render/card-fonts.test.ts). */
export const FONT_METRIC_FACES = {
  display: "public/fonts/Beleren-Bold.ttf",
  body: "public/fonts/mplantin.ttf",
  bodyItalic: "public/fonts/mplantin-italic.ttf",
};

const ASCII = Array.from({ length: 0x7f - 0x20 }, (_, i) => String.fromCharCode(0x20 + i));
/** The typographic punctuation names and type lines use. */
const PUNCTUATION = [..."‘’“”–—•…−"];
/** The typographic punctuation the rules layout measures (U+2212 is set as
 *  a hyphen there: lib/cards/rules-box.ts rulesWordText). */
const RULES_PUNCTUATION = [..."‘’“”–—•…"];
/** What a stat value can hold besides printable ASCII. */
const STAT_EXTRA = [..."½∞−–—×"];
/** The characters stat kerning is listed between (both renderers kern a
 *  value; pairs with other letters are left out — lib/cards/stat-fit.ts). */
const STAT_KERN_CHARS = [..."0123456789+-*/Xx½∞−–—×."];
const LATIN_START = 0xa0;
const LATIN_END = 0x17f;
const LATIN = Array.from({ length: LATIN_END - LATIN_START + 1 }, (_, i) => String.fromCharCode(LATIN_START + i));

function parse(root, file) {
  const buf = readFileSync(path.join(root, file));
  return opentype.parse(buf.buffer.slice(buf.byteOffset, buf.byteOffset + buf.byteLength));
}

/** Control-point bounds of a glyph ([xMin, yMin, xMax, yMax]); null for a
 *  glyph with no outline (a space, an empty placeholder glyph). */
function controlBox(glyph) {
  const m = glyph.getMetrics();
  if (!Number.isFinite(m.xMin) || (m.yMin === 0 && m.yMax === 0 && glyph.getBoundingBox().x2 === 0)) return null;
  return [m.xMin, m.yMin, m.xMax, m.yMax];
}

/**
 * One face as a LINE face — what a single-line fit, the stat fit and a
 * band's baseline need of it (lib/cards/display-metrics.ts, stat-fit.ts,
 * type-faces.ts):
 *   - hhea ascender / descender / lineGap and units per em;
 *   - the advance of printable ASCII (code-point order) and of the
 *     typographic punctuation the face HAS (MPlantin has no U+2212);
 *   - every ASCII pair the face kerns APART, in thousandths of an em rounded
 *     up (the browser applies them, so a measured line counts them; the pairs
 *     it tightens are left out — an upper bound for both renderers);
 *   - [advance, left bearing, right bearing] of every stat glyph the face
 *     has, and the kerning between stat characters, in font units.
 */
function lineFace(font) {
  const upm = font.unitsPerEm;
  const adv = (ch) => font.charToGlyph(ch).advanceWidth;
  const kernPerMille = (pair) =>
    font.getAdvanceWidth(pair, 1000, { kerning: true }) - font.getAdvanceWidth(pair, 1000, { kerning: false });
  const kernWidening = {};
  for (const a of ASCII) {
    const entries = [];
    for (const b of ASCII) {
      const k = kernPerMille(a + b);
      if (k > 0) entries.push(`${b}${Math.ceil(k - 1e-9)}`);
    }
    if (entries.length) kernWidening[a] = entries.join(" ");
  }
  const statGlyphs = {};
  for (const ch of [...ASCII, ...STAT_EXTRA]) {
    if (!font.hasChar(ch)) continue;
    const glyph = font.charToGlyph(ch);
    const m = glyph.getMetrics();
    const inkless = !Number.isFinite(m.xMin) || glyph.getBoundingBox().x2 === glyph.getBoundingBox().x1;
    statGlyphs[ch] = [glyph.advanceWidth, inkless ? 0 : m.xMin, inkless ? 0 : glyph.advanceWidth - m.xMax];
  }
  const statKerning = {};
  const kernChars = STAT_KERN_CHARS.filter((ch) => font.hasChar(ch));
  for (const a of kernChars) {
    for (const b of kernChars) {
      const k = font.getKerningValue(font.charToGlyph(a), font.charToGlyph(b));
      if (k) statKerning[a + b] = k;
    }
  }
  const sorted = (obj) => Object.fromEntries(Object.entries(obj).sort(([a], [b]) => (a < b ? -1 : a > b ? 1 : 0)));
  return {
    unitsPerEm: upm,
    ascender: font.ascender,
    descender: -font.descender,
    lineGap: font.tables.hhea.lineGap,
    asciiAdvanceUnits: ASCII.map(adv),
    extraAdvanceUnits: Object.fromEntries(PUNCTUATION.filter((ch) => font.hasChar(ch)).map((ch) => [ch, adv(ch)])),
    kernWidening,
    statGlyphs,
    statKerning: sorted(statKerning),
  };
}

/** A body master's own tables (lib/cards/rules-metrics.ts): the advance of
 *  the rules punctuation and of Latin-1 and Latin Extended-A in code-point
 *  order (−1 where the face has no glyph — a fallback face draws it), and
 *  the glyphs that ink past their advance box ([left of the origin, right of
 *  the advance], per mille). */
function bodyFace(font, drawnByBoth) {
  const perMille = (units) => (units * 1000) / font.unitsPerEm;
  const latinAdvancePerMille = LATIN.map((ch) => (font.hasChar(ch) ? perMille(font.charToGlyph(ch).advanceWidth) : -1));
  const sideInkPerMille = {};
  for (const ch of drawnByBoth) {
    const glyph = font.charToGlyph(ch);
    const box = glyph.getBoundingBox();
    if (box.x1 === 0 && box.x2 === 0) continue; // no outline
    const left = Math.ceil(perMille(Math.max(0, -box.x1)) - 1e-9);
    const right = Math.ceil(perMille(Math.max(0, box.x2 - glyph.advanceWidth)) - 1e-9);
    if (left || right) sideInkPerMille[ch] = [left, right];
  }
  const extraAdvancePerMille = Object.fromEntries(
    RULES_PUNCTUATION.map((ch) => [ch, perMille(font.charToGlyph(ch).advanceWidth)]),
  );
  return { extraAdvancePerMille, latinAdvancePerMille, sideInkPerMille };
}

/** The letters' default ink band (em × 1000): every letter and digit of both
 *  body masters stays within it (lib/cards/rules-metrics.ts DEFAULT_INK). */
const DEFAULT_INK_PER_MILLE = [700, 200];

/**
 * The body faces' shared VERTICAL ink — the larger of the two masters'
 * bounds, for every character both draw:
 *   - `inkPerMille`: the characters that reach past the default band, their
 *     control-point bounds per mille, each side floored at the band;
 *   - `glyphInk`: each glyph's own outline, above and below the baseline, in
 *     hundredths of an em rounded UP, grouped by value ([characters, ascent,
 *     descent], sorted by ascent then descent, characters in the order
 *     ASCII, punctuation, Latin).
 */
function bodyInk(regular, italic, drawnByBoth) {
  const faces = [regular, italic];
  const inkPerMille = {};
  const groups = new Map();
  for (const ch of drawnByBoth) {
    let ascent = 0;
    let descent = 0;
    let outAscent = 0;
    let outDescent = 0;
    for (const face of faces) {
      const glyph = face.charToGlyph(ch);
      const control = controlBox(glyph);
      if (control) {
        ascent = Math.max(ascent, (control[3] * 1000) / face.unitsPerEm);
        descent = Math.max(descent, (-control[1] * 1000) / face.unitsPerEm);
      }
      const box = glyph.getBoundingBox();
      outAscent = Math.max(outAscent, box.y2 / face.unitsPerEm);
      outDescent = Math.max(outDescent, -box.y1 / face.unitsPerEm);
    }
    const a = Math.ceil(ascent - 1e-9);
    const d = Math.ceil(descent - 1e-9);
    if (a > DEFAULT_INK_PER_MILLE[0] || d > DEFAULT_INK_PER_MILLE[1]) {
      inkPerMille[ch] = [Math.max(a, DEFAULT_INK_PER_MILLE[0]), Math.max(d, DEFAULT_INK_PER_MILLE[1])];
    }
    const key = `${Math.ceil(outAscent * 100 - 1e-9)},${Math.ceil(outDescent * 100 - 1e-9)}`;
    groups.set(key, [...(groups.get(key) ?? []), ch]);
  }
  const glyphInk = [...groups.entries()]
    .map(([key, chars]) => {
      const [a, d] = key.split(",").map(Number);
      return [chars.join(""), a, d];
    })
    .sort((x, y) => x[1] - y[1] || x[2] - y[2]);
  return { inkPerMille, glyphInk };
}

/** Every table of lib/cards/font-metrics.ts, from the committed fonts under
 *  `root`. */
export function computeFontMetrics(root) {
  const fonts = Object.fromEntries(Object.entries(FONT_METRIC_FACES).map(([id, file]) => [id, parse(root, file)]));
  // The characters BOTH body masters draw with their own glyph: printable
  // ASCII but the space, the rules punctuation and U+00A1–U+017F.
  const drawnByBoth = [...ASCII.slice(1), ...RULES_PUNCTUATION, ...LATIN.slice(1)].filter(
    (ch) => fonts.body.hasChar(ch) && fonts.bodyItalic.hasChar(ch),
  );
  return {
    files: FONT_METRIC_FACES,
    line: Object.fromEntries(Object.entries(fonts).map(([id, font]) => [id, lineFace(font)])),
    body: {
      regular: bodyFace(fonts.body, drawnByBoth),
      italic: bodyFace(fonts.bodyItalic, drawnByBoth),
      ...bodyInk(fonts.body, fonts.bodyItalic, drawnByBoth),
    },
  };
}

// ---------------------------------------------------------------------------
// The module's source.
// ---------------------------------------------------------------------------

const BARE_KEY = /^[A-Za-z_$][A-Za-z0-9_$]*$/;
const key = (k) => (BARE_KEY.test(k) ? k : JSON.stringify(k));

function packed(items, perLine, indent = "    ") {
  const lines = [];
  for (let i = 0; i < items.length; i += perLine) lines.push(`${indent}${items.slice(i, i + perLine).join(", ")},`);
  return lines.join("\n");
}

const record = (obj, value, perLine, indent) =>
  packed(
    Object.entries(obj).map(([k, v]) => `${key(k)}: ${value(v)}`),
    perLine,
    indent,
  );

function lineFaceSource(id, file, face) {
  return `  ${id}: {
    file: ${JSON.stringify(file)},
    unitsPerEm: ${face.unitsPerEm},
    ascender: ${face.ascender},
    descender: ${face.descender},
    lineGap: ${face.lineGap},
    asciiAdvanceUnits: [
${packed(face.asciiAdvanceUnits.map(String), 16, "      ")}
    ],
    extraAdvanceUnits: {
${record(face.extraAdvanceUnits, String, 9, "      ")}
    },
    kernWidening: {
${Object.entries(face.kernWidening)
  .map(([k, v]) => `      ${key(k)}: ${JSON.stringify(v)},`)
  .join("\n")}
    },
    statGlyphs: {
${record(face.statGlyphs, (v) => `[${v.join(", ")}]`, 6, "      ")}
    },
    statKerning: {
${record(face.statKerning, String, 8, "      ")}
    },
  },`;
}

function bodyFaceSource(id, face) {
  return `  ${id}: {
    extraAdvancePerMille: {
${record(face.extraAdvancePerMille, String, 9, "      ")}
    },
    latinAdvancePerMille: [
${packed(face.latinAdvancePerMille.map(String), 16, "      ")}
    ],
    sideInkPerMille: {
${record(face.sideInkPerMille, (v) => `[${v.join(", ")}]`, 8, "      ")}
    },
  },`;
}

/** Source of lib/cards/font-metrics.ts. */
export function renderFontMetricsModule({ files, line, body }) {
  return `// GENERATED by scripts/generate-font-metrics.mjs from the committed fonts —
// do not edit by hand (tests/unit/cards/font-metrics.test.ts fails when it
// drifts from them: regenerate with \`node scripts/generate-font-metrics.mjs\`
// after a font file changes or a face is added to FONT_METRIC_FACES in
// scripts/lib/font-metrics.mjs, which also says how each table is derived).
//
// The card faces' metric tables (TODO 3.20 / 4.8.0) — one entry per face, so
// the client preview and the server bake measure a line with the SAME
// numbers and no font is parsed at runtime. Read through
// lib/cards/display-metrics.ts (single-line fits), lib/cards/stat-fit.ts
// (stat values), lib/cards/rules-metrics.ts (the rules layout) and
// lib/cards/type-faces.ts (which face a slot is set in). Client-safe (no fs).

/** One face as a single-line face: hhea, the advances of printable ASCII
 *  (U+0020–U+007E in code-point order) and of the typographic punctuation
 *  the face has, the ASCII pairs it kerns APART (left character →
 *  "<right><thousandths of an em>" entries), and each stat glyph's
 *  [advance, left bearing, right bearing] with the kerning between stat
 *  characters — font units unless said otherwise. */
export type LineFaceMetrics = {
  readonly file: string;
  readonly unitsPerEm: number;
  /** hhea ascender / descender (positive) / lineGap. */
  readonly ascender: number;
  readonly descender: number;
  readonly lineGap: number;
  readonly asciiAdvanceUnits: readonly number[];
  readonly extraAdvanceUnits: Readonly<Record<string, number>>;
  readonly kernWidening: Readonly<Record<string, string>>;
  readonly statGlyphs: Readonly<Record<string, readonly [number, number, number]>>;
  readonly statKerning: Readonly<Record<string, number>>;
};

export type LineFaceId = ${Object.keys(line)
    .map((id) => JSON.stringify(id))
    .join(" | ")};

export const LINE_FACE_METRICS: Readonly<Record<LineFaceId, LineFaceMetrics>> = {
${Object.entries(line)
  .map(([id, face]) => lineFaceSource(id, files[id], face))
  .join("\n")}
};

/** A body master's own tables: the advance of the rules punctuation and of
 *  U+00A0–U+017F in code-point order, thousandths of an em (−1: the face has
 *  no glyph there), and the glyphs that ink past their advance box,
 *  [left, right] per mille. */
export type BodyFaceMetrics = {
  readonly extraAdvancePerMille: Readonly<Record<string, number>>;
  readonly latinAdvancePerMille: readonly number[];
  readonly sideInkPerMille: Readonly<Record<string, readonly [number, number]>>;
};

export const BODY_FACE_METRICS: Readonly<Record<"regular" | "italic", BodyFaceMetrics>> = {
${bodyFaceSource("regular", body.regular)}
${bodyFaceSource("italic", body.italic)}
};

/** The characters both body masters draw past the letters' 0.70 / 0.20 em
 *  band: the larger of the two masters' bounds, [above, below] the baseline
 *  per mille. */
export const BODY_INK_PER_MILLE: Readonly<Record<string, readonly [number, number]>> = {
${record(body.inkPerMille, (v) => `[${v.join(", ")}]`, 6, "  ")}
};

/** Each glyph's own ink above and below the baseline, hundredths of an em
 *  rounded UP (the larger of the two masters' outlines): [characters,
 *  ascent, descent]. */
export const BODY_GLYPH_INK: readonly (readonly [string, number, number])[] = [
${packed(
  body.glyphInk.map(([chars, a, d]) => `[${JSON.stringify(chars)}, ${a}, ${d}]`),
  5,
  "  ",
)}
];
`;
}
