import fs from "node:fs";
import path from "node:path";
import { describe, expect, it } from "vitest";
import { offCardSuffix, tokenSuffix, tokenize } from "@/components/cards/mana-cost-glyphs";
import { drawsManaGem } from "@/lib/cards/mana-gem";
import { HYBRID_PAIRS, normalizeManaCost } from "@/lib/cards/mana-order";
import { MORE_SYMBOLS, MORE_SYMBOLS_LABEL, MORE_SYMBOL_GROUPS } from "@/lib/cards/more-symbols";
import { SYMBOL_STYLES } from "@/lib/cards/symbol-style";
import { undrawableSymbols } from "@/lib/validation/card-glyphs";

// ---------------------------------------------------------------------------
// The ONE list of hybrid, twobrid and Phyrexian symbols (TODO 6.16d): the
// rules-text toolbar and the cost picker both read it, so what one offers the
// other offers, in the same order, under the same label.
// ---------------------------------------------------------------------------

const ROOT = process.cwd();
const SHEET = fs.readFileSync(path.join(ROOT, "node_modules/mana-font/css/mana.css"), "utf8");
const read = (file: string) => fs.readFileSync(path.join(ROOT, file), "utf8");

/** The thirty, written out once — the order the toolbar has had since #499. */
const THIRTY = [
  "{W/U}", "{U/B}", "{B/R}", "{R/G}", "{G/W}", "{W/B}", "{U/R}", "{B/G}", "{R/W}", "{G/U}",
  "{2/W}", "{2/U}", "{2/B}", "{2/R}", "{2/G}",
  "{W/P}", "{U/P}", "{B/P}", "{R/P}", "{G/P}",
  "{W/U/P}", "{W/B/P}", "{U/B/P}", "{U/R/P}", "{B/R/P}", "{B/G/P}", "{R/G/P}", "{R/W/P}", "{G/W/P}", "{G/U/P}",
];

describe("the shared list", () => {
  it("is the thirty, in four groups, in the toolbar's order", () => {
    expect(MORE_SYMBOLS_LABEL).toBe("Hybrid, twobrid & Phyrexian symbols…");
    expect(MORE_SYMBOL_GROUPS.map((group) => [group.id, group.label, group.symbols.length])).toEqual([
      ["hybrid", "Hybrid mana", 10],
      ["twobrid", "Twobrid mana", 5],
      ["phyrexian", "Phyrexian mana", 5],
      ["hybrid-phyrexian", "Hybrid Phyrexian mana", 10],
    ]);
    expect(MORE_SYMBOLS.map((symbol) => symbol.token)).toEqual(THIRTY);
    expect(new Set(THIRTY).size).toBe(30);
  });

  it("names each in words", () => {
    const names = Object.fromEntries(MORE_SYMBOLS.map((symbol) => [symbol.token, symbol.name]));
    expect(names["{W/U}"]).toBe("white or blue mana");
    expect(names["{G/U}"]).toBe("green or blue mana");
    expect(names["{2/B}"]).toBe("two generic or black mana");
    expect(names["{R/P}"]).toBe("red Phyrexian mana");
    expect(names["{G/U/P}"]).toBe("green or blue Phyrexian mana");
    expect(new Set(Object.values(names)).size).toBe(30);
    for (const name of Object.values(names)) expect(name).toMatch(/^[a-z][A-Za-z ]+ mana$/);
  });

  it("every token is the printed one: the cost normalizer keeps it, pair for pair", () => {
    const pairs = new Set<string>(HYBRID_PAIRS);
    for (const { token } of MORE_SYMBOLS) {
      expect(normalizeManaCost(token), token).toBe(token);
      const parts = token.slice(1, -1).split("/");
      if (parts.length === 3 || (parts[1] !== "P" && parts[0] !== "2")) expect(pairs.has(parts[0] + parts[1]), token).toBe(true);
    }
  });

  it("each is drawn: mana-font has its cost class, and a card draws it on every symbol style", () => {
    for (const { token } of MORE_SYMBOLS) {
      const [parsed] = tokenize(token);
      const suffix = offCardSuffix(parsed)!;
      expect(suffix, token).toBe(tokenSuffix(parsed));
      expect(new RegExp(`\\.ms-cost\\.ms-${suffix}[ ,:]`).test(SHEET), token).toBe(true);
      for (const style of Object.values(SYMBOL_STYLES)) {
        expect(drawsManaGem(suffix, style), `${token} (${style.id})`).toBe(true);
        expect(undrawableSymbols(token, { symbols: style }), `${token} (${style.id})`).toEqual([]);
      }
    }
    expect(Object.keys(SYMBOL_STYLES).sort()).toEqual(["1997", "2003", "modern", "original"]);
  });

  it("never offers the colourless Phyrexian symbol no renderer draws", () => {
    expect(THIRTY).not.toContain("{C/P}");
    expect(undrawableSymbols("{C/P}")).not.toEqual([]);
  });

  it("the toolbar and the cost picker read it — neither keeps a list of its own", () => {
    for (const file of ["components/creator/rules-symbol-toolbar.tsx", "components/cards/mana-cost-picker.tsx"]) {
      const source = read(file);
      expect(source, file).toContain('from "@/lib/cards/more-symbols"');
      expect(source, file).toContain("MORE_SYMBOL_GROUPS");
      expect(source, file).toContain("{MORE_SYMBOLS_LABEL}");
      // No hybrid, twobrid or Phyrexian code written out as a string.
      expect(source.match(/"\{[^"}]*\/[^"}]*\}"/g) ?? [], file).toEqual([]);
    }
  });
});
