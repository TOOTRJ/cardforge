import { beforeEach, describe, expect, it, vi } from "vitest";

// ---------------------------------------------------------------------------
// POST /api/admin/frame-align-score — the compare page's "Score" button
// (TODO 0.18: the route itself; lib/frames/score-combo.ts has its own test).
// Contract: the admin session is checked FIRST (a guest or a non-admin gets
// a 404 and nothing is parsed or scored); the body is validated against the
// real template / colour lists and a Scryfall-id-shaped `ref`; the validated
// fields — and nothing else from the body — reach scoreFrameCombo; a
// refusal comes back with scoreFrameCombo's own status (404 no printing,
// 502 Scryfall) and a score comes back as JSON with ok: true.
// ---------------------------------------------------------------------------

const REF = "308465a9-2143-49f2-b9d0-a09272dd1b62";

const state = vi.hoisted(() => ({
  profile: null as null | { id: string; is_admin: boolean },
  profileReads: 0,
  score: vi.fn(),
}));

vi.mock("@/lib/supabase/server", () => ({
  getCurrentProfile: async () => {
    state.profileReads += 1;
    return state.profile;
  },
}));
vi.mock("@/lib/frames/score-combo", () => ({ scoreFrameCombo: state.score }));

import { POST } from "@/app/api/admin/frame-align-score/route";

function post(body: unknown) {
  return POST(
    new Request("https://www.pipglyph.com/api/admin/frame-align-score", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: typeof body === "string" ? body : JSON.stringify(body),
    }),
  );
}

const SCORE = {
  ok: true as const,
  overall: 5.2,
  perSlot: { title: 11.4 },
  global: { dxPct: 0.1, dyPct: -0.2, confidence: 0.61 },
  slots: { title: { score: 11.4, best: 9.8, dxPct: 0.3, dyPct: 0 } },
  referenceId: REF,
};

beforeEach(() => {
  state.profile = { id: "admin", is_admin: true };
  state.profileReads = 0;
  state.score.mockReset();
  state.score.mockResolvedValue(SCORE);
});

describe("POST /api/admin/frame-align-score", () => {
  it("answers 404 to a guest and to a non-admin, scoring nothing", async () => {
    state.profile = null;
    const guest = await post({ template: "lotr", color: "u" });
    expect(guest.status).toBe(404);
    expect(await guest.json()).toEqual({ ok: false, error: "Not authorized." });

    state.profile = { id: "user", is_admin: false };
    expect((await post({ template: "lotr", color: "u" })).status).toBe(404);
    expect(state.score).not.toHaveBeenCalled();
  });

  it("checks the session before it looks at the body", async () => {
    state.profile = { id: "user", is_admin: false };
    // An invalid body from a non-admin is still a 404, never a 400 that
    // would confirm the route exists.
    expect((await post("not json")).status).toBe(404);
    expect((await post({ template: "nope" })).status).toBe(404);
    expect(state.profileReads).toBe(2);
  });

  it("rejects an unknown template or colour, a malformed ref and a non-JSON body", async () => {
    const bad = [
      { template: "nope", color: "u" },
      { template: "lotr", color: "x" },
      { template: "lotr", color: "a" }, // a master key, not a verification colour
      { template: "lotr" },
      { template: "lotr", color: "u", ref: "../../etc/passwd" },
      { template: "lotr", color: "u", ref: "1234" },
      { template: "lotr", color: "u", ref: 42 },
    ];
    for (const body of bad) {
      const response = await post(body);
      expect(response.status, JSON.stringify(body)).toBe(400);
      expect(await response.json()).toEqual({ ok: false, error: "Invalid payload." });
    }
    expect((await post("{not json")).status).toBe(400);
    expect(state.score).not.toHaveBeenCalled();
  });

  it("scores exactly the validated combo and ref, dropping anything else in the body", async () => {
    await post({ template: "lotr", color: "u", ref: REF, referenceId: "evil", overrides: { lotr: {} } });
    expect(state.score).toHaveBeenCalledTimes(1);
    // referenceId / overrides are server-side inputs of scoreFrameCombo —
    // a client must never be able to set them.
    expect(state.score).toHaveBeenCalledWith({ template: "lotr", color: "u", ref: REF });

    state.score.mockClear();
    await post({ template: "battle", color: "r" });
    expect(state.score).toHaveBeenCalledWith({ template: "battle", color: "r" });
  });

  it("returns the score as JSON", async () => {
    const response = await post({ template: "lotr", color: "u" });
    expect(response.status).toBe(200);
    expect(await response.json()).toEqual(SCORE);
  });

  it("passes a refusal through with scoreFrameCombo's own status", async () => {
    state.score.mockResolvedValueOnce({
      ok: false,
      error: "No reference printing for this combination.",
      status: 404,
    });
    const missing = await post({ template: "lotr", color: "c" });
    expect(missing.status).toBe(404);
    expect(await missing.json()).toEqual({
      ok: false,
      error: "No reference printing for this combination.",
    });

    state.score.mockResolvedValueOnce({ ok: false, error: "Could not download the scan.", status: 502 });
    const upstream = await post({ template: "lotr", color: "u" });
    expect(upstream.status).toBe(502);
    expect(await upstream.json()).toEqual({ ok: false, error: "Could not download the scan." });
  });
});
