import { beforeEach, describe, expect, it, vi } from "vitest";

// ---------------------------------------------------------------------------
// The deck's tokens, server side (TODO DK5.16): the real cards' all_parts
// through the SHARED Scryfall client's batch lookup (75 printings a call),
// held in Next's data cache (one lookup per deck's printings), never a call
// for a deck with no printing; a failed call lists the PipGlyph cards'
// tokens alone.
// ---------------------------------------------------------------------------

const state = vi.hoisted(() => ({
  calls: [] as Array<Array<{ id: string }>>,
  fail: false,
  cacheOptions: null as unknown,
}));

vi.mock("next/cache", () => ({
  unstable_cache: (fn: (...args: unknown[]) => unknown, _keys: string[], options: unknown) => {
    state.cacheOptions = options;
    return fn;
  },
}));

vi.mock("@/lib/scryfall/client", () => ({
  SCRYFALL_COLLECTION_MAX: 75,
  getCardCollection: vi.fn(async (identifiers: Array<{ id: string }>) => {
    state.calls.push(identifiers);
    if (state.fail) return null;
    return {
      notFound: [],
      cards: identifiers.map(({ id }) => ({
        id,
        name: `Card ${id}`,
        all_parts: id.endsWith("0001")
          ? [{ id: "aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa", component: "token", name: "Treasure", type_line: "Token Artifact — Treasure" }]
          : [],
      })),
    };
  }),
}));

const { listDeckTokens, DECK_TOKEN_CACHE_SECONDS } = await import("@/lib/decks/deck-tokens-server");

const pid = (n: number) => `bbbbbbbb-bbbb-4bbb-8bbb-${String(n).padStart(12, "0")}`;
const printing = (n: number) => ({ entry: { board: "main", name: `Card ${n}`, scryfall_id: pid(n), quantity: 1 }, card: null });

beforeEach(() => {
  state.calls = [];
  state.fail = false;
});

describe("listDeckTokens", () => {
  it("is cached a day under one tag", () => {
    expect(state.cacheOptions).toEqual({ revalidate: DECK_TOKEN_CACHE_SECONDS, tags: ["deck-token-parts"] });
    expect(DECK_TOKEN_CACHE_SECONDS).toBe(86_400);
  });

  it("looks the printings up 75 at a time", async () => {
    const items = Array.from({ length: 100 }, (_, i) => printing(i + 1));
    const { tokens, realCardsFailed } = await listDeckTokens(items);
    expect(state.calls.map((c) => c.length)).toEqual([75, 25]);
    expect(realCardsFailed).toBe(false);
    expect(tokens.map((t) => [t.name, t.makers])).toEqual([["Treasure", ["Card 1"]]]);
  });

  it("calls nothing for a deck with no printing", async () => {
    const { tokens } = await listDeckTokens([
      { entry: { board: "main", name: "Mine", scryfall_id: null, quantity: 1 }, card: { title: "Mine", rules_text: "Create a Map token." } },
    ]);
    expect(state.calls).toEqual([]);
    expect(tokens.map((t) => t.name)).toEqual(["Map"]);
  });

  it("a failed lookup still lists the PipGlyph cards' tokens", async () => {
    state.fail = true;
    const { tokens, realCardsFailed } = await listDeckTokens([
      printing(1),
      { entry: { board: "main", name: "Mine", scryfall_id: null, quantity: 1 }, card: { title: "Mine", rules_text: "Create a Map token." } },
    ]);
    expect(realCardsFailed).toBe(true);
    expect(tokens.map((t) => t.name)).toEqual(["Map"]);
  });
});
