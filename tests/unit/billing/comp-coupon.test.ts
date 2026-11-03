import { beforeEach, describe, expect, it, vi } from "vitest";
import { chainClient } from "@/tests/stubs/supabase-chain";

// ---------------------------------------------------------------------------
// BL1 — a comp on a MONTHLY paid plan is a 100%-off repeating coupon
// (lib/billing/comp-coupon.ts decides, lib/billing/comp-stripe-apply.ts
// writes); an ANNUAL plan keeps #688's pro-rated balance credit.
//
// Stripe is SIMULATED here (no keys, no network): subscriptions carry
// discounts, coupons live in a store keyed by id, the customer balance is a
// ledger, and `renew()` issues the renewal invoice the way Stripe's docs
// describe a repeating coupon — the discount applies to an invoice created
// at or after its `start` and before its `end` (start + duration_in_months).
// The owner's test-clock run on the sandbox checks that model for real (the
// PR body's checklist).
// ---------------------------------------------------------------------------

const sync = vi.hoisted(() => ({ syncSubscriptionForUser: vi.fn(), resolveSubscriptionTier: vi.fn() }));
vi.mock("@/lib/stripe/subscription-sync", () => sync);
vi.mock("@/lib/stripe/client", () => ({ getStripe: vi.fn(), isStripeConfigured: () => false }));

import {
  applyCompToSubscription,
  ensureCompCoupon,
  moveCompOffCouponForSwitch,
  reconcileCompBilling,
} from "@/lib/billing/comp-stripe-apply";
import {
  COMP_COUPON_GRANT_KEY,
  COMP_SWITCH_HOLD_KEY,
  compBillingNeedsReconcile,
  compCouponChangeFor,
  compCouponId,
  compCouponMonths,
  compCouponNote,
  compCouponOutlook,
  isCompCouponShape,
  renewalsIn,
  type CouponSubFacts,
} from "@/lib/billing/comp-coupon";
import { COMP_CREDIT_GRANT_KEY, COMP_CREDIT_LEDGER_KEY, compCreditLedgerKey } from "@/lib/billing/comp-stripe";
import { addMonthsUtc, periodCreditCents } from "@/lib/billing/balance-credit";

const DAY = 86_400;
const sec = (v: string) => Math.floor(Date.parse(v) / 1000);
const iso = (s: number) => new Date(s * 1000).toISOString();
const addMonths = (s: number, n: number) => Math.floor(addMonthsUtc(s * 1000, n) / 1000);

// Plus monthly, $6, anchored on the 20th at noon: the current period is
// Oct 20 → Nov 20; "now" is Nov 1.
const ANCHOR = sec("2026-10-20T12:00:00Z");
const NOW = new Date("2026-11-01T12:00:00Z");
const nowSec = sec(NOW.toISOString());
const PLUS_MONTHLY = { id: "price_plus_monthly", unit_amount: 600, currency: "usd", recurring: { interval: "month", interval_count: 1 } };
const PRO_MONTHLY = { id: "price_pro_monthly", unit_amount: 1500, currency: "usd", recurring: { interval: "month", interval_count: 1 } };
const PLUS_ANNUAL = { id: "price_plus_annual", unit_amount: 6000, currency: "usd", recurring: { interval: "year", interval_count: 1 } };
type Price = typeof PLUS_MONTHLY;

const ONE_MONTH = "2026-12-01T12:00:00.000Z";
const THREE_MONTHS = "2027-02-01T12:00:00.000Z";

type Disc = { id: string; start: number; end: number | null; source: { type: "coupon"; coupon: string } };
type Coupon = Record<string, unknown> & { id: string; percent_off?: number; duration?: string; duration_in_months?: number };
type Txn = { id: string; amount: number; metadata: Record<string, string> };

function fakeStripe(opts: {
  price?: Price;
  anchor?: number;
  cycle?: number;
  metadata?: Record<string, string>;
  discounts?: Disc[];
  coupons?: Map<string, Coupon>;
  ledger?: Txn[];
  cancelAtPeriodEnd?: boolean;
  clock?: number;
}) {
  const coupons = opts.coupons ?? new Map<string, Coupon>();
  const ledger: Txn[] = [...(opts.ledger ?? [])];
  const idem = new Map<string, unknown>();
  let n = 0;
  const st = {
    clock: opts.clock ?? nowSec,
    price: opts.price ?? PLUS_MONTHLY,
    anchor: opts.anchor ?? ANCHOR,
    cycle: opts.cycle ?? 1, // current period = [anchor + (cycle-1) mo, anchor + cycle mo)
    metadata: { ...(opts.metadata ?? {}) } as Record<string, string>,
    discounts: [...(opts.discounts ?? [])] as Disc[],
    cancel_at_period_end: opts.cancelAtPeriodEnd ?? false,
    invoices: [] as Array<{ at: number; subtotal: number; discounted: number; balanceUsed: number; charged: number; discountId: string | null }>,
  };
  const step = () => (st.price.recurring.interval === "year" ? 12 : 1);
  const periodStart = () => addMonths(st.anchor, (st.cycle - 1) * step());
  const periodEnd = () => addMonths(st.anchor, st.cycle * step());
  const view = (expand?: string[]) => ({
    id: "sub_1",
    object: "subscription",
    customer: "cus_1",
    status: "active",
    cancel_at_period_end: st.cancel_at_period_end,
    cancel_at: null,
    trial_end: null,
    billing_cycle_anchor: st.anchor,
    metadata: { ...st.metadata },
    discounts: expand?.includes("discounts") ? st.discounts.map((d) => ({ ...d })) : st.discounts.map((d) => d.id),
    items: { data: [{ id: "si_1", current_period_start: periodStart(), current_period_end: periodEnd(), price: st.price }] },
  });
  const balance = () => ledger.reduce((sum, t) => sum + t.amount, 0);
  const stripe = {
    st,
    ledger,
    couponStore: coupons,
    subscriptions: {
      retrieve: vi.fn(async (_id: string, params?: { expand?: string[] }) => view(params?.expand)),
      update: vi.fn(
        async (
          _id: string,
          params: { metadata?: Record<string, string>; discounts?: "" | Array<{ coupon?: string; discount?: string }>; expand?: string[] },
          options?: { idempotencyKey?: string },
        ) => {
          if (options?.idempotencyKey && idem.has(options.idempotencyKey)) return idem.get(options.idempotencyKey);
          if ("discounts" in params) {
            const next: Disc[] = [];
            for (const d of params.discounts === "" ? [] : (params.discounts ?? [])) {
              if (d.discount) {
                const existing = st.discounts.find((x) => x.id === d.discount);
                if (!existing) throw Object.assign(new Error("No such discount"), { code: "resource_missing" });
                next.push(existing);
              } else if (d.coupon) {
                const c = coupons.get(d.coupon);
                if (!c) throw Object.assign(new Error("No such coupon"), { code: "resource_missing" });
                n += 1;
                next.push({
                  id: `di_${n}`,
                  start: st.clock,
                  end: c.duration === "repeating" ? addMonths(st.clock, c.duration_in_months as number) : null,
                  source: { type: "coupon", coupon: c.id },
                });
              }
            }
            st.discounts = next;
          }
          for (const [k, v] of Object.entries(params.metadata ?? {})) {
            if (v === "") delete st.metadata[k];
            else st.metadata[k] = v;
          }
          const out = view(params.expand);
          if (options?.idempotencyKey) idem.set(options.idempotencyKey, out);
          return out;
        },
      ),
    },
    coupons: {
      retrieve: vi.fn(async (id: string) => {
        const c = coupons.get(id);
        if (!c) throw Object.assign(new Error(`No such coupon: '${id}'`), { code: "resource_missing" });
        return { ...c };
      }),
      create: vi.fn(async (params: Coupon) => {
        if (coupons.has(params.id)) throw Object.assign(new Error("exists"), { code: "resource_already_exists" });
        const c = { ...params, object: "coupon", valid: true, amount_off: null };
        coupons.set(params.id, c);
        return { ...c };
      }),
    },
    customers: {
      retrieve: vi.fn(async () => ({ id: "cus_1", balance: balance() })),
      listBalanceTransactions: vi.fn(async () => ({ data: [...ledger].reverse(), has_more: false })),
      createBalanceTransaction: vi.fn(
        async (_c: string, params: { amount: number; metadata: Record<string, string> }, options?: { idempotencyKey?: string }) => {
          if (options?.idempotencyKey && idem.has(options.idempotencyKey)) return idem.get(options.idempotencyKey);
          const txn = { id: `cbtxn_${ledger.length + 1}`, amount: params.amount, metadata: params.metadata };
          ledger.push(txn);
          if (options?.idempotencyKey) idem.set(options.idempotencyKey, txn);
          return txn;
        },
      ),
    },
    /** The clock moves to the period's end and Stripe issues the renewal. */
    renew() {
      st.clock = periodEnd();
      st.cycle += 1;
      const subtotal = st.price.unit_amount;
      const d = st.discounts.find((x) => x.start <= st.clock && (x.end == null || st.clock < x.end)) ?? null;
      const pct = d ? Number(coupons.get(d.source.coupon)?.percent_off ?? 0) : 0;
      const discounted = Math.round(subtotal * (1 - pct / 100));
      const credit = Math.max(0, -balance());
      const balanceUsed = Math.min(credit, discounted);
      if (balanceUsed > 0) ledger.push({ id: `cbtxn_${ledger.length + 1}`, amount: balanceUsed, metadata: {} });
      // Stripe drops a repeating discount once it has ended.
      st.discounts = st.discounts.filter((x) => x.end == null || x.end > st.clock);
      const invoice = { at: st.clock, subtotal, discounted, balanceUsed, charged: discounted - balanceUsed, discountId: d?.id ?? null };
      st.invoices.push(invoice);
      return invoice;
    },
    /** Jump the clock without a renewal (an admin re-save later on). */
    at(s: number) {
      st.clock = s;
      return new Date(s * 1000);
    },
  };
  return stripe;
}
type Fake = ReturnType<typeof fakeStripe>;

const PROFILE = {
  stripe_customer_id: "cus_1",
  stripe_subscription_id: "sub_1",
  subscription_tier: "plus",
  subscription_status: "active",
  comp_tier: "plus",
  comp_expires_at: THREE_MONTHS,
};
const db = (over: Record<string, unknown> = {}) =>
  chainClient((table) => (table === "profiles" ? { data: { ...PROFILE, ...over } } : {}));
const comp = (tier: "plus" | "pro" | null, expiresAt: string | null) => ({ tier, expiresAt });
const grant = (stripe: Fake, c: { tier: "plus" | "pro" | null; expiresAt: string | null }, now: Date = new Date(stripe.st.clock * 1000)) =>
  applyCompToSubscription(db().client as never, "u1", c, { stripe: stripe as never, now });
const ours = (stripe: Fake) => stripe.st.discounts.filter((d) => d.source.coupon.startsWith("pipglyph_comp_100off_"));

beforeEach(() => {
  sync.syncSubscriptionForUser.mockReset().mockResolvedValue({});
  sync.resolveSubscriptionTier
    .mockReset()
    .mockImplementation(async (sub: { items: { data: Array<{ price: { id: string } }> } }) =>
      sub.items.data[0].price.id.includes("pro") ? "pro" : "plus",
    );
});

// ---------------------------------------------------------------------------
describe("the pure rules", () => {
  it("ONE coupon per length, by a deterministic id — never a client's code", () => {
    expect(compCouponId(1)).toBe("pipglyph_comp_100off_1m");
    expect(compCouponId(12)).toBe("pipglyph_comp_100off_12m");
    expect(() => compCouponId(0)).toThrow();
    expect(() => compCouponId(1.5)).toThrow();
  });

  it("only the exact shape is ours: 100 % off, repeating, the id's months", () => {
    const good = { id: compCouponId(3), percent_off: 100, duration: "repeating", duration_in_months: 3, valid: true };
    expect(isCompCouponShape(good, 3)).toBe(true);
    expect(isCompCouponShape({ ...good, percent_off: 50 }, 3)).toBe(false);
    expect(isCompCouponShape({ ...good, duration: "forever" }, 3)).toBe(false);
    expect(isCompCouponShape({ ...good, duration_in_months: 2 }, 3)).toBe(false);
    expect(isCompCouponShape({ ...good, valid: false }, 3)).toBe(false);
    expect(isCompCouponShape({ ...good, amount_off: 600 }, 3)).toBe(false);
  });

  it("the comp's months: whole calendar months, ≥ 15 leftover days round up, a day short counts as the month", () => {
    expect(compCouponMonths(nowSec, sec(ONE_MONTH))).toBe(1);
    expect(compCouponMonths(nowSec, sec(THREE_MONTHS))).toBe(3);
    // The admin's picker lands at midnight, half a day short of the month.
    expect(compCouponMonths(nowSec, sec("2026-12-01T00:00:00Z"))).toBe(1);
    expect(compCouponMonths(nowSec, nowSec + 10 * DAY)).toBe(0);
    expect(compCouponMonths(nowSec, nowSec + 14 * DAY)).toBe(0);
    expect(compCouponMonths(nowSec, nowSec + 15 * DAY)).toBe(1);
    expect(compCouponMonths(nowSec, nowSec + 45 * DAY)).toBe(2); // Dec 1 + 15 days
    expect(compCouponMonths(nowSec, nowSec + 40 * DAY)).toBe(1);
  });

  it("renewals follow the billing anchor, the day clamped to the month's last (Jan 31 → Feb 28 → Mar 31)", () => {
    const anchor = sec("2027-01-31T09:00:00Z");
    const sub: CouponSubFacts = {
      status: "active",
      billing_cycle_anchor: anchor,
      items: { data: [{ current_period_start: anchor, current_period_end: sec("2027-02-28T09:00:00Z") }] },
    };
    expect(renewalsIn(sub, anchor, sec("2027-04-01T00:00:00Z")).map(iso)).toEqual([
      "2027-02-28T09:00:00.000Z",
      "2027-03-31T09:00:00.000Z",
    ]);
  });

  it("an outlook: the free invoices left and the first one charged as usual", () => {
    const sub: CouponSubFacts = {
      status: "active",
      billing_cycle_anchor: ANCHOR,
      items: { data: [{ current_period_start: ANCHOR, current_period_end: addMonths(ANCHOR, 1) }] },
    };
    const end = addMonths(nowSec, 3);
    expect(compCouponOutlook(sub, end, nowSec)).toEqual({ freeInvoices: 3, chargedFromSec: sec("2027-02-20T12:00:00Z") });
  });

  it("the notes say what happened in one line", () => {
    const apply = compCouponChangeFor({
      sub: { status: "active", billing_cycle_anchor: ANCHOR, items: { data: [{ current_period_end: addMonths(ANCHOR, 1) }] } },
      subscribedTier: "plus",
      comp: comp("plus", ONE_MONTH),
      now: NOW,
    });
    expect(apply).toMatchObject({ kind: "apply", couponMonths: 1 });
    expect(compCouponNote(apply, { freeInvoices: 1, chargedFrom: "2026-12-20T12:00:00.000Z" })).toBe(
      "Their next monthly invoice is free — a 100%-off complimentary coupon on their Stripe subscription. Billing resumes as usual on Dec 20, 2026 UTC.",
    );
    expect(compCouponNote({ kind: "remove", discountId: "di_1", reason: "comp_released" })).toMatch(/^Removed the complimentary coupon/);
    expect(compCouponNote({ kind: "none", reason: "comp_too_short" })).toMatch(/^Shorter than half a month/);
  });
});

// ---------------------------------------------------------------------------
describe("a MONTHLY plan: grant, the renewal at $0, re-save, revoke", () => {
  it("GRANT: the coupon is created once (100 % off, repeating, 1 month) and attached with the grant in ONE update", async () => {
    const stripe = fakeStripe({});
    const out = await grant(stripe, comp("plus", ONE_MONTH), NOW);
    expect(stripe.coupons.create).toHaveBeenCalledTimes(1);
    expect(stripe.coupons.create).toHaveBeenCalledWith(
      expect.objectContaining({
        id: "pipglyph_comp_100off_1m",
        percent_off: 100,
        duration: "repeating",
        duration_in_months: 1,
        name: "PipGlyph complimentary plan (1 month free)",
      }),
      { idempotencyKey: "comp-coupon-create:pipglyph_comp_100off_1m" },
    );
    expect(stripe.subscriptions.update).toHaveBeenCalledTimes(1);
    const [, params] = stripe.subscriptions.update.mock.calls[0];
    expect(params).toMatchObject({
      discounts: [{ coupon: "pipglyph_comp_100off_1m" }],
      proration_behavior: "none",
      metadata: { [COMP_COUPON_GRANT_KEY]: `${nowSec}:${sec(ONE_MONTH)}:1` },
    });
    // Never the balance on a monthly plan.
    expect(stripe.customers.createBalanceTransaction).not.toHaveBeenCalled();
    expect(out).toMatchObject({ failed: false, coupon: { freeInvoices: 1, chargedFrom: "2026-12-20T12:00:00.000Z" } });
    expect(out.note).toMatch(/^Their next monthly invoice is free/);
  });

  it("the RENEWAL invoices: exactly N at $0, the one after at the full price — nothing pro-rated", async () => {
    const stripe = fakeStripe({});
    await grant(stripe, comp("plus", THREE_MONTHS), NOW);
    const invoices = [stripe.renew(), stripe.renew(), stripe.renew(), stripe.renew()];
    expect(invoices.map((i) => [iso(i.at).slice(0, 10), i.charged])).toEqual([
      ["2026-11-20", 0],
      ["2026-12-20", 0],
      ["2027-01-20", 0],
      ["2027-02-20", 600],
    ]);
    // The invoice SHOWS the comp: the full subtotal, the comp's discount on it.
    expect(invoices[0]).toMatchObject({ subtotal: 600, discounted: 0, balanceUsed: 0 });
    expect(invoices[0].discountId).not.toBeNull();
    expect(ours(stripe)).toEqual([]); // ended by itself
  });

  it("RE-SAVE of the same comp — an hour later, or after a free renewal: no write, no second coupon, no double discount", async () => {
    const stripe = fakeStripe({});
    await grant(stripe, comp("plus", THREE_MONTHS), NOW);
    stripe.subscriptions.update.mockClear();
    stripe.coupons.create.mockClear();

    let out = await grant(stripe, comp("plus", THREE_MONTHS), stripe.at(nowSec + 3600));
    expect(stripe.subscriptions.update).not.toHaveBeenCalled();
    expect(stripe.coupons.create).not.toHaveBeenCalled();
    expect(out.coupon?.change.kind).toBe("keep");
    expect(out.note).toBe("Their complimentary coupon is already on their Stripe subscription.");

    stripe.renew(); // Nov 20, $0
    out = await grant(stripe, comp("plus", THREE_MONTHS), stripe.at(sec("2026-11-25T12:00:00Z")));
    expect(stripe.subscriptions.update).not.toHaveBeenCalled();
    expect(out.coupon).toMatchObject({ change: { kind: "keep" }, freeInvoices: 2 });
    expect(ours(stripe)).toHaveLength(1);
    expect([stripe.renew(), stripe.renew(), stripe.renew()].map((i) => i.charged)).toEqual([0, 0, 600]);
  });

  it("two users comped the same length share ONE coupon (looked up, never created twice)", async () => {
    const coupons = new Map<string, Coupon>();
    await grant(fakeStripe({ coupons }), comp("plus", ONE_MONTH), NOW);
    const second = fakeStripe({ coupons });
    await grant(second, comp("plus", ONE_MONTH), NOW);
    expect(second.coupons.create).not.toHaveBeenCalled();
    expect([...coupons.keys()]).toEqual(["pipglyph_comp_100off_1m"]);
  });

  it("two saves racing to create the coupon: the loser reads the winner's", async () => {
    const stripe = fakeStripe({});
    stripe.coupons.create.mockImplementationOnce(async (p: Coupon) => {
      stripe.couponStore.set(p.id, { ...p, valid: true });
      throw Object.assign(new Error("exists"), { code: "resource_already_exists" });
    });
    expect(await ensureCompCoupon(stripe as never, 2)).toBe("pipglyph_comp_100off_2m");
  });

  it("a coupon under our id with another shape (edited in the dashboard) is NEVER applied", async () => {
    const coupons = new Map<string, Coupon>([
      ["pipglyph_comp_100off_1m", { id: "pipglyph_comp_100off_1m", percent_off: 100, duration: "forever", valid: true }],
    ]);
    const stripe = fakeStripe({ coupons });
    const out = await grant(stripe, comp("plus", ONE_MONTH), NOW);
    expect(out.failed).toBe(true);
    expect(stripe.subscriptions.update).not.toHaveBeenCalled();
  });

  it("REVOKE mid-way: the coupon comes off in one update; the invoice already at $0 stays, the next is charged", async () => {
    const stripe = fakeStripe({});
    await grant(stripe, comp("plus", THREE_MONTHS), NOW);
    expect(stripe.renew().charged).toBe(0); // Nov 20
    const out = await grant(stripe, comp(null, null), stripe.at(sec("2026-12-05T12:00:00Z")));
    expect(out.coupon?.change).toEqual({ kind: "remove", discountId: "di_1", reason: "comp_released" });
    expect(stripe.subscriptions.update).toHaveBeenLastCalledWith(
      "sub_1",
      { discounts: "", proration_behavior: "none", metadata: { [COMP_COUPON_GRANT_KEY]: "" } },
      expect.objectContaining({ idempotencyKey: expect.stringContaining("remove:di_1") }),
    );
    expect(ours(stripe)).toEqual([]);
    expect(stripe.st.metadata[COMP_COUPON_GRANT_KEY]).toBeUndefined();
    expect(stripe.renew().charged).toBe(600); // Dec 20
    expect(stripe.st.invoices.map((i) => i.charged)).toEqual([0, 600]);
    // Nothing is clawed back or credited.
    expect(stripe.customers.createBalanceTransaction).not.toHaveBeenCalled();
    expect(out.note).toMatch(/next invoice is charged as usual/);
  });

  it("another discount on the subscription is kept untouched when ours goes on and comes off", async () => {
    const other: Disc = { id: "di_other", start: nowSec - DAY, end: null, source: { type: "coupon", coupon: "SOMETHING_ELSE" } };
    const stripe = fakeStripe({ discounts: [other] });
    await grant(stripe, comp("plus", ONE_MONTH), NOW);
    expect(stripe.subscriptions.update.mock.calls[0][1]).toMatchObject({
      discounts: [{ discount: "di_other" }, { coupon: "pipglyph_comp_100off_1m" }],
    });
    await grant(stripe, comp(null, null), stripe.at(nowSec + DAY));
    expect(stripe.subscriptions.update.mock.calls[1][1]).toMatchObject({ discounts: [{ discount: "di_other" }] });
    expect(stripe.st.discounts.map((d) => d.id)).toEqual(["di_other"]);
  });

  it("EXTENDED from one month to three after the first free renewal: re-sized to the two still owed (3 free in all)", async () => {
    const stripe = fakeStripe({});
    await grant(stripe, comp("plus", ONE_MONTH), NOW);
    stripe.renew(); // Nov 20, $0
    const out = await grant(stripe, comp("plus", THREE_MONTHS), stripe.at(sec("2026-11-25T12:00:00Z")));
    expect(out.coupon?.change).toMatchObject({ kind: "apply", couponMonths: 2, replaces: "di_1", grant: { startSec: nowSec, months: 3 } });
    expect(ours(stripe)).toHaveLength(1);
    expect(stripe.st.metadata[COMP_COUPON_GRANT_KEY]).toBe(`${nowSec}:${sec(THREE_MONTHS)}:3`);
    expect([stripe.renew(), stripe.renew(), stripe.renew()].map((i) => i.charged)).toEqual([0, 0, 600]);
    expect(stripe.st.invoices.filter((i) => i.charged === 0)).toHaveLength(3);
  });

  it("SHORTENED from three months to one after the first free renewal: nothing more is owed — the coupon comes off", async () => {
    const stripe = fakeStripe({});
    await grant(stripe, comp("plus", THREE_MONTHS), NOW);
    stripe.renew(); // Nov 20, $0
    const out = await grant(stripe, comp("plus", ONE_MONTH), stripe.at(sec("2026-11-25T12:00:00Z")));
    expect(out.coupon?.change).toEqual({ kind: "remove", discountId: "di_1", reason: "comp_too_short" });
    expect(stripe.renew().charged).toBe(600); // Dec 20
  });

  it("a comp under half a month frees no invoice: nothing is written, the admin is told", async () => {
    const stripe = fakeStripe({});
    const out = await grant(stripe, comp("plus", iso(nowSec + 10 * DAY)), NOW);
    expect(stripe.subscriptions.update).not.toHaveBeenCalled();
    expect(stripe.coupons.create).not.toHaveBeenCalled();
    expect(out.note).toMatch(/Shorter than half a month/);
  });

  it("a cancelled monthly plan gets no coupon; a comp below the plan changes nothing", async () => {
    let stripe = fakeStripe({ cancelAtPeriodEnd: true });
    let out = await grant(stripe, comp("plus", ONE_MONTH), NOW);
    expect(stripe.subscriptions.update).not.toHaveBeenCalled();
    expect(out.note).toMatch(/cancelled and stops on its own date/);

    stripe = fakeStripe({ price: PRO_MONTHLY });
    out = await grant(stripe, comp("plus", ONE_MONTH), NOW);
    expect(stripe.subscriptions.update).not.toHaveBeenCalled();
    expect(out.note).toBe("The comp is below their plan, so it changes nothing.");
  });

  it("an expired comp's coupon keeps freeing the invoice it was sized for (those are the comp's own months)", async () => {
    const stripe = fakeStripe({});
    await grant(stripe, comp("plus", ONE_MONTH), NOW); // ends Dec 1
    stripe.subscriptions.update.mockClear();
    // Dec 2: the comp has expired (the row still names it); a resave or a
    // webhook run must not take the coupon off before Dec 20's renewal… which
    // the 1-month coupon (ends Dec 1 noon) doesn't cover anyway — Nov 20 was its one.
    await grant(stripe, comp("plus", ONE_MONTH), stripe.at(sec("2026-12-02T12:00:00Z")));
    expect(stripe.subscriptions.update).not.toHaveBeenCalled();
  });

  it("a subscription read WITHOUT its discounts expanded is refused — never a guess that could add a second coupon", async () => {
    const stripe = fakeStripe({ discounts: [{ id: "di_x", start: nowSec, end: null, source: { type: "coupon", coupon: "X" } }] });
    stripe.subscriptions.retrieve.mockImplementation(async () => ({ ...(await fakeStripe({}).subscriptions.retrieve("sub_1")), discounts: ["di_x"] }));
    const out = await grant(stripe, comp("plus", ONE_MONTH), NOW);
    expect(out.failed).toBe(true);
    expect(stripe.subscriptions.update).not.toHaveBeenCalled();
  });

  it("asks Stripe for the subscription WITH its discounts", async () => {
    const stripe = fakeStripe({});
    await grant(stripe, comp("plus", ONE_MONTH), NOW);
    expect(stripe.subscriptions.retrieve).toHaveBeenCalledWith("sub_1", { expand: ["discounts"] });
  });
});

// ---------------------------------------------------------------------------
describe("an ANNUAL plan stays on the balance credit", () => {
  it("a month's comp on $60 / year is $5 on the balance; no coupon is created or attached", async () => {
    const stripe = fakeStripe({ price: PLUS_ANNUAL, anchor: sec("2026-06-01T12:00:00Z"), cycle: 1 });
    const out = await grant(stripe, comp("plus", ONE_MONTH), NOW);
    expect(stripe.coupons.create).not.toHaveBeenCalled();
    expect(stripe.coupons.retrieve).not.toHaveBeenCalled();
    expect(stripe.customers.createBalanceTransaction).toHaveBeenCalledWith(
      "cus_1",
      expect.objectContaining({ amount: -500 }),
      expect.anything(),
    );
    expect(stripe.st.discounts).toEqual([]);
    expect(out.credit?.postedCents).toBe(500);
  });
});

// ---------------------------------------------------------------------------
describe("switching plan while comped", () => {
  const NOV25 = sec("2026-11-25T12:00:00Z");

  it("monthly → ANNUAL in the app: before the portal opens, the coupon comes off and the rest of the comp is credited from the end of the invoice it already freed", async () => {
    const stripe = fakeStripe({});
    await grant(stripe, comp("plus", THREE_MONTHS), NOW);
    stripe.renew(); // Nov 20 → Dec 20 is free
    stripe.at(NOV25);
    const live = await stripe.subscriptions.retrieve("sub_1");
    const moved = await moveCompOffCouponForSwitch(stripe as never, live as never, {
      userId: "u1",
      comp: comp("plus", THREE_MONTHS),
      target: { tier: "plus", period: "annual" },
      now: new Date(NOV25 * 1000),
    });
    expect(moved.moved).toBe(true);
    // No 100 % coupon left to free the annual invoice.
    expect(ours(stripe)).toEqual([]);
    expect(stripe.st.metadata[COMP_COUPON_GRANT_KEY]).toBeUndefined();
    expect(stripe.st.metadata[COMP_SWITCH_HOLD_KEY]).toBe(String(NOV25));
    // The credit pays Dec 20 → Feb 1 (the free invoice already paid Nov 20 → Dec 20).
    const dec20 = sec("2026-12-20T12:00:00Z");
    expect(stripe.st.metadata[COMP_CREDIT_GRANT_KEY]).toBe(`${dec20}:${sec(THREE_MONTHS)}`);
    const expected = periodCreditCents({ price: PLUS_MONTHLY, tier: "plus", startSec: dec20, endSec: sec(THREE_MONTHS) });
    expect(expected).toBe(837); // $72 × (1/12 + 12/365)
    expect(stripe.customers.createBalanceTransaction).toHaveBeenCalledWith(
      "cus_1",
      expect.objectContaining({ amount: -837, metadata: expect.objectContaining({ [COMP_CREDIT_LEDGER_KEY]: compCreditLedgerKey("sub_1", { startSec: dec20, endSec: sec(THREE_MONTHS) }) }) }),
      expect.anything(),
    );
    // The coupon came off in the SAME update that named the credit's grant (before any money).
    const first = stripe.subscriptions.update.mock.calls.findIndex(([, p]) => (p as { discounts?: unknown }).discounts === "");
    expect((stripe.subscriptions.update.mock.calls[first][1] as { metadata: Record<string, string> }).metadata).toMatchObject({
      [COMP_COUPON_GRANT_KEY]: "",
      [COMP_CREDIT_GRANT_KEY]: `${dec20}:${sec(THREE_MONTHS)}`,
    });
    expect(stripe.subscriptions.update.mock.invocationCallOrder[first]).toBeLessThan(
      stripe.customers.createBalanceTransaction.mock.invocationCallOrder[0],
    );
  });

  it("the customer ABANDONS the portal: the comp stays a credit while the switch hold is fresh (a re-save or event changes nothing)", async () => {
    const stripe = fakeStripe({});
    await grant(stripe, comp("plus", THREE_MONTHS), NOW);
    stripe.renew();
    stripe.at(NOV25);
    await moveCompOffCouponForSwitch(stripe as never, (await stripe.subscriptions.retrieve("sub_1")) as never, {
      userId: "u1",
      comp: comp("plus", THREE_MONTHS),
      target: { tier: "plus", period: "annual" },
      now: new Date(NOV25 * 1000),
    });
    stripe.subscriptions.update.mockClear();
    stripe.customers.createBalanceTransaction.mockClear();
    const out = await grant(stripe, comp("plus", THREE_MONTHS), stripe.at(NOV25 + 3600));
    expect(stripe.subscriptions.update).not.toHaveBeenCalled();
    expect(stripe.customers.createBalanceTransaction).not.toHaveBeenCalled();
    expect(out.credit?.postedCents).toBe(0);
    expect(compBillingNeedsReconcile({ sub: (await stripe.subscriptions.retrieve("sub_1")) as never, subscribedTier: "plus", comp: comp("plus", THREE_MONTHS), now: new Date((NOV25 + 3600) * 1000) })).toBe(false);
    // The credit (#688's pro-rated one) pays what the comp still owes:
    // Dec 20 in full, Jan 20 for the 12 comp days left in it.
    expect([stripe.renew(), stripe.renew()].map((i) => i.charged)).toEqual([0, 363]);
  });

  it("monthly → a HIGHER monthly tier the comp covers (a Pro comp on Plus, switching to Pro): the coupon stays", async () => {
    const stripe = fakeStripe({});
    await grant(stripe, comp("pro", THREE_MONTHS), NOW);
    const moved = await moveCompOffCouponForSwitch(stripe as never, (await stripe.subscriptions.retrieve("sub_1")) as never, {
      userId: "u1",
      comp: comp("pro", THREE_MONTHS),
      target: { tier: "pro", period: "monthly" },
      now: NOW,
    });
    expect(moved).toEqual({ moved: false, note: null });
    expect(ours(stripe)).toHaveLength(1);
  });

  it("monthly Plus comp → Pro monthly (above the comp): moved off the coupon first", async () => {
    const stripe = fakeStripe({});
    await grant(stripe, comp("plus", THREE_MONTHS), NOW);
    const moved = await moveCompOffCouponForSwitch(stripe as never, (await stripe.subscriptions.retrieve("sub_1")) as never, {
      userId: "u1",
      comp: comp("plus", THREE_MONTHS),
      target: { tier: "pro", period: "monthly" },
      now: NOW,
    });
    expect(moved.moved).toBe(true);
    expect(ours(stripe)).toEqual([]);
  });

  it("no comp coupon on the plan: the switch is untouched", async () => {
    const stripe = fakeStripe({});
    const moved = await moveCompOffCouponForSwitch(stripe as never, (await stripe.subscriptions.retrieve("sub_1")) as never, {
      userId: "u1",
      comp: comp(null, null),
      target: { tier: "plus", period: "annual" },
      now: NOW,
    });
    expect(moved).toEqual({ moved: false, note: null });
    expect(stripe.subscriptions.update).not.toHaveBeenCalled();
  });

  it("a switch made in Stripe's own portal (the coupon still on an ANNUAL price): the webhook takes it off", async () => {
    const stripe = fakeStripe({});
    await grant(stripe, comp("plus", THREE_MONTHS), NOW);
    // The portal switched the price at Nov 25 and started an annual period.
    stripe.st.price = PLUS_ANNUAL;
    stripe.st.anchor = NOV25;
    stripe.st.cycle = 1;
    stripe.at(NOV25 + 60);
    const eventSub = await stripe.subscriptions.retrieve("sub_1");
    const out = await reconcileCompBilling(db().client as never, stripe as never, "u1", eventSub as never, "plus", new Date((NOV25 + 60) * 1000));
    expect(out?.failed).toBe(false);
    expect(ours(stripe)).toEqual([]);
    // The switch's invoice fell inside the discount: the comp is paid for to
    // the period's end — no credit on top.
    expect(stripe.customers.createBalanceTransaction).not.toHaveBeenCalled();
    expect(out?.note).toMatch(/Took the complimentary coupon off/);
  });

  it("ANNUAL → monthly (a downgrade's phase change): the credit's unspent part comes back, then a coupon for what is still owed", async () => {
    // Annual Plus renewing Dec 1; comped Plus Nov 1 → Feb 1 on the credit ($15).
    const annualAnchor = sec("2025-12-01T12:00:00Z");
    const ledgerKey = compCreditLedgerKey("sub_1", { startSec: nowSec, endSec: sec(THREE_MONTHS) });
    const stripe = fakeStripe({
      price: PLUS_ANNUAL,
      anchor: annualAnchor,
      metadata: { [COMP_CREDIT_GRANT_KEY]: `${nowSec}:${sec(THREE_MONTHS)}` },
      ledger: [{ id: "cbtxn_0", amount: -1500, metadata: { [COMP_CREDIT_LEDGER_KEY]: ledgerKey } }],
    });
    // Dec 1: the schedule's next phase — Plus MONTHLY from here, its first
    // invoice ($6) paid by the credit on the balance.
    const dec1 = sec("2026-12-01T12:00:00Z");
    stripe.st.price = PLUS_MONTHLY;
    stripe.st.anchor = dec1;
    stripe.st.cycle = 1;
    stripe.ledger.push({ id: "cbtxn_inv", amount: 600, metadata: {} });
    stripe.at(dec1 + 60);
    const eventSub = await stripe.subscriptions.retrieve("sub_1");
    expect(compBillingNeedsReconcile({ sub: eventSub as never, subscribedTier: "plus", comp: comp("plus", THREE_MONTHS), now: new Date((dec1 + 60) * 1000) })).toBe(true);
    const out = await reconcileCompBilling(db().client as never, stripe as never, "u1", eventSub as never, "plus", new Date((dec1 + 60) * 1000));
    // The whole credit comes back that is unspent ($9); the $6 that paid
    // Dec 1's invoice stays — that invoice is the comp's first.
    expect(out?.credit).toMatchObject({ postedCents: -900, keptCents: 600 });
    expect(stripe.st.metadata[COMP_CREDIT_GRANT_KEY]).toBeUndefined();
    // A 3-month comp (from the credit's start, Nov 1) with one invoice
    // already paid: the coupon frees the two still owed, then billing resumes.
    expect(out?.coupon?.change).toMatchObject({ kind: "apply", couponMonths: 2, grant: { startSec: nowSec, months: 3 } });
    expect([stripe.renew(), stripe.renew(), stripe.renew()].map((i) => [iso(i.at).slice(0, 10), i.charged])).toEqual([
      ["2027-01-01", 0],
      ["2027-02-01", 0],
      ["2027-03-01", 600],
    ]);
    expect(stripe.ledger.reduce((sum, t) => sum + t.amount, 0)).toBe(0); // nothing left on the balance
  });

  it("a #688 credit on a MONTHLY plan moves onto the coupon at the next event — never both paying the same invoice", async () => {
    const ledgerKey = compCreditLedgerKey("sub_1", { startSec: nowSec, endSec: sec(THREE_MONTHS) });
    const stripe = fakeStripe({
      metadata: { [COMP_CREDIT_GRANT_KEY]: `${nowSec}:${sec(THREE_MONTHS)}` },
      ledger: [{ id: "cbtxn_0", amount: -1800, metadata: { [COMP_CREDIT_LEDGER_KEY]: ledgerKey } }],
    });
    stripe.renew(); // Nov 20: $6 of the credit pays it
    const at = stripe.st.clock + 60;
    const out = await reconcileCompBilling(db().client as never, stripe as never, "u1", (await stripe.subscriptions.retrieve("sub_1")) as never, "plus", stripe.at(at));
    // The $12 still unspent comes back; the $6 that paid Nov 20 stays.
    expect(out?.credit).toMatchObject({ postedCents: -1200, keptCents: 600 });
    expect(stripe.st.metadata[COMP_CREDIT_GRANT_KEY]).toBeUndefined();
    // Nov 20 counted as freed (the credit paid it): Dec 20 and Jan 20 free,
    // Feb 20 charged — three invoices for three months, as a fresh grant.
    expect(out?.coupon?.change).toMatchObject({ kind: "apply", couponMonths: 2 });
    expect([stripe.renew(), stripe.renew(), stripe.renew()].map((i) => i.charged)).toEqual([0, 0, 600]);
    expect(stripe.ledger.reduce((sum, t) => sum + t.amount, 0)).toBe(0);
  });

  it("a #688 credit on a monthly plan whose comp is CLEARED is released as #688 does — the time lived through stays paid for", async () => {
    const ledgerKey = compCreditLedgerKey("sub_1", { startSec: nowSec, endSec: sec(THREE_MONTHS) });
    const stripe = fakeStripe({
      metadata: { [COMP_CREDIT_GRANT_KEY]: `${nowSec}:${sec(THREE_MONTHS)}` },
      ledger: [{ id: "cbtxn_0", amount: -1800, metadata: { [COMP_CREDIT_LEDGER_KEY]: ledgerKey } }],
    });
    const out = await grant(stripe, comp(null, null), stripe.at(nowSec + 10 * DAY));
    // 10 days lived = $72 × 10/365 = $1.97 stays; $16.03 comes back. No coupon.
    expect(out.credit?.postedCents).toBe(-1603);
    expect(stripe.coupons.create).not.toHaveBeenCalled();
    expect(stripe.st.discounts).toEqual([]);
  });

  it("a plan that matches its comp's billing is left alone by the webhook (its own update event stops there)", async () => {
    const stripe = fakeStripe({});
    await grant(stripe, comp("plus", THREE_MONTHS), NOW);
    stripe.subscriptions.update.mockClear();
    const out = await reconcileCompBilling(db().client as never, stripe as never, "u1", (await stripe.subscriptions.retrieve("sub_1")) as never, "plus", NOW);
    expect(out).toBeNull();
    expect(stripe.subscriptions.update).not.toHaveBeenCalled();
    // No grant named at all: not even the profile is read.
    const plain = fakeStripe({});
    const stub = db();
    expect(await reconcileCompBilling(stub.client as never, plain as never, "u1", (await plain.subscriptions.retrieve("sub_1")) as never, "plus", NOW)).toBeNull();
    expect(stub.log).toEqual([]);
  });
});
