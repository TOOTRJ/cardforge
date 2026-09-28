// ---------------------------------------------------------------------------
// Keyrune set-symbol metrics (TODO 4.20, layout v32). Shared by
// scripts/generate-keyrune-metrics.mjs (writes lib/cards/keyrune-metrics.ts)
// and the unit test that keeps the generated table in step with the installed
// keyrune package.
//
// Both renderers draw a preset set symbol from node_modules/keyrune: the
// preview through keyrune.css's `ss ss-{code}` classes, the bake from
// keyrune.ttf with the codepoint lib/render/card-fonts.ts parses out of the
// same CSS. The table gives the client-safe size helper
// (lib/cards/set-symbol-size.ts) each glyph's advance — the width both
// renderers lay it out at — and its INK box, so a glyph can be fitted to the
// set-symbol box by what it draws rather than by its em.
// ---------------------------------------------------------------------------

import { readFileSync } from "node:fs";
import { createRequire } from "node:module";
import path from "node:path";

const require = createRequire(import.meta.url);
const fontkit = require("@pdf-lib/fontkit");

export const KEYRUNE_FILES = {
  pkg: "node_modules/keyrune/package.json",
  css: "node_modules/keyrune/css/keyrune.css",
  ttf: "node_modules/keyrune/fonts/keyrune.ttf",
};

/**
 * Set code → codepoint, parsed exactly as getKeyruneCodepoint's map is
 * (lib/render/card-fonts.ts): every rule with a `content: "\hex"`, every
 * `.ss-{code}:before` / `::before` selector in it, a later rule winning.
 */
export function parseKeyruneCodes(css) {
  const map = new Map();
  const blockPattern = /([^{}]+)\{[^}]*content:\s*"(\\[\da-f]+)"[^}]*\}/gi;
  for (const block of css.matchAll(blockPattern)) {
    const codepoint = parseInt(block[2].slice(1), 16);
    for (const sel of block[1].split(",")) {
      const match = sel.match(/\.ss-([\w-]+):{1,2}before/);
      if (match) map.set(match[1].toLowerCase(), codepoint);
    }
  }
  return map;
}

/** The glyph a bare `.ss` draws (`.ss:before`) — the default mark. */
export function parseKeyruneDefault(css) {
  const match = css.match(/(?:^|\})\s*\.ss:{1,2}before\s*\{[^}]*content:\s*"\\([\da-f]+)"/i);
  if (!match) throw new Error("keyrune.css: no .ss:before rule");
  return parseInt(match[1], 16);
}

/**
 * The exact ink box of an outline: its on-curve points plus every curve's
 * extrema. (fontkit's and opentype.js's own bounds are each off by up to 6
 * units on a few keyrune glyphs' left or right edge — M20's among them.)
 * `commands` are fontkit path commands: { command, args }.
 */
export function outlineBox(commands) {
  let x0 = Infinity;
  let y0 = Infinity;
  let x1 = -Infinity;
  let y1 = -Infinity;
  const add = (x, y) => {
    x0 = Math.min(x0, x);
    x1 = Math.max(x1, x);
    y0 = Math.min(y0, y);
    y1 = Math.max(y1, y);
  };
  // Where a quadratic (p0, p1, p2) or cubic (p0, p1, p2, p3) has a turning
  // point on 0 < t < 1, per axis.
  const quadT = (p0, p1, p2) => {
    const d = p0 - 2 * p1 + p2;
    return d === 0 ? [] : [(p0 - p1) / d];
  };
  const cubicT = (p0, p1, p2, p3) => {
    const a = -p0 + 3 * p1 - 3 * p2 + p3;
    const b = 2 * (p0 - 2 * p1 + p2);
    const c = p1 - p0;
    if (Math.abs(a) < 1e-12) return b === 0 ? [] : [-c / b];
    const disc = b * b - 4 * a * c;
    if (disc < 0) return [];
    const s = Math.sqrt(disc);
    return [(-b + s) / (2 * a), (-b - s) / (2 * a)];
  };
  let cx = 0;
  let cy = 0;
  for (const { command, args } of commands) {
    if (command === "moveTo" || command === "lineTo") {
      [cx, cy] = args;
      add(cx, cy);
    } else if (command === "quadraticCurveTo") {
      const [qx, qy, x, y] = args;
      const at = (t, p0, p1, p2) => (1 - t) ** 2 * p0 + 2 * (1 - t) * t * p1 + t * t * p2;
      for (const t of [...quadT(cx, qx, x), ...quadT(cy, qy, y)]) {
        if (t > 0 && t < 1) add(at(t, cx, qx, x), at(t, cy, qy, y));
      }
      add(x, y);
      [cx, cy] = [x, y];
    } else if (command === "bezierCurveTo") {
      const [ax, ay, bx, by, x, y] = args;
      const at = (t, p0, p1, p2, p3) =>
        (1 - t) ** 3 * p0 + 3 * (1 - t) ** 2 * t * p1 + 3 * (1 - t) * t * t * p2 + t ** 3 * p3;
      for (const t of [...cubicT(cx, ax, bx, x), ...cubicT(cy, ay, by, y)]) {
        if (t > 0 && t < 1) add(at(t, cx, ax, bx, x), at(t, cy, ay, by, y));
      }
      add(x, y);
      [cx, cy] = [x, y];
    }
  }
  return { minX: x0, minY: y0, maxX: x1, maxY: y1 };
}

/**
 * The table: units per em, set code → codepoint, and per codepoint
 * [advance, xMin, yMin, xMax, yMax] in font units — the advance from hmtx,
 * the ink box from the glyph's outline (outlineBox), rounded OUTWARD to
 * whole units so a glyph fitted by its ink never draws past the box it was
 * fitted to.
 */
export function computeKeyruneMetrics(root) {
  const at = (file) => path.join(root, file);
  const css = readFileSync(at(KEYRUNE_FILES.css), "utf8");
  const version = JSON.parse(readFileSync(at(KEYRUNE_FILES.pkg), "utf8")).version;
  const font = fontkit.create(readFileSync(at(KEYRUNE_FILES.ttf)));
  const codes = parseKeyruneCodes(css);
  const defaultCodepoint = parseKeyruneDefault(css);
  const glyphs = new Map();
  for (const cp of [defaultCodepoint, ...codes.values()]) {
    if (glyphs.has(cp)) continue;
    const glyph = font.glyphForCodePoint(cp);
    if (!glyph || glyph.id === 0) throw new Error(`keyrune.ttf has no glyph for U+${cp.toString(16)}`);
    const bb = outlineBox(glyph.path.commands);
    glyphs.set(cp, [
      glyph.advanceWidth,
      Math.floor(bb.minX),
      Math.floor(bb.minY),
      Math.ceil(bb.maxX),
      Math.ceil(bb.maxY),
    ]);
  }
  return {
    version,
    unitsPerEm: font.unitsPerEm,
    defaultCodepoint,
    codes: [...codes.entries()].sort(([a], [b]) => (a < b ? -1 : a > b ? 1 : 0)),
    glyphs: [...glyphs.entries()].sort(([a], [b]) => a - b),
  };
}

const hex = (n) => `0x${n.toString(16).toUpperCase()}`;
const key = (code) => (/^[a-z_$][\w$]*$/i.test(code) ? code : JSON.stringify(code));

function packed(items, perLine) {
  const lines = [];
  for (let i = 0; i < items.length; i += perLine) lines.push(`  ${items.slice(i, i + perLine).join(", ")},`);
  return lines.join("\n");
}

/** Source of lib/cards/keyrune-metrics.ts. */
export function renderKeyruneMetricsModule({ version, unitsPerEm, defaultCodepoint, codes, glyphs }) {
  return `// GENERATED by scripts/generate-keyrune-metrics.mjs from node_modules/keyrune
// ${version} — do not edit by hand (tests/unit/cards/keyrune-metrics.test.ts
// fails when it drifts from the installed package: regenerate after a keyrune
// upgrade with \`node scripts/generate-keyrune-metrics.mjs\`).
//
// Keyrune's set glyphs as both renderers draw them (the preview's
// \`ss ss-{code}\` classes, the bake's keyrune.ttf): which glyph a set code
// selects, the advance it is laid out at, and the box its ink fills — read by
// lib/cards/set-symbol-size.ts. Client-safe (no fs).

/** The keyrune package the table was read from. */
export const KEYRUNE_VERSION = ${JSON.stringify(version)};

/** Font units per em of keyrune.ttf. */
export const KEYRUNE_UNITS_PER_EM = ${unitsPerEm};

/** The glyph a bare \`.ss\` draws — the bake's fallback for an unknown code
 *  (KEYRUNE_DEFAULT_GLYPH in lib/render/card-fonts.ts). */
export const KEYRUNE_DEFAULT_CODEPOINT = ${hex(defaultCodepoint)};

/** Set code → codepoint, as keyrune.css's \`.ss-{code}:before\` rules map it
 *  (the same parse as getKeyruneCodepoint). */
export const KEYRUNE_CODEPOINTS: Readonly<Record<string, number>> = {
${packed(
  codes.map(([code, cp]) => `${key(code)}: ${hex(cp)}`),
  6,
)}
};

/** Codepoint → [advance, xMin, yMin, xMax, yMax] in font units: the advance
 *  both renderers lay the glyph out at, and its ink box rounded outward. */
export const KEYRUNE_GLYPHS: Readonly<Record<number, readonly [number, number, number, number, number]>> = {
${packed(
  glyphs.map(([cp, m]) => `${hex(cp)}: [${m.join(", ")}]`),
  4,
)}
};
`;
}
