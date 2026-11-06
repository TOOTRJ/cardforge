import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { makeAlertAdmin } from "../billing/helpers/alert-admin";

// ---------------------------------------------------------------------------
// GET /api/cron/refill-credits — since owner 2026-11-06 plan credits are
// one-time, so the run grants no subscriber anything; it still sweeps the
// old dated free-days grants (stubbed here — their own test is
// tests/unit/billing/free-days-credits.test.ts) and releases the bank's
// stale reservations. Failures stay LOUD: a failed grant answers 500 and
// alerts every admin ONCE per UTC day; a clean run is a 200.
// ---------------------------------------------------------------------------

type Sweep = (admin: unknown, opts?: { onGrantFailed?: (userId: string, error: string) => void }) => Promise<unknown>;

const state = vi.hoisted(() => ({
  configured: true,
  admin: null as unknown,
  grants: null as unknown as Sweep,
}));
vi.mock("@/lib/supabase/admin", () => ({
  createAdminClient: () => state.admin,
  isAdminConfigured: () => state.configured,
}));
vi.mock("@/lib/billing/day-bank", () => ({ releaseStaleReservations: async () => 0 }));
vi.mock("@/lib/billing/free-days-credits", () => ({
  grantFreeDaysCredits: (...args: Parameters<Sweep>) => state.grants(...args),
}));

import { GET } from "@/app/api/cron/refill-credits/route";
import { currentCreditPeriod } from "@/lib/billing/plans";

const get = (auth = "Bearer s3cret") =>
  GET(new Request("https://www.pipglyph.com/api/cron/refill-credits", { headers: { authorization: auth } }));

let alert: ReturnType<typeof makeAlertAdmin>;
beforeEach(() => {
  vi.stubEnv("CRON_SECRET", "s3cret");
  vi.spyOn(console, "error").mockImplementation(() => {});
  state.configured = true;
  alert = makeAlertAdmin({ adminIds: ["admin-1", "admin-2"] });
  state.admin = alert.admin;
});
afterEach(() => {
  vi.unstubAllEnvs();
  vi.restoreAllMocks();
  vi.useRealTimers();
});

describe("GET /api/cron/refill-credits", () => {
  it("answers 401 without the cron bearer, before any work", async () => {
    state.grants = vi.fn();
    expect((await get("Bearer wrong")).status).toBe(401);
    expect(state.grants).not.toHaveBeenCalled();
  });

  it("a clean run: 200, no subscriber granted anything (one-time credits), and no admin notified", async () => {
    state.grants = vi.fn(async () => ({ ok: true, processed: 3, granted: 1, failed: 0 }));
    const res = await get();
    expect(res.status).toBe(200);
    expect(await res.json()).toEqual({
      ok: true,
      period: currentCreditPeriod(),
      processed: 0,
      granted: 0,
      failed: 0,
      grants: { processed: 3, granted: 1, failed: 0 },
      bankReleased: 0,
    });
    expect(alert.insertCalls).toEqual([]);
  });

  it("a failed free-days grant: 500, and every admin is notified ONCE however often it reruns that day", async () => {
    vi.useFakeTimers({ toFake: ["Date"] });
    vi.setSystemTime(new Date("2026-10-18T06:00:05Z"));
    state.grants = vi.fn(async (_admin, opts) => {
      opts?.onGrantFailed?.("user-a", "permission denied for function grant_credits");
      return { ok: true, processed: 2, granted: 1, failed: 1 };
    });
    const res = await get();
    expect(res.status).toBe(500);
    expect(await res.json()).toMatchObject({ ok: false, period: "2026-10", failed: 1, grants: { processed: 2, granted: 1, failed: 1 } });
    expect(alert.notifications.map((n) => [n.recipient_id, n.type, (n.payload as Record<string, unknown>).dedupeKey])).toEqual([
      ["admin-1", "credit_refill_failed", "cron:2026-10-18"],
      ["admin-2", "credit_refill_failed", "cron:2026-10-18"],
    ]);
    // Same day, again (a manual rerun): still a 500, no second alert.
    vi.setSystemTime(new Date("2026-10-18T09:30:00Z"));
    expect((await get()).status).toBe(500);
    expect(alert.notifications).toHaveLength(2);
  });

  it("a failed page read answers 500 with the error", async () => {
    state.grants = vi.fn(async () => ({ ok: false, error: "down" }));
    const res = await get();
    expect(res.status).toBe(500);
    expect(await res.json()).toMatchObject({ ok: false, error: "plan_grants: down" });
  });
});
