import { describe, expect, it } from "vitest";
import {
  ABILITY_WORDS,
  isAbilityWord,
  tokenizeRulesText,
  groupTightRuns,
  hybridHalves,
  inlineManaTintKey,
  type RulesItem,
} from "@/lib/cards/rules-text";
import fixture from "./fixtures/scryfall-ability-words.json";

const flat = (items: RulesItem[]) =>
  items.map((it) => (it.t === "m" ? `[${it.suffix}]` : it.v)).join(" ");

describe("tokenizeRulesText", () => {
  it("renders mana tokens as pips", () => {
    const [p] = tokenizeRulesText("{T}: Add {G}{G}.");
    expect(flat(p)).toBe("[tap] : Add [g] [g] .");
  });

  it("renders pips INSIDE reminder parentheses (the most common reminder)", () => {
    const [p] = tokenizeRulesText("({T}: Add {G}.)");
    const manaItems = p.filter((it) => it.t === "m");
    expect(manaItems.map((m) => (m.t === "m" ? m.suffix : ""))).toEqual([
      "tap",
      "g",
    ]);
    // Words inside the parenthetical stay reminder-italic.
    const wordItems = p.filter((it) => it.t === "w");
    expect(wordItems.every((w) => w.t === "w" && w.em === "reminder")).toBe(
      true,
    );
  });

  it("marks punctuation glued to a pip as tight", () => {
    const [p] = tokenizeRulesText("{T}: Add {G}.");
    // "{T}" then ":" — the colon abuts the closing brace.
    expect(p[0]).toMatchObject({ t: "m", suffix: "tap" });
    expect(p[1]).toMatchObject({ t: "w", v: ":", tight: true });
  });

  it("keeps adjacent pips in one tight run", () => {
    const [p] = tokenizeRulesText("Add {G}{G} to your mana pool.");
    const runs = groupTightRuns(p);
    const pipRun = runs.find((r) => r.some((it) => it.t === "m"));
    expect(pipRun?.filter((it) => it.t === "m")).toHaveLength(2);
  });

  it("italicizes ability words before an em dash, not keywords", () => {
    const [p] = tokenizeRulesText("Landfall — Whenever a land enters, draw.");
    expect(p[0]).toMatchObject({ t: "w", v: "Landfall", em: "ability" });
    const [q] = tokenizeRulesText("Flying, vigilance");
    expect(q[0]).toMatchObject({ t: "w", v: "Flying," });
    expect((q[0] as { em?: string }).em).toBeUndefined();
  });

  it("keeps blank lines as paragraph breaks", () => {
    const paragraphs = tokenizeRulesText("Flying\n\nHaste");
    expect(paragraphs).toHaveLength(3);
    expect(paragraphs[1]).toEqual([]);
  });

  it("opens a reminder tightly after a pip's parenthesis", () => {
    const [p] = tokenizeRulesText("Hexproof ({W/U} and {2/B} also work.)");
    const manaSuffixes = p
      .filter((it) => it.t === "m")
      .map((it) => (it.t === "m" ? it.suffix : ""));
    expect(manaSuffixes).toEqual(["wu", "2b"]);
  });
});

// Layout v33: a word after a space is never glued to the pip or reminder
// before it. The tokenizer used to mark the first word of any span that
// FOLLOWED a mana token or a parenthesis as tight, even when the span opened
// with a space — both renderers drew "ⓑequal", "{2}and", "(remix)deals" and
// "reach.)Trample" (54 of the 731 public cards measured, stored HD bakes
// included; 16 more had "({T}:" split inside a reminder, now whole).
describe("tokenizeRulesText — words after a pip or a reminder", () => {
  const runs = (text: string) =>
    groupTightRuns(tokenizeRulesText(text)[0]).map((run) => run.map((it) => (it.t === "m" ? `{${it.suffix}}` : it.v)).join(""));

  it("starts a new run for a word after a space, whatever came before it", () => {
    expect(runs("Pay an amount of {B} equal to its power.")).toEqual([
      "Pay", "an", "amount", "of", "{b}", "equal", "to", "its", "power.",
    ]);
    expect(runs("It costs {2} and {G} less.")).toEqual(["It", "costs", "{2}", "and", "{g}", "less."]);
    expect(runs("Cast it (remix) deals 3 damage.")).toEqual(["Cast", "it", "(remix)", "deals", "3", "damage."]);
    expect(runs("Flying (It can block creatures with reach.) Trample")).toEqual([
      "Flying", "(It", "can", "block", "creatures", "with", "reach.)", "Trample",
    ]);
    // Inside a reminder too.
    expect(runs("({G} or {U} both work.)")).toEqual(["({g}", "or", "{u}", "both", "work.)"]);
  });

  it("still glues what touches: a pip's colon or period, a parenthesis, adjacent pips", () => {
    expect(runs("{T}: Add {G}{G}.")).toEqual(["{tap}:", "Add", "{g}{g}."]);
    expect(runs("({T}: Add {G}.)")).toEqual(["({tap}:", "Add", "{g}.)"]);
    expect(runs("Ward—{2}. Hexproof")).toEqual(["Ward—{2}.", "Hexproof"]);
    // A reminder glued to the word before it stays one run with it.
    expect(runs("word(reminder) next")).toEqual(["word(reminder)", "next"]);
  });

  it("keeps the words and their emphasis — only the glue changed", () => {
    const [p] = tokenizeRulesText("Add {B} equal (It's reminder.) Next");
    expect(p.map((it) => (it.t === "m" ? `{${it.suffix}}` : `${it.v}${it.em ? `/${it.em}` : ""}`))).toEqual([
      "Add", "{b}", "equal", "(It's/reminder", "reminder.)/reminder", "Next",
    ]);
    expect(p.find((it) => it.t === "w" && it.v === "equal")?.tight).toBeUndefined();
    expect(p.find((it) => it.t === "w" && it.v === "Next")?.tight).toBeUndefined();
  });
});

// TODO 1.13 (rides layout v33): the ability words are Scryfall's catalog,
// fetched once into a committed fixture.
describe("ABILITY_WORDS", () => {
  it("is Scryfall's catalog/ability-words as of the committed fixture, lowercased", () => {
    expect(fixture.source).toBe("https://api.scryfall.com/catalog/ability-words");
    expect(fixture.fetched).toMatch(/^\d{4}-\d{2}-\d{2}$/);
    expect(fixture.catalog.object).toBe("catalog");
    expect(fixture.catalog.data).toHaveLength(fixture.catalog.total_values);
    const catalog = fixture.catalog.data.map((w) => w.toLowerCase()).sort();
    expect([...ABILITY_WORDS].sort()).toEqual(catalog);
    expect(new Set(catalog).size).toBe(catalog.length);
  });

  it("italicizes every catalog word before an ability's em dash — the 2024–2026 ones too", () => {
    for (const word of fixture.catalog.data) {
      const [p] = tokenizeRulesText(`${word} — Draw a card.`);
      const words = word.split(/\s+/);
      for (const [i, w] of words.entries()) expect(p[i], word).toMatchObject({ t: "w", v: w, em: "ability" });
      expect(p[words.length], word).toMatchObject({ t: "w", v: "—", em: "ability" });
      expect((p[words.length + 1] as { em?: string }).em, word).toBeUndefined();
    }
    expect(isAbilityWord("Void")).toBe(true);
    expect(isAbilityWord("  eerie ")).toBe(true);
  });

  it("reads a typographic apostrophe and a descend count the way the cards print them", () => {
    expect(isAbilityWord("Council’s dilemma")).toBe(true);
    expect(isAbilityWord("Hero’s Reward")).toBe(true);
    expect(isAbilityWord("Descend 4")).toBe(true);
    expect(isAbilityWord("Descend 8")).toBe(true);
    const [p] = tokenizeRulesText("Descend 4 — Whenever you attack, draw a card.");
    expect(p.slice(0, 3)).toMatchObject([
      { v: "Descend", em: "ability" },
      { v: "4", em: "ability" },
      { v: "—", em: "ability" },
    ]);
  });

  it("never italicizes a keyword or an ordinary sentence with an em dash", () => {
    for (const text of ["Flying — so it flies.", "Trample — big.", "Draw a card — then discard.", "Landfalls — nope."]) {
      const [p] = tokenizeRulesText(text);
      expect(p.every((it) => it.t !== "w" || !it.em), text).toBe(true);
    }
    expect(isAbilityWord("Legacy of stone")).toBe(false);
    expect(isAbilityWord("4")).toBe(false);
  });
});

describe("groupTightRuns", () => {
  it("groups an item with its tight followers", () => {
    const [p] = tokenizeRulesText("{T}: tap");
    const runs = groupTightRuns(p);
    // "{T}:" is one run; "tap" its own.
    expect(runs[0].length).toBe(2);
    expect(runs).toHaveLength(2);
  });
});

describe("hybridHalves", () => {
  it("splits hybrid, twobrid, and hybrid-phyrexian suffixes", () => {
    expect(hybridHalves("wu")).toEqual({ top: "w", bottom: "u" });
    expect(hybridHalves("2g")).toEqual({ top: "2", bottom: "g" });
    expect(hybridHalves("gup")).toEqual({ top: "g", bottom: "u" });
  });

  it("returns null for solid and utility suffixes", () => {
    expect(hybridHalves("g")).toBeNull();
    expect(hybridHalves("tap")).toBeNull();
    expect(hybridHalves("wp")).toBeNull(); // single-color phyrexian: solid disc
  });
});

describe("inlineManaTintKey", () => {
  it("tints colored and phyrexian pips to their color, the rest neutral", () => {
    expect(inlineManaTintKey("g")).toBe("g");
    expect(inlineManaTintKey("wp")).toBe("w");
    expect(inlineManaTintKey("tap")).toBe("c");
    expect(inlineManaTintKey("2")).toBe("c");
  });
});
