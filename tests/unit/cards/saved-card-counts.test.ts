import { beforeEach, describe, expect, it, vi } from "vitest";
import { chainClient, called, type ChainAnswer, type ChainCall } from "@/tests/stubs/supabase-chain";

// ---------------------------------------------------------------------------
// The home page's card numbers (owner 2026-11-11): EVERY saved card, not
// only the public ones — read through migration 0207's saved_card_counts()
// with the cookie-free client (the page is static), zeros on a failure, and
// main's public counts on a database the migration has not reached yet.
// ---------------------------------------------------------------------------

const db = vi.hoisted(() => ({
  configured: true,
  rpc: null as null | (() => ChainAnswer | Promise<ChainAnswer>),
  rpcCalls: [] as Array<[string, unknown]>,
  tables: [] as Array<{ table: string; calls: ChainCall[] }>,
  resolve: null as null | ((table: string, calls: ChainCall[]) => ChainAnswer),
  /** A cookie-bound client was built: the page would stop being static. */
  cookieClient: 0,
}));

vi.mock("@/lib/supabase/env", () => ({ isSupabaseConfigured: () => db.configured }));
vi.mock("@/lib/supabase/public", () => ({
  createPublicClient: () => {
    const stub = chainClient((table, calls) => {
      db.tables.push({ table, calls });
      return db.resolve ? db.resolve(table, calls) : { count: 0, error: null };
    });
    return {
      ...stub.client,
      rpc: async (name: string, args?: unknown) => {
        db.rpcCalls.push([name, args]);
        return { data: null, error: null, ...(await db.rpc!()) };
      },
    };
  },
}));
vi.mock("@/lib/supabase/server", () => ({
  createClient: async () => {
    db.cookieClient += 1;
    throw new Error("the home page's counts never read a cookie");
  },
  getCurrentUser: async () => null,
}));

import { getSavedCardCounts } from "@/lib/cards/queries";

beforeEach(() => {
  db.configured = true;
  db.rpc = () => ({ data: [{ cards: 1308, cards_this_week: 42 }] });
  db.rpcCalls = [];
  db.tables = [];
  db.resolve = null;
  db.cookieClient = 0;
});

describe("getSavedCardCounts", () => {
  it("reads the two totals from saved_card_counts() — no table, no cookie", async () => {
    expect(await getSavedCardCounts()).toEqual({ cards: 1308, cardsThisWeek: 42 });
    expect(db.rpcCalls).toEqual([["saved_card_counts", undefined]]);
    expect(db.tables).toEqual([]);
    expect(db.cookieClient).toBe(0);
  });

  it("reads counts that arrive as strings or as one object", async () => {
    db.rpc = () => ({ data: { cards: "25000", cards_this_week: "7" } });
    expect(await getSavedCardCounts()).toEqual({ cards: 25000, cardsThisWeek: 7 });
  });

  it("is zeros — never a throw, never a negative or a NaN — on an empty or strange answer", async () => {
    for (const data of [[], null, [{}], [{ cards: -4, cards_this_week: "x" }], [{ cards: null }]]) {
      db.rpc = () => ({ data });
      expect(await getSavedCardCounts()).toEqual({ cards: 0, cardsThisWeek: 0 });
    }
  });

  it("is zeros when the read fails or throws", async () => {
    db.rpc = () => ({ error: { message: "boom", code: "57014" } });
    expect(await getSavedCardCounts()).toEqual({ cards: 0, cardsThisWeek: 0 });
    expect(db.tables).toEqual([]); // a failure is not "the function is missing"
    db.rpc = () => {
      throw new Error("network");
    };
    expect(await getSavedCardCounts()).toEqual({ cards: 0, cardsThisWeek: 0 });
  });

  it("is zeros with no database configured, and asks nothing", async () => {
    db.configured = false;
    expect(await getSavedCardCounts()).toEqual({ cards: 0, cardsThisWeek: 0 });
    expect(db.rpcCalls).toEqual([]);
  });

  it("a database without the function yet (PGRST202) shows main's numbers: the public cards, as head counts", async () => {
    db.rpc = () => ({ error: { message: "Could not find the function", code: "PGRST202" } });
    db.resolve = (_table, calls) => ({ count: called(calls, "gte") ? 9 : 310, error: null });
    expect(await getSavedCardCounts()).toEqual({ cards: 310, cardsThisWeek: 9 });
    expect(db.tables).toHaveLength(2);
    for (const { table, calls } of db.tables) {
      expect(table).toBe("cards");
      expect(calls.find((c) => c.method === "select")?.args).toEqual(["id", { count: "exact", head: true }]);
      expect(calls.some((c) => c.method === "eq" && c.args[0] === "visibility" && c.args[1] === "public")).toBe(true);
    }
  });
});
