import { describe, expect, it } from "vitest";

import {
  FREE_PERIOD_REASON,
  PLAN_CREDITS_REASON,
  freePeriodCreditsKey,
  grantFreePeriodCredits,
  grantPlanCreditsOnce,
  planCreditsKey,
  type CreditGrantClient,
} from "@/lib/billing/credit-refill";
import { FREE_PERIOD_CREDITS, PLAN_CREDITS_ONCE } from "@/lib/billing/plans";

// ---------------------------------------------------------------------------
// Plan credits are ONE-TIME (owner 2026-11-06): the tier's stock with the
// first paid invoice, once per account and tier — Pro after Plus the
// difference, a downgrade nothing, a resubscribe nothing twice; and the
// free-period credits once per account, the old trial tranche counting as
// served. Both keyed, so a retry grants nothing twice.
// ---------------------------------------------------------------------------

const USER = "00000000-0000-0000-0000-000000000001";

type GrantCall = { p_user_id: string; p_amount: number; p_reason: string; p_idempotency_key: string };
type LedgerRow = { delta: number; idempotency_key: string };

function stubAdmin(opts: {
  /** The account's plan-once rows (any tier). */
  planRows?: LedgerRow[];
  /** A trial_grant / free_period_bonus row already on the ledger. */
  freePeriodEarlier?: boolean;
  readError?: string;
  grantError?: string;
}): { admin: CreditGrantClient; grants: GrantCall[]; reads: string[] } {
  const grants: GrantCall[] = [];
  const reads: string[] = [];
  const admin = {
    from: () => ({
      select: () => ({
        // Both reads start on the account: the free-period once-per-account
        // read is .eq(user).in(reason, …).limit(1); the plan-once rows are
        // .eq(user).like(prefix) (the user filter uses the ledger's index).
        eq: (_column: string, user: string) => ({
          in: (_column2: string, reasons: string[]) => {
            reads.push(`in:${reasons.join(",")}`);
            return { limit: async () => ({ data: opts.freePeriodEarlier ? [{ id: "l_1" }] : [], error: null }) };
          },
          like: async (_column2: string, pattern: string) => {
            reads.push(`like:${user}:${pattern}`);
            return {
              data: opts.readError ? null : (opts.planRows ?? []),
              error: opts.readError ? { message: opts.readError } : null,
            };
          },
        }),
      }),
    }),
    rpc: async (_fn: string, args: GrantCall) => {
      grants.push(args);
      return { error: opts.grantError ? { message: opts.grantError } : null };
    },
  } as unknown as CreditGrantClient;
  return { admin, grants, reads };
}

describe("grantPlanCreditsOnce", () => {
  it("grants the tier's stock under the account+tier key when the account has no plan credits yet", async () => {
    const { admin, grants, reads } = stubAdmin({});
    expect(await grantPlanCreditsOnce(admin, USER, "pro")).toEqual({ ok: true, granted: PLAN_CREDITS_ONCE.pro });
    expect(grants).toEqual([{ p_user_id: USER, p_amount: 120, p_reason: PLAN_CREDITS_REASON, p_idempotency_key: planCreditsKey(USER, "pro") }]);
    expect(reads).toEqual([`like:${USER}:plan-once:${USER}:%`]);
    expect(PLAN_CREDITS_ONCE).toEqual({ plus: 60, pro: 120 });
  });

  it("the same tier again (a second paid invoice, a resubscribe): nothing — the key exists", async () => {
    const { admin, grants } = stubAdmin({ planRows: [{ delta: 60, idempotency_key: planCreditsKey(USER, "plus") }] });
    expect(await grantPlanCreditsOnce(admin, USER, "plus")).toEqual({ ok: true, granted: 0 });
    expect(grants).toEqual([]);
  });

  it("Pro after Plus grants the DIFFERENCE (owner question 1), never 120 on top of 60", async () => {
    const { admin, grants } = stubAdmin({ planRows: [{ delta: 60, idempotency_key: planCreditsKey(USER, "plus") }] });
    expect(await grantPlanCreditsOnce(admin, USER, "pro")).toEqual({ ok: true, granted: 60 });
    expect(grants[0]).toMatchObject({ p_amount: 60, p_idempotency_key: planCreditsKey(USER, "pro") });
  });

  it("a downgrade (Plus after Pro) grants nothing — the account already holds more than Plus's stock", async () => {
    const { admin, grants } = stubAdmin({ planRows: [{ delta: 120, idempotency_key: planCreditsKey(USER, "pro") }] });
    expect(await grantPlanCreditsOnce(admin, USER, "plus")).toEqual({ ok: true, granted: 0 });
    expect(grants).toEqual([]);
  });

  it("an unreadable ledger is an error, never a guess (a Pro grant judged blind would double up)", async () => {
    const { admin, grants } = stubAdmin({ readError: "down" });
    expect(await grantPlanCreditsOnce(admin, USER, "pro")).toEqual({ ok: false, error: "down" });
    expect(grants).toEqual([]);
    const failing = stubAdmin({ grantError: "permission denied" });
    expect(await grantPlanCreditsOnce(failing.admin, USER, "plus")).toEqual({ ok: false, error: "permission denied" });
  });
});

describe("grantFreePeriodCredits", () => {
  it("grants the free-period credits once per account under the account key", async () => {
    const { admin, grants, reads } = stubAdmin({});
    expect(await grantFreePeriodCredits(admin, USER)).toEqual({ ok: true, granted: FREE_PERIOD_CREDITS });
    expect(grants).toEqual([{ p_user_id: USER, p_amount: 10, p_reason: FREE_PERIOD_REASON, p_idempotency_key: freePeriodCreditsKey(USER) }]);
    expect(reads).toEqual([`in:trial_grant,${FREE_PERIOD_REASON}`]);
  });

  it("an account that had the old 25-credit trial tranche, or these credits already, gets nothing", async () => {
    const { admin, grants } = stubAdmin({ freePeriodEarlier: true });
    expect(await grantFreePeriodCredits(admin, USER)).toEqual({ ok: true, granted: 0 });
    expect(grants).toEqual([]);
  });

  it("a failed grant is reported", async () => {
    const { admin } = stubAdmin({ grantError: "boom" });
    expect(await grantFreePeriodCredits(admin, USER)).toEqual({ ok: false, error: "boom" });
  });
});
