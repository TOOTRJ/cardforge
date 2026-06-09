import { describe, expect, it } from "vitest";
import {
  tokenizeRulesText,
  groupTightRuns,
  hybridHalves,
  inlineManaTintKey,
  type RulesItem,
} from "@/lib/cards/rules-text";

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
