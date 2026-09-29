import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import searchData from "./fixtures/token-search.json";
import {
  DFC_PROMO_TOKEN_SETS,
  EXTRAS_DROPPED_LAYOUTS,
  SEARCH_SCOPE_LABELS,
  SEARCH_SCOPE_VALUES,
  isSearchScope,
  keepExtrasResult,
  tokensScopeQuery,
} from "@/lib/scryfall/search-scope";

// ---------------------------------------------------------------------------
// TODO 1.23's search half: Scryfall's include_extras only from the "Tokens &
// emblems" scope (or the no-match fallback), restricted to tokens and
// emblems, with the layouts and promo tokens PipGlyph can't import dropped.
// The Scryfall answers are real (tests/unit/scryfall/fixtures/
// token-search.json, captured 2026-09-29); the client runs against a stubbed
// fetch with fake timers (its module-level throttle spaces searches 500 ms).
// ---------------------------------------------------------------------------

type ClientModule = typeof import("@/lib/scryfall/client");

async function freshClient(): Promise<ClientModule> {
  vi.resetModules();
  return import("@/lib/scryfall/client");
}

async function settle<T>(promise: Promise<T>): Promise<T> {
  await vi.runAllTimersAsync();
  return promise;
}

const list = (data: unknown[]) =>
  new Response(JSON.stringify({ object: "list", total_cards: data.length, has_more: false, data }), {
    status: 200,
    headers: { "Content-Type": "application/json" },
  });

const label = (card: { set?: string | null; collector_number?: string | null; name: string }) =>
  `${card.set} #${card.collector_number} ${card.name}`;

describe("the scopes", () => {
  it("Cards and Tokens & emblems, Cards first", () => {
    expect(SEARCH_SCOPE_VALUES).toEqual(["cards", "tokens"]);
    expect(SEARCH_SCOPE_LABELS.tokens).toBe("Tokens & emblems");
    expect(isSearchScope("tokens")).toBe(true);
    expect(isSearchScope("planes")).toBe(false);
  });

  it("the tokens query groups the user's and restricts it to tokens and emblems", () => {
    expect(tokensScopeQuery('  !"Treasure" ')).toBe('(!"Treasure") (t:token OR t:emblem)');
  });
});

describe("keepExtrasResult (the TODO's measurement, 2026-09-29)", () => {
  it('drops the F17/F18 double-faced promos and the FJ22 front card from !"Treasure"', () => {
    const all = searchData["treasure-extras"];
    // What include_extras answers: F17 #11 first, FJ22 #36 among them.
    expect(all.map(label)).toEqual([
      "f17 #11 Dinosaur // Treasure",
      "f18 #1 Merfolk // Treasure",
      "f17 #12 Pirate // Treasure",
      "tfra #15 Treasure",
      "fj22 #36 Treasure",
      "f17 #10 Vampire // Treasure",
    ]);
    expect(all.filter(keepExtrasResult).map(label)).toEqual(["tfra #15 Treasure"]);
  });

  it("drops every non-card layout, keeps tokens, emblems and other double-faced tokens", () => {
    for (const layout of EXTRAS_DROPPED_LAYOUTS) {
      expect(keepExtrasResult({ layout, set: "tfdn" }), layout).toBe(false);
    }
    expect(EXTRAS_DROPPED_LAYOUTS).toEqual(
      new Set(["art_series", "front_card", "planar", "scheme", "vanguard"]),
    );
    expect(DFC_PROMO_TOKEN_SETS).toEqual(new Set(["f17", "f18"]));
    expect(keepExtrasResult({ layout: "token", set: "tfra" })).toBe(true);
    expect(keepExtrasResult({ layout: "emblem", set: "tfdn" })).toBe(true);
    // TMOM #16 Incubator // Phyrexian, a real double-faced token.
    expect(keepExtrasResult({ layout: "double_faced_token", set: "tmom" })).toBe(true);
  });
});

describe("searchCardsWithOutcome", () => {
  beforeEach(() => {
    vi.useFakeTimers();
  });
  afterEach(() => {
    vi.useRealTimers();
    vi.unstubAllGlobals();
  });

  it("sends include_extras only when asked, and filters before the limit", async () => {
    const urls: string[] = [];
    vi.stubGlobal(
      "fetch",
      vi.fn().mockImplementation((url: string) => {
        urls.push(url);
        return Promise.resolve(list(searchData["treasure-extras"]));
      }),
    );
    const client = await freshClient();
    const extras = await settle(
      client.searchCardsWithOutcome({ query: tokensScopeQuery('!"Treasure"'), limit: 1, includeExtras: true }),
    );
    expect(extras.cards.map(label)).toEqual(["tfra #15 Treasure"]);
    expect(extras.noMatches).toBe(false);
    const plain = await settle(client.searchCardsWithOutcome({ query: "treasure", limit: 12 }));
    // A plain query is never filtered (it never carries extras).
    expect(plain.cards).toHaveLength(6);

    const params = urls.map((url) => new URL(url).searchParams);
    expect(params[0]!.get("include_extras")).toBe("true");
    expect(params[0]!.get("q")).toBe('(!"Treasure") (t:token OR t:emblem)');
    expect(params[1]!.has("include_extras")).toBe(false);
  });

  it("says 'no matches' for Scryfall's 404 only — never for a failure", async () => {
    const fetchMock = vi
      .fn()
      .mockResolvedValueOnce(
        new Response(JSON.stringify({ object: "error", code: "not_found", status: 404 }), { status: 404 }),
      )
      .mockResolvedValue(new Response("{}", { status: 503 }));
    vi.stubGlobal("fetch", fetchMock);
    const client = await freshClient();
    expect(await settle(client.searchCardsWithOutcome({ query: "zzzz" }))).toEqual({
      cards: [],
      noMatches: true,
    });
    expect(await settle(client.searchCardsWithOutcome({ query: "zzzz" }))).toEqual({
      cards: [],
      noMatches: false,
    });
    // searchCards keeps its old answer: a plain list.
    expect(await settle(client.searchCards({ query: "zzzz" }))).toEqual([]);
  });
});
