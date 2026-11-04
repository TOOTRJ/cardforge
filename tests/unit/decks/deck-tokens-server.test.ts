import { beforeEach, describe, expect, it, vi } from "vitest";

// ---------------------------------------------------------------------------
// The deck's tokens, server side (TODO DK5.16): the real cards' all_parts
// through the SHARED Scryfall client's batch lookup (75 printings a call,
// each held to a timeout), held in Next's data cache (a success a day, a
// failure a few minutes — so an outage or a 429 isn't called again on every
// view), never a call for a deck with no printing; a failed call lists the
// PipGlyph cards' tokens alone; a lookup that reached Scryfall is logged on
// the signed-in viewer (logScryfallCall, `deck_tokens`).
// ---------------------------------------------------------------------------

const state = vi.hoisted(() => ({
  calls: [] as Array<{ identifiers: Array<{ id: string }>; options: unknown }>,
  fail: false,
  cacheOptions: [] as Array<{ keys: string[]; options: unknown }>,
  store: new Map<string, unknown>(),
  logged: [] as Array<[string, string]>,
}));

// A data cache: an answer is kept per key + arguments; a throw keeps nothing.
vi.mock("next/cache", () => ({
  unstable_cache: (fn: (...args: unknown[]) => Promise<unknown>, keys: string[], options: unknown) => {
    state.cacheOptions.push({ keys, options });
    return async (...args: unknown[]) => {
      const key = JSON.stringify([keys, args]);
      if (state.store.has(key)) return state.store.get(key);
      const value = await fn(...args);
      state.store.set(key, value);
      return value;
    };
  },
}));

vi.mock("@/lib/scryfall/rate-limit", () => ({
  logScryfallCall: vi.fn(async (userId: string, action: string) => {
    state.logged.push([userId, action]);
  }),
}));

vi.mock("@/lib/scryfall/client", () => ({
  SCRYFALL_COLLECTION_MAX: 75,
  getCardCollection: vi.fn(async (identifiers: Array<{ id: string }>, options: unknown) => {
    state.calls.push({ identifiers, options });
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

const {
  listDeckTokens,
  DECK_TOKEN_CACHE_SECONDS,
  DECK_TOKEN_FAILURE_CACHE_SECONDS,
  DECK_TOKEN_CALL_TIMEOUT_MS,
  DECK_TOKEN_CACHE_TAG,
} = await import("@/lib/decks/deck-tokens-server");

const pid = (n: number) => `bbbbbbbb-bbbb-4bbb-8bbb-${String(n).padStart(12, "0")}`;
const printing = (n: number) => ({ entry: { board: "main", name: `Card ${n}`, scryfall_id: pid(n), quantity: 1 }, card: null });
const VIEWER = "11111111-1111-4111-8111-111111111111";

beforeEach(() => {
  state.calls = [];
  state.fail = false;
  state.store.clear();
  state.logged = [];
});

describe("listDeckTokens", () => {
  it("keeps a success a day and any answer a few minutes, under one tag", async () => {
    await listDeckTokens([printing(1)]);
    expect(state.cacheOptions.map((c) => c.options)).toEqual([
      { revalidate: DECK_TOKEN_FAILURE_CACHE_SECONDS, tags: [DECK_TOKEN_CACHE_TAG] },
      { revalidate: DECK_TOKEN_CACHE_SECONDS, tags: [DECK_TOKEN_CACHE_TAG] },
    ]);
    expect(DECK_TOKEN_CACHE_SECONDS).toBe(86_400);
    expect(DECK_TOKEN_FAILURE_CACHE_SECONDS).toBeLessThanOrEqual(600);
  });

  it("looks the printings up 75 at a time, each call held to a timeout of a few seconds", async () => {
    const items = Array.from({ length: 100 }, (_, i) => printing(i + 1));
    const { tokens, realCardsFailed } = await listDeckTokens(items);
    expect(state.calls.map((c) => c.identifiers.length)).toEqual([75, 25]);
    expect(state.calls.every((c) => (c.options as { timeoutMs: number }).timeoutMs === DECK_TOKEN_CALL_TIMEOUT_MS)).toBe(true);
    expect(DECK_TOKEN_CALL_TIMEOUT_MS).toBeGreaterThanOrEqual(2_000);
    expect(DECK_TOKEN_CALL_TIMEOUT_MS).toBeLessThanOrEqual(6_000);
    expect(realCardsFailed).toBe(false);
    expect(tokens.map((t) => [t.name, t.makers])).toEqual([["Treasure", ["Card 1"]]]);
  });

  it("a second view of the same printings calls nothing", async () => {
    await listDeckTokens([printing(1), printing(2)]);
    await listDeckTokens([printing(2), printing(1)]);
    expect(state.calls).toHaveLength(1);
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

  it("a failure is kept briefly: the next view reads it instead of calling Scryfall again", async () => {
    state.fail = true;
    await listDeckTokens([printing(1)]);
    const second = await listDeckTokens([printing(1)]);
    expect(state.calls).toHaveLength(1);
    expect(second.realCardsFailed).toBe(true);
  });

  it("logs a lookup that reached Scryfall on the signed-in viewer — once per lookup, never a cache hit or an anonymous view", async () => {
    await listDeckTokens(Array.from({ length: 100 }, (_, i) => printing(i + 1)), { viewerId: VIEWER });
    expect(state.logged).toEqual([[VIEWER, "deck_tokens"]]);
    await listDeckTokens(Array.from({ length: 100 }, (_, i) => printing(i + 1)), { viewerId: VIEWER });
    expect(state.logged).toHaveLength(1);
    await listDeckTokens([printing(500)]);
    expect(state.calls).toHaveLength(3);
    expect(state.logged).toHaveLength(1);
  });
});
