// @vitest-environment happy-dom
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { afterEach, describe, expect, it, vi } from "vitest";
import { cleanup, fireEvent, render, screen } from "@testing-library/react";
import { normalizeManaCostWithSymbols, normalizeManaCost } from "@/lib/cards/mana-order";
import { effectiveEntryFields } from "@/lib/decks/effective-entry";
import { computeDeckAnalytics } from "@/lib/decks/analytics";
import { computeDeckCharts, costColorSymbols } from "@/lib/decks/deck-charts";
import { costNamesCustomSymbol, type OwnerSymbols, type SymbolMeanings } from "@/lib/symbols/symbol-token";
import { costColors } from "@/lib/tools/play-exports/model";
import { buildCardsExport } from "@/lib/tools/play-exports/build";
import { ManaCostPicker } from "@/components/cards/mana-cost-picker";
import { OwnSymbolsProvider, type OwnSymbolChoice } from "@/components/cards/own-symbols";
import { RulesSymbolToolbar } from "@/components/creator/rules-symbol-toolbar";
import type { DeckCardEntry } from "@/types/deck";
import { CARD_COST_MAX } from "@/lib/validation/card";
import { publicDeckItems } from "@/lib/decks/private-card-name";
import { BASE_URL, OTHER, OWNER, cardRow } from "../tools/play-exports-fixtures";

// ---------------------------------------------------------------------------
// The owner's own symbols where they are PICKED and where LISTS count them
// (new pips PR 4):
//   * the creator's cost picker and rules toolbar offer the maker's live
//     symbols ("Your symbols") — only when the creator gives them, i.e. while
//     the tool is open to the maker (lib/symbols/queries.ts) — each adding
//     `{*CODE}`, kept after the coloured symbols in the cost;
//   * the deck read carries each card OWNER's symbols (one batched read),
//     and the deck's mana value, curve, colour symbols and the play exports
//     count what each declares — never the letters of its code.
// ---------------------------------------------------------------------------

vi.mock("server-only", () => ({}));
vi.mock("@/lib/supabase/env", () => ({ isSupabaseConfigured: () => true }));
vi.mock("@/lib/supabase/server", () => ({ createClient: async () => ({}) }));

afterEach(() => cleanup());

const MEANINGS: SymbolMeanings = {
  FIRE: { manaValue: 3, baseColor: "R" },
  BUG: { manaValue: 2, baseColor: null },
};
const SYMBOLS: OwnerSymbols = { meanings: MEANINGS, pictures: { "*FIRE": "data:image/png;base64,AAAA" } };

const CHOICES: OwnSymbolChoice[] = [
  { code: "FIRE", name: "Ember", imageUrl: "data:image/png;base64,AAAA" },
  { code: "BUG", name: "Swarm", imageUrl: "data:image/png;base64,BBBB" },
];

const read = (path: string) => readFileSync(join(process.cwd(), path), "utf8");

describe("the picker's order", () => {
  it("keeps every other symbol in print order and the owner's after the colours, before {T} / {E}", () => {
    expect(normalizeManaCostWithSymbols("{R}{*FIRE}{2}")).toBe("{2}{R}{*FIRE}");
    expect(normalizeManaCostWithSymbols("{*FIRE}{G}{1}{*BUG}{1}")).toBe("{2}{G}{*FIRE}{*BUG}");
    expect(normalizeManaCostWithSymbols("{T}{*fire}{U}")).toBe("{U}{*fire}{T}");
    expect(normalizeManaCostWithSymbols("{*FIRE}")).toBe("{*FIRE}");
  });

  it("drops a lone {0} beside an own symbol, as beside any other mana", () => {
    // The stepper at 0, "Add", then the symbol: never a printed "0".
    expect(normalizeManaCostWithSymbols("{0}{*FIRE}")).toBe("{*FIRE}");
    expect(normalizeManaCostWithSymbols("{*FIRE}{0}")).toBe("{*FIRE}");
    expect(normalizeManaCost("{0}{R}")).toBe("{R}");
    // A {0} on its own is still a cost (Ornithopter).
    expect(normalizeManaCostWithSymbols("{0}")).toBe("{0}");
  });

  it("is normalizeManaCost's answer without an own symbol, and leaves anything outside the grammar alone", () => {
    expect(normalizeManaCostWithSymbols("{R}{2}")).toBe(normalizeManaCost("{R}{2}"));
    expect(normalizeManaCostWithSymbols("{R}{*FIRE} text")).toBe("{R}{*FIRE} text");
    expect(normalizeManaCostWithSymbols("{*FIRE}{*TOOLONGCODE}{R}")).toBe("{*FIRE}{*TOOLONGCODE}{R}");
    expect(normalizeManaCostWithSymbols("{*FIRE}{CHAOS}{R}")).toBe("{*FIRE}{CHAOS}{R}");
  });

  it("the card actions keep normalizeManaCost: a saved cost with an own symbol is never re-ordered", () => {
    expect(normalizeManaCost("{*FIRE}{R}{1}")).toBe("{*FIRE}{R}{1}");
    for (const file of ["lib/cards/actions.ts"]) expect(read(file)).not.toContain("normalizeManaCostWithSymbols");
  });
});

describe("the cost picker", () => {
  it("offers no own symbols outside the creator's provider", () => {
    render(<ManaCostPicker value="" onChange={() => {}} />);
    expect(screen.queryByRole("group", { name: "Your symbols" })).toBeNull();
  });

  it("offers the maker's symbols by name and code, each adding {*CODE} after the colours", () => {
    const onChange = vi.fn();
    render(
      <OwnSymbolsProvider symbols={CHOICES}>
        <ManaCostPicker value="{R}{1}" onChange={onChange} />
      </OwnSymbolsProvider>,
    );
    const group = screen.getByRole("group", { name: "Your symbols" });
    expect(group.querySelectorAll("button")).toHaveLength(2);
    fireEvent.click(screen.getByRole("button", { name: "Add Ember {*FIRE}" }));
    expect(onChange).toHaveBeenLastCalledWith("{1}{R}{*FIRE}");
  });

  it("a symbol the cost has no room for is dimmed and not added", () => {
    const onChange = vi.fn();
    // Room for no 7-character `{*FIRE}`, yet a cost the picker reads.
    const full = "{R}".repeat(Math.floor((CARD_COST_MAX - 4) / 3));
    render(
      <OwnSymbolsProvider symbols={CHOICES}>
        <ManaCostPicker value={full} onChange={onChange} />
      </OwnSymbolsProvider>,
    );
    const button = screen.getByRole("button", { name: "Add Ember {*FIRE}" });
    expect(button.getAttribute("aria-disabled")).toBe("true");
    fireEvent.click(button);
    expect(onChange).not.toHaveBeenCalled();
  });
});

describe("the rules toolbar", () => {
  it("offers no own symbols outside the creator's provider", () => {
    render(<RulesSymbolToolbar onInsert={() => {}} />);
    expect(screen.queryByRole("group", { name: "Your symbols" })).toBeNull();
  });

  it("inserts {*CODE} for each of the maker's symbols", () => {
    const onInsert = vi.fn();
    render(
      <OwnSymbolsProvider symbols={CHOICES}>
        <RulesSymbolToolbar onInsert={onInsert} />
      </OwnSymbolsProvider>,
    );
    fireEvent.click(screen.getByRole("button", { name: "Insert Swarm {*BUG}" }));
    expect(onInsert).toHaveBeenLastCalledWith("{*BUG}");
  });

  it("the creator gives the provider the gated choices on both pages", () => {
    const form = read("components/creator/card-creator-form.tsx");
    expect(form.match(/<OwnSymbolsProvider symbols=\{ownSymbols\}>/g)).toHaveLength(2);
    for (const page of ["app/(app)/create/page.tsx", "app/(app)/card/[username]/edit/page.tsx"]) {
      // Read beside the pips and the meanings (one Promise.all), never a
      // serial await in the JSX.
      expect(read(page)).toMatch(/await Promise\.all\(\[\s*getPipOverrides\(user\.id\),\s*getSymbolMeanings\(user\.id\),\s*listOwnSymbolChoices\(user\.id\),[\s\S]*?\]\)/);
      expect(read(page)).toContain("ownSymbols={ownSymbols}");
    }
    const queries = read("lib/symbols/queries.ts");
    expect(queries).toMatch(/getViewerTool\(CUSTOM_SYMBOLS_SLUG\)[\s\S]*if \(!tool\?\.allowed\) return \[\];/);
    expect(queries).toMatch(/filter\(\(symbol\) => !symbol\.deletedAt\)/);
  });
});

const entry = (over: Partial<DeckCardEntry> = {}): DeckCardEntry =>
  ({
    id: "e1",
    deck_id: "d1",
    card_id: "c1",
    scryfall_id: null,
    name: "Ember Wolf",
    quantity: 1,
    board: "main",
    position: 0,
    source: "creator",
    created_at: "2026-11-01T00:00:00Z",
    type_line: null,
    mana_cost: null,
    mana_value: null,
    color_identity: [],
    ...over,
  }) as unknown as DeckCardEntry;

const deckCard = (over: Record<string, unknown> = {}) =>
  ({
    id: "c1",
    owner_id: OWNER,
    title: "Ember Wolf",
    visibility: "public",
    card_type: "creature",
    supertype: null,
    subtypes: [],
    cost: "{1}{*FIRE}",
    color_identity: ["red"],
    frame_style: { template: "m15" },
    back_face: null,
    ...over,
  }) as never;

describe("decks", () => {
  it("costNamesCustomSymbol reads the front's and the second face's cost", () => {
    expect(costNamesCustomSymbol({ cost: "{1}{*fire}" })).toBe(true);
    expect(costNamesCustomSymbol({ cost: "{1}", back_face: { cost: "{*BUG}" } })).toBe(true);
    expect(costNamesCustomSymbol({ cost: "{1}", back_face: { rules_text: "{*BUG}" } })).toBe(false);
    expect(costNamesCustomSymbol(null)).toBe(false);
  });

  it("an entry's mana value counts the card owner's symbol — 0 without the map", () => {
    expect(effectiveEntryFields(entry(), deckCard(), undefined, MEANINGS).manaValue).toBe(4);
    expect(effectiveEntryFields(entry(), deckCard()).manaValue).toBe(1);
    // A split card's halves both read it.
    const split = deckCard({ frame_style: { template: "split" }, back_face: { cost: "{*BUG}" } });
    expect(effectiveEntryFields(entry(), split, undefined, MEANINGS).manaValue).toBe(6);
  });

  it("the breakdown's total, curve and colour symbols read the row's owner symbols", () => {
    const items = [{ entry: entry({ quantity: 2 }), card: deckCard(), ownerSymbols: SYMBOLS }];
    expect(computeDeckAnalytics(items).totalManaValue).toBe(8);
    const charts = computeDeckCharts(items as never);
    expect(charts.curve[4].total).toBe(2);
    expect(costColorSymbols("{1}{*FIRE}{*BUG}", MEANINGS)).toMatchObject({ R: 1, W: 0, U: 0, B: 0, G: 0, C: 0 });
    // Never the letters of a code: {*BUG} is neither black nor green.
    expect(costColorSymbols("{*BUG}")).toMatchObject({ B: 0, U: 0, G: 0 });
  });

  it("a visitor's masked list keeps each row's owner symbols", () => {
    const items = [{ entry: entry(), card: deckCard(), ownerSymbols: SYMBOLS, cardOwner: null }];
    expect(publicDeckItems(items, false)[0]!.ownerSymbols).toBe(SYMBOLS);
  });

  it("the deck rows draw the owner's pictures in the cost", () => {
    for (const file of ["components/decks/deck-card-views.tsx", "components/decks/deck-preview-pane.tsx", "components/decks/deck-card-modal.tsx"]) {
      expect(read(file)).toMatch(/overrides=\{(row\.)?item\.ownerSymbols\?\.pictures\}/);
    }
  });
});

describe("play exports", () => {
  it("a cost's colours are a symbol's declared colour, never the letters of its code", () => {
    expect(costColors("{*FIRE}{*BUG}")).toEqual([]);
    expect(costColors("{*FIRE}{*BUG}{G}", MEANINGS)).toEqual(["R", "G"]);
    expect(costColors("{*TOOLONGCODE}{U}")).toEqual(["U"]);
  });

  it("the mana value counts the card OWNER's symbols; the cost text keeps {*CODE}", () => {
    const mine = cardRow({ cost: "{1}{*FIRE}", color_identity: ["red"] });
    const theirs = cardRow({ owner_id: OTHER, cost: "{1}{*FIRE}", color_identity: ["red"] });
    const exp = buildCardsExport([mine, theirs], {
      baseUrl: BASE_URL,
      usernames: new Map(),
      symbols: new Map([[OWNER, SYMBOLS]]),
      cardBackUrl: `${BASE_URL}/back.png`,
    });
    const [a, b] = exp.cards;
    expect(a.manaValue).toBe(4);
    expect(a.front.cost).toBe("{1}{*FIRE}");
    expect(a.front.colors).toEqual(["R"]);
    // Another owner with no FIRE: 0, and the frame's colour.
    expect(b.manaValue).toBe(1);
    expect(b.front.colors).toEqual(["R"]);
  });
});

describe("the batched read", () => {
  it("reads nothing for no owners, and a failed read is an empty map (every code then counts 0)", async () => {
    const { readOwnerSymbolsOf } = await import("@/lib/pips/queries");
    expect((await readOwnerSymbolsOf([])).size).toBe(0);
    const spy = vi.spyOn(console, "error").mockImplementation(() => {});
    // The mocked client has no `from`: the read throws.
    expect((await readOwnerSymbolsOf([OWNER])).size).toBe(0);
    expect(spy).toHaveBeenCalled();
    spy.mockRestore();
  });

  it("groups the rows by owner: meanings by the table's CHECKs, pictures only the owner's own objects", async () => {
    const { ownerSymbolsFromRows } = await import("@/lib/pips/queries");
    const pic = (owner: string) => `https://zkwkisxoqdhdchqyjwdc.supabase.co/storage/v1/object/public/custom-pips/${owner}/sym-1.png?v=1`;
    const map = ownerSymbolsFromRows([
      { owner_id: OWNER, code: "FIRE", image_url: pic(OWNER), mana_value: 3, base_color: "R" },
      { owner_id: OWNER, code: "BUG", image_url: pic(OTHER), mana_value: 2, base_color: null },
      { owner_id: OTHER, code: "ICE", image_url: pic(OTHER), mana_value: 25, base_color: "U" },
    ]);
    expect(map.get(OWNER)).toEqual({
      meanings: MEANINGS,
      pictures: { "*FIRE": pic(OWNER) },
    });
    expect(map.get(OTHER)).toEqual({ meanings: {}, pictures: { "*ICE": pic(OTHER) } });
  });
});
