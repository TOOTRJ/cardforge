import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { makeAlertAdmin } from "../billing/helpers/alert-admin";

// ---------------------------------------------------------------------------
// GET /api/cron/refill-credits — failures are LOUD (2026-10-18): a sweep with
// failed grants or a failed profiles page read answers 500 (Vercel's cron
// log shows the run as failed; Vercel never retries a cron, and grants are
// keyed anyway) and alerts every admin ONCE per UTC day; a clean sweep is a
// 200 and alerts nobody. The sweep itself is stubbed: what it grants is
// tests/unit/billing/credit-refill.test.ts's business, unchanged.
// ---------------------------------------------------------------------------

type Sweep = (
  admin: unknown,
  period: string,
  opts?: { onGrantFailed?: (userId: string, error: string) => void },
) => Promise<unknown>;

const state = vi.hoisted(() => ({
  configured: true,
  admin: null as unknown,
  sweep: null as unknown as Sweep,
}));
vi.mock("@/lib/supabase/admin", () => ({
  createAdminClient: () => state.admin,
  isAdminConfigured: () => state.configured,
}));
vi.mock("@/lib/billing/credit-refill", () => ({
  refillActiveSubscribers: (...args: Parameters<Sweep>) => state.sweep(...args),
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
    state.sweep = vi.fn();
    expect((await get("Bearer wrong")).status).toBe(401);
    expect(state.sweep).not.toHaveBeenCalled();
  });

  it("a clean sweep: 200 with its stats, and no admin is notified", async () => {
    state.sweep = vi.fn(async () => ({ ok: true, processed: 12, granted: 3, failed: 0 }));
    const res = await get();
    expect(res.status).toBe(200);
    expect(await res.json()).toEqual({ ok: true, period: currentCreditPeriod(), processed: 12, granted: 3, failed: 0 });
    expect(alert.insertCalls).toEqual([]);
  });

  it("failed grants: 500, and every admin is notified ONCE however often it reruns that day", async () => {
    vi.useFakeTimers({ toFake: ["Date"] });
    vi.setSystemTime(new Date("2026-10-18T06:00:05Z"));
    state.sweep = vi.fn(async (_admin, _period, opts) => {
      opts?.onGrantFailed?.("user-a", "permission denied for function grant_credits");
      opts?.onGrantFailed?.("user-b", "permission denied for function grant_credits");
      return { ok: true, processed: 40, granted: 5, failed: 2 };
    });

    const res = await get();
    expect(res.status).toBe(500);
    expect(await res.json()).toEqual({ ok: false, period: "2026-10", processed: 40, granted: 5, failed: 2 });
    expect(alert.notifications).toEqual(
      ["admin-1", "admin-2"].map((recipient) => ({
        recipient_id: recipient,
        actor_id: null,
        type: "credit_refill_failed",
        payload: {
          source: "cron",
          dedupeKey: "cron:2026-10-18",
          period: "2026-10",
          day: "2026-10-18",
          processed: 40,
          granted: 5,
          failed: 2,
          pageError: null,
          userIds: ["user-a", "user-b"],
          error: "permission denied for function grant_credits",
        },
      })),
    );

    // Same day, again (a manual rerun, a duplicate delivery): still a 500, no second alert.
    vi.setSystemTime(new Date("2026-10-18T09:30:00Z"));
    expect((await get()).status).toBe(500);
    expect(alert.notifications).toHaveLength(2);

    // Next day, still failing: one more alert per admin.
    vi.setSystemTime(new Date("2026-10-19T06:00:05Z"));
    expect((await get()).status).toBe(500);
    expect(alert.notifications.map((n) => n.payload.dedupeKey)).toEqual([
      "cron:2026-10-18",
      "cron:2026-10-18",
      "cron:2026-10-19",
      "cron:2026-10-19",
    ]);
  });

  it("a failed profiles page read: 500 and an alert naming it (counts so far unknown)", async () => {
    vi.useFakeTimers({ toFake: ["Date"] });
    vi.setSystemTime(new Date("2026-10-18T06:00:05Z"));
    state.sweep = vi.fn(async (_admin, _period, opts) => {
      opts?.onGrantFailed?.("user-a", "boom");
      return { ok: false, error: "canceling statement due to statement timeout" };
    });
    const res = await get();
    expect(res.status).toBe(500);
    expect(await res.json()).toEqual({
      ok: false,
      period: "2026-10",
      failed: 1,
      error: "canceling statement due to statement timeout",
    });
    expect(alert.notifications).toHaveLength(2);
    expect(alert.notifications[0].payload).toMatchObject({
      processed: null,
      granted: null,
      failed: 1,
      pageError: "canceling statement due to statement timeout",
      userIds: ["user-a"],
      error: "boom",
    });
  });

  it("names at most 20 failed user ids in the alert", async () => {
    state.sweep = vi.fn(async (_admin, _period, opts) => {
      for (let i = 0; i < 25; i += 1) opts?.onGrantFailed?.(`user-${i}`, "boom");
      return { ok: true, processed: 25, granted: 0, failed: 25 };
    });
    await get();
    expect(alert.notifications[0].payload.userIds).toHaveLength(20);
    expect(alert.notifications[0].payload.failed).toBe(25);
  });

  it("an alert that cannot be written never changes the answer", async () => {
    alert = makeAlertAdmin({ adminIds: ["admin-1"], insertError: "db down" });
    state.admin = alert.admin;
    state.sweep = vi.fn(async (_admin, _period, opts) => {
      opts?.onGrantFailed?.("user-a", "boom");
      return { ok: true, processed: 1, granted: 0, failed: 1 };
    });
    expect((await get()).status).toBe(500);
  });
});
