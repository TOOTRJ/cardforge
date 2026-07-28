import { describe, expect, it } from "vitest";

import {
  grantMonthlyCreditsForPeriod,
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
