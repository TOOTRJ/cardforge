import { describe, expect, it } from "vitest";
import { deckToText, exportEntriesOf, type ExportEntry } from "@/lib/decks/export-text";
import { parseDecklist } from "@/lib/decks/parse-decklist";
import type { DeckBoard } from "@/types/deck";

const entry = (
  name: string,
  quantity: number,
  board: DeckBoard = "main",
  extra: Partial<ExportEntry> = {},
): ExportEntry => ({
  name,
  quantity,
  board,
  set_code: null,
  collector_number: null,
  proxyTitle: null,
  ...extra,
});

const DECK = { title: "Krenko Goblin Swarm" };

const ENTRIES: ExportEntry[] = [
  entry("Krenko, Mob Boss", 1, "commander", {
    set_code: "fdn",
    collector_number: "204",
  }),
  entry("Lightning Bolt", 4),
  entry("Mountain", 20),
  entry("Pyroblast", 2, "side"),
  entry("Some Maybe Card", 3, "maybe"),
];

describe("deckToText — arena style", () => {
  const text = deckToText(DECK, ENTRIES, { style: "arena" });

  it("emits About/Name and section headers with printings", () => {
    expect(text).toContain("About\nName Krenko Goblin Swarm");
    expect(text).toContain("Commander\n1 Krenko, Mob Boss (FDN) 204");
    expect(text).toContain("Deck\n4 Lightning Bolt");
    expect(text).toContain("Sideboard\n2 Pyroblast");
  });

  it("never exports the maybeboard", () => {
    expect(text).not.toContain("Some Maybe Card");
  });

  it("round-trips through our own parser", () => {
    const parsed = parseDecklist(text);
    expect(parsed.title).toBe("Krenko Goblin Swarm");
    expect(parsed.warnings).toEqual([]);
    const byName = new Map(parsed.entries.map((e) => [e.name, e]));
    expect(byName.get("Krenko, Mob Boss")).toMatchObject({
      board: "commander",
      setCode: "fdn",
      collectorNumber: "204",
    });
    expect(byName.get("Lightning Bolt")).toMatchObject({
      board: "main",
      quantity: 4,
    });
    expect(byName.get("Pyroblast")).toMatchObject({
      board: "side",
      quantity: 2,
    });
    expect(byName.has("Some Maybe Card")).toBe(false);
  });
});

describe("deckToText — plain style", () => {
  it("emits bare lines with a blank-line sideboard split, no printings", () => {
    const text = deckToText(DECK, ENTRIES, { style: "plain" });
    expect(text).toBe(
      "1 Krenko, Mob Boss\n4 Lightning Bolt\n20 Mountain\n\n2 Pyroblast",
    );
  });

  it("round-trips through the parser (commander merges into main)", () => {
    const text = deckToText(DECK, ENTRIES, { style: "plain" });
    const parsed = parseDecklist(text);
    expect(
      parsed.entries.find((e) => e.name === "Pyroblast")?.board,
    ).toBe("side");
  });
});

describe("deckToText — proxy names", () => {
  it("swaps in custom card titles for remixed entries", () => {
    const remixed = [
      entry("Krenko, Mob Boss", 1, "commander", {
        proxyTitle: "Grenko, Riot Forgeboss",
      }),
      entry("Lightning Bolt", 4),
    ];
    const text = deckToText(DECK, remixed, {
      style: "plain",
      useProxyNames: true,
    });
    expect(text).toContain("1 Grenko, Riot Forgeboss");
    expect(text).toContain("4 Lightning Bolt");
    expect(text).not.toContain("Krenko, Mob Boss");
  });

  it("a renamed line drops the original's printing; an unrenamed one keeps it", () => {
    const text = deckToText(
      DECK,
      [
        entry("Krenko, Mob Boss", 1, "commander", {
          set_code: "fdn",
          collector_number: "204",
          proxyTitle: "Grenko, Riot Forgeboss",
        }),
        entry("Lightning Bolt", 4, "main", {
          set_code: "m11",
          collector_number: "149",
          proxyTitle: "Lightning Bolt",
        }),
      ],
      { style: "arena", useProxyNames: true },
    );
    expect(text).toContain("Commander\n1 Grenko, Riot Forgeboss\n");
    expect(text).not.toContain("(FDN)");
    expect(text).toContain("Deck\n4 Lightning Bolt (M11) 149");
  });
});

describe("exportEntriesOf — the names the viewer's deck list shows (DK0.7)", () => {
  const row = (name: string, card: { title: string } | null, extra: Partial<ExportEntry> = {}) => ({
    entry: { name, quantity: 1, board: "main" as DeckBoard, set_code: null, collector_number: null, ...extra },
    card,
  });

  it("a readable custom card names the line; a card the viewer can't read leaves the entry's own name", () => {
    const entries = exportEntriesOf([
      row("Krenko, Mob Boss", { title: "Grenko, Riot Forgeboss" }),
      // A private card in a public deck: RLS gives the visitor no card.
      row("Old Draft Title", null),
      row("Lightning Bolt", null, { set_code: "m11", collector_number: "149" }),
    ]);
    const plain = deckToText(DECK, entries, { style: "plain", useProxyNames: true });
    expect(plain).toBe("1 Grenko, Riot Forgeboss\n1 Old Draft Title\n1 Lightning Bolt");
    const arena = deckToText(DECK, entries, { style: "arena", useProxyNames: true });
    expect(arena).toContain("1 Lightning Bolt (M11) 149");
  });
});
