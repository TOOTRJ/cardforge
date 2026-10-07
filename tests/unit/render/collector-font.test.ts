import { existsSync, readFileSync, statSync } from "node:fs";
import path from "node:path";
import satori, { type Font } from "satori";
import { describe, expect, it } from "vitest";
import { getFrameProfile } from "@/lib/cards/template-layout";
import {
  COLLECTOR_FONT_BYTES,
  DISPLAY_FONT_BYTES,
  KEYRUNE_FONT_BYTES,
  MANA_FONT_BYTES,
  MPLANTIN_FONT_BYTES,
  MPLANTIN_ITALIC_FONT_BYTES,
  cardFonts,
} from "@/lib/render/card-fonts";
import { FRAME_TEMPLATE_VALUES } from "@/types/card";
import { loadLocalAdditionalAsset } from "@/lib/render/fallback-assets";
import { readCmap } from "@/lib/render/font-cmap";
import { COLLECTOR_TEXT } from "@/scripts/lib/collector-metrics.mjs";

// ---------------------------------------------------------------------------
// TODO 4.9b — the collector line's face (public/fonts/Montserrat-Medium.ttf,
// scripts/build-collector-font.mjs) can never change an existing card's
// text. Satori resolves a character through the requested families and then
// EVERY registered font in registration order (satori's getEngine) — and a
// character NO font has (★, CJK, Thai, an arrow: lib/render/fallback-assets
// .ts answers those with nothing) is drawn with the LAST registered font:
// its .notdef box and advance, and, when a word STARTS with such a
// character, the whole word in that face. So three guards hold it:
//   • its cmap ⊆ MPlantin's (the first registered face, the fallback of
//     every family): no character resolves to it unless asked for by name;
//   • it is registered AFTER MPlantin and NEVER last — Keyrune stays the
//     last font, as it was before this face, so a missing glyph draws
//     exactly what it drew (registered last, the collector face turned
//     "日本 Dragon" into two boxes and a sans-serif "Dragon", and a "★" in
//     rules text into a box 0.59 em wide where it was a 1 em gap);
//   • a real Satori run of text with missing glyphs, in the bake's families,
//     is the same SVG with and without the face.
// Plus the self-hosting rules: the OFL beside it, a WOFF2 twin the preview
// loads, and the @font-face metric overrides from its hhea.
// ---------------------------------------------------------------------------

const ROOT = process.cwd();
const read = (rel: string) => readFileSync(path.join(ROOT, rel));

/** renderCardImage's fonts array: what the ONE builder (lib/render/
 *  card-fonts.ts cardFonts, TODO 4.8.0) returns for a profile — the bake
 *  registers exactly that. (Until 4.8.0 this test parsed the array out of
 *  renderCardImage's source with a regex.) */
function bakeFonts(): Font[] {
  return cardFonts(getFrameProfile("m15")) as Font[];
}

const TODAYS_SIX: ReadonlyArray<[string, Buffer, number, string]> = [
  ["MPlantin", MPLANTIN_FONT_BYTES, 400, "normal"],
  ["MPlantin", MPLANTIN_ITALIC_FONT_BYTES, 400, "italic"],
  ["CardDisplay", DISPLAY_FONT_BYTES, 400, "normal"],
  ["Mana", MANA_FONT_BYTES, 400, "normal"],
  ["CollectorLine", COLLECTOR_FONT_BYTES, 500, "normal"],
  ["Keyrune", KEYRUNE_FONT_BYTES, 400, "normal"],
];

describe("the collector face", () => {
  const collector = readCmap(read("public/fonts/Montserrat-Medium.ttf"));
  const mplantin = readCmap(read("node_modules/mana-font/fonts/mplantin.ttf"));

  it("maps exactly the subset text — 67 code points — and every one is in MPlantin's cmap, upright and italic", () => {
    const expected = [...new Set(Array.from(COLLECTOR_TEXT, (ch) => ch.codePointAt(0) as number))].sort((a, b) => a - b);
    expect([...collector.keys()].sort((a, b) => a - b)).toEqual(expected);
    expect(expected).toHaveLength(67);
    const italic = readCmap(read("public/fonts/mplantin-italic.ttf"));
    for (const cp of collector.keys()) {
      expect(mplantin.has(cp), `U+${cp.toString(16)}`).toBe(true);
      // An italic run resolves through MPlantin's italic face first.
      expect(italic.has(cp), `italic U+${cp.toString(16)}`).toBe(true);
    }
    // The ★ is in no card font — it is a path (lib/cards/collector-line.ts).
    expect(collector.has(0x2605)).toBe(false);
    expect(mplantin.has(0x2605)).toBe(false);
  });

  it("is registered in the bake's fonts array after MPlantin and Beleren and NEVER last: Keyrune stays the last font", () => {
    const bake = readFileSync(path.join(ROOT, "lib/render/card-image.tsx"), "utf8");
    const names = bakeFonts().map((font) => font.name);
    expect(names).toEqual(["MPlantin", "MPlantin", "CardDisplay", "Mana", "CollectorLine", "Keyrune"]);
    // The font a missing glyph is drawn with is the last one registered.
    expect(names[names.length - 1]).toBe("Keyrune");
    expect(names.indexOf("CollectorLine")).toBeGreaterThan(names.indexOf("MPlantin"));
    // The bake registers the builder's array and no literal of its own.
    expect(bake).toContain("fonts: cardFonts(frameLayout),");
    expect(bake).not.toMatch(/_FONT_BYTES/);
    expect(bake).not.toMatch(/\{ name: "[A-Za-z]+", data: /);
    const fonts = readFileSync(path.join(ROOT, "lib/render/card-fonts.ts"), "utf8");
    expect(fonts).toMatch(/"public",\s*"fonts",\s*"Montserrat-Medium\.ttf"/);
  });

  it("every template's render registers today's six, in today's order, the same bytes (TODO 4.8.0: no profile names another face)", () => {
    for (const template of FRAME_TEMPLATE_VALUES) {
      const fonts = cardFonts(getFrameProfile(template));
      expect(
        fonts.map((font) => [font.name, font.weight, font.style]),
        template,
      ).toEqual(TODAYS_SIX.map(([name, , weight, style]) => [name, weight, style]));
      // (Identity, compared by hand: a matcher would deep-compare megabytes.)
      fonts.forEach((font, i) => expect(font.data === TODAYS_SIX[i][1], `${template} ${font.name}`).toBe(true));
      // A fresh array per render (Satori memoizes its engine per array).
      expect(cardFonts(getFrameProfile(template)) === fonts).toBe(false);
    }
    // A slot set in the body face (the 1997 type line, 4.10a) adds nothing:
    // MPlantin is already the first registered face.
    const m15 = getFrameProfile("m15");
    const fixture = { ...m15, type: { ...m15.type, font: "body" as const }, pt: { ...m15.pt!, font: "body" as const } };
    expect(cardFonts(fixture).map((font) => font.name)).toEqual(TODAYS_SIX.map(([name]) => name));
  });

  it("changes no existing run — not even a missing glyph's box: the same SVG with and without the face", async () => {
    const withFace = bakeFonts();
    const without = withFace.filter((font) => font.name !== "CollectorLine");
    expect(without).toHaveLength(withFace.length - 1);
    // The bake's families (lib/cards/type-faces.ts TYPE_FACES' bakeFamily)
    // and the text a card can hold: a character no font has in the middle of
    // a line and at the START of a word (the word's face follows its first
    // character), one the Noto fallback answers, and plain text in the
    // collector face's own code points.
    const samples: Array<{ family: string; weight: number; style: "normal" | "italic"; text: string }> = [
      { family: '"MPlantin"', weight: 400, style: "normal", text: "Draw a card ★ then discard ★★ a card." },
      { family: '"MPlantin"', weight: 400, style: "normal", text: "Flying 日本語 and haste. Trample สวัสดี more. Tap ⟶ untap ↯ go ✦ on." },
      { family: '"MPlantin"', weight: 400, style: "italic", text: "ǵ then ★ then more — “quoted” flavor ★Star." },
      { family: '"CardDisplay", "MPlantin"', weight: 600, style: "normal", text: "日本 Dragon" },
      { family: '"CardDisplay", "MPlantin"', weight: 600, style: "normal", text: "ART: ★JONES 日本 MÜLLER" },
      { family: '"CardDisplay", "MPlantin"', weight: 400, style: "normal", text: "Creature — Elf مرحبا ★Druid" },
      { family: '"MPlantin"', weight: 400, style: "normal", text: "A-Z a-z 0123456789 / - • † DMU • EN 107/281 R 0009" },
      { family: '"Keyrune"', weight: 400, style: "normal", text: " ★ A" },
      { family: '"Mana"', weight: 400, style: "normal", text: " ★ 7" },
    ];
    const render = (fonts: Font[], sample: (typeof samples)[number]) =>
      satori(
        {
          type: "div",
          props: {
            style: {
              display: "flex",
              flexWrap: "wrap",
              width: 900,
              fontFamily: sample.family,
              fontWeight: sample.weight,
              fontStyle: sample.style,
              fontSize: 48,
              color: "#000",
            },
            children: sample.text,
          },
          key: null,
        } as never,
        // A fresh array per run: Satori memoizes its engine per array and
        // adds the run's fallback fonts to it (lib/render/satori-png.ts).
        { width: 900, height: 300, fonts: [...fonts], loadAdditionalAsset: loadLocalAdditionalAsset },
      );
    for (const sample of samples) {
      const [a, b] = [await render(withFace, sample), await render(without, sample)];
      expect(a, `${sample.family} ${sample.style}: ${sample.text}`).toBe(b);
    }
  });

  it("ships beside its OFL with a WOFF2 twin, small, and the preview's @font-face carries its hhea as overrides", () => {
    expect(readFileSync(path.join(ROOT, "public/fonts/Montserrat-OFL.txt"), "utf8")).toMatch(/SIL Open Font License/);
    expect(existsSync(path.join(ROOT, "public/fonts/Montserrat-Medium.woff2"))).toBe(true);
    expect(statSync(path.join(ROOT, "public/fonts/Montserrat-Medium.ttf")).size).toBeLessThan(20_000);
    const css = readFileSync(path.join(ROOT, "app/globals.css"), "utf8");
    const face = /@font-face \{\s*font-family: "CollectorLine";[\s\S]*?\}/.exec(css)?.[0] ?? "";
    expect(face).toContain('url("/fonts/Montserrat-Medium.woff2") format("woff2")');
    expect(face).toContain('url("/fonts/Montserrat-Medium.ttf") format("truetype")');
    expect(face).toContain("font-weight: 500;");
    expect(face).toContain("ascent-override: 96.8%;");
    expect(face).toContain("descent-override: 25.1%;");
    expect(face).toContain("line-gap-override: 0%;");
  });

  it("has no kerning or substitution: both renderers lay the runs out from the advances alone", () => {
    const bytes = read("public/fonts/Montserrat-Medium.ttf");
    const count = bytes.readUInt16BE(4);
    const tags: string[] = [];
    for (let i = 0; i < count; i += 1) tags.push(bytes.subarray(12 + i * 16, 16 + i * 16).toString("latin1"));
    expect(tags).not.toContain("GPOS");
    expect(tags).not.toContain("GSUB");
    expect(tags).not.toContain("kern");
  });
});
