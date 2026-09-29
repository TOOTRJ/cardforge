import { beforeEach, describe, expect, it, vi } from "vitest";
import { NextRequest } from "next/server";
import importPrintings from "../scryfall/fixtures/import-printings.json";
import tokenPrintings from "../scryfall/fixtures/token-printings.json";

// ---------------------------------------------------------------------------
// GET /api/scryfall/search — the per-user quota (TODO 0.17). A normal
// account is checked before the upstream call and logged after it; an admin
// (the frame-compare reference picker) is never refused and never logged, so a
// verification session never spends the admin's "search" bucket, which the
// printings strip shares. is_admin comes from the session's profile only.
// The upstream call still goes through searchCards, whose module-level
// throttle (lib/scryfall/client.ts) spaces every request, admin or not.
//
// TODO 1.23: tokens and emblems — the "Tokens & emblems" scope (Scryfall's
// include_extras, restricted to tokens and emblems) and the fallback to it
// when a plain query finds nothing.
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
  // `state.search` answers the cards, or a whole outcome; an empty list is
  // Scryfall's "no matches" (its 404).
  searchCardsWithOutcome: async (options: unknown) => {
    const answer = (await state.search(options)) as unknown[] | { cards: unknown[]; noMatches: boolean };
    return Array.isArray(answer) ? { cards: answer, noMatches: answer.length === 0 } : answer;
  },
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

  it("lets an admin search without being stopped by, or spending, the quota", async () => {
    signIn({ id: "admin-1", is_admin: true });
    // Even a quota the admin has already run through doesn't stop them: the
    // check runs beside the profile read, and its answer is ignored.
    state.check.mockResolvedValue({
      ok: false,
      reason: "per_day",
      retryAfterSeconds: 3600,
      message: "Daily quota reached (2000 search/day).",
    });
    const res = await get("q=makindi%20ox&limit=8");
    expect(res.status).toBe(200);
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

describe("GET /api/scryfall/search — the trimmed result", () => {
  it("carries the oracle id the art picker's printings grid needs (TODO 1.15); null when Scryfall has none", async () => {
    state.search.mockResolvedValue([
      { id: "c1", name: "Llanowar Elves", oracle_id: "68954295-54e3-4303-a6bc-fc4547a4e3a3" },
      { id: "c2", name: "Reversible card" },
    ]);
    const body = await (await get("q=llanowar")).json();
    expect(body.results.map((c: { oracle_id: string | null }) => c.oracle_id)).toEqual([
      "68954295-54e3-4303-a6bc-fc4547a4e3a3",
      null,
    ]);
  });

  it("real printings: a transform DFC keeps its card-level oracle id; a reversible card has none (its faces carry it)", async () => {
    const delver = importPrintings["isd-51"];
    const commandTower = importPrintings["sld-2794"];
    state.search.mockResolvedValue([delver, commandTower]);
    const body = await (await get("q=delver")).json();
    expect(body.results).toMatchObject([
      { id: delver.id, name: "Delver of Secrets // Insectile Aberration", oracle_id: delver.oracle_id },
      { id: commandTower.id, oracle_id: null },
    ]);
    expect(delver.oracle_id).toBe("edd531b9-f615-4399-8c8c-1c5e18c4acbf");
  });
});

describe("GET /api/scryfall/search — tokens and emblems (TODO 1.23)", () => {
  const TREASURE = tokenPrintings["tfra-15"];
  const KAITO = tokenPrintings["tfdn-24"];

  it("the Tokens & emblems scope searches tokens and emblems with include_extras, one call", async () => {
    state.search.mockResolvedValue([TREASURE]);
    const body = await (await get(`q=${encodeURIComponent('!"Treasure"')}&scope=tokens`)).json();
    expect(state.search).toHaveBeenCalledTimes(1);
    expect(state.search).toHaveBeenCalledWith({
      query: '(!"Treasure") (t:token OR t:emblem)',
      limit: 12,
      includeExtras: true,
    });
    expect(state.log).toHaveBeenCalledTimes(1);
    expect(body).toMatchObject({ ok: true, scope: "tokens" });
    expect(body.results).toMatchObject([
      { id: TREASURE.id, name: "Treasure", set: "tfra", type_line: "Token Artifact — Treasure" },
    ]);
  });

  it("the Cards scope never sends include_extras while the plain query finds something", async () => {
    state.search.mockResolvedValue([{ id: "c1", name: "Treasure Map" }]);
    const body = await (await get("q=treasure")).json();
    expect(state.search).toHaveBeenCalledTimes(1);
    expect(state.search).toHaveBeenCalledWith({ query: "treasure", limit: 12 });
    expect(body.scope).toBe("cards");
  });

  it("falls back to tokens and emblems when the plain query finds nothing — two calls, each counted", async () => {
    state.search.mockResolvedValueOnce([]).mockResolvedValueOnce([KAITO]);
    const body = await (await get(`q=${encodeURIComponent("Kaito Cunning Infiltrator Emblem")}`)).json();
    expect(state.search.mock.calls).toEqual([
      [{ query: "Kaito Cunning Infiltrator Emblem", limit: 12 }],
      [{ query: "(Kaito Cunning Infiltrator Emblem) (t:token OR t:emblem)", limit: 12, includeExtras: true }],
    ]);
    expect(state.log).toHaveBeenCalledTimes(2);
    expect(body).toMatchObject({ ok: true, scope: "tokens" });
    expect(body.results.map((c: { name: string }) => c.name)).toEqual(["Kaito, Cunning Infiltrator Emblem"]);
  });

  it("keeps the Cards scope when the fallback finds nothing either", async () => {
    state.search.mockResolvedValue([]);
    const body = await (await get("q=zzzz")).json();
    expect(state.search).toHaveBeenCalledTimes(2);
    expect(body).toEqual({ ok: true, results: [], scope: "cards" });
  });

  it("never falls back on an upstream failure (not Scryfall's 'no matches')", async () => {
    state.search.mockResolvedValue({ cards: [], noMatches: false });
    await get("q=treasure");
    expect(state.search).toHaveBeenCalledTimes(1);
  });

  it("an admin's fallback isn't counted either", async () => {
    signIn({ id: "admin-1", is_admin: true });
    state.search.mockResolvedValueOnce([]).mockResolvedValueOnce([KAITO]);
    await get("q=kaito%20emblem");
    expect(state.search).toHaveBeenCalledTimes(2);
    expect(state.log).not.toHaveBeenCalled();
  });

  it("refuses an unknown scope before calling Scryfall", async () => {
    const res = await get("q=treasure&scope=planes");
    expect(res.status).toBe(400);
    expect(state.search).not.toHaveBeenCalled();
  });

  it("carries the front face's P/T, which tells same-named tokens apart", async () => {
    state.search.mockResolvedValue([tokenPrintings["tdom-3"], tokenPrintings["tmom-16"]]);
    const body = await (await get("q=soldier&scope=tokens")).json();
    expect(body.results).toMatchObject([
      { name: "Soldier", power: "1", toughness: "1" },
      { name: "Incubator // Phyrexian", power: null, toughness: null },
    ]);
  });
});
