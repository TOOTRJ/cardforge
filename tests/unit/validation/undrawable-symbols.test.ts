import { describe, expect, it } from "vitest";
import { tokenize, tokenSuffix } from "@/components/cards/mana-cost-glyphs";
import { drawsManaGem, manaGemSpec, manaGlyphSuffixes } from "@/lib/cards/mana-gem";
import { tokenizeRulesText } from "@/lib/cards/rules-text";
import { SYMBOL_STYLES, symbolStyle } from "@/lib/cards/symbol-style";
import {
  cardSymbolFields,
  cardSymbolStyle,
  findUndrawableSymbols,
  listSymbols,
  undrawableSymbols,
  undrawableSymbolsMessage,
  type GlyphCheckValues,
} from "@/lib/validation/card-glyphs";

// ---------------------------------------------------------------------------
// The creator's warning for a `{…}` symbol the card can't draw. Both
// renderers leave such a pip out without a trace (lib/cards/mana-gem.ts), so
// the check must agree with THEIR gate symbol for symbol — it is asked of
// drawsManaGem, never of a list of its own.
// ---------------------------------------------------------------------------

const STYLES = Object.values(SYMBOL_STYLES);

/** The ways a maker can type the symbol a mana-font suffix draws. */
function writtenFormsOf(suffix: string): string[] {
  if (suffix === "untap") return ["{Q}"];
  const upper = suffix.toUpperCase();
  const forms = [`{${upper}}`, `{${suffix}}`];
  // Hybrid, twobrid and Phyrexian symbols are written with a slash.
  if (/^[wubrg2][wubrgp]$/.test(suffix)) forms.push(`{${upper[0]}/${upper[1]}}`);
  // The two-colour Phyrexian symbol is written in three parts ({G/U/P}) and
  // only so: "{GUP}" is not a symbol.
  if (/^[wubrg]{2}p$/.test(suffix)) return [`{${upper[0]}/${upper[1]}/P}`, `{${suffix[0]}/${suffix[1]}/p}`];
  return forms;
}

describe("undrawableSymbols — every symbol the font has draws, so none is named", () => {
  it("no reachable suffix with a glyph yields a warning, in any symbol style", () => {
    const suffixes = manaGlyphSuffixes();
    expect(suffixes.length).toBeGreaterThan(60);
    for (const suffix of suffixes) {
      // Every era's {T} is reached by typing {T} on a frame of that style.
      if (suffix.startsWith("tap")) continue;
      for (const written of writtenFormsOf(suffix)) {
        // The written form really is that suffix…
        const tokens = tokenize(written);
        expect(tokens.map(tokenSuffix), written).toEqual([suffix]);
        // …and no style warns about it, in a cost or in rules text.
        for (const style of STYLES) {
          expect(undrawableSymbols(written, { symbols: style }), `${written} (${style.id})`).toEqual([]);
          expect(undrawableSymbols(`Pay ${written}: draw a card.`, { symbols: style })).toEqual([]);
        }
      }
    }
  });

  it("the styles read are ALL of them — the 1993 frame's \"original\" (TODO 4.10c) with the three before it", () => {
    expect(STYLES.map((style) => style.id).sort()).toEqual(["1997", "2003", "modern", "original"]);
  });

  it("\"original\": a symbol the style draws as an IMAGE is drawable — with the font's glyph or without one — and never named", () => {
    const original = SYMBOL_STYLES.original;
    const letters = Object.keys(original.symbolImages ?? {});
    expect(letters.sort()).toEqual(["b", "g", "r", "u", "w"]);
    for (const letter of letters) {
      expect(manaGemSpec(letter, 72, original).kind, letter).toBe("image");
      for (const written of [`{${letter.toUpperCase()}}`, `{${letter}}`]) {
        expect(undrawableSymbols(written, { symbols: original }), written).toEqual([]);
        expect(undrawableSymbols(`{T}, ${written}: Add ${written}${written}.`, { symbols: original })).toEqual([]);
      }
    }
    // The gate is the image, not the font: a style that draws an image for
    // a suffix mana-font has no glyph for still draws it, so nothing warns.
    expect(drawsManaGem("zz", original)).toBe(false);
    expect(undrawableSymbols("{ZZ}", { symbols: original })).toEqual(["{ZZ}"]);
    const withImage = { ...original, symbolImages: { ...original.symbolImages!, zz: "/frames/probe/zz.png" } };
    expect(drawsManaGem("zz", withImage)).toBe(true);
    expect(undrawableSymbols("{ZZ}", { symbols: withImage })).toEqual([]);
    // …and the 1993 frame's cards read that style (a card on the pair).
    expect(cardSymbolStyle({ frame_style: { template: "agclassic" } }).id).toBe("original");
    expect(cardSymbolStyle({ frame_style: { template: "alphaland" } }).id).toBe("original");
    const symbols = cardSymbolStyle({ frame_style: { template: "agclassic" } });
    const fields = [
      { label: "Mana cost", value: "{X}{2}{W}{U}{B}{R}{G}" },
      { label: "Rules text", value: "{T}, {W/U}: Add {R}{G}. {Q}: Add {C}." },
    ];
    expect(findUndrawableSymbols(fields, { symbols })).toEqual([]);
  });

  it("{T} draws in every style (each style's own tap is in the font)", () => {
    for (const style of STYLES) {
      expect(manaGlyphSuffixes()).toContain(style.tapSuffix);
      expect(undrawableSymbols("{T}: Add {G}.", { symbols: style })).toEqual([]);
    }
  });

  it("an ordinary cost and rules text name nothing", () => {
    expect(undrawableSymbols("{2}{W/U}{2/G}{B/P}{X}{S}{C}{20}")).toEqual([]);
    // The hybrid Phyrexian symbol draws since layout v49 (Tamiyo, Ajani):
    // either colour order, in every style, in a cost and in rules text.
    for (const style of STYLES) {
      expect(undrawableSymbols("{2}{G}{G/U/P}{U}", { symbols: style }), style.id).toEqual([]);
      expect(undrawableSymbols("Compleated ({G/W/P} can be paid with {G}, {W}, or 2 life.) {w/g/p}", { symbols: style }), style.id).toEqual([]);
      expect(drawsManaGem(tokenSuffix(tokenize("{G/W/P}")[0])!, style), style.id).toBe(true);
    }
    expect(undrawableSymbols("{T}, {Q}, Pay {E}{E}: Add {C}. ({G/W} can be paid with either {G} or {W}.)")).toEqual([]);
    expect(undrawableSymbols("")).toEqual([]);
    expect(undrawableSymbols(null)).toEqual([]);
    expect(undrawableSymbols("No symbols here — {unclosed")).toEqual([]);
  });
});

describe("undrawableSymbols — what the card leaves out is named", () => {
  const UNDRAWABLE = [
    "{21}", // past the font's last generic
    "{99}",
    "{C/P}", // colourless Phyrexian
    "{1/2}", // a half
    "{W/W/P}", // not a hybrid Phyrexian symbol: one colour twice
    "{C/W/P}", // nor with the colourless or a generic half
    "{2/W/P}",
    "{3/W}", // a twobrid that isn't 2
    "{C/W}", // colourless hybrid, as written
    "{A}", // acorn
    "{CHAOS}",
    "{TAP}",
    "{HW}",
    "{∞}",
    "{½}",
  ];

  it("each example is named, alone, in a cost and in rules text, in every style", () => {
    for (const style of STYLES) {
      for (const symbol of UNDRAWABLE) {
        expect(undrawableSymbols(symbol, { symbols: style }), symbol).toEqual([symbol]);
        expect(undrawableSymbols(`{2}${symbol}{G}`, { symbols: style })).toEqual([symbol]);
        expect(undrawableSymbols(`{T}, Pay ${symbol}: Draw a card. (${symbol} is a symbol.)`, { symbols: style })).toEqual([symbol]);
        // And the renderers' gate really refuses it.
        const suffix = tokenSuffix(tokenize(symbol)[0]);
        expect(suffix && drawsManaGem(suffix, style), symbol).toBe(false);
      }
    }
  });

  it("names each once, upper-cased, in order of first appearance", () => {
    expect(undrawableSymbols("{21}{c/p}{21}{ C/P }{G}{1/2}{W/U/P}")).toEqual(["{21}", "{C/P}", "{1/2}"]);
  });

  it("agrees with the rules tokenizer: one name per kind of pip the renderers drop", () => {
    const modern = symbolStyle(undefined);
    const texts = [
      "{T}, Pay {21}: Add {C/P}. ({W/U/P} can be paid with {W}, {U}, or 2 life; {W/W/P} is no symbol.)",
      "Landfall — Whenever a land enters, add {1/2}{G}.\n{3/W}{3/W}: Draw a card.",
      "Flying\n{2}{U}: Scry 1.",
    ];
    for (const text of texts) {
      const dropped = new Set(
        tokenizeRulesText(text)
          .flat()
          .filter((item) => item.t === "m" && !drawsManaGem(item.suffix, modern))
          .map((item) => (item.t === "m" ? item.suffix : "")),
      );
      expect(undrawableSymbols(text).length, text).toBe(dropped.size);
    }
  });

  it("an owner's custom pip images change nothing: they exist only for symbols the font has", () => {
    const overrides = { W: "https://example.test/w.png", C: "https://example.test/c.png" };
    expect(undrawableSymbols("{W}{C}{W/U/P}{C/P}{3/W}", { overrides })).toEqual(["{C/P}", "{3/W}"]);
    expect(undrawableSymbols("{W}{C}", { overrides })).toEqual([]);
  });
});

describe("the fields the check reads", () => {
  const VALUES: GlyphCheckValues = {
    title: "Probe",
    cost: "{21}{G}",
    supertype: "",
    subtypes_text: "",
    rules_text: "{T}: Add {W/U/P} or {W/W/P}.",
    flavor_text: "A {21} in flavor text prints as typed.",
    power: "",
    toughness: "",
    loyalty: "",
    defense: "",
    artist_credit: "",
    footer_text: "",
    loyalty_abilities: [{ text: "Add {C/P}." }, { text: "Draw a card." }],
    saga_intro: "{1/2}",
    saga_chapters: [{ text: "Add {G}." }, { text: "Add {3/W}." }],
    has_back_face: false,
    back_face: {
      title: "",
      cost: "{A}",
      supertype: "",
      subtypes_text: "",
      rules_text: "Pay {CHAOS}.",
      flavor_text: "",
      power: "",
      toughness: "",
      loyalty: "",
      defense: "",
    },
  };

  it("costs and rules-style texts, labelled; flavor text is not read (no renderer parses symbols there)", () => {
    expect(findUndrawableSymbols(cardSymbolFields(VALUES))).toEqual([
      { label: "Mana cost", symbols: ["{21}"] },
      { label: "Rules text", symbols: ["{W/W/P}"] },
      { label: "Loyalty ability 1", symbols: ["{C/P}"] },
      { label: "Saga intro", symbols: ["{1/2}"] },
      { label: "Chapter 2", symbols: ["{3/W}"] },
    ]);
    expect(cardSymbolFields(VALUES).map((f) => f.label)).not.toContain("Flavor text");
  });

  it("the second face only when the card has one", () => {
    const found = findUndrawableSymbols(cardSymbolFields({ ...VALUES, has_back_face: true }));
    expect(found.slice(-2)).toEqual([
      { label: "Back face mana cost", symbols: ["{A}"] },
      { label: "Back face rules text", symbols: ["{CHAOS}"] },
    ]);
  });

  // An imported walker (and every saved walker or saga) holds the
  // serialized text in rules_text AND in its rows; the card draws the rows.
  // The creator has no rules field on those kinds, so a line read from
  // rules_text could never be cleared by the maker.
  it("a walker frame with a filled row reads the rows, never the rules text it doesn't draw", () => {
    const ajani: GlyphCheckValues = {
      ...VALUES,
      cost: "{1}{G}{G/W/P}{W}",
      rules_text: "Compleated ({G/W/P} can be paid with {G}, {W}, or 2 life.)\n+1: Draw a card.",
      loyalty_abilities: [{ text: "Compleated ({G/W/P} can be paid with {G}, {W}, or 2 life.)" }, { text: "Draw a card." }],
      saga_intro: "",
      saga_chapters: [],
      frame_style: { template: "m15pw" },
    };
    // Ajani, Sleeper Agent as imported: its {G/W/P} draws (layout v49), so
    // the notice names nothing.
    expect(findUndrawableSymbols(cardSymbolFields(ajani))).toEqual([]);
    // The mechanism, with a symbol that still can't be drawn.
    const walker: GlyphCheckValues = {
      ...ajani,
      cost: "{1}{G}{21}{W}",
      rules_text: "Compleated ({21} can be paid with {G}, {W}, or 2 life.)\n+1: Draw a card.",
      loyalty_abilities: [{ text: "Compleated ({21} can be paid with {G}, {W}, or 2 life.)" }, { text: "Draw a card." }],
    };
    expect(findUndrawableSymbols(cardSymbolFields(walker))).toEqual([
      { label: "Mana cost", symbols: ["{21}"] },
      { label: "Loyalty ability 1", symbols: ["{21}"] },
    ]);
    // The maker takes the symbol out of the row: only the cost is left.
    const edited = { ...walker, loyalty_abilities: [{ text: "Compleated" }, { text: "Draw a card." }] };
    expect(findUndrawableSymbols(cardSymbolFields(edited)).map((f) => f.label)).toEqual(["Mana cost"]);
    // No filled row: the renderers parse rules_text into the rows, so it is read.
    const unparsed = { ...walker, loyalty_abilities: [{ text: "  " }] };
    expect(findUndrawableSymbols(cardSymbolFields(unparsed)).map((f) => f.label)).toEqual(["Mana cost", "Rules text"]);
    // The same rows on a frame without loyalty rows don't hide the rules text.
    const creature = { ...walker, frame_style: { template: "m15" } };
    expect(findUndrawableSymbols(cardSymbolFields(creature)).map((f) => f.label)).toContain("Rules text");
  });

  it("a saga frame with a filled chapter reads the chapters, never the rules text", () => {
    const saga: GlyphCheckValues = {
      ...VALUES,
      cost: "{2}{G}",
      rules_text: "I — Add {3/W}.",
      loyalty_abilities: [],
      saga_intro: "",
      saga_chapters: [{ text: "Add {3/W}.", numerals: [1] }],
      frame_style: { template: "saga" },
    };
    expect(findUndrawableSymbols(cardSymbolFields(saga))).toEqual([{ label: "Chapter 1", symbols: ["{3/W}"] }]);
    const fixed = { ...saga, saga_chapters: [{ text: "Add {G}.", numerals: [1] }] };
    expect(findUndrawableSymbols(cardSymbolFields(fixed))).toEqual([]);
    // A row with no chapter number isn't a chapter: the card still parses rules_text.
    const unnumbered = { ...saga, saga_chapters: [{ text: "Add {G}.", numerals: [] }] };
    expect(findUndrawableSymbols(cardSymbolFields(unnumbered)).map((f) => f.label)).toEqual(["Rules text"]);
  });

  it("a form slice without the costs or the row arrays still checks", () => {
    const { cost: _cost, loyalty_abilities: _rows, saga_chapters: _chapters, ...rest } = VALUES;
    void _cost;
    void _rows;
    void _chapters;
    expect(findUndrawableSymbols(cardSymbolFields(rest)).map((f) => f.label)).toEqual(["Rules text", "Saga intro"]);
  });
});

describe("the warning's sentence", () => {
  it("names the symbols in plain words", () => {
    expect(undrawableSymbolsMessage(["{21}"])).toBe("{21} can't be drawn and will be left off the card");
    expect(undrawableSymbolsMessage(["{21}", "{C/P}"])).toBe("{21} and {C/P} can't be drawn and will be left off the card");
    expect(listSymbols(["{21}", "{C/P}", "{1/2}"])).toBe("{21}, {C/P} and {1/2}");
    expect(listSymbols(["{A}", "{B/C}", "{D}", "{E/F}", "{G/H}", "{I}", "{J}", "{K}"])).toBe(
      "{A}, {B/C}, {D}, {E/F}, {G/H}, {I} and 2 more",
    );
  });
});
