import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { NextRequest } from "next/server";

// ---------------------------------------------------------------------------
// TODO 0.17's other half: the admin exemption drops only the PER-USER quota.
// The global Scryfall throttle lives in lib/scryfall/client.ts (a
// module-level chain, 500 ms between /cards/search calls), and an admin's
// searches still queue behind it. Runs the real client against a stubbed
// fetch with fake timers.
// ---------------------------------------------------------------------------

const state = vi.hoisted(() => ({ check: vi.fn(), log: vi.fn() }));

vi.mock("@/lib/supabase/env", () => ({ isSupabaseConfigured: () => true }));
vi.mock("@/lib/supabase/server", () => ({
  getCurrentUser: async () => ({ id: "admin-1" }),
  getCurrentProfile: async () => ({ id: "admin-1", is_admin: true }),
}));
vi.mock("@/lib/scryfall/rate-limit", () => ({
  checkScryfallRateLimit: state.check,
  logScryfallCall: state.log,
}));

beforeEach(() => {
  vi.useFakeTimers();
  state.check.mockReset().mockResolvedValue({
    ok: false,
    reason: "per_day",
    retryAfterSeconds: 3600,
    message: "Daily quota reached (2000 search/day).",
  });
  state.log.mockReset().mockResolvedValue(undefined);
});

afterEach(() => {
  vi.useRealTimers();
  vi.unstubAllGlobals();
});

describe("GET /api/scryfall/search — admin searches keep the global throttle", () => {
  it("spaces two concurrent admin searches at least 500 ms apart upstream", async () => {
    const dispatched: Array<{ at: number; url: string }> = [];
    vi.stubGlobal(
      "fetch",
      vi.fn().mockImplementation((url: string) => {
        dispatched.push({ at: Date.now(), url });
        return Promise.resolve(
          new Response(JSON.stringify({ object: "list", data: [] }), {
            status: 200,
            headers: { "Content-Type": "application/json" },
          }),
        );
      }),
    );
    // A fresh client module, so no earlier dispatch shortens the first gap.
    vi.resetModules();
    const { GET } = await import("@/app/api/scryfall/search/route");
    const get = (q: string) =>
      GET(new NextRequest(`https://www.pipglyph.com/api/scryfall/search?q=${q}&limit=8`));

    const pending = Promise.all([get("makindi"), get("ox")]);
    await vi.runAllTimersAsync();
    const responses = await pending;

    expect(responses.map((r) => r.status)).toEqual([200, 200]);
    expect(dispatched).toHaveLength(2);
    expect(dispatched.every((d) => d.url.startsWith("https://api.scryfall.com/cards/search?"))).toBe(true);
    expect(dispatched[1].at - dispatched[0].at).toBeGreaterThanOrEqual(500);
    // …while the per-user quota stays out of it: a spent quota doesn't
    // refuse the admin, and nothing is logged against it.
    expect(state.log).not.toHaveBeenCalled();
  });
});
