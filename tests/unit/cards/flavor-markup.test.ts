import { describe, expect, it } from "vitest";
import { flavorSegments, hasFlavorMarkup, stripFlavorMarkup } from "@/lib/cards/flavor-markup";
import { breakRulesText, flavorRuns, metricsFor, runWidthPx, wordWidthPx } from "@/lib/cards/rules-layout";
import { rulesTextWidthEm } from "@/lib/cards/rules-metrics";
import type { RulesItem } from "@/lib/cards/rules-text";
import { unrenderableCharacters } from "@/lib/validation/card-glyphs";
import { printTypography } from "@/lib/validation/print-typography";

// ---------------------------------------------------------------------------
// Flavour text's upright `*…*` spans (layout v71, lib/cards/flavor-markup.ts):
// the parser, the runs the ONE rules layout builds from it and measures in
// the roman face, print typography reading through the stars, and the glyph
// check. The renderers' own drawing of those runs is held by
// tests/unit/render/rules-no-clip.test.tsx ("flavor, upright spans") and the
// parity case m15/g/creature-long@flavor-upright.
// ---------------------------------------------------------------------------

/** Scryfall's own flavour texts (2026-10-28), stored as an import stores
 *  them (print typography already run). */
const SCRYFALL = {
  // STA #3 Defiant Strike — a book's title as the attribution.
  sta3: printTypography(
    '"For twelve days and twelve nights, Somat assailed the monster\'s shell. On the thirteenth morning, it cracked with the dawn."\n—*Heroics: A Book of Fables*',
    "flavor",
  ),
  // AFR #194 Lurking Roper — spans inside hyphenated words.
  afr194: printTypography('"You see, stalac-*tites* grow down from the ceiling, while stalag-*mites* reach—AAHHHHHHHHH—"', "flavor"),
  // CLB #310 Dire Mimic — a stressed word.
  clb310: printTypography("Sometimes the closet *is* the monster.", "flavor"),
  // TMP #1 Advance Scout — a span at a word's start.
  tmp1: printTypography(
    '"The soldier\'s path is worn smooth by the tread of many feet—all in one direction, none returning."\n—Oracle *en*-Vec',
    "flavor",
  ),
  // SLD — quotes INSIDE the span.
  sld: printTypography('*"The Number of the Beast," single (1982)*', "flavor"),
};

const words = (runs: RulesItem[][]) =>
  runs.map((run) => run.map((it) => (it.t === "w" ? `${it.em ? "i" : "R"}:${it.v}` : `{${it.suffix}}`)).join("+"));

describe("flavorSegments — balanced pairs on one line are the markup, every other star is text", () => {
  it("reads balanced pairs, the stars dropped", () => {
    expect(flavorSegments("Are *we* the wrong sort?")).toEqual([
      { text: "Are ", upright: false },
      { text: "we", upright: true },
      { text: " the wrong sort?", upright: false },
    ]);
    expect(flavorSegments("—*Heroics: A Book of Fables*")).toEqual([
      { text: "—", upright: false },
      { text: "Heroics: A Book of Fables", upright: true },
    ]);
    expect(flavorSegments("*I*")).toEqual([{ text: "I", upright: true }]);
    expect(flavorSegments("*a**b*")).toEqual([
      { text: "a", upright: true },
      { text: "b", upright: true },
    ]);
  });

  it("starts and ends a span inside a word, with punctuation round it or in it", () => {
    expect(flavorSegments("—Oracle *en*-Vec")).toEqual([
      { text: "—Oracle ", upright: false },
      { text: "en", upright: true },
      { text: "-Vec", upright: false },
    ]);
    expect(flavorSegments("stalac-*tites* grow")).toEqual([
      { text: "stalac-", upright: false },
      { text: "tites", upright: true },
      { text: " grow", upright: false },
    ]);
    expect(flavorSegments("“*That’s* how.”")).toEqual([
      { text: "“", upright: false },
      { text: "That’s", upright: true },
      { text: " how.”", upright: false },
    ]);
    expect(flavorSegments("*“Red Box” (1983)*,")).toEqual([
      { text: "“Red Box” (1983)", upright: true },
      { text: ",", upright: false },
    ]);
  });

  it("leaves an unbalanced, spaced, doubled or line-crossing star as typed", () => {
    for (const line of ["A lone * star.", "2 * 3 * 4", "**", "** bold? **", "* spaced *", "*open only", "close only*", "*", "***"]) {
      expect(flavorSegments(line), line).toEqual([{ text: line, upright: false }]);
    }
    // The first star can't open (a space after it); the next pair can.
    expect(flavorSegments("a * b *c* d")).toEqual([
      { text: "a * b ", upright: false },
      { text: "c", upright: true },
      { text: " d", upright: false },
    ]);
    // A pair is on ONE line: split by a line break it is two lone stars.
    expect(hasFlavorMarkup("*open\nclose*")).toBe(false);
    expect(stripFlavorMarkup("*open\nclose*")).toBe("*open\nclose*");
  });

  it("hasFlavorMarkup / stripFlavorMarkup agree with the segments", () => {
    for (const text of Object.values(SCRYFALL)) {
      expect(hasFlavorMarkup(text), text).toBe(true);
      expect(stripFlavorMarkup(text)).not.toContain("*");
      expect(stripFlavorMarkup(text)).toBe(
        text
          .split("\n")
          .map((line) => flavorSegments(line).map((s) => s.text).join(""))
          .join("\n"),
      );
    }
    expect(hasFlavorMarkup(null)).toBe(false);
    expect(hasFlavorMarkup("")).toBe(false);
    expect(hasFlavorMarkup("No markup.")).toBe(false);
    // The regex is global: a repeated call answers the same.
    expect([hasFlavorMarkup("*a*"), hasFlavorMarkup("*a*"), hasFlavorMarkup("*a*")]).toEqual([true, true, true]);
  });
});

describe("flavorRuns — the rules layout's runs", () => {
  it("a line with no span is exactly the runs it always was: one italic item per word", () => {
    expect(flavorRuns("  Born with wings of light.  ")).toEqual(
      ["Born", "with", "wings", "of", "light."].map((v) => [{ t: "w", v, em: "flavor" }]),
    );
    expect(flavorRuns("A lone * star.")).toEqual(["A", "lone", "*", "star."].map((v) => [{ t: "w", v, em: "flavor" }]));
  });

  it("sets a span's words roman (no emphasis) and never keeps its stars", () => {
    expect(words(flavorRuns("—*Heroics: A Book of Fables*"))).toEqual(["i:—+R:Heroics:", "R:A", "R:Book", "R:of", "R:Fables"]);
    expect(words(flavorRuns("Sometimes the closet *is* the monster."))).toEqual([
      "i:Sometimes",
      "i:the",
      "i:closet",
      "R:is",
      "i:the",
      "i:monster.",
    ]);
    // A word a span starts or ends inside is ONE run (no word gap), its
    // pieces glued (`tight`), each in its own face.
    const stalac = flavorRuns("stalac-*tites* grow");
    expect(words(stalac)).toEqual(["i:stalac-+R:tites", "i:grow"]);
    expect(stalac[0][1]).toMatchObject({ tight: true });
    expect(words(flavorRuns("—Oracle *en*-Vec"))).toEqual(["i:—Oracle", "R:en+i:-Vec"]);
    // Two spans side by side: one roman item.
    expect(words(flavorRuns("*a**b*c"))).toEqual(["R:ab+i:c"]);
    for (const text of Object.values(SCRYFALL)) {
      for (const line of text.split("\n")) {
        for (const run of flavorRuns(line)) for (const it of run) if (it.t === "w") expect(it.v).not.toContain("*");
      }
    }
  });
});

describe("the layout measures an upright span in the ROMAN face", () => {
  const COLUMN = { hd: 1100, default: 550 };

  it("each roman word's box is the roman advances, ceiled — never the italic's", () => {
    const blocks = breakRulesText(null, SCRYFALL.sta3, 76, COLUMN);
    const flavor = blocks.find((b) => b.kind === "flavor")!;
    const items = flavor.lines.flatMap((l) => l.runs.flat()).filter((it): it is Extract<RulesItem, { t: "w" }> => it.t === "w");
    const roman = items.filter((it) => !it.em);
    expect(roman.map((it) => it.v)).toEqual(["Heroics:", "A", "Book", "of", "Fables"]);
    const m = metricsFor(76, undefined, "hd");
    for (const it of roman) {
      expect(wordWidthPx(it, m)).toBe(Math.ceil(rulesTextWidthEm(it.v, false) * m.fontPx - 1e-6));
    }
    // The faces really differ here: the layout would have measured "Heroics:"
    // 1+ px narrower in the italic.
    expect(Math.ceil(rulesTextWidthEm("Heroics:", false) * 76)).toBeGreaterThan(Math.ceil(rulesTextWidthEm("Heroics:", true) * 76));
    // A line's width is its runs' boxes (each piece of a glued word its own).
    for (const line of flavor.lines) {
      const w = line.runs.reduce((sum, run, i) => sum + (i > 0 ? m.wordGapPx : 0) + runWidthPx(run, m), 0);
      expect(line.widthPx.hd).toBe(w);
    }
  });

  it("breaks inside a span where the column says so — every word of it roman on both lines", () => {
    const long = "—*Heroics: A Book of Fables and Other Ancient Tales of the Vastlands*";
    const blocks = breakRulesText(null, long, 76, { hd: 700, default: 350 });
    const lines = blocks[0].lines;
    expect(lines.length).toBeGreaterThan(1);
    const items = lines.flatMap((l) => l.runs.flat());
    expect(items[0]).toMatchObject({ v: "—", em: "flavor" });
    for (const it of items.slice(1)) expect(it).not.toHaveProperty("em");
    // The drawn text is the text without the stars.
    expect(lines.map((l) => l.runs.map((r) => r.map((it) => (it.t === "w" ? it.v : "")).join("")).join(" ")).join(" ")).toBe(
      stripFlavorMarkup(long),
    );
  });

  it("breaks the marked text where it breaks its own words set roman — not where the italic would", () => {
    // A column that just holds the line in the (narrower) italic but not in
    // the roman: the span moves its last word to a new line.
    const line = "*Heroics Heroics Heroics Heroics*";
    const italicWidth = breakRulesText(null, "Heroics Heroics Heroics Heroics", 76, COLUMN)[0].lines[0].widthPx;
    const tight = { hd: italicWidth.hd, default: italicWidth.default };
    expect(breakRulesText(null, "Heroics Heroics Heroics Heroics", 76, tight)[0].lines).toHaveLength(1);
    expect(breakRulesText(null, line, 76, tight)[0].lines).toHaveLength(2);
  });
});

describe("print typography never prints the markup's stars as anything else", () => {
  it("keeps every star, and reads a quote through them", () => {
    for (const [typed, printed] of [
      ['*"Red Box" (1983)*', "*“Red Box” (1983)*"],
      ['"Are *we* the wrong sort?"', "“Are *we* the wrong sort?”"],
      ["-*Song of All*, canto 2", "—*Song of All*, canto 2"],
      ['"*That\'s* how."', "“*That’s* how.”"],
      ["Successful delivery is *not* guaranteed.", "Successful delivery is *not* guaranteed."],
    ] as const) {
      expect(printTypography(typed, "flavor"), typed).toBe(printed);
      // Idempotent.
      expect(printTypography(printed, "flavor")).toBe(printed);
    }
  });

  it("converts a marked text exactly as it converts the same text unmarked", () => {
    for (const text of [
      '*"The Wicker Man," single (2000)*',
      'Dungeons & Dragons Set 1: Basic Rules, *"Red Box" (1983)*',
      '"Course he ran! *I* wouldn\'t want to stare down that barrel, either!"\n-Alaborn soldier',
    ]) {
      expect(stripFlavorMarkup(printTypography(text, "flavor"))).toBe(printTypography(stripFlavorMarkup(text), "flavor"));
    }
  });

  it("rules text is untouched: a star there is no markup (and `* ` opening a line is still the bullet)", () => {
    expect(printTypography("* Draw a card.", "rules")).toBe("• Draw a card.");
    expect(printTypography('Gain *two* "life".', "rules")).toBe("Gain *two* “life”.");
  });
});

describe("the glyph check reads an upright span in the roman face", () => {
  it("flags a character the ROMAN face draws empty only where it prints roman", () => {
    // MPlantin's roman maps ° to an EMPTY glyph; its italic draws one.
    expect(unrenderableCharacters("Heated to 451°.", "italic")).toEqual([]);
    expect(unrenderableCharacters("Heated to *451°*.", "italic")).toEqual(["°"]);
    expect(unrenderableCharacters("°", "rules")).toEqual(["°"]);
    // The markup's stars are never drawn, so never checked.
    expect(unrenderableCharacters("*Fables*", "italic")).toEqual([]);
  });
});
