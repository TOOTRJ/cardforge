import { describe, expect, it } from "vitest";
import { deckToText, type ExportEntry } from "@/lib/decks/export-text";
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
});
