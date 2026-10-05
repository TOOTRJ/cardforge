import { beforeEach, describe, expect, it, vi } from "vitest";

// ---------------------------------------------------------------------------
// TODO 5.4 skeptic pass — GET /api/ai/remix-estimate: signed-in only, a
// uuid deck_id, the AI rate limit BEFORE any Scryfall work, the estimate's
// numbers through, never cached.
// ---------------------------------------------------------------------------

const s = vi.hoisted(() => ({
  user: { id: "user-1" } as { id: string } | null,
  rate: { ok: true } as Record<string, unknown>,
  estimate: vi.fn(),
}));

vi.mock("@/lib/supabase/env", () => ({ isSupabaseConfigured: () => true }));
vi.mock("@/lib/supabase/server", () => ({ getCurrentUser: async () => s.user }));
vi.mock("@/lib/ai/rate-limit", () => ({ checkAiRateLimit: async () => s.rate }));
vi.mock("@/lib/ai/generation-limits", () => ({ batchCardLimit: async () => 100 }));
vi.mock("@/lib/ai/remix-estimate", () => ({ estimateDeckRemix: s.estimate }));

import { NextRequest } from "next/server";
import { GET } from "@/app/api/ai/remix-estimate/route";

const DECK = "44444444-4444-4444-8444-444444444444";
const get = (query: string) =>
  GET(new NextRequest(`http://x/api/ai/remix-estimate?${query}`));

beforeEach(() => {
  s.user = { id: "user-1" };
  s.rate = { ok: true };
  s.estimate.mockReset().mockResolvedValue({
    cards: 3,
    credits: 5,
    doubleFaced: 2,
    skipped: 1,
    unresolved: 0,
    creditsByEntry: { a: 2, b: 2, c: 1 },
  });
});

describe("GET /api/ai/remix-estimate", () => {
  it("needs a signed-in user", async () => {
    s.user = null;
    const res = await get(`deck_id=${DECK}`);
    expect(res.status).toBe(401);
    expect(s.estimate).not.toHaveBeenCalled();
  });

  it("needs a uuid deck_id", async () => {
    expect((await get("deck_id=not-a-uuid")).status).toBe(400);
    expect((await get("")).status).toBe(400);
    expect(s.estimate).not.toHaveBeenCalled();
  });

  it("is gated by the AI rate limit before any Scryfall work", async () => {
    s.rate = { ok: false, reason: "per_minute", retryAfterSeconds: 30, message: "Slow down." };
    const res = await get(`deck_id=${DECK}`);
    expect(res.status).toBe(429);
    expect(s.estimate).not.toHaveBeenCalled();
  });

  it("answers the estimate's numbers (never the per-entry map), uncached", async () => {
    const res = await get(`deck_id=${DECK}`);
    expect(res.status).toBe(200);
    expect(res.headers.get("cache-control")).toBe("private, no-store");
    const body = await res.json();
    expect(body).toEqual({ ok: true, cards: 3, credits: 5, doubleFaced: 2, skipped: 1, unresolved: 0, cardLimit: 100 });
    expect(s.estimate).toHaveBeenCalledWith(DECK, 100);
  });
});
