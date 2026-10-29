import { beforeEach, describe, expect, it, vi } from "vitest";

// ---------------------------------------------------------------------------
// Emblems are NOT remixed (owner 2026-10-13) — the PLAN. createDeckRemixJob
// makes no entry and no step for an emblem: the user's own emblem cards are
// left out by the estimate's own filter (remixableDeckItems, before the
// batch cap), a printed emblem is what the estimate priced 0. With no step
// there is nothing to reserve — no `spend:` ledger row can exist for it —
// and the runner's "N of N" counts only the cards that are remixed.
// ---------------------------------------------------------------------------

const USER = "11111111-1111-4111-8111-111111111111";

const s = vi.hoisted(() => ({
  items: [] as Array<{ entry: Record<string, unknown>; card: Record<string, unknown> | null }>,
  inserted: [] as Record<string, unknown>[],
  decksCreated: 0,
}));

vi.mock("@/lib/supabase/server", () => ({
  getCurrentUser: async () => ({ id: USER }),
  getCurrentProfile: async () => ({ display_name: "Tester", username: "tester" }),
  createClient: async () => ({
    from: (table: string) => {
      const chain = {
        select: () => chain,
        eq: () => chain,
        insert: (row: Record<string, unknown>) => {
          s.inserted.push(row);
          return chain;
        },
        maybeSingle: async () => ({
          data: { id: "deck-1", title: "Kaito's Deck", description: null, format: "commander", owner_id: USER },
          error: null,
        }),
        single: async () => ({ data: { id: "job-1", ...s.inserted.at(-1), table }, error: null }),
      };
      return chain;
    },
  }),
}));
vi.mock("@/lib/decks/queries", async (importOriginal) => ({
  ...(await importOriginal<typeof import("@/lib/decks/queries")>()),
  listDeckCards: async () => s.items,
}));
vi.mock("@/lib/decks/actions", () => ({
  createDeckAction: async () => {
    s.decksCreated += 1;
    return { ok: true, deckId: "deck-2", slug: "kaitos-deck-ai-remix" };
  },
  updateDeckAction: async () => ({ ok: true }),
}));

import { createDeckRemixJob } from "@/lib/ai/generation-jobs";

const id = (n: number) => `${String(n).repeat(8)}-1111-4111-8111-111111111111`;
const entry = (key: string, over: Record<string, unknown>, card: Record<string, unknown> | null = null) => ({
  entry: { id: key, board: "main", quantity: 1, name: key, card_id: null, scryfall_id: null, ...over },
  card,
});

type Plan = { entries: Array<{ name: string; credits?: number }>; skipped: number };
type Step = { key: string; label: string; credits?: number };

beforeEach(() => {
  s.items = [];
  s.inserted = [];
  s.decksCreated = 0;
});

describe("createDeckRemixJob leaves emblems out of the plan", () => {
  it("no entry and no step for an own emblem or a printed one; every other entry keeps its price", async () => {
    s.items = [
      entry("walker", { card_id: id(1) }, { card_type: "planeswalker" }),
      entry("own-emblem", { card_id: id(2) }, { card_type: "emblem" }),
      entry("printed-emblem", { scryfall_id: id(3) }),
      entry("cathar", { scryfall_id: id(4) }),
      entry("own-dfc", { card_id: id(5) }, { card_type: "creature" }),
    ];
    const result = await createDeckRemixJob({
      deckId: "deck-1",
      style: "ink",
      limit: 100,
      // The estimate's map: the own emblem is not in it, the printed one is 0.
      creditsByEntry: { walker: 1, "printed-emblem": 0, cathar: 2, "own-dfc": 2 },
    });
    expect(result.ok).toBe(true);
    const job = s.inserted.at(-1)!;
    const plan = job.plan as Plan;
    const steps = job.steps as Step[];
    expect(plan.entries.map((e) => [e.name, e.credits ?? 1])).toEqual([
      ["walker", 1],
      ["cathar", 2],
      ["own-dfc", 2],
    ]);
    // An emblem is not "beyond the batch cap".
    expect(plan.skipped).toBe(0);
    // Three card steps (+ the free guide; no AI cover since TODO DK6.3): the
    // runner finishes "3 of 3" with no failed or pending emblem step.
    expect(steps.map((step) => step.label)).toEqual(["walker", "cathar", "own-dfc", "How to play guide"]);
    expect(steps.filter((step) => step.key.startsWith("remix:")).map((step) => step.credits ?? 1)).toEqual([1, 2, 2]);
  });

  it("an own emblem takes no slot of the batch cap", async () => {
    s.items = [
      entry("own-emblem", { card_id: id(1) }, { card_type: "emblem" }),
      entry("a", { scryfall_id: id(2) }),
      entry("b", { scryfall_id: id(3) }),
      entry("c", { scryfall_id: id(4) }),
    ];
    const result = await createDeckRemixJob({ deckId: "deck-1", style: "ink", limit: 2 });
    expect(result.ok).toBe(true);
    const plan = s.inserted.at(-1)!.plan as Plan;
    expect(plan.entries.map((e) => e.name)).toEqual(["a", "b"]);
    expect(plan.skipped).toBe(1);
  });

  it("a deck of emblems alone creates no deck and no job", async () => {
    s.items = [
      entry("own-emblem", { card_id: id(1) }, { card_type: "emblem" }),
      entry("printed-emblem", { scryfall_id: id(2) }),
    ];
    const result = await createDeckRemixJob({
      deckId: "deck-1",
      style: "ink",
      limit: 100,
      creditsByEntry: { "printed-emblem": 0 },
    });
    expect(result).toEqual({ ok: false, error: "Nothing to remix — emblems aren't remixed." });
    expect(s.decksCreated).toBe(0);
    expect(s.inserted).toEqual([]);
  });
});
