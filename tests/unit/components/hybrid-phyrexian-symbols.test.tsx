// @vitest-environment happy-dom
import fs from "node:fs";
import path from "node:path";
import { afterEach, describe, expect, it, vi } from "vitest";
import { cleanup, fireEvent, render, screen } from "@testing-library/react";
import { ManaCostGlyphs, offCardSuffix, tokenSuffix, tokenize } from "@/components/cards/mana-cost-glyphs";
import { InlinePips } from "@/components/cards/inline-pips";
import { RulesSymbolToolbar } from "@/components/creator/rules-symbol-toolbar";
import { lintCardDesign, withDrawableSymbols } from "@/lib/ai/mtg-rules";
import { drawsManaGem } from "@/lib/cards/mana-gem";
import { HYBRID_PAIRS, canonicalHybridPair, normalizeManaCost } from "@/lib/cards/mana-order";
import { canonicalPipCode, joinPipRuns, pipSuffixForCode, splitPipRuns } from "@/lib/cards/pip-runs";
import { SYMBOL_STYLES } from "@/lib/cards/symbol-style";
import { undrawableSymbols } from "@/lib/validation/card-glyphs";

// ---------------------------------------------------------------------------
// The ten two-colour Phyrexian symbols ({G/U/P}: Tamiyo, Compleated Sage) in
// the creator's symbol toolbar, and OFF a card everywhere (TODO 6.16c).
//
// A card draws the symbol itself since layout v49 — a split disc, whichever
// way the pair was typed. Off a card (the toolbar, the rules editor's chips,
// a cost in a deck list or an article) the pip is mana-font's own class, and
// the font has ONE class per pair, in the printed order: "{U/G/P}" asked for
// a class with no glyph and showed an empty disc.
// ---------------------------------------------------------------------------

afterEach(cleanup);

/** The printed pair order: Scryfall's symbology (read 2026-10-08) and
 *  mana-font's ten classes. */
const TEN = ["{W/U/P}", "{W/B/P}", "{U/B/P}", "{U/R/P}", "{B/R/P}", "{B/G/P}", "{R/G/P}", "{R/W/P}", "{G/W/P}", "{G/U/P}"];
const NAMES = [
  "white or blue",
  "white or black",
  "blue or black",
  "blue or red",
  "black or red",
  "black or green",
  "red or green",
  "red or white",
  "green or white",
  "green or blue",
];
const reversed = (token: string) => `{${token[3]}/${token[1]}/P}`;
const classOf = (token: string) => `${token[1]}${token[3]}p`.toLowerCase();

const SHEET = fs.readFileSync(path.join(process.cwd(), "node_modules/mana-font/css/mana.css"), "utf8");
/** True when mana-font draws `.ms-cost.ms-<suffix>` as a split Phyrexian
 *  disc: a glyph in each half (::before and ::after) and the pair's own two
 *  colours. */
function fontDrawsSplit(suffix: string): boolean {
  const glyphs = new RegExp(`\\.ms-${suffix}::before, \\.ms-${suffix}::after[^{]*\\{\\s*content:`).test(SHEET);
  const colours = new RegExp(`\\.ms-cost\\.ms-${suffix} \\{\\s*--ms-split-top:`).test(SHEET);
  return glyphs && colours;
}

describe("the ten, in the printed pair order", () => {
  it("is the order the cost normalizer keeps, pair for pair", () => {
    expect(HYBRID_PAIRS.map((pair) => `{${pair[0]}/${pair[1]}/P}`)).toEqual(TEN);
    for (const token of TEN) {
      expect(normalizeManaCost(token), token).toBe(token);
      expect(normalizeManaCost(reversed(token)), reversed(token)).toBe(token);
      expect(canonicalHybridPair(token[3], token[1])).toBe(`${token[1]}${token[3]}`);
    }
    expect(canonicalHybridPair("W", "W")).toBeNull();
    expect(canonicalHybridPair("C", "W")).toBeNull();
  });

  it("mana-font has a class for each of the ten — and for no reversed pair", () => {
    for (const token of TEN) {
      expect(fontDrawsSplit(classOf(token)), token).toBe(true);
      expect(fontDrawsSplit(classOf(reversed(token))), reversed(token)).toBe(false);
    }
  });
});

describe("RulesSymbolToolbar — the ten buttons", () => {
  const open = () => {
    const onInsert = vi.fn();
    const { container } = render(<RulesSymbolToolbar onInsert={onInsert} />);
    return { onInsert, container };
  };

  it("each is named, inserts its printed token and draws mana-font's pip", () => {
    const { onInsert } = open();
    TEN.forEach((token, index) => {
      const name = `Insert ${NAMES[index]} Phyrexian mana ${token}`;
      const button = screen.getByRole("button", { name, hidden: true });
      expect(button.getAttribute("title")).toBe(
        `${NAMES[index][0].toUpperCase()}${NAMES[index].slice(1)} Phyrexian mana — inserts ${token}`,
      );
      // A real button: reachable with Tab, pressed with Enter / Space.
      expect(button.tagName).toBe("BUTTON");
      expect(button.getAttribute("type")).toBe("button");
      expect(button.hasAttribute("tabindex")).toBe(false);
      const glyph = button.querySelector("i")!;
      expect(glyph.classList.contains("ms-cost")).toBe(true);
      expect(glyph.classList.contains(`ms-${classOf(token)}`), token).toBe(true);
      fireEvent.click(button);
      expect(onInsert).toHaveBeenLastCalledWith(token);
    });
    expect(onInsert).toHaveBeenCalledTimes(10);
  });

  it("they follow the one-colour Phyrexian symbols, in order, in the same group", () => {
    const { container } = open();
    const labels = [...container.querySelectorAll("details button")].map((b) => b.getAttribute("aria-label"));
    const first = labels.indexOf(`Insert white or blue Phyrexian mana {W/U/P}`);
    expect(labels[first - 1]).toBe("Insert {G/P}");
    expect(labels.slice(first)).toEqual(TEN.map((token, i) => `Insert ${NAMES[i]} Phyrexian mana ${token}`));
  });

  it("no other button changed its name", () => {
    const { container } = open();
    const labels = [...container.querySelectorAll("button")].map((b) => b.getAttribute("aria-label")!);
    // 37 symbol buttons + the ten, and the two typography buttons (— and •, 6.11).
    expect(labels).toHaveLength(49);
    const symbols = labels.filter((label) => /\{[^}]+\}$/.test(label));
    expect(symbols).toHaveLength(47);
    for (const label of symbols.slice(0, 37)) expect(label).toMatch(/^Insert \{[^}]+\}$/);
    expect(labels.filter((label) => !symbols.includes(label))).toHaveLength(2);
  });
});

describe("off a card, either typed order draws", () => {
  it("offCardSuffix is the pair's one class; the card's own suffix keeps the order typed", () => {
    for (const token of TEN) {
      for (const written of [token, reversed(token), token.toLowerCase(), reversed(token).toLowerCase()]) {
        const [parsed] = tokenize(written);
        expect(offCardSuffix(parsed), written).toBe(classOf(token));
        expect(fontDrawsSplit(offCardSuffix(parsed)!), written).toBe(true);
      }
      // The bake and the preview read tokenSuffix: unchanged, so no pixel is.
      expect(tokenSuffix(tokenize(reversed(token))[0])).toBe(classOf(reversed(token)));
    }
  });

  it("every other symbol keeps the class it had (a plain hybrid typed the other way: 6.16d)", () => {
    const others = "{W}{U}{B}{R}{G}{C}{X}{0}{7}{20}{T}{Q}{S}{E}{W/U}{G/U}{2/W}{W/P}{G/P}{C/P}{W/W/P}{CHAOS}";
    for (const token of tokenize(others)) expect(offCardSuffix(token)).toBe(tokenSuffix(token));
  });

  it("ManaCostGlyphs (pickers, deck lists, articles) draws the pair's class", () => {
    for (const token of TEN) {
      for (const written of [token, reversed(token)]) {
        const { container, unmount } = render(<ManaCostGlyphs cost={`{X}${written}{G}`} />);
        const classes = [...container.querySelectorAll("i")].map((i) => i.className);
        expect(classes, written).toEqual([
          "ms ms-cost ms-shadow ms-x",
          `ms ms-cost ms-shadow ms-${classOf(token)}`,
          "ms ms-cost ms-shadow ms-g",
        ]);
        unmount();
      }
    }
  });

  it("a CARD's row is not touched: it draws its own split disc, in the order typed", () => {
    const disc = { size: "8cqw", gap: "1cqw", px: 100 };
    const { container } = render(<ManaCostGlyphs cost="{U/G/P}" disc={disc} />);
    expect(container.querySelector("[data-pip]")!.getAttribute("data-pip")).toBe("ugp");
    expect([...container.querySelectorAll("i")].map((i) => i.className)).toEqual(["ms ms-p", "ms ms-p"]);
  });

  it("the rules editor's chips and InlinePips read it as a pip, the text kept as typed", () => {
    for (const token of TEN) {
      for (const written of [token, reversed(token), token.toLowerCase()]) {
        const code = canonicalPipCode(written.slice(1, -1));
        expect(code, written).toBe(written.toUpperCase());
        expect(pipSuffixForCode(code!), written).toBe(classOf(token));
        const text = `Pay ${written}: draw.`;
        const runs = splitPipRuns(text);
        expect(runs[1]).toEqual({ kind: "pip", code: written.toUpperCase(), suffix: classOf(token) });
        expect(joinPipRuns(runs)).toHaveLength(text.length);
      }
    }
    // Never a pair of one colour, a colourless or a twobrid Phyrexian.
    for (const inner of ["W/W/P", "C/W/P", "2/W/P", "W/U/B", "W/U/PP"]) expect(canonicalPipCode(inner), inner).toBeNull();
    const { container } = render(<InlinePips text="Pay {u/g/p}." />);
    const pip = container.querySelector("i")!;
    expect(pip.getAttribute("aria-label")).toBe("{U/G/P}");
    expect(pip.classList.contains("ms-gup")).toBe(true);
  });
});

describe("never warned, never refused", () => {
  it("the creator's undrawable-symbol notice is silent for all ten, either order, in every style", () => {
    for (const token of TEN) {
      for (const written of [token, reversed(token), token.toLowerCase()]) {
        for (const style of Object.values(SYMBOL_STYLES)) {
          expect(drawsManaGem(tokenSuffix(tokenize(written)[0])!, style), written).toBe(true);
          expect(undrawableSymbols(written, { symbols: style }), `${written} (${style.id})`).toEqual([]);
          expect(undrawableSymbols(`{T}, Pay ${written}: Draw a card.`, { symbols: style })).toEqual([]);
        }
      }
    }
    expect(undrawableSymbols(TEN.join(""))).toEqual([]);
  });

  it("the AI lint accepts each in a cost and in rules text, and the autofix leaves it alone", () => {
    TEN.forEach((token, index) => {
      const [first, second] = NAMES[index].split(" or ");
      const { errors } = lintCardDesign({
        title: "Compleated Probe",
        cost: normalizeManaCost(`{2}${token}`),
        card_type: "creature",
        color_identity: [first, second] as never,
        rules_text: `${token}: This creature gets +1/+0 until end of turn.`,
        power: "2",
        toughness: "2",
        loyalty: null,
        defense: null,
      });
      expect(errors.filter((e) => e.message.includes("can't be drawn")), token).toEqual([]);
      expect(withDrawableSymbols(`{2}${token}`)).toBe(`{2}${token}`);
    });
  });
});
