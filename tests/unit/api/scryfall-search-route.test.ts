import { beforeEach, describe, expect, it, vi } from "vitest";
import { NextRequest } from "next/server";

// ---------------------------------------------------------------------------
// GET /api/scryfall/search — the per-user quota (TODO 0.17). A normal
// account is checked before the upstream call and logged after it; an admin
// (the frame-compare reference picker) is neither checked nor logged, so a
// verification session never spends the admin's "search" bucket, which the
// printings strip shares. is_admin comes from the session's profile only.
// The upstream call still goes through searchCards, whose module-level
// throttle (lib/scryfall/client.ts) spaces every request, admin or not.
// ---------------------------------------------------------------------------

type Profile = { id: string; is_admin: boolean } | null;

const state = vi.hoisted(() => ({
  user: { id: "user-1" } as { id: string } | null,
  profile: { id: "user-1", is_admin: false } as { id: string; is_admin: boolean } | null,
  check: vi.fn(),
  log: vi.fn(),
  search: vi.fn(),
}));

vi.mock("@/lib/supabase/env", () => ({ isSupabaseConfigured: () => true }));
vi.mock("@/lib/supabase/server", () => ({
  getCurrentUser: async () => state.user,
  getCurrentProfile: async () => state.profile,
}));
vi.mock("@/lib/scryfall/rate-limit", () => ({
  checkScryfallRateLimit: state.check,
  logScryfallCall: state.log,
}));
vi.mock("@/lib/scryfall/client", () => ({
  searchCards: state.search,
  pickArtCropUrl: () => null,
  pickPrintImageUrl: () => null,
}));

import { GET } from "@/app/api/scryfall/search/route";

function get(query: string) {
  return GET(new NextRequest(`https://www.pipglyph.com/api/scryfall/search?${query}`));
}

function signIn(profile: Profile) {
  state.user = profile ? { id: profile.id } : { id: "user-1" };
  state.profile = profile;
}

beforeEach(() => {
  signIn({ id: "user-1", is_admin: false });
  state.check.mockReset().mockResolvedValue({ ok: true });
  state.log.mockReset().mockResolvedValue(undefined);
  state.search.mockReset().mockResolvedValue([{ id: "c1", name: "Serra Angel" }]);
});

describe("GET /api/scryfall/search — per-user quota", () => {
  it("checks and logs a normal account's search", async () => {
    const res = await get("q=serra&limit=8");
    expect(res.status).toBe(200);
    expect(state.check).toHaveBeenCalledWith("user-1", "search");
    expect(state.search).toHaveBeenCalledWith({ query: "serra", limit: 8 });
    expect(state.log).toHaveBeenCalledWith("user-1", "search");
    const body = await res.json();
    expect(body.results.map((c: { name: string }) => c.name)).toEqual(["Serra Angel"]);
  });

  it("refuses a normal account over its quota before calling Scryfall", async () => {
    state.check.mockResolvedValue({
      ok: false,
      reason: "per_minute",
      retryAfterSeconds: 60,
      message: "Slow down — you've hit 60 search calls in the last minute.",
    });
    const res = await get("q=serra");
    expect(res.status).toBe(429);
    expect(state.search).not.toHaveBeenCalled();
    expect(state.log).not.toHaveBeenCalled();
  });

  it("lets an admin search without checking or spending the quota", async () => {
    signIn({ id: "admin-1", is_admin: true });
    // Even a quota the admin has already run through doesn't stop them.
    state.check.mockResolvedValue({
      ok: false,
      reason: "per_day",
      retryAfterSeconds: 3600,
      message: "Daily quota reached (2000 search/day).",
    });
    const res = await get("q=makindi%20ox&limit=8");
    expect(res.status).toBe(200);
    expect(state.check).not.toHaveBeenCalled();
    expect(state.log).not.toHaveBeenCalled();
    // Still an upstream call through the throttled client.
    expect(state.search).toHaveBeenCalledWith({ query: "makindi ox", limit: 8 });
  });

  it("never takes admin status from the request", async () => {
    const res = await GET(
      new NextRequest("https://www.pipglyph.com/api/scryfall/search?q=serra&admin=1&is_admin=true", {
        headers: { "x-admin": "true", cookie: "is_admin=true" },
      }),
    );
    expect(res.status).toBe(200);
    expect(state.check).toHaveBeenCalledWith("user-1", "search");
    expect(state.log).toHaveBeenCalledWith("user-1", "search");
  });

  it("keeps the quota when the profile can't be read (fails closed)", async () => {
    state.profile = null;
    await get("q=serra");
    expect(state.check).toHaveBeenCalledWith("user-1", "search");
    expect(state.log).toHaveBeenCalledWith("user-1", "search");
  });

  it("still requires a session, admin or not", async () => {
    state.user = null;
    state.profile = { id: "admin-1", is_admin: true };
    const res = await get("q=serra");
    expect(res.status).toBe(401);
    expect(state.search).not.toHaveBeenCalled();
  });

  it("answers an empty query without touching the quota or Scryfall", async () => {
    const res = await get("q=%20%20");
    expect(await res.json()).toEqual({ ok: true, results: [] });
    expect(state.check).not.toHaveBeenCalled();
    expect(state.search).not.toHaveBeenCalled();
  });
});
