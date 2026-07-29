import { describe, expect, it } from "vitest";

import {
  REFILL_PAGE_SIZE,
  grantMonthlyCreditsForPeriod,
  refillActiveSubscribers,
  type CreditGrantClient,
} from "@/lib/billing/credit-refill";
import {
  MONTHLY_CREDITS,
  creditRefillKey,
  creditUpgradeKey,
} from "@/lib/billing/plans";

// ---------------------------------------------------------------------------
// grantMonthlyCreditsForPeriod — the shared webhook/cron grant path. The core
// contract under test is the mid-month upgrade fix: a month whose refill key
// was already consumed by a lower tier must top up exactly the shortfall
// under a tier-scoped upgrade key, and downgrades/same-tier must grant
// nothing (banked credits are never clawed back).
// ---------------------------------------------------------------------------

const USER = "00000000-0000-0000-0000-000000000001";
const PERIOD = "2026-07";

type GrantCall = {
  p_user_id: string;
  p_amount: number;
  p_reason: string;
  p_idempotency_key: string;
};

function stubAdmin(opts: {
  /** The ledger row found under the month's base refill key. */
  baseRow?: { delta: number } | null;
  readError?: string;
  grantError?: string;
}): { admin: CreditGrantClient; grants: GrantCall[] } {
  const grants: GrantCall[] = [];
  const admin = {
    from: () => ({
      select: () => ({
        eq: () => ({
          maybeSingle: async () => ({
            data: opts.readError ? null : (opts.baseRow ?? null),
            error: opts.readError ? { message: opts.readError } : null,
          }),
        }),
      }),
    }),
    rpc: async (_fn: string, args: GrantCall) => {
      grants.push(args);
      return { error: opts.grantError ? { message: opts.grantError } : null };
    },
  } as unknown as CreditGrantClient;
  return { admin, grants };
}

describe("grantMonthlyCreditsForPeriod", () => {
  it("grants the full allotment under the base key when the month is ungranted", async () => {
    const { admin, grants } = stubAdmin({ baseRow: null });
    const result = await grantMonthlyCreditsForPeriod(admin, USER, "pro", PERIOD);

    expect(result).toEqual({ ok: true, granted: MONTHLY_CREDITS.pro });
    expect(grants).toHaveLength(1);
    expect(grants[0]).toMatchObject({
      p_user_id: USER,
      p_amount: MONTHLY_CREDITS.pro,
      p_reason: "subscription_refill",
      p_idempotency_key: creditRefillKey(USER, PERIOD),
    });
  });

  it("tops up the shortfall under the upgrade key after a mid-month upgrade", async () => {
    // Month already granted as Plus (30); the user upgraded to Pro (75).
    const { admin, grants } = stubAdmin({
      baseRow: { delta: MONTHLY_CREDITS.plus },
    });
    const result = await grantMonthlyCreditsForPeriod(admin, USER, "pro", PERIOD);

    const shortfall = MONTHLY_CREDITS.pro - MONTHLY_CREDITS.plus;
    expect(result).toEqual({ ok: true, granted: shortfall });
    expect(grants).toHaveLength(1);
    expect(grants[0]).toMatchObject({
      p_amount: shortfall,
      p_idempotency_key: creditUpgradeKey(USER, PERIOD, "pro"),
    });
  });

  it("grants nothing when the month's grant already covers the tier (same tier)", async () => {
    const { admin, grants } = stubAdmin({
      baseRow: { delta: MONTHLY_CREDITS.plus },
    });
    const result = await grantMonthlyCreditsForPeriod(admin, USER, "plus", PERIOD);

    expect(result).toEqual({ ok: true, granted: 0 });
    expect(grants).toHaveLength(0);
  });

  it("grants nothing on a downgrade — banked credits are never clawed back", async () => {
    const { admin, grants } = stubAdmin({
      baseRow: { delta: MONTHLY_CREDITS.pro },
    });
    const result = await grantMonthlyCreditsForPeriod(admin, USER, "plus", PERIOD);

    expect(result).toEqual({ ok: true, granted: 0 });
    expect(grants).toHaveLength(0);
  });

  it("grants nothing for the free tier", async () => {
    const { admin, grants } = stubAdmin({ baseRow: null });
    const result = await grantMonthlyCreditsForPeriod(admin, USER, "free", PERIOD);

    expect(result).toEqual({ ok: true, granted: 0 });
    expect(grants).toHaveLength(0);
  });

  it("falls back to the (idempotent) base grant when the ledger read fails", async () => {
    const { admin, grants } = stubAdmin({ readError: "connection lost" });
    const result = await grantMonthlyCreditsForPeriod(admin, USER, "plus", PERIOD);

    expect(result).toEqual({ ok: true, granted: MONTHLY_CREDITS.plus });
    expect(grants).toHaveLength(1);
    expect(grants[0]).toMatchObject({
      p_idempotency_key: creditRefillKey(USER, PERIOD),
    });
  });

  it("surfaces a grant RPC failure", async () => {
    const { admin } = stubAdmin({ baseRow: null, grantError: "boom" });
    const result = await grantMonthlyCreditsForPeriod(admin, USER, "pro", PERIOD);

    expect(result).toEqual({ ok: false, error: "boom" });
  });
});

// ---------------------------------------------------------------------------
// refillActiveSubscribers — the daily cron sweep. The core contract is
// pagination: PostgREST caps un-ranged selects at 1000 rows, and the old
// un-paginated query silently dropped subscriber #1001+ forever.
// ---------------------------------------------------------------------------

type SweepStubOpts = {
  subscribers: Array<{ id: string; subscription_tier: string }>;
  /** 0-based page index whose read should fail. */
  failPageRead?: number;
};

function stubSweepAdmin(opts: SweepStubOpts): {
  admin: CreditGrantClient;
  grants: GrantCall[];
  pageReads: Array<[number, number]>;
} {
  const grants: GrantCall[] = [];
  const pageReads: Array<[number, number]> = [];
  const admin = {
    from: (table: string) => ({
      select: () => ({
        // profiles path: .eq().in().order().range(); ledger path: .eq().maybeSingle()
        eq: () => ({
          maybeSingle: async () => ({ data: null, error: null }),
          in: () => ({
            order: () => ({
              range: async (from: number, to: number) => {
                pageReads.push([from, to]);
                const pageIndex = Math.floor(from / REFILL_PAGE_SIZE);
                if (table !== "profiles") throw new Error("unexpected table");
                if (opts.failPageRead === pageIndex) {
                  return { data: null, error: { message: "page read failed" } };
                }
                return {
                  data: opts.subscribers.slice(from, to + 1),
                  error: null,
                };
              },
            }),
          }),
        }),
      }),
    }),
    rpc: async (_fn: string, args: GrantCall) => {
      grants.push(args);
      return { error: null };
    },
  } as unknown as CreditGrantClient;
  return { admin, grants, pageReads };
}

function fakeSubscribers(count: number) {
  return Array.from({ length: count }, (_, i) => ({
    id: `user-${String(i).padStart(5, "0")}`,
    subscription_tier: i % 3 === 0 ? "pro" : "plus",
  }));
}

describe("refillActiveSubscribers", () => {
  it("pages past the 1000-row PostgREST cap and grants to every subscriber", async () => {
    // 2 full pages + a partial third — the un-paginated query saw only 1000.
    const subscribers = fakeSubscribers(REFILL_PAGE_SIZE * 2 + 250);
    const { admin, grants, pageReads } = stubSweepAdmin({ subscribers });

    const result = await refillActiveSubscribers(admin, PERIOD);

    expect(result).toEqual({
      ok: true,
      processed: subscribers.length,
      granted: subscribers.length,
      failed: 0,
    });
    expect(grants).toHaveLength(subscribers.length);
    expect(pageReads).toEqual([
      [0, REFILL_PAGE_SIZE - 1],
      [REFILL_PAGE_SIZE, REFILL_PAGE_SIZE * 2 - 1],
      [REFILL_PAGE_SIZE * 2, REFILL_PAGE_SIZE * 3 - 1],
    ]);
    // The tail subscriber the old query dropped is granted.
    expect(
      grants.some((g) => g.p_user_id === subscribers.at(-1)!.id),
    ).toBe(true);
  });

  it("stops after a single short page (no phantom second read)", async () => {
    const subscribers = fakeSubscribers(3);
    const { admin, grants, pageReads } = stubSweepAdmin({ subscribers });

    const result = await refillActiveSubscribers(admin, PERIOD);

    expect(result).toEqual({ ok: true, processed: 3, granted: 3, failed: 0 });
    expect(grants).toHaveLength(3);
    expect(pageReads).toEqual([[0, REFILL_PAGE_SIZE - 1]]);
  });

  it("aborts with the stats-so-far error when a page read fails", async () => {
    const subscribers = fakeSubscribers(REFILL_PAGE_SIZE + 10);
    const { admin, grants } = stubSweepAdmin({ subscribers, failPageRead: 1 });

    const result = await refillActiveSubscribers(admin, PERIOD);

    expect(result).toEqual({ ok: false, error: "page read failed" });
    // Page 0 was still fully granted — grants are idempotent, so the next
    // daily run resumes harmlessly.
    expect(grants).toHaveLength(REFILL_PAGE_SIZE);
  });
});
