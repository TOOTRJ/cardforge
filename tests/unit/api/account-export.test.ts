import { beforeEach, describe, expect, it, vi } from "vitest";

// ---------------------------------------------------------------------------
// The account export (GDPR) reads every list WHOLE: PostgREST answers an
// un-ranged select with at most 1000 rows, so a Pro account's 1,001st card
// or a deck's 1,001st entry went missing from its own export. Each read now
// pages by id; a failed read refuses the export rather than hand back a
// partial file that looks complete.
// ---------------------------------------------------------------------------

type Call = { table: string; ops: Array<[string, ...unknown[]]> };

const s = vi.hoisted(() => ({
  calls: [] as Call[],
  sizes: {} as Record<string, number>,
  failTable: null as string | null,
}));

vi.mock("@/lib/supabase/server", () => ({
  getCurrentUser: async () => ({ id: "user-1", email: "user@example.test" }),
  getCurrentProfile: async () => ({ id: "user-1", username: "user" }),
  createClient: async () => ({
    from(table: string) {
      const call: Call = { table, ops: [] };
      s.calls.push(call);
      const chain: Record<string, unknown> = {};
      for (const op of ["select", "eq", "in", "order", "range"]) {
        chain[op] = (...args: unknown[]) => {
          call.ops.push([op, ...args]);
          return chain;
        };
      }
      chain.then = (resolve: (v: unknown) => unknown, reject?: (e: unknown) => unknown) => {
        if (s.failTable === table) {
          return Promise.resolve({ data: null, error: { message: "boom" } }).then(resolve, reject);
        }
        const range = call.ops.find((op) => op[0] === "range") as [string, number, number];
        const total = s.sizes[table] ?? 0;
        const from = range[1];
        const to = Math.min(range[2], total - 1);
        const data = Array.from({ length: Math.max(0, to - from + 1) }, (_, i) => ({
          id: `${table}-${from + i}`,
        }));
        return Promise.resolve({ data, error: null, count: total }).then(resolve, reject);
      };
      return chain;
    },
  }),
}));

import { GET } from "@/app/api/account/export/route";

beforeEach(() => {
  s.calls = [];
  s.sizes = { cards: 2345, decks: 3, deck_cards: 1500, credit_ledger: 12 };
  s.failTable = null;
});

describe("GET /api/account/export", () => {
  it("exports every row past PostgREST's 1000-row cap, paged by id", async () => {
    const response = await GET();
    expect(response.status).toBe(200);
    const body = JSON.parse(await response.text());
    expect(body.cards).toHaveLength(2345);
    expect(body.deckCards).toHaveLength(1500);
    expect(body.decks).toHaveLength(3);
    expect(body.creditLedger).toHaveLength(12);

    const cardPages = s.calls.filter((c) => c.table === "cards");
    expect(cardPages.map((c) => c.ops.find((op) => op[0] === "range"))).toEqual([
      ["range", 0, 999],
      ["range", 1000, 1999],
      ["range", 2000, 2999],
    ]);
    for (const call of s.calls) {
      expect(call.ops, call.table).toContainEqual(["order", "id", { ascending: true }]);
    }
    const entryCall = s.calls.find((c) => c.table === "deck_cards");
    expect(entryCall?.ops).toContainEqual(["in", "deck_id", ["decks-0", "decks-1", "decks-2"]]);
  });

  it("asks each read for its exact count, so a short table is one request", async () => {
    await GET();
    for (const call of s.calls) expect(call.ops, call.table).toContainEqual(["select", "*", { count: "exact" }]);
    expect(s.calls.filter((c) => c.table === "decks")).toHaveLength(1);
  });

  it("refuses a partial export", async () => {
    s.failTable = "card_likes";
    const response = await GET();
    expect(response.status).toBe(503);
  });
});
