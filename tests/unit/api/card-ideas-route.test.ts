import { readFileSync } from "node:fs";
import { join } from "node:path";
import { beforeEach, describe, expect, it, vi } from "vitest";

// ---------------------------------------------------------------------------
// POST /api/ai/card-ideas — "Get ideas" (2026-10-28, fix/ai-generation-live):
// the one credit is refunded once when the design fails, the user hears the
// failure's KIND and the truth about the credit (never the provider's
// text), an earlier orphaned charge is swept back first, and the user's
// recent AI titles reach the designer.
// ---------------------------------------------------------------------------

const s = vi.hoisted(() => ({
  spend: vi.fn(),
  refund: vi.fn(),
  settle: vi.fn(),
  reconcile: vi.fn(),
  ideas: vi.fn(),
}));

vi.mock("@/lib/supabase/env", () => ({ isSupabaseConfigured: () => true }));
vi.mock("@/lib/supabase/server", () => ({
  getCurrentUser: async () => ({ id: "user-1" }),
  createClient: async () => ({ from: () => ({ insert: async () => ({ error: null }) }) }),
}));
vi.mock("@/lib/supabase/admin", () => ({ createAdminClient: () => ({}), isAdminConfigured: () => true }));
vi.mock("@/lib/billing/flags", () => ({ isBillingEnabled: () => true }));
vi.mock("@/lib/billing/credit-reconcile", () => ({ reconcileUserSpends: s.reconcile }));
vi.mock("@/lib/ai/provider", () => ({ isDesignAiConfigured: () => true }));
vi.mock("@/lib/ai/recent-designs", () => ({ recentAiTitles: async () => ["Emberwake Tyrant"] }));
vi.mock("@/lib/ai/rate-limit", () => ({
  checkAiRateLimit: async () => ({ ok: true }),
  getFreshCreditBalance: async () => 4,
  logAiCall: async () => undefined,
  spendCredits: s.spend,
  refundCredits: s.refund,
  settleSpend: s.settle,
}));
vi.mock("@/lib/ai/card-ideas", () => ({ generateCardIdeas: s.ideas }));
vi.mock("@/lib/ai/generation-jobs", () => ({ loadOwnedDeckContext: async () => null }));

import { POST } from "@/app/api/ai/card-ideas/route";

const post = async (body: unknown = {}) => {
  const res = await POST(
    new Request("http://x/api/ai/card-ideas", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify(body),
    }),
  );
  return { status: res.status, json: (await res.json()) as Record<string, unknown> };
};

beforeEach(() => {
  s.spend.mockReset().mockResolvedValue({ ok: true, balance: 4, charged: true });
  s.refund.mockReset().mockResolvedValue(true);
  s.settle.mockReset().mockResolvedValue(undefined);
  s.reconcile.mockReset().mockResolvedValue(undefined);
  s.ideas.mockReset();
  vi.spyOn(console, "error").mockImplementation(() => undefined);
});

describe("POST /api/ai/card-ideas", () => {
  it("sweeps the user's orphaned charges first, then hands the designer the recent titles", async () => {
    s.ideas.mockResolvedValue([{ title: "Ashveil Courier" }]);
    const { status } = await post({ theme: "embers" });
    expect(status).toBe(200);
    expect(s.reconcile).toHaveBeenCalledWith({}, "user-1");
    expect(s.reconcile.mock.invocationCallOrder[0]).toBeLessThan(s.spend.mock.invocationCallOrder[0]!);
    expect(s.ideas).toHaveBeenCalledWith(expect.objectContaining({ recentTitles: ["Emberwake Tyrant"] }));
    expect(s.settle).toHaveBeenCalledTimes(1);
    expect(s.refund).not.toHaveBeenCalled();
  });

  it("a failed design is refunded once and says so — never the provider's text", async () => {
    s.ideas.mockRejectedValue(new Error("anthropic 529 overloaded_error request_id=req_123"));
    const { status, json } = await post();
    expect(status).toBe(502);
    expect(json.code).toBe("design_busy");
    expect(json.error).toBe("The AI service is busy right now. Wait a minute, then try again. Your credit was returned.");
    expect(String(json.error)).not.toContain("req_123");
    expect(s.refund).toHaveBeenCalledTimes(1);
    expect(String(s.refund.mock.calls[0]![3])).toMatch(/^refund:spend:ideas:/);
  });

  it("a refund that doesn't land is promised by the sweep, not claimed", async () => {
    s.ideas.mockRejectedValue(new Error("socket hang up"));
    s.refund.mockResolvedValue(false);
    const { json } = await post();
    expect(json.error).toBe(
      "The AI couldn't write this card. Try again, or add a theme to steer it. The credit it took comes back to you automatically within the hour.",
    );
  });

  it("an uncharged run (admin) says nothing was used and refunds nothing", async () => {
    s.spend.mockResolvedValue({ ok: true, balance: Number.POSITIVE_INFINITY, charged: false });
    s.ideas.mockRejectedValue(new Error("boom"));
    const { json } = await post();
    expect(String(json.error)).toMatch(/No credits were used\.$/);
    expect(s.refund).not.toHaveBeenCalled();
  });

  it("runs at 120 s and keeps its AI work inside the time budget", () => {
    const source = readFileSync(join(process.cwd(), "app/api/ai/card-ideas/route.ts"), "utf8");
    expect(source).toContain("export const maxDuration = 120;");
    expect(source).toContain("withAiTimeBudget(startedAt, maxDuration,");
  });
});
