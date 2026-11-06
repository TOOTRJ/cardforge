import { describe, expect, it } from "vitest";

import {
  MONTHLY_REFILL_BACKSTOP_DAYS,
  REFILL_PAGE_SIZE,
  grantMonthlyCreditsForPeriod,
  grantTrialCreditsForPeriod,
  refillActiveSubscribers,
  refillPlanFor,
  refillTierFor,
  type CreditGrantClient,
  type RefillProfileRow,
} from "@/lib/billing/credit-refill";
import {
  MONTHLY_CREDITS,
  creditRefillKey,
  creditUpgradeKey,
  previousCreditPeriod,
  TRIAL_CREDITS,
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
const hoursAgoFrom = (from: Date, h: number) => new Date(from.getTime() - h * 3_600_000).toISOString();

type GrantCall = {
  p_user_id: string;
  p_amount: number;
  p_reason: string;
  p_idempotency_key: string;
};

type LedgerRow = { delta: number; idempotency_key: string };

function stubAdmin(opts: {
    /** A trial_grant row already on the ledger: the tranche is spent. */
    trialEarlier?: boolean;
  /** The ledger row found under the month's base refill key. */
  baseRow?: { delta: number } | null;
  /** Every refill row of the month (base + upgrade top-ups) when the
   *  scenario needs more than the base row. Overrides `baseRow`. */
  rows?: LedgerRow[];
  readError?: string;
  grantError?: string;
  /** The user's newest base grant, any period (the backstop read). */
  newest?: { created_at: string; idempotency_key: string } | null;
  newestError?: string;
}): { admin: CreditGrantClient; grants: GrantCall[] } {
  const grants: GrantCall[] = [];
  const rows: LedgerRow[] =
    opts.rows ??
    (opts.baseRow ? [{ delta: opts.baseRow.delta, idempotency_key: creditRefillKey(USER, PERIOD) }] : []);
  const admin = {
    from: () => ({
      select: () => ({
        // The trial tranche's once-per-account read (reason = trial_grant).
        eq: () => ({ eq: () => ({ limit: async () => ({ data: opts.trialEarlier ? [{ id: "l_1" }] : [], error: null }) }) }),
        like: (_column: string, pattern: string) => {
          // The month's refill rows share the base key as a prefix — one LIKE;
          // the newest-grant read is a LIKE on the user prefix, ordered, limit 1.
          if (/^refill:[^:]+:\d{4}-\d{2}%$/.test(pattern)) {
            return Promise.resolve({
              data: opts.readError ? null : rows,
              error: opts.readError ? { message: opts.readError } : null,
            });
          }
          expect(pattern).toBe(`${creditRefillKey(USER, "")}%`);
          const chain = {
            order: () => chain,
            limit: () => chain,
            then: (resolve: (v: unknown) => void) =>
              resolve({
                data: opts.newestError ? null : opts.newest ? [opts.newest] : [],
                error: opts.newestError ? { message: opts.newestError } : null,
              }),
          };
          return chain;
        },
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
    // Month already granted as Plus (30); the user upgraded to Pro (100).
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

  it("measures the shortfall against EVERYTHING the month granted — Free → Plus → Pro is 100, not 125", async () => {
    // Regression (2026-09-22): the free refill (5, back when Free refilled)
    // held the base key, the Plus upgrade topped up 25, and the Pro upgrade
    // then topped up 100 − 5 again — 125 credits for a 100-credit plan. The
    // legacy 5-credit base row still exists in older months' ledgers.
    const legacyFreeRefill = 5;
    const afterPlus = stubAdmin({
      rows: [
        { delta: legacyFreeRefill, idempotency_key: creditRefillKey(USER, PERIOD) },
        {
          delta: MONTHLY_CREDITS.plus - legacyFreeRefill,
          idempotency_key: creditUpgradeKey(USER, PERIOD, "plus"),
        },
      ],
    });
    const result = await grantMonthlyCreditsForPeriod(afterPlus.admin, USER, "pro", PERIOD);
    expect(result).toEqual({ ok: true, granted: MONTHLY_CREDITS.pro - MONTHLY_CREDITS.plus });
    expect(afterPlus.grants[0]).toMatchObject({
      p_amount: MONTHLY_CREDITS.pro - MONTHLY_CREDITS.plus,
      p_idempotency_key: creditUpgradeKey(USER, PERIOD, "pro"),
    });
  });

  it("grants nothing on a re-upgrade after a downgrade in the same month (Pro → Plus → Pro)", async () => {
    const { admin, grants } = stubAdmin({
      rows: [
        { delta: MONTHLY_CREDITS.plus, idempotency_key: creditRefillKey(USER, PERIOD) },
        {
          delta: MONTHLY_CREDITS.pro - MONTHLY_CREDITS.plus,
          idempotency_key: creditUpgradeKey(USER, PERIOD, "pro"),
        },
      ],
    });
    expect(await grantMonthlyCreditsForPeriod(admin, USER, "pro", PERIOD)).toEqual({ ok: true, granted: 0 });
    expect(grants).toHaveLength(0);
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

  it("the trial tranche is ONCE per account: a trial_grant row already on the ledger means nothing more (the days bank can start a second free period)", async () => {
    const { admin, grants } = stubAdmin({ baseRow: null, trialEarlier: true });
    expect(await grantTrialCreditsForPeriod(admin, USER, PERIOD)).toEqual({ ok: true, granted: 0 });
    expect(grants).toHaveLength(0);
  });

  it("the trial tranche: TRIAL_CREDITS under the month's base key, tagged trial_grant", async () => {
    const { admin, grants } = stubAdmin({ baseRow: null });
    const result = await grantTrialCreditsForPeriod(admin, USER, PERIOD);
    expect(result).toEqual({ ok: true, granted: TRIAL_CREDITS });
    expect(grants[0]).toMatchObject({
      p_amount: TRIAL_CREDITS,
      p_reason: "trial_grant",
      p_idempotency_key: creditRefillKey(USER, PERIOD),
    });
    // The first payment in the same month then tops it up to the allotment.
    const converted = stubAdmin({ baseRow: { delta: TRIAL_CREDITS } });
    const topUp = await grantMonthlyCreditsForPeriod(converted.admin, USER, "pro", PERIOD);
    expect(topUp).toEqual({ ok: true, granted: MONTHLY_CREDITS.pro - TRIAL_CREDITS });
  });

  it("grants NOTHING to the free tier — Free doesn't refill (owner decision 2026-09-24; 5 credits once at signup)", async () => {
    const { admin, grants } = stubAdmin({ baseRow: null });
    const result = await grantMonthlyCreditsForPeriod(admin, USER, "free", PERIOD);

    expect(MONTHLY_CREDITS.free).toBe(0);
    expect(result).toEqual({ ok: true, granted: 0 });
    expect(grants).toHaveLength(0);
  });

  it("grants nothing to a lapsed trial in the month its 30-credit grant landed", async () => {
    // Trial converted to nothing → effective free; the month's key already
    // holds a bigger grant, so the free allotment is a no-op (never clawed back).
    const { admin, grants } = stubAdmin({ baseRow: { delta: MONTHLY_CREDITS.plus } });
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

  it("as the cron's BACKSTOP on a monthly plan: grants nothing while the newest base grant is recent, grants after 35 days or with no grant at all", async () => {
    const now = new Date("2026-02-01T06:00:00Z");
    const recent = { created_at: "2026-01-31T20:00:00Z", idempotency_key: creditRefillKey(USER, "2026-01") };
    // Paid on Jan 31 (the invoice granted); the cron on Feb 1 grants nothing.
    const waiting = stubAdmin({ newest: recent });
    expect(await grantMonthlyCreditsForPeriod(waiting.admin, USER, "pro", PERIOD, { base: "backstop", now })).toEqual({ ok: true, granted: 0 });
    expect(waiting.grants).toEqual([]);
    // The webhook was missed: the newest grant is 36 days old → the backstop grants.
    const old = { created_at: new Date(now.getTime() - (MONTHLY_REFILL_BACKSTOP_DAYS + 1) * 86_400_000).toISOString(), idempotency_key: creditRefillKey(USER, "2025-12") };
    const missed = stubAdmin({ newest: old });
    expect(await grantMonthlyCreditsForPeriod(missed.admin, USER, "pro", PERIOD, { base: "backstop", now })).toEqual({ ok: true, granted: MONTHLY_CREDITS.pro });
    // …under the MISSED month's key: the one after the newest grant's (2025-12 → 2026-01).
    expect(missed.grants[0]).toMatchObject({ p_idempotency_key: creditRefillKey(USER, "2026-01") });
    // No grant ever (a row synced before the ledger): grants. A failed read: grants (idempotent).
    expect((await grantMonthlyCreditsForPeriod(stubAdmin({ newest: null }).admin, USER, "plus", PERIOD, { base: "backstop", now })).ok).toBe(true);
    const failed = stubAdmin({ newestError: "boom" });
    expect(await grantMonthlyCreditsForPeriod(failed.admin, USER, "plus", PERIOD, { base: "backstop", now })).toEqual({ ok: true, granted: MONTHLY_CREDITS.plus });
    // A same-month trial conversion is a TOP-UP under an upgrade key — the
    // payment that anchors the next renewal: it counts as the newest grant.
    const converted = stubAdmin({ newest: { created_at: hoursAgoFrom(now, 30 * 24), idempotency_key: creditUpgradeKey(USER, "2026-01", "pro") } });
    expect(await grantMonthlyCreditsForPeriod(converted.admin, USER, "pro", PERIOD, { base: "backstop", now })).toEqual({ ok: true, granted: 0 });
    expect(converted.grants).toEqual([]);
    // A month that HAS its base row still tops up an upgrade under the backstop.
    const topUp = stubAdmin({ baseRow: { delta: MONTHLY_CREDITS.plus }, newest: recent });
    expect(await grantMonthlyCreditsForPeriod(topUp.admin, USER, "pro", PERIOD, { base: "backstop", now })).toEqual({ ok: true, granted: MONTHLY_CREDITS.pro - MONTHLY_CREDITS.plus });
    // "always" (the webhook, an annual plan) never reads the newest grant.
    const always = stubAdmin({ newest: recent });
    expect(await grantMonthlyCreditsForPeriod(always.admin, USER, "pro", PERIOD)).toEqual({ ok: true, granted: MONTHLY_CREDITS.pro });
  });

  it("a lapsed subscriber coming back (newest grant months old) is granted the CURRENT month, which the creation grant dedupes — never a month that was never owed", async () => {
    const now = new Date("2026-03-20T06:00:00Z");
    const oldPlan = { created_at: "2025-10-05T20:00:00Z", idempotency_key: creditRefillKey(USER, "2025-10") };
    const back = stubAdmin({ newest: oldPlan });
    await grantMonthlyCreditsForPeriod(back.admin, USER, "plus", "2026-03", { base: "backstop", now });
    expect(back.grants[0].p_idempotency_key).toBe(creditRefillKey(USER, "2026-03"));
  });

  it("the backstop grants the MISSED month — the one after the newest grant's — never the current one over it", async () => {
    // Paid Jan 31 (key 2026-01); the Feb 28 renewal's webhook was missed;
    // the cron on Mar 8 is past the 35 days: February is owed, and March is
    // left to the Mar 28 renewal.
    const now = new Date("2026-03-08T06:00:00Z");
    const jan = { created_at: "2026-01-31T20:00:00Z", idempotency_key: creditRefillKey(USER, "2026-01") };
    const missed = stubAdmin({ newest: jan });
    expect(await grantMonthlyCreditsForPeriod(missed.admin, USER, "plus", "2026-03", { base: "backstop", now })).toEqual({ ok: true, granted: MONTHLY_CREDITS.plus });
    expect(missed.grants[0].p_idempotency_key).toBe(creditRefillKey(USER, "2026-02"));
    // Two months missed inside the look-back (Dec 5 paid; Jan and Feb
    // renewals missed; Feb 10): the earlier one is caught up.
    const dec = { created_at: "2025-12-05T20:00:00Z", idempotency_key: creditRefillKey(USER, "2025-12") };
    const twice = stubAdmin({ newest: dec });
    await grantMonthlyCreditsForPeriod(twice.admin, USER, "plus", "2026-02", { base: "backstop", now: new Date("2026-02-10T06:00:00Z") });
    expect(twice.grants[0].p_idempotency_key).toBe(creditRefillKey(USER, "2026-01"));
    // The newest grant is last month: this month is the missed one.
    const feb = { created_at: "2026-01-28T20:00:00Z", idempotency_key: creditRefillKey(USER, "2026-02") };
    const current = stubAdmin({ newest: feb });
    await grantMonthlyCreditsForPeriod(current.admin, USER, "plus", "2026-03", { base: "backstop", now });
    expect(current.grants[0].p_idempotency_key).toBe(creditRefillKey(USER, "2026-03"));
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
  subscribers: Array<Partial<RefillProfileRow> & { id: string }>;
  /** 0-based page index whose read should fail. */
  failPageRead?: number;
};

function stubSweepAdmin(opts: SweepStubOpts & { heldBeforeStart?: string[] }): {
  admin: CreditGrantClient;
  grants: GrantCall[];
  pageReads: Array<[number, number]>;
} {
  const grants: GrantCall[] = [];
  const pageReads: Array<[number, number]> = [];
  const admin = {
    from: (table: string) => ({
      select: () => ({
        // plan_grants path (the paid time before a hold): .in().eq().eq().gt().limit()
        in: () => {
          const chain = {
            eq: () => chain,
            gt: () => chain,
            limit: () => chain,
            then: (resolve: (v: unknown) => void) =>
              resolve({ data: (opts.heldBeforeStart ?? []).map((user_id) => ({ user_id })), error: null }),
          };
          return chain;
        },
        // ledger path: .like() — no refill rows yet this month, and no
        // newest base grant (the backstop read's .order().limit()).
        like: () => {
          const chain = {
            not: () => chain,
            order: () => chain,
            limit: () => chain,
            then: (resolve: (v: unknown) => void) => resolve({ data: [], error: null }),
          };
          return chain;
        },
        // profiles path: .order().range()
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
    subscription_status: "active",
    is_admin: false,
    created_at: "2026-01-10T00:00:00Z",
  }));
}

describe("refillTierFor", () => {
  const base: RefillProfileRow = {
    id: USER,
    subscription_tier: "free",
    subscription_status: null,
    is_admin: false,
    created_at: "2026-01-10T00:00:00Z",
  };

  it("owes free accounts nothing — Free doesn't refill", () => {
    expect(refillTierFor(base, PERIOD)).toBeNull();
  });

  it("treats a lapsed or canceled paid subscription as free (nothing owed)", () => {
    expect(
      refillTierFor({ ...base, subscription_tier: "pro", subscription_status: "canceled" }, PERIOD),
    ).toBeNull();
    expect(
      refillTierFor({ ...base, subscription_tier: "plus", subscription_status: "past_due" }, PERIOD),
    ).toBeNull();
  });

  it("owes active paid subscribers their tier", () => {
    expect(
      refillTierFor({ ...base, subscription_tier: "plus", subscription_status: "active" }, PERIOD),
    ).toBe("plus");
  });

  it("a plan HELD by free days that have not started (Stripe reads trialing; the time until the hold is paid) is owed its tier; a plain trial is not", () => {
    const held = { ...base, subscription_tier: "pro", subscription_status: "trialing" };
    expect(refillTierFor(held, PERIOD, { heldBeforeStart: true })).toBe("pro");
    expect(refillTierFor(held, PERIOD, { heldBeforeStart: false })).toBeNull();
    expect(refillTierFor(held, PERIOD)).toBeNull();
    // The plan rule reads the interval as for an active plan.
    expect(refillPlanFor({ ...held, billing_interval: "year", current_period_end: "2027-01-15T00:00:00Z" }, "pro", new Date("2026-03-01T06:00:00Z"))).toEqual({ current: "always", backfillPrevious: true });
    expect(refillPlanFor({ ...held, billing_interval: "month" }, "pro")).toEqual({ current: "backstop", backfillPrevious: false });
  });

  it("a comp (the perks overlay) is NOT owed here since 0176 — its grant's own allotments are (lib/billing/free-days-credits.ts)", () => {
    // Comped Pro on a free account: nothing from this sweep.
    expect(refillTierFor({ ...base, comp_tier: "pro", comp_expires_at: null } as RefillProfileRow, PERIOD)).toBeNull();
    // Comped Pro on a lapsed Plus subscription: nothing either.
    expect(
      refillTierFor(
        { ...base, subscription_tier: "plus", subscription_status: "canceled", comp_tier: "pro", comp_expires_at: "2026-12-31T00:00:00Z" } as RefillProfileRow,
        PERIOD,
      ),
    ).toBeNull();
    // An active Pro stays Pro whatever the overlay says.
    expect(
      refillTierFor(
        { ...base, subscription_tier: "pro", subscription_status: "active", comp_tier: "plus", comp_expires_at: null } as RefillProfileRow,
        PERIOD,
      ),
    ).toBe("pro");
  });

  it("skips trials (single grant at creation) and admins; a paid subscriber who signed up this month still gets their tier", () => {
    expect(
      refillTierFor({ ...base, subscription_tier: "pro", subscription_status: "trialing" }, PERIOD),
    ).toBeNull();
    expect(refillTierFor({ ...base, is_admin: true }, PERIOD)).toBeNull();
    expect(refillTierFor({ ...base, created_at: "2026-07-20T12:00:00Z" }, PERIOD)).toBeNull();
    expect(
      refillTierFor(
        { ...base, subscription_tier: "plus", subscription_status: "active", created_at: "2026-07-20T12:00:00Z" },
        PERIOD,
      ),
    ).toBe("plus");
  });
});

describe("refillPlanFor — who grants the base allotment (0175)", () => {
  const now = new Date("2026-03-01T06:00:00Z");
  const base = { id: "u", subscription_tier: "pro", subscription_status: "active", is_admin: false, created_at: "2026-01-01T00:00:00Z" };

  it("a monthly plan: the invoice grants; the cron is the backstop", () => {
    expect(refillPlanFor({ ...base, billing_interval: "month" }, "pro", now)).toEqual({ current: "backstop", backfillPrevious: false });
  });

  it("an annual plan: every calendar month, and the previous month when the plan already ran then", () => {
    // Started Jan 15 (period ends Jan 15 next year): February is owed.
    expect(refillPlanFor({ ...base, billing_interval: "year", current_period_end: "2027-01-15T00:00:00Z" }, "pro", now)).toEqual({ current: "always", backfillPrevious: true });
    // Bought on Mar 1: February was before the plan — never backfilled.
    expect(refillPlanFor({ ...base, billing_interval: "year", current_period_end: "2027-03-01T00:00:00Z" }, "pro", now)).toEqual({ current: "always", backfillPrevious: false });
    // No period end known: no backfill.
    expect(refillPlanFor({ ...base, billing_interval: "year" }, "pro", now)).toEqual({ current: "always", backfillPrevious: false });
  });

  it("an unknown interval (pre-0175 row) keeps the old rule; a comp overlay changes nothing here (0176)", () => {
    expect(refillPlanFor({ ...base, billing_interval: null }, "pro", now)).toEqual({ current: "always", backfillPrevious: false });
    // A monthly Plus payer comped Pro: the plan's own rule (the comp's
    // credits are its grant's, lib/billing/free-days-credits.ts).
    const comped = { ...base, subscription_tier: "plus", billing_interval: "month", comp_tier: "pro", comp_expires_at: "2027-01-01T00:00:00Z" } as RefillProfileRow;
    expect(refillPlanFor(comped, "plus", now)).toEqual({ current: "backstop", backfillPrevious: false });
  });
});

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

  it("grants nothing to free, lapsed, trialing or admin accounts — only paid tiers refill", async () => {
    const subscribers = [
      { id: "free-old", subscription_tier: "free", subscription_status: null, is_admin: false, created_at: "2026-01-01T00:00:00Z" },
      { id: "free-new", subscription_tier: "free", subscription_status: null, is_admin: false, created_at: "2026-07-03T00:00:00Z" },
      { id: "trial", subscription_tier: "pro", subscription_status: "trialing", is_admin: false, created_at: "2026-01-01T00:00:00Z" },
      { id: "admin", subscription_tier: "free", subscription_status: null, is_admin: true, created_at: "2026-01-01T00:00:00Z" },
      { id: "lapsed", subscription_tier: "plus", subscription_status: "canceled", is_admin: false, created_at: "2026-01-01T00:00:00Z" },
    ];
    const { admin, grants } = stubSweepAdmin({ subscribers });

    const result = await refillActiveSubscribers(admin, PERIOD);

    expect(result).toEqual({ ok: true, processed: 5, granted: 0, failed: 0 });
    expect(grants).toEqual([]);
  });

  it("an annual plan that already ran last month is granted last month too; a monthly plan with no grant ever is granted by the backstop", async () => {
    const subscribers = [
      { id: "annual", subscription_tier: "pro", subscription_status: "active", is_admin: false, created_at: "2025-06-01T00:00:00Z", billing_interval: "year", current_period_end: "2026-06-01T00:00:00Z" },
      { id: "monthly", subscription_tier: "plus", subscription_status: "active", is_admin: false, created_at: "2026-01-01T00:00:00Z", billing_interval: "month" },
    ];
    const { admin, grants } = stubSweepAdmin({ subscribers });
    const result = await refillActiveSubscribers(admin, PERIOD);
    expect(result).toEqual({ ok: true, processed: 2, granted: 2, failed: 0 });
    expect(grants.map((g) => g.p_idempotency_key)).toEqual([
      creditRefillKey("annual", previousCreditPeriod()),
      creditRefillKey("annual", PERIOD),
      creditRefillKey("monthly", PERIOD),
    ]);
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
