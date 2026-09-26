import "server-only";

import fs from "node:fs";
import path from "node:path";
import type { Font } from "satori";
import { readCmap, withCmap } from "@/lib/render/font-cmap";
import { NOTO_SANS_GOOGLE_RANGES } from "@/lib/render/noto-fallback-ranges";

// ---------------------------------------------------------------------------
// Satori's `loadAdditionalAsset`, answered from disk — NEVER the network
// (TODO 6.16a). Satori calls it when a character is in none of the fonts a
// render registered, with the character's class ("emoji", "symbol", "math",
// "ja-JP", …, or "unknown") and the characters of that class.
//
// next/og's own loader answered from third parties on EVERY such render:
// emoji from Twemoji on jsDelivr, "unknown" (Latin/Greek/Cyrillic extras —
// "ǵ", a zero-width space…) from Noto Sans on fonts.googleapis.com, CJK and
// other scripts from their Noto families — the render-time twin of the
// 2026-09-22 next/font/google outage. Here:
//
//   * "unknown" → public/fonts/NotoSans-Fallback.ttf (Google's own Noto Sans
//     2.015, scripts/build-noto-fallback.mjs), with a cmap cut to what
//     Google's `text=` subset for the same request maps: the requested
//     characters inside Noto Sans' Google unicode-range, their canonical
//     pieces and the precomposed letters those pieces spell, plus U+0020 and
//     U+FE00. Outlines, advances and metrics are Google's, so a card that
//     used to pull Noto from Google bakes the same pixels.
//   * decomposed Latin/Greek/Cyrillic ("u" + U+0308) that satori files under
//     th-TH / he-IL / ja-JP → the same Noto Sans answer, under a family
//     name per class (isDecomposedLetterSegment below).
//   * "emoji" → a transparent square: emoji are stripped from the image
//     (Twemoji is 3,689 SVGs / 8.6 MB — not worth tracing into every render
//     function). lib/validation/card-glyphs.ts warns the author.
//   * everything else (symbols/math outside the card fonts, CJK, Thai,
//     Arabic, Hebrew, Indic scripts) → nothing: those characters draw blank
//     or as a missing-glyph box (symbols drew blank on main too, Google
//     reachable), and the author is warned the same way.
//
// Used by lib/render/satori-png.ts for the card bake AND the node OG images.
// ---------------------------------------------------------------------------

// Read with the process.cwd() + literal-segments pattern so @vercel/nft
// traces the file into the render functions (like lib/render/card-fonts.ts).
const NOTO_FALLBACK_PATH = path.join(process.cwd(), "public", "fonts", "NotoSans-Fallback.ttf");

let notoBytes: Buffer | null = null;
let notoCmap: Map<number, number> | null = null;
/** [precomposed code point, its NFD pieces] for every letter the fallback
 *  font can compose — Google's subsetter maps these when all the pieces are
 *  in the request's closure (e.g. asking for "ẫ" also maps "â" and "ã"). */
let compositions: Array<[number, number[]]> | null = null;

function noto(): { bytes: Buffer; cmap: Map<number, number>; compositions: Array<[number, number[]]> } {
  if (!notoBytes || !notoCmap || !compositions) {
    notoBytes = fs.readFileSync(NOTO_FALLBACK_PATH);
    notoCmap = readCmap(notoBytes);
    compositions = [];
    for (const cp of notoCmap.keys()) {
      const pieces = nfdPieces(cp);
      // Singletons (U+2126 → Ω) and mark-only sequences (U+0344) are not
      // pulled in by Google's closure; letters with marks are.
      if (pieces.length > 1 && !/^\p{M}/u.test(String.fromCodePoint(pieces[0]))) {
        compositions.push([cp, pieces]);
      }
    }
  }
  return { bytes: notoBytes, cmap: notoCmap, compositions };
}

function nfdPieces(cp: number): number[] {
  return Array.from(String.fromCodePoint(cp).normalize("NFD"), (c) => c.codePointAt(0) as number);
}

function inGoogleRange(cp: number): boolean {
  return NOTO_SANS_GOOGLE_RANGES.some(([start, end]) => cp >= start && cp <= end);
}

/** The code points Google's Noto Sans subset for this request text maps —
 *  null when Google would not have been asked at all (next/og's
 *  FontDetector only sends in-range characters to Noto Sans). */
export function notoRequestCodepoints(text: string): number[] | null {
  const asked = Array.from(text, (c) => c.codePointAt(0) as number).filter(inGoogleRange);
  if (asked.length === 0) return null;
  const { cmap, compositions: composable } = noto();
  const closure = new Set<number>();
  for (const cp of asked) {
    closure.add(cp);
    for (const piece of nfdPieces(cp)) closure.add(piece);
  }
  const mapped = new Set<number>([0x20, 0xfe00]);
  for (const cp of closure) mapped.add(cp);
  for (const [cp, pieces] of composable) {
    if (pieces.every((p) => closure.has(p))) mapped.add(cp);
  }
  return [...mapped].filter((cp) => cmap.has(cp)).sort((a, b) => a - b);
}

// Satori parses a font once per data object (a WeakMap), so the same
// request text reuses the same bytes. Bounded: a request font is ~190 KB.
const REQUEST_FONT_CACHE_SIZE = 16;
const requestFonts = new Map<string, Buffer | null>();

/** The fallback font shaped for one "unknown"-class request, or null. */
export function notoFontForText(text: string): Buffer | null {
  const hit = requestFonts.get(text);
  if (hit !== undefined) return hit;
  const codepoints = notoRequestCodepoints(text);
  let font: Buffer | null = null;
  if (codepoints) {
    const { bytes, cmap } = noto();
    font = withCmap(
      bytes,
      codepoints.map((cp) => [cp, cmap.get(cp) as number] as const),
    );
  }
  if (requestFonts.size >= REQUEST_FONT_CACHE_SIZE) {
    requestFonts.delete(requestFonts.keys().next().value as string);
  }
  requestFonts.set(text, font);
  return font;
}

/** What an emoji becomes on a bake: an invisible square of the text's size. */
export const STRIPPED_EMOJI_IMAGE = `data:image/svg+xml;base64,${Buffer.from(
  '<svg xmlns="http://www.w3.org/2000/svg" width="1" height="1" viewBox="0 0 1 1"/>',
).toString("base64")}`;

/** The family name the fallback registers under — referenced by no style, so
 *  it is only ever reached through Satori's per-character fallback. */
export const NOTO_FALLBACK_FAMILY = "PipGlyph Noto Sans fallback";

/** A grapheme of Latin / Greek / Cyrillic letters carrying combining marks —
 *  decomposed (NFD) text, e.g. "u" + U+0308, as pasted from a macOS file
 *  name. Satori files some of those marks under th-TH / he-IL / ja-JP (their
 *  script extensions), and next/og answered them from Noto Sans Thai /
 *  Hebrew / JP; they are Noto Sans characters, so they get the "unknown"
 *  answer rather than vanishing (a gap after the base letter). */
const DECOMPOSED_LETTERS =
  /^(?=[\s\S]*\p{M})[\p{sc=Latin}\p{sc=Greek}\p{sc=Cyrillic}\p{sc=Common}\p{sc=Inherited}]+$/u;

export function isDecomposedLetterSegment(segment: string): boolean {
  return DECOMPOSED_LETTERS.test(segment);
}

/**
 * Satori `loadAdditionalAsset` that never touches the network: see the file
 * header for what each character class resolves to.
 */
export async function loadLocalAdditionalAsset(
  languageCode: string,
  segment: string,
): Promise<string | Font[]> {
  if (languageCode === "emoji") return STRIPPED_EMOJI_IMAGE;
  if (languageCode !== "unknown" && !isDecomposedLetterSegment(segment)) return [];
  const data = notoFontForText(segment);
  // One family per class: satori consults only the first font registered
  // under a family name, so the th-TH and he-IL answers of one render (each
  // cut to its own request) must not share the "unknown" answer's name —
  // just as next/og's fonts were named per request.
  const name =
    languageCode === "unknown" ? NOTO_FALLBACK_FAMILY : `${NOTO_FALLBACK_FAMILY} ${languageCode}`;
  return data ? [{ name, data, weight: 400, style: "normal" }] : [];
}
