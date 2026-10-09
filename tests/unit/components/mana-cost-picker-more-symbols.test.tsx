// @vitest-environment happy-dom
import { useState } from "react";
import { afterEach, describe, expect, it, vi } from "vitest";
import { cleanup, fireEvent, render, screen, within } from "@testing-library/react";
import { ManaCostGlyphs, offCardSuffix, tokenSuffix, tokenize } from "@/components/cards/mana-cost-glyphs";
import { ManaCostPicker } from "@/components/cards/mana-cost-picker";
import { RulesSymbolToolbar } from "@/components/creator/rules-symbol-toolbar";
import { HYBRID_PAIRS } from "@/lib/cards/mana-order";
import { MORE_SYMBOLS, MORE_SYMBOLS_LABEL, MORE_SYMBOL_GROUPS } from "@/lib/cards/more-symbols";
import { pipSuffixForCode } from "@/lib/cards/pip-runs";
import { deriveColorIdentity } from "@/lib/creator/card-fields";
import { CARD_COST_MAX, cardCostSchema } from "@/lib/validation/card";

// ---------------------------------------------------------------------------
// The cost picker's "Hybrid, twobrid & Phyrexian symbols…" group (TODO
// 6.16d): the rules toolbar's thirty, in its order, added through the
// picker's own normalising path — and what the picker does at the cost's
// 64-character limit.
// ---------------------------------------------------------------------------

afterEach(cleanup);

/** A symbol's mana-font class, from its code ("{W/U}" → the pair's class).
 *  Built from the token, never written out (mana-class-collision.test.ts). */
const classOf = (token: string) => `ms-${token.slice(1, -1).split("/").join("").toLowerCase()}`;
const nameOf = (token: string) => `Add ${MORE_SYMBOLS.find((s) => s.token === token)!.name} ${token}`;

/** The picker with a real value behind it, as the form's Controller gives. */
function Harness({ initial = "", spy }: { initial?: string; spy?: (next: string) => void }) {
  const [cost, setCost] = useState(initial);
  return (
    <>
      <ManaCostPicker
        value={cost}
        onChange={(next) => {
          spy?.(next);
          setCost(next);
        }}
      />
      <span data-testid="cost">{cost}</span>
    </>
  );
}
const costNow = () => screen.getByTestId("cost").textContent;
const button = (name: string) => screen.getByRole("button", { name, hidden: true });
const rowClasses = (container: HTMLElement) =>
  [...container.querySelectorAll('[role="img"] i')].map((i) => i.className.split(" ").at(-1));

describe("the group", () => {
  it("is collapsed until asked for, under the toolbar's label", () => {
    const { container } = render(<Harness />);
    const details = container.querySelector("details")!;
    expect(details.hasAttribute("open")).toBe(false);
    const summary = details.querySelector("summary")!;
    expect(summary.textContent).toBe(MORE_SYMBOLS_LABEL);
    // A <summary> is in the tab order by itself: nothing may take it out.
    expect(summary.hasAttribute("tabindex")).toBe(false);
    fireEvent.click(summary);
    expect(details.hasAttribute("open")).toBe(true);
    fireEvent.click(summary);
    expect(details.hasAttribute("open")).toBe(false);
  });

  it("inside a field's <label>, only a control acts: the summary and the plain parts press nothing", () => {
    // Every mount is inside FieldGroup's <label>, which forwards a click on
    // plain content to its first button — the picker's "Remove last".
    // A browser skips that for a cancelled click (checked in Chromium on the
    // creator); the test environment's <label> forwards regardless, so this
    // holds the cancelling itself.
    const spy = vi.fn();
    const { container } = render(<Harness initial="{2}{W/U}" spy={spy} />);
    const cancelled = (target: Element) => !fireEvent.click(target);
    expect(cancelled(container.querySelector("summary")!)).toBe(true);
    expect(container.querySelector("details")!.hasAttribute("open")).toBe(true);
    expect(cancelled(screen.getByRole("status"))).toBe(true);
    expect(cancelled(screen.getByRole("group", { name: "Hybrid mana" }))).toBe(true);
    expect(cancelled(screen.getByText("Generic"))).toBe(true);
    expect(spy).not.toHaveBeenCalled();
    // A button's own click is left alone.
    expect(cancelled(button("Add White"))).toBe(false);
    expect(costNow()).toBe("{2}{W}{W/U}");
  });

  it("holds the toolbar's thirty, in the toolbar's order", () => {
    const { container, unmount } = render(<Harness />);
    const picked = [...container.querySelectorAll("details button")].map((b) => /\{[^}]+\}$/.exec(b.getAttribute("aria-label")!)![0]);
    unmount();
    const toolbar = render(<RulesSymbolToolbar onInsert={() => {}} />);
    const offered = [...toolbar.container.querySelectorAll("details button")].map((b) => /\{[^}]+\}$/.exec(b.getAttribute("aria-label")!)![0]);
    expect(picked).toHaveLength(30);
    expect(picked).toEqual(offered);
    expect(picked).toEqual(MORE_SYMBOLS.map((symbol) => symbol.token));
  });

  it("each button is named, a real button, and draws mana-font's pip", () => {
    const { container } = render(<Harness />);
    for (const group of MORE_SYMBOL_GROUPS) {
      const row = within(container.querySelector("details")!).getByRole("group", { name: group.label, hidden: true });
      expect(row.querySelectorAll("button")).toHaveLength(group.symbols.length);
    }
    for (const { token, name } of MORE_SYMBOLS) {
      const b = button(`Add ${name} ${token}`);
      expect(b.tagName).toBe("BUTTON");
      expect(b.getAttribute("type")).toBe("button");
      expect(b.hasAttribute("tabindex")).toBe(false);
      expect(b.hasAttribute("disabled")).toBe(false);
      expect(b.getAttribute("title")).toBe(`${name[0].toUpperCase()}${name.slice(1)} — adds ${token}`);
      const glyph = b.querySelector("i")!;
      expect(glyph.classList.contains("ms-cost"), token).toBe(true);
      expect(glyph.classList.contains(classOf(token)), token).toBe(true);
    }
    // The buttons the picker already had keep their names.
    for (const name of ["Add White", "Add Blue", "Add Black", "Add Red", "Add Green", "Add Colorless", "Add X mana", "Add Tap", "Add Snow", "Add Energy"]) {
      expect(button(name)).toBeTruthy();
    }
  });
});

describe("adding", () => {
  // One test per symbol: thirty mounts in one test ran past the time limit
  // on a loaded machine.
  it.each(MORE_SYMBOLS.map((symbol) => symbol.token))("%s adds its printed token, and the cost row draws it", (token) => {
    const spy = vi.fn();
    const { container } = render(<Harness spy={spy} />);
    fireEvent.click(button(nameOf(token)));
    expect(spy).toHaveBeenCalledTimes(1);
    expect(spy).toHaveBeenLastCalledWith(token);
    expect(rowClasses(container), token).toEqual([classOf(token)]);
    // Twice stacks; remove-last takes one back; clear empties.
    fireEvent.click(button(nameOf(token)));
    expect(costNow()).toBe(token + token);
    fireEvent.click(button("Remove last mana symbol"));
    expect(costNow()).toBe(token);
    fireEvent.click(button("Clear cost"));
    expect(costNow()).toBe("");
    expect(container.querySelector('[role="img"]')).toBeNull();
  });

  // Costs as printed (Scryfall, read 2026-10-08), built by clicking the
  // picker's buttons in the WRONG order: last symbol first.
  const PRINTED: Array<[card: string, cost: string]> = [
    ["Tamiyo, Compleated Sage", "{2}{G}{G/U/P}{U}"],
    ["Ajani, Sleeper Agent", "{1}{G}{G/W/P}{W}"],
    ["Lukka, Bound to Ruin", "{2}{R}{R/G/P}{G}"],
    ["Nahiri, the Unforgiving", "{1}{R}{R/W/P}{W}"],
    ["Jace, the Perfected Mind", "{2}{U}{U/P}"],
    ["Nissa, Ascended Animist", "{3}{G}{G}{G/P}{G/P}"],
    ["Omnath, Locus of All", "{W}{U}{B/P}{R}{G}"],
    ["K'rrik, Son of Yawgmoth", "{4}{B/P}{B/P}{B/P}"],
    ["Reaper King", "{2/W}{2/U}{2/B}{2/R}{2/G}"],
    ["Temur Tawnyback", "{2/G}{2/U}{2/R}"],
    ["Reigning Victor", "{2/R}{2/W}{2/B}"],
    ["Stirring Honormancer", "{2}{W}{W/B}{B}"],
    ["Toluz, Clever Conductor", "{W/U}{U}{U/B}"],
    ["Indominus Rex, Alpha", "{1}{U/B}{U/B}{G}{G}"],
    ["The Fourteenth Doctor", "{R/G}{W}{U}"],
    ["Kaust, Eyes of the Glade", "{R/W}{G}"],
    ["Biomass Mutation", "{X}{G/U}{G/U}"],
  ];
  const SIMPLE: Record<string, string> = { W: "Add White", U: "Add Blue", B: "Add Black", R: "Add Red", G: "Add Green", X: "Add X mana" };

  it.each(PRINTED)("%s: %s, whichever order it is clicked in", (_card, cost) => {
    const tokens = [...cost.matchAll(/\{([^}]+)\}/g)].map((m) => m[1]);
    for (const order of [tokens, [...tokens].reverse()]) {
      const { container, unmount } = render(<Harness />);
      for (const inner of order) {
        if (/^\d+$/.test(inner)) {
          fireEvent.change(container.querySelector('input[type="number"]')!, { target: { value: inner } });
          fireEvent.click(screen.getByText("Add").closest("button")!);
        } else {
          fireEvent.click(button(SIMPLE[inner] ?? nameOf(`{${inner}}`)));
        }
      }
      expect(costNow()).toBe(cost);
      // Remove-last takes the last PRINTED symbol.
      fireEvent.click(button("Remove last mana symbol"));
      expect(costNow()).toBe(cost.slice(0, cost.lastIndexOf("{")));
      unmount();
    }
  });

  it("the frame colour follows such a cost as it does any other", () => {
    expect(deriveColorIdentity("{2}{W/U}")).toEqual(["white", "blue"]);
    expect(deriveColorIdentity("{2/R}{2/R}")).toEqual(["red"]);
    expect(deriveColorIdentity("{3}{B/P}")).toEqual(["black"]);
    expect(deriveColorIdentity("{2}{G}{G/U/P}{U}")).toEqual(["green", "blue"]);
  });
});

describe("at the cost's limit", () => {
  const full = "{W/U/P}".repeat(9); // 63 characters

  it("the limit is the schema's", () => {
    expect(CARD_COST_MAX).toBe(64);
    expect(cardCostSchema.safeParse("{W}".repeat(21) + "{").success).toBe(true);
    expect(cardCostSchema.safeParse("{W/U}".repeat(13)).success).toBe(false);
  });

  it("no symbol is added past it: the button dims, says why, and stays reachable", () => {
    const spy = vi.fn();
    render(<Harness initial={full} spy={spy} />);
    const status = screen.getByRole("status");
    expect(status.textContent).toBe(
      "A cost holds up to 64 characters — the dimmed symbols no longer fit. Remove one to add another.",
    );
    expect(status.classList.contains("sr-only")).toBe(false);
    for (const name of ["Add White", "Add Tap", nameOf("{W/U}"), nameOf("{2/G}"), nameOf("{R/P}"), nameOf("{G/U/P}")]) {
      const b = button(name);
      expect(b.getAttribute("aria-disabled"), name).toBe("true");
      // Not `disabled`: the keyboard keeps its place.
      expect(b.hasAttribute("disabled")).toBe(false);
      expect(b.getAttribute("title")).toMatch(/ — the cost is full \(64 characters\)$/);
      fireEvent.click(b);
    }
    fireEvent.click(screen.getByText("Add").closest("button")!);
    expect(spy).not.toHaveBeenCalled();
    expect(costNow()).toBe(full);

    // Removing one makes room again.
    fireEvent.click(button("Remove last mana symbol"));
    expect(costNow()).toHaveLength(56);
    expect(button(nameOf("{G/U/P}")).hasAttribute("aria-disabled")).toBe(false);
    expect(screen.getByRole("status").textContent).toBe("");
    expect(screen.getByRole("status").classList.contains("sr-only")).toBe(true);
    fireEvent.click(button(nameOf("{G/U/P}")));
    expect(costNow()).toHaveLength(63);
  });

  it("only the symbols that no longer fit are refused", () => {
    // 60 characters: a five-character symbol fits (65 would not), three do.
    render(<Harness initial={"{W/U}".repeat(12)} />);
    expect(button("Add White").hasAttribute("aria-disabled")).toBe(false);
    expect(button(nameOf("{W/U}")).getAttribute("aria-disabled")).toBe("true");
    expect(button(nameOf("{W/U/P}")).getAttribute("aria-disabled")).toBe("true");
    expect(screen.getByRole("status").textContent).not.toBe("");
    fireEvent.click(button("Add White"));
    expect(costNow()).toHaveLength(63);
    expect(button("Add White").getAttribute("aria-disabled")).toBe("true");
  });

  it("a generic number that merges into the one there still fits", () => {
    // {9} + 12 hybrids = 63; {9} + {1} = {10}: 64, so it is added.
    render(<Harness initial={"{9}" + "{W/U}".repeat(12)} />);
    const add = screen.getByText("Add").closest("button")!;
    expect(add.hasAttribute("aria-disabled")).toBe(false);
    fireEvent.click(add);
    expect(costNow()).toBe("{10}" + "{W/U}".repeat(12));
    expect(costNow()).toHaveLength(64);
    expect(cardCostSchema.safeParse(costNow()).success).toBe(true);
  });

  it("an empty cost says nothing", () => {
    render(<Harness />);
    expect(screen.getByRole("status").textContent).toBe("");
  });
});

describe("off a card, a plain hybrid typed the other way round draws", () => {
  const reversed = HYBRID_PAIRS.map((pair) => [`{${pair[0]}/${pair[1]}}`, `{${pair[1]}/${pair[0]}}`] as const);

  it("offCardSuffix is the pair's one class; the card's own suffix keeps the order typed", () => {
    for (const [printed, typed] of reversed) {
      for (const written of [printed, typed, typed.toLowerCase()]) {
        expect(`ms-${offCardSuffix(tokenize(written)[0])}`, written).toBe(classOf(printed));
        expect(`ms-${pipSuffixForCode(written.toUpperCase())}`, written).toBe(classOf(printed));
      }
      // The bake and the preview read tokenSuffix: unchanged, so no pixel is.
      expect(`ms-${tokenSuffix(tokenize(typed)[0])}`).toBe(classOf(typed));
    }
  });

  it("a twobrid, a one-colour Phyrexian and everything else keep the class they had", () => {
    const others = "{W}{U}{B}{R}{G}{C}{X}{0}{7}{20}{T}{Q}{S}{E}{2/W}{2/G}{3/U}{W/P}{G/P}{C/P}{W/W}{W/W/P}{CHAOS}";
    for (const token of tokenize(others)) expect(offCardSuffix(token)).toBe(tokenSuffix(token));
  });

  it("ManaCostGlyphs (pickers, deck lists, articles) draws the pair's class; a card's row draws its own", () => {
    for (const [printed, typed] of reversed) {
      const { container, unmount } = render(<ManaCostGlyphs cost={`{X}${typed}`} />);
      expect(rowClasses(container), typed).toEqual(["ms-x", classOf(printed)]);
      unmount();
    }
    const disc = { size: "8cqw", gap: "1cqw", px: 100 };
    const { container } = render(<ManaCostGlyphs cost="{U/W}" disc={disc} />);
    expect(container.querySelector("[data-pip]")!.getAttribute("data-pip")).toBe("uw");
  });
});
