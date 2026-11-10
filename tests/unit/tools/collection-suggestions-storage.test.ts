import { describe, expect, it } from "vitest";
import {
  LAST_SUGGESTIONS_DAYS,
  lastSuggestionsKey,
  readLastSuggestions,
  writeLastSuggestions,
  type CommanderSuggestion,
  type StoredSuggestions,
} from "@/lib/tools/collection/suggestions";

// ---------------------------------------------------------------------------
// "Suggest a commander"'s answer kept a week in this browser (owner decision
// 8): offered back only for an unchanged collection; a suggestion whose
// commander is gone is dropped (and the whole entry when none is left); a
// broken entry is removed; storage that throws never breaks the page.
// ---------------------------------------------------------------------------

function memoryStorage(seed: Record<string, string> = {}) {
  const map = new Map(Object.entries(seed));
  return {
    map,
    getItem: (k: string) => map.get(k) ?? null,
    setItem: (k: string, v: string) => void map.set(k, v),
    removeItem: (k: string) => void map.delete(k),
  };
}

const suggestion = (commanderId: string): CommanderSuggestion => ({
  commanderId,
  name: commanderId,
  imageUrl: null,
  colorIdentity: ["R"],
  deckType: "tokens",
  pitch: "Go wide.",
  why: "Goblins.",
  gaps: "",
  keyCards: [{ id: "row", name: "Goblin" }],
  support: { inColours: 10, fit: 5, roles: { ramp: 1, draw: 1, removal: 1, wipe: 0 }, lands: 1, score: 40, deckTypes: { tokens: 4 }, tribes: [] },
});

const NOW = Date.parse("2026-11-10T12:00:00Z");
const stored = (over: Partial<StoredSuggestions> = {}): StoredSuggestions => ({
  savedAt: new Date(NOW - 60_000).toISOString(),
  collectionSize: 79,
  result: { overview: "x", suggestions: [suggestion("a"), suggestion("b")] },
  ...over,
});
const context = (ids: string[] = ["a", "b"]) => ({ now: NOW, collectionSize: 79, commanderIds: new Set(ids) });

describe("the kept suggestions", () => {
  it("round-trip per viewer, dropping a commander no longer owned", () => {
    const storage = memoryStorage();
    writeLastSuggestions("u1", stored(), storage);
    expect(readLastSuggestions("u1", context(), storage)?.result.suggestions).toHaveLength(2);
    expect(readLastSuggestions("u1", context(["b"]), storage)?.result.suggestions.map((s) => s.commanderId)).toEqual(["b"]);
    expect(readLastSuggestions("u2", context(), storage)).toBeNull();
  });

  it.each([
    ["older than the week", stored({ savedAt: new Date(NOW - (LAST_SUGGESTIONS_DAYS * 24 + 1) * 3_600_000).toISOString() })],
    ["for a changed collection", stored({ collectionSize: 80 })],
    ["whose commanders are all gone", stored()],
  ])("is dropped when %s", (label, value) => {
    const storage = memoryStorage({ [lastSuggestionsKey("u1")]: JSON.stringify(value) });
    const ids = label === "whose commanders are all gone" ? [] : ["a", "b"];
    expect(readLastSuggestions("u1", context(ids), storage)).toBeNull();
    expect(storage.map.size).toBe(0);
  });

  it("reads a deck type renamed since as none", () => {
    const value = stored();
    (value.result.suggestions[0] as { deckType: string | null }).deckType = "storm";
    const storage = memoryStorage({ [lastSuggestionsKey("u1")]: JSON.stringify(value) });
    const read = readLastSuggestions("u1", context(), storage);
    expect(read?.result.suggestions[0].deckType).toBeNull();
    expect(read?.result.suggestions[1].deckType).toBe("tokens");
  });

  it("drops a broken entry and never throws", () => {
    const broken = { ...stored(), result: { overview: "x", suggestions: [{ commanderId: "a" }] } };
    for (const raw of ["nope", JSON.stringify(broken), JSON.stringify(null)]) {
      const storage = memoryStorage({ [lastSuggestionsKey("u1")]: raw });
      expect(readLastSuggestions("u1", context(), storage)).toBeNull();
      expect(storage.map.size).toBe(0);
    }
    const throwing = {
      getItem: () => {
        throw new Error("blocked");
      },
      setItem: () => {
        throw new Error("blocked");
      },
      removeItem: () => {
        throw new Error("blocked");
      },
    };
    expect(readLastSuggestions("u1", context(), throwing)).toBeNull();
    expect(() => writeLastSuggestions("u1", stored(), throwing)).not.toThrow();
  });
});
