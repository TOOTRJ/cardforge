import { beforeEach, describe, expect, it, vi } from "vitest";
import { chainClient, type ChainAnswer } from "@/tests/stubs/supabase-chain";

// ---------------------------------------------------------------------------
// getDeckActivityAction (TODO DK7.4) — the panel's one read. The gate is the
// server's: signed in, the plan is Pro (an admin / billing off counts — the
// entitlements say "pro"; Plus does not), the deck is the caller's. Then ONE
// read of twice the period from each database function (0151's views, 0154's
// likes), built into the period and the one before.
// ---------------------------------------------------------------------------

const USER = "11111111-1111-4111-8111-111111111111";
const OTHER = "99999999-9999-4999-8999-999999999999";
const DECK = "33333333-3333-4333-8333-333333333333";

const state = vi.hoisted(() => ({
  client: null as unknown,
  user: { id: "11111111-1111-4111-8111-111111111111" } as { id: string } | null,
  owner: "11111111-1111-4111-8111-111111111111",
  tier: "pro" as string,
  rpc: {} as Record<string, ChainAnswer>,
  likeRows: [] as Array<{ created_at: string }>,
}));

vi.mock("@/lib/supabase/server", () => ({
  createClient: async () => state.client,
  getCurrentUser: async () => state.user,
}));
vi.mock("@/lib/billing/entitlements", () => ({
  getEntitlements: async () => ({ effectiveTier: state.tier }),
}));

import { getDeckActivityAction } from "@/lib/decks/activity-actions";

function db() {
  const stub = chainClient((table): ChainAnswer => {
    if (table === "decks") return { data: { id: DECK, owner_id: state.owner }, error: null };
    if (table === "deck_likes") return { data: state.likeRows, error: null };
    return { data: null, error: null };
  });
  stub.rpc.mockImplementation((async (name: string) => state.rpc[name] ?? { data: [], error: null }) as never);
  state.client = stub.client;
  return stub;
}

beforeEach(() => {
  state.user = { id: USER };
  state.owner = USER;
  state.tier = "pro";
  state.rpc = {};
  state.likeRows = [];
});

describe("getDeckActivityAction", () => {
  it("reads twice the period from both functions and builds the series", async () => {
    const stub = db();
    const today = new Date().toISOString().slice(0, 10);
    state.rpc = {
      deck_views_by_day: { data: [{ day: today, views: 4 }], error: null },
      deck_likes_by_day: { data: [{ day: today, likes: 2 }], error: null },
    };
    const result = await getDeckActivityAction(DECK, 7);
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.activity.days).toBe(7);
    expect(result.activity.views.total).toBe(4);
    expect(result.activity.likes.total).toBe(2);
    expect(result.activity.likes.change).toEqual({ kind: "new" });
    expect(stub.rpc).toHaveBeenCalledWith("deck_views_by_day", { p_deck_id: DECK, p_days: 14 });
    expect(stub.rpc).toHaveBeenCalledWith("deck_likes_by_day", { p_deck_id: DECK, p_days: 14 });
  });

  it("refuses a free or Plus plan before any read", async () => {
    for (const tier of ["free", "plus"]) {
      const stub = db();
      state.tier = tier;
      expect(await getDeckActivityAction(DECK, 30)).toEqual({ ok: false, error: "not_pro" });
      expect(stub.rpc).not.toHaveBeenCalled();
    }
  });

  it("refuses a signed-out caller", async () => {
    db();
    state.user = null;
    expect(await getDeckActivityAction(DECK, 30)).toEqual({ ok: false, error: "signed_out" });
  });

  it("refuses someone else's deck — a Pro visitor too", async () => {
    const stub = db();
    state.owner = OTHER;
    expect(await getDeckActivityAction(DECK, 30)).toEqual({ ok: false, error: "not_found" });
    expect(stub.rpc).not.toHaveBeenCalled();
  });

  it("refuses a period that isn't offered and an id that isn't one", async () => {
    db();
    expect(await getDeckActivityAction(DECK, 14)).toEqual({ ok: false, error: "not_found" });
    expect(await getDeckActivityAction(DECK, 400)).toEqual({ ok: false, error: "not_found" });
    expect(await getDeckActivityAction("nope", 30)).toEqual({ ok: false, error: "not_found" });
  });

  it("counts the like rows by UTC day on a database 0154 hasn't reached", async () => {
    const stub = db();
    const now = new Date();
    state.rpc = { deck_likes_by_day: { data: null, error: { code: "PGRST202", message: "no function" } } as ChainAnswer };
    state.likeRows = [{ created_at: now.toISOString() }, { created_at: now.toISOString() }];
    const result = await getDeckActivityAction(DECK, 7);
    expect(result.ok && result.activity.likes.total).toBe(2);
    const likesRead = stub.forTable("deck_likes")[0];
    expect(likesRead?.calls.some((c) => c.method === "eq" && c.args[0] === "deck_id" && c.args[1] === DECK)).toBe(true);
  });

  it("says it failed when a function errors", async () => {
    db();
    vi.spyOn(console, "error").mockImplementation(() => {});
    state.rpc = { deck_likes_by_day: { data: null, error: { message: "boom" } } as ChainAnswer };
    expect(await getDeckActivityAction(DECK, 90)).toEqual({ ok: false, error: "failed" });
  });
});
