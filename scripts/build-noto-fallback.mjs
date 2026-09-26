// ---------------------------------------------------------------------------
// Regenerate public/fonts/NotoSans-Fallback.ttf + lib/render/noto-fallback-
// ranges.ts — the bake's LOCAL stand-in for the Google Fonts fetch that
// next/og used to make at render time (TODO 6.16a).
//
// Satori asks for extra glyphs when a character is in none of the registered
// fonts. It sorts such characters into classes (emoji, symbol, math, CJK,
// Thai, …, "unknown"); next/og answered the "unknown" class with Noto Sans
// from fonts.googleapis.com — for EVERY bake of a card with, say, "ǵ" in the
// artist line or a zero-width space in the flavor text. lib/render/
// fallback-assets.ts now answers it from this file instead.
//
// What this script does (DEV time only — nothing here runs during a render):
//   1. Downloads the exact font Google serves next/og: `css2?family=Noto+Sans`
//      as TTF (an old-Safari user agent gets TTF, like next/og's), and the
//      unicode-range list its FontDetector uses to decide which requested
//      characters Noto Sans may answer.
//   2. Keeps every code point Satori could ever request as the "unknown"
//      class (inside those ranges, and in no emoji/symbol/math/script class
//      — the same regexes as satori 0.25's language detector), their NFD
//      pieces, plus U+0020 and U+FE00, which every Google `text=` subset
//      maps. (Which of them a given request MAPS is decided per request in
//      lib/render/fallback-assets.ts, the way Google's subsetter does.)
//   3. Subsets with fontTools: glyph ORDER and outlines unchanged; layout
//      tables and hinting dropped (Google's per-request subsets for these
//      characters carry no kern pairs, and opentype.js reads nothing else).
//
//   node scripts/build-noto-fallback.mjs
//
// Needs network (Google Fonts) and Python 3 with fontTools
// (`python3 -m pip install fonttools`). Commit both outputs together, then
// run scripts/build-glyph-coverage.mjs (the creator's warnings read it);
// tests/unit/render/fallback-assets.test.ts pins the result.
// ---------------------------------------------------------------------------

import { execFileSync } from "node:child_process";
import { mkdtempSync, readFileSync, statSync, writeFileSync } from "node:fs";
import { createRequire } from "node:module";
import { tmpdir } from "node:os";
import path from "node:path";
import { isUnknownClass } from "./lib/glyph-coverage.mjs";

const require = createRequire(import.meta.url);
const fontkit = require("@pdf-lib/fontkit");

const FONT_OUT = path.resolve("public/fonts/NotoSans-Fallback.ttf");
const RANGES_OUT = path.resolve("lib/render/noto-fallback-ranges.ts");
// The two user agents next/og sends (FontDetector.load / loadGoogleFont).
const CHROME_UA =
  "Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/112.0.0.0 Safari/537.36";
const SAFARI_UA =
  "Mozilla/5.0 (Macintosh; U; Intel Mac OS X 10_6_8; de-at) AppleWebKit/533.21.1 (KHTML, like Gecko) Version/5.0.5 Safari/533.21.1";

async function text(url, ua) {
  const res = await fetch(url, { headers: { "User-Agent": ua } });
  if (!res.ok) throw new Error(`${url} → HTTP ${res.status}`);
  return res.text();
}

// 1. Ranges (FontDetector) and the full TTF (loadGoogleFont's format).
const rangesCss = await text("https://fonts.googleapis.com/css2?family=Noto+Sans&display=swap", CHROME_UA);
const ranges = [];
for (const [, list] of rangesCss.matchAll(/unicode-range:\s*(.+?);/gs)) {
  for (const part of list.split(", ")) {
    const [a, b] = part.replace(/U\+/g, "").split("-").map((h) => parseInt(h, 16));
    ranges.push([a, Number.isNaN(b) || b === undefined ? a : b]);
  }
}
const fullCss = await text("https://fonts.googleapis.com/css2?family=Noto+Sans", SAFARI_UA);
const ttfUrl = fullCss.match(/src: url\((.+?)\) format\('(?:opentype|truetype)'\)/)?.[1];
if (!ttfUrl) throw new Error("No TTF URL in the Google Fonts response");
const res = await fetch(ttfUrl);
if (!res.ok) throw new Error(`${ttfUrl} → HTTP ${res.status}`);
const dir = mkdtempSync(path.join(tmpdir(), "noto-fallback-"));
const fullPath = path.join(dir, "NotoSans-Regular.ttf");
writeFileSync(fullPath, Buffer.from(await res.arrayBuffer()));

// 2. Only satori's "unknown" class ever reaches Noto Sans (the other
//    classes — emoji, symbol, math, CJK, … — go to their own families).
const inRange = (cp) => ranges.some(([a, b]) => cp >= a && cp <= b);
const full = fontkit.create(readFileSync(fullPath));
const charset = new Set(full.characterSet);
const keep = full.characterSet.filter((cp) => inRange(cp) && isUnknownClass(cp));
// A Google subset also maps the canonical (NFD) pieces of what it was asked
// for — "ǵ" brings "g" + U+0301 — so those must exist here to be mapped.
const pieces = keep.flatMap((cp) =>
  [...String.fromCodePoint(cp).normalize("NFD")].map((c) => c.codePointAt(0)).filter((c) => charset.has(c)),
);
const unicodes = [...new Set([...keep, ...pieces, 0x20, 0xfe00])].sort((a, b) => a - b);
const unicodesFile = path.join(dir, "unicodes.txt");
writeFileSync(unicodesFile, unicodes.map((cp) => `U+${cp.toString(16).toUpperCase().padStart(4, "0")}`).join("\n"));

// 3. Subset (see the header for why each option).
execFileSync(
  "python3",
  [
    "-m", "fontTools.subset", fullPath,
    `--unicodes-file=${unicodesFile}`,
    "--layout-features=",
    "--drop-tables+=GSUB,GPOS,GDEF,STAT,gasp,DSIG",
    "--no-hinting",
    "--no-glyph-names",
    "--notdef-outline",
    "--no-recalc-bounds",
    "--no-recalc-timestamp",
    "--name-IDs=*",
    "--name-languages=*",
    `--output-file=${FONT_OUT}`,
  ],
  { stdio: "inherit" },
);

// Merge touching/overlapping ranges for the generated table.
const merged = [];
for (const [a, b] of [...ranges].sort((x, y) => x[0] - y[0])) {
  const last = merged[merged.length - 1];
  if (last && a <= last[1] + 1) last[1] = Math.max(last[1], b);
  else merged.push([a, b]);
}
const hex = (n) => `0x${n.toString(16).toUpperCase()}`;
writeFileSync(
  RANGES_OUT,
  `// GENERATED by scripts/build-noto-fallback.mjs — do not edit by hand.
//
// The unicode-range union Google Fonts declares for Noto Sans
// (css2?family=Noto+Sans), i.e. the characters next/og's FontDetector would
// send to Google as a Noto Sans request. lib/render/fallback-assets.ts uses
// it to answer exactly the requests Google would have answered.
export const NOTO_SANS_GOOGLE_RANGES: ReadonlyArray<readonly [number, number]> = [
${merged.map(([a, b]) => `  [${hex(a)}, ${hex(b)}],`).join("\n")}
];
`,
);

console.log(
  `${path.relative(process.cwd(), FONT_OUT)}: ${unicodes.length} code points, ${statSync(FONT_OUT).size} bytes`,
);
console.log(`${path.relative(process.cwd(), RANGES_OUT)}: ${merged.length} ranges`);
