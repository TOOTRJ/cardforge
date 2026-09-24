import { describe, expect, it } from "vitest";

import {
  REFILL_PAGE_SIZE,
  grantMonthlyCreditsForPeriod,
  refillActiveSubscribers,
  refillTierFor,
  type CreditGrantClient,
  type RefillProfileRow,
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

type LedgerRow = { delta: number; idempotency_key: string };

function stubAdmin(opts: {
  /** The ledger row found under the month's base refill key. */
  baseRow?: { delta: number } | null;
  /** Every refill row of the month (base + upgrade top-ups) when the
   *  scenario needs more than the base row. Overrides `baseRow`. */
  rows?: LedgerRow[];
  readError?: string;
  grantError?: string;
}): { admin: CreditGrantClient; grants: GrantCall[] } {
  const grants: GrantCall[] = [];
  const rows: LedgerRow[] =
    opts.rows ??
    (opts.baseRow ? [{ delta: opts.baseRow.delta, idempotency_key: creditRefillKey(USER, PERIOD) }] : []);
  const admin = {
    from: () => ({
      select: () => ({
        // The month's refill rows share the base key as a prefix — one LIKE.
        like: async (_column: string, pattern: string) => {
          expect(pattern).toBe(`${creditRefillKey(USER, PERIOD)}%`);
          return {
            data: opts.readError ? null : rows,
            error: opts.readError ? { message: opts.readError } : null,
          };
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
        // ledger path: .like() — no refill rows yet this month
        like: async () => ({ data: [], error: null }),
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

  it("owes an unexpired admin comp its tier — the higher of comp and live plan", () => {
    const now = new Date("2026-07-15T00:00:00Z");
    // Comped Pro on a free account.
    expect(refillTierFor({ ...base, comp_tier: "pro", comp_expires_at: null }, PERIOD, now)).toBe("pro");
    // Comped Pro on a lapsed Plus subscription.
    expect(
      refillTierFor(
        { ...base, subscription_tier: "plus", subscription_status: "canceled", comp_tier: "pro", comp_expires_at: "2026-12-31T00:00:00Z" },
        PERIOD,
        now,
      ),
    ).toBe("pro");
    // Comped Plus never demotes an active Pro.
    expect(
      refillTierFor(
        { ...base, subscription_tier: "pro", subscription_status: "active", comp_tier: "plus", comp_expires_at: null },
        PERIOD,
        now,
      ),
    ).toBe("pro");
    // An expired comp is no comp — and a free account is owed nothing.
    expect(
      refillTierFor({ ...base, comp_tier: "pro", comp_expires_at: "2026-07-01T00:00:00Z" }, PERIOD, now),
    ).toBeNull();
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
