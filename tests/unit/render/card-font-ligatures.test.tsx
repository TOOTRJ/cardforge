// @vitest-environment happy-dom
import { readFileSync } from "node:fs";
import { join } from "node:path";
// @ts-expect-error -- opentype.js (a dev dependency) ships no type declarations.
import opentype from "opentype.js";
import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it, vi } from "vitest";
import { CardPreview, type CardPreviewData } from "@/components/cards/card-preview";

vi.mock("@/lib/cards/drawable-media", () => ({ drawableCardMedia: <T,>(card: T) => card }));

// ---------------------------------------------------------------------------
// Ligatures: the browser preview forms a font's GSUB 'liga' ligatures by
// default, the Satori bake never does. Beleren (CardDisplay) has two — ffi
// and ffl — so a line with no letter-spacing (a type line) holding "Griffin",
// "Officer" or "Shuffler" drew another glyph in the preview, 0.095 em (ffi) /
// 0.15 em (ffl) shorter than the three kerned letters, and the rest of the
// line sat left of the stored image's (tests/parity "@ffi-ligature",
// "@ffl-ligature" hold the pixels). The preview therefore sets
// `font-variant-ligatures: none` on its root. This file holds the two facts
// that fix rests on:
//   • which ligatures the card's faces HAVE — a replaced or re-exported font
//     with more of them (fi, fl, a discretionary set) fails here, and whoever
//     replaces it measures the bake before trusting the preview;
//   • the preview's root switches them off and nothing inside it switches
//     them back on (nor touches kerning, which both renderers apply).
// ---------------------------------------------------------------------------

type Coverage = { format: number; glyphs?: number[]; ranges?: { start: number; end: number }[] };
type Gsub = {
  features: { tag: string; feature: { lookupListIndexes: number[] } }[];
  lookups: {
    lookupType: number;
    subtables: { coverage?: Coverage; ligatureSets?: { ligGlyph: number; components: number[] }[][]; extension?: unknown }[];
  }[];
};
type Font = {
  tables: { gsub?: Gsub };
  glyphs: { get(index: number): { unicode?: number; name?: string } };
};

const parse = (file: string): Font => {
  const buf = readFileSync(join(process.cwd(), "public/fonts", file));
  return opentype.parse(buf.buffer.slice(buf.byteOffset, buf.byteOffset + buf.byteLength));
};

const covered = (coverage: Coverage): number[] =>
  coverage.format === 1
    ? (coverage.glyphs ?? [])
    : (coverage.ranges ?? []).flatMap((r) => Array.from({ length: r.end - r.start + 1 }, (_, i) => r.start + i));

/** Every ligature of the features a browser may form by itself or through
 *  `font-variant-ligatures` (liga, clig on by default; dlig, hlig, rlig),
 *  spelled as the letters it replaces. */
function ligaturesOf(font: Font): string[] {
  const gsub = font.tables.gsub;
  if (!gsub) return [];
  const letter = (glyph: number) => {
    const g = font.glyphs.get(glyph);
    return g.unicode ? String.fromCodePoint(g.unicode) : `<${g.name ?? glyph}>`;
  };
  const found = new Set<string>();
  for (const { tag, feature } of gsub.features) {
    if (!["liga", "clig", "dlig", "hlig", "rlig"].includes(tag)) continue;
    for (const index of feature.lookupListIndexes) {
      const lookup = gsub.lookups[index];
      // Anything but a plain ligature lookup would need reading by hand.
      expect(lookup.lookupType, `${tag} lookup ${index}`).toBe(4);
      for (const subtable of lookup.subtables) {
        const first = covered(subtable.coverage!);
        (subtable.ligatureSets ?? []).forEach((set, i) => {
          for (const ligature of set) found.add([first[i], ...ligature.components].map(letter).join(""));
        });
      }
    }
  }
  return [...found].sort();
}

describe("the card faces' ligatures", () => {
  it("Beleren has exactly ffi and ffl; MPlantin and the collector face have none", () => {
    expect(ligaturesOf(parse("Beleren-Bold.ttf"))).toEqual(["ffi", "ffl"]);
    for (const file of ["mplantin.ttf", "mplantin-italic.ttf", "Montserrat-Medium.ttf"]) {
      expect(parse(file).tables.gsub, file).toBeUndefined();
    }
  });
});

describe("the preview", () => {
  const card = {
    title: "Baffling Griffin Officer",
    cost: "{1}{W}",
    cardType: "creature",
    supertype: "Legendary",
    subtypes: ["Griffin", "Shuffler"],
    rarity: "rare",
    colorIdentity: ["white"],
    rulesText: "Flying\nWhen Baffling Griffin Officer enters, shuffle your library.",
    flavorText: "An efficient waffle.",
    power: "2",
    toughness: "2",
    loyalty: null,
    defense: null,
    artistCredit: "Anya Vale",
    artUrl: null,
    artPosition: {},
    frameStyle: { template: "m15", finish: "regular", collector: "2015" },
    setIconUrl: null,
    setIconCode: null,
    backFace: null,
    faceContent: null,
    watermark: null,
  } as unknown as CardPreviewData;

  it("switches ligatures off on its root and nowhere back on; kerning is left alone", () => {
    const markup = renderToStaticMarkup(<CardPreview {...card} />);
    const root = /^<div[^>]*>/.exec(markup)?.[0] ?? "";
    expect(root).toMatch(/style="[^"]*font-variant-ligatures:\s*none/);
    // One declaration, the root's: no element inside the card sets the
    // property again, or reaches the same features another way.
    expect(markup.match(/font-variant-ligatures/g)).toHaveLength(1);
    expect(markup).not.toMatch(/font-feature-settings|font-variant:|font-kerning/);
  });
});
