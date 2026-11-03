import { beforeEach, describe, expect, it, vi } from "vitest";
import { chainClient } from "@/tests/stubs/supabase-chain";

// ---------------------------------------------------------------------------
// BL1 — a comp on a MONTHLY paid plan is a 100%-off repeating coupon
// (lib/billing/comp-coupon.ts decides, lib/billing/comp-stripe-apply.ts
// writes); an ANNUAL plan keeps #688's pro-rated balance credit.
//
// Stripe is SIMULATED here (no keys, no network): subscriptions carry
// discounts, coupons live in a store keyed by id, the customer balance is a
// ledger, and a renewal is TWO steps, as Stripe does it: `roll()` creates
// the renewal invoice as a DRAFT at the period's end — its discount fixed
// then (a repeating coupon applies to an invoice created at or after its
// `start` and before its `end`) — and `finalize()` applies the customer
// BALANCE about an hour later. A claw-back in between charged a comped user
// under the first draft of BL1 (finding P1); `renew()` is the two together.
// scripts/stripe-sandbox-comp-check.mjs runs the same scenarios on a real
// sandbox test clock.
// ---------------------------------------------------------------------------

const sync = vi.hoisted(() => ({ syncSubscriptionForUser: vi.fn(), resolveSubscriptionTier: vi.fn() }));
vi.mock("@/lib/stripe/subscription-sync", () => sync);
vi.mock("@/lib/stripe/client", () => ({ getStripe: vi.fn(), isStripeConfigured: () => false }));

import {
  applyCompToSubscription,
  ensureCompCoupon,
  reconcileCompBilling,
  releaseScheduleForCompChange,
} from "@/lib/billing/comp-stripe-apply";
import {
  COMP_COUPON_GRANT_KEY,
  COMP_COUPON_ROUND_UP_DAYS,
  compBillingNeedsReconcile,
  couponCoveredUntil,
  compCouponChangeFor,
  STRIPE_COUPON_NAME_MAX,
  compCouponId,
  compCouponMonths,
  compCouponName,
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
  status?: string;
  /** A scheduled downgrade (lib/stripe/actions.ts scheduleDowngrade). */
  schedule?: { id: string; nextPrice: Price } | null;
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
    status: opts.status ?? "active",
    schedule: opts.schedule ?? null,
    invoices: [] as Array<{ at: number; subtotal: number; discounted: number; balanceUsed: number; charged: number; discountId: string | null; status: "draft" | "paid" }>,
  };
  const step = () => (st.price.recurring.interval === "year" ? 12 : 1);
  const periodStart = () => addMonths(st.anchor, (st.cycle - 1) * step());
  const periodEnd = () => addMonths(st.anchor, st.cycle * step());
  const view = (expand?: string[]) => ({
    id: "sub_1",
    object: "subscription",
    customer: "cus_1",
    status: st.status,
    cancel_at_period_end: st.cancel_at_period_end,
    cancel_at: null,
    trial_end: null,
    billing_cycle_anchor: st.anchor,
    metadata: { ...st.metadata },
    discounts: expand?.includes("discounts") ? st.discounts.map((d) => ({ ...d })) : st.discounts.map((d) => d.id),
    schedule: !st.schedule
      ? null
      : expand?.some((e) => e.startsWith("schedule"))
        ? {
            id: st.schedule.id,
            end_behavior: "release",
            current_phase: { start_date: periodStart(), end_date: periodEnd() },
            phases: [
              { start_date: periodStart(), end_date: periodEnd(), items: [{ price: st.price }] },
              { start_date: periodEnd(), end_date: addMonths(periodEnd(), 1), items: [{ price: st.schedule.nextPrice }] },
            ],
          }
        : st.schedule.id,
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
    subscriptionSchedules: {
      release: vi.fn(async (id: string) => {
        if (st.schedule?.id !== id) throw Object.assign(new Error("No such schedule"), { code: "resource_missing" });
        st.schedule = null;
        return { id, status: "released" };
      }),
    },
    coupons: {
      retrieve: vi.fn(async (id: string) => {
        const c = coupons.get(id);
        if (!c) throw Object.assign(new Error(`No such coupon: '${id}'`), { code: "resource_missing" });
        return { ...c };
      }),
      create: vi.fn(async (params: Coupon) => {
        if (coupons.has(params.id)) throw Object.assign(new Error("exists"), { code: "resource_already_exists" });
        // Stripe's own limit (the sandbox run hit it): a longer name is refused.
        const name = (params as { name?: string }).name ?? "";
        if (name.length > 40) throw new Error(`Invalid string: ${name}; must be at most 40 characters`);
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
    /** The period rolls: the clock moves to its end and Stripe creates the
     *  renewal invoice as a DRAFT — its discount fixed now, no balance yet. */
    roll() {
      st.clock = periodEnd();
      st.cycle += 1;
      const subtotal = st.price.unit_amount;
      const d = st.discounts.find((x) => x.start <= st.clock && (x.end == null || st.clock < x.end)) ?? null;
      const pct = d ? Number(coupons.get(d.source.coupon)?.percent_off ?? 0) : 0;
      const discounted = Math.round(subtotal * (1 - pct / 100));
      // Stripe drops a repeating discount once it has ended.
      st.discounts = st.discounts.filter((x) => x.end == null || x.end > st.clock);
      const invoice = { at: st.clock, subtotal, discounted, balanceUsed: 0, charged: discounted, discountId: d?.id ?? null, status: "draft" as "draft" | "paid" };
      st.invoices.push(invoice);
      return invoice;
    },
    /** About an hour later the draft FINALIZES: the customer balance (a
     *  credit) is applied now, what is left is charged. */
    finalize(invoice = st.invoices[st.invoices.length - 1]) {
      const credit = Math.max(0, -balance());
      const balanceUsed = Math.min(credit, invoice.discounted);
      if (balanceUsed > 0) ledger.push({ id: `cbtxn_${ledger.length + 1}`, amount: balanceUsed, metadata: {} });
      invoice.balanceUsed = balanceUsed;
      invoice.charged = invoice.discounted - balanceUsed;
      invoice.status = "paid";
      return invoice;
    },
    /** A whole renewal: the draft, then its finalization. */
    renew() {
      return stripe.finalize(stripe.roll());
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

  it("the coupon's name fits Stripe's 40-character limit for every comp a save allows (the sandbox run refused 43)", () => {
    expect(compCouponName(1)).toBe("PipGlyph complimentary (1 month free)");
    expect(compCouponName(3)).toBe("PipGlyph complimentary (3 months free)");
    // A comp is at most 730 days: never more than 25 months, rounded up.
    expect(compCouponMonths(0, 730 * 86400)).toBeLessThanOrEqual(25);
    for (let n = 1; n <= 99; n++) expect(compCouponName(n).length).toBeLessThanOrEqual(STRIPE_COUPON_NAME_MAX);
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
        name: "PipGlyph complimentary (1 month free)",
      }),
      { idempotencyKey: expect.stringMatching(/^comp-coupon-create:pipglyph_comp_100off_1m:[0-9a-f-]{36}$/) },
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
describe("a #688 balance credit already on a MONTHLY plan runs out under #688's rules (owner 2026-11-02)", () => {
  // Plus $6 monthly, comped Nov 1 → Feb 1 under #688: the credit for the
  // comp period sits on the balance.
  const creditGrant = { startSec: nowSec, endSec: sec(THREE_MONTHS) };
  const ledgerKey = compCreditLedgerKey("sub_1", creditGrant);
  const credited = periodCreditCents({ price: PLUS_MONTHLY, tier: "plus", startSec: nowSec, endSec: sec(THREE_MONTHS) });
  const with688 = () =>
    fakeStripe({
      metadata: { [COMP_CREDIT_GRANT_KEY]: `${nowSec}:${sec(THREE_MONTHS)}` },
      ledger: [{ id: "cbtxn_0", amount: -credited, metadata: { [COMP_CREDIT_LEDGER_KEY]: ledgerKey } }],
    });

  it("the old P1: a re-save AND a webhook event while the renewal is still a DRAFT claw nothing back — invoices $0, $0, $0, then the full price", async () => {
    expect(credited).toBe(1800);
    const stripe = with688();
    const draft = stripe.roll(); // Nov 20: the draft, balance not yet applied
    expect(draft).toMatchObject({ status: "draft", discounted: 600 });
    // Inside the draft window: the admin re-saves the same comp, and a
    // subscription.updated event reaches the webhook.
    const inWindow = stripe.at(draft.at + 30 * 60);
    const out = await grant(stripe, comp("plus", THREE_MONTHS), inWindow);
    const eventSub = await stripe.subscriptions.retrieve("sub_1", { expand: ["discounts"] });
    expect(await reconcileCompBilling(db().client as never, stripe as never, "u1", eventSub as never, "plus", inWindow)).toBeNull();
    expect(out.failed).toBe(false);
    expect(out.credit?.postedCents).toBe(0);
    stripe.finalize(draft);
    stripe.renew();
    stripe.renew();
    stripe.renew();
    expect(stripe.st.invoices.map((i) => [iso(i.at).slice(0, 10), i.charged])).toEqual([
      ["2026-11-20", 0],
      ["2026-12-20", 0],
      ["2027-01-20", 0],
      ["2027-02-20", 600],
    ]);
    // Never a claw-back, never a coupon.
    expect(stripe.customers.createBalanceTransaction).not.toHaveBeenCalled();
    expect(stripe.coupons.create).not.toHaveBeenCalled();
    expect(stripe.coupons.retrieve).not.toHaveBeenCalled();
    expect(stripe.st.discounts).toEqual([]);
  });

  it("the webhook's safety net never even looks at a #688 credit on a monthly plan", async () => {
    const stripe = with688();
    const sub = await stripe.subscriptions.retrieve("sub_1", { expand: ["discounts"] });
    expect(compBillingNeedsReconcile({ sub: sub as never, subscribedTier: "plus", comp: comp("plus", THREE_MONTHS), now: NOW })).toBe(false);
    const stub = db();
    expect(await reconcileCompBilling(stub.client as never, stripe as never, "u1", sub as never, "plus", NOW)).toBeNull();
    expect(stub.log).toEqual([]);
  });

  it("EXTENDED, it stays a credit — #688's settlement, no coupon", async () => {
    const stripe = with688();
    const out = await grant(stripe, comp("plus", "2027-03-01T12:00:00.000Z"), stripe.at(nowSec + 5 * DAY));
    expect(out.credit?.postedCents).toBeGreaterThan(0);
    expect(stripe.coupons.create).not.toHaveBeenCalled();
    expect(stripe.st.discounts).toEqual([]);
  });

  it("CLEARED, it is released as #688 does — the time lived through stays paid for", async () => {
    const stripe = with688();
    const out = await grant(stripe, comp(null, null), stripe.at(nowSec + 10 * DAY));
    // 10 days lived = $72 × 10/365 = $1.97 stays; $16.03 comes back. No coupon.
    expect(out.credit?.postedCents).toBe(-1603);
    expect(stripe.coupons.create).not.toHaveBeenCalled();
    expect(stripe.st.discounts).toEqual([]);
  });
});

// ---------------------------------------------------------------------------
describe("the coupon across drafts, mid-period changes and dunning", () => {
  it("a comp granted mid-period: the renewal drafts take the discount when they are CREATED — $0, $0, $0, then $6", async () => {
    const stripe = fakeStripe({});
    await grant(stripe, comp("plus", THREE_MONTHS), stripe.at(sec("2026-11-10T08:00:00Z")));
    const drafts = [stripe.roll(), stripe.roll(), stripe.roll(), stripe.roll()];
    expect(drafts.map((d) => d.discounted)).toEqual([0, 0, 0, 600]);
    drafts.forEach((d) => stripe.finalize(d));
    expect(stripe.st.invoices.map((i) => i.charged)).toEqual([0, 0, 0, 600]);
  });

  it("the round-up rule is ONE named constant: 15 days (owner 2026-11-02)", () => {
    expect(COMP_COUPON_ROUND_UP_DAYS).toBe(15);
    expect(compCouponMonths(nowSec, nowSec + (COMP_COUPON_ROUND_UP_DAYS - 1) * DAY)).toBe(0);
    expect(compCouponMonths(nowSec, nowSec + COMP_COUPON_ROUND_UP_DAYS * DAY)).toBe(1);
  });

  it("'covered' is keyed off the comp's GRANT, never the replaced discount's mid-period start", async () => {
    const stripe = fakeStripe({});
    await grant(stripe, comp("plus", ONE_MONTH), NOW);
    stripe.renew(); // Nov 20 → Dec 20, freed
    await grant(stripe, comp("plus", THREE_MONTHS), stripe.at(sec("2026-11-25T12:00:00Z"))); // extended: a NEW discount, started Nov 25
    const sub = (await stripe.subscriptions.retrieve("sub_1", { expand: ["discounts"] })) as unknown as CouponSubFacts;
    const discount = sub.discounts?.[0] as { start: number };
    expect(discount.start).toBe(sec("2026-11-25T12:00:00Z"));
    const g = { startSec: nowSec, endSec: sec(THREE_MONTHS), months: 3 };
    const at = sec("2026-11-26T12:00:00Z");
    expect(couponCoveredUntil(sub, g, discount as never, at)).toBe(sec("2026-12-20T12:00:00Z"));
    // No grant (or no discount): nothing is covered past now.
    expect(couponCoveredUntil(sub, null, discount as never, at)).toBe(at);
    expect(couponCoveredUntil(sub, g, null, at)).toBe(at);
  });

  it("SHORTENED mid-period while still owed: re-sized, the next invoices follow the new end", async () => {
    const stripe = fakeStripe({});
    await grant(stripe, comp("plus", THREE_MONTHS), NOW);
    const out = await grant(stripe, comp("plus", "2027-01-01T12:00:00.000Z"), stripe.at(sec("2026-11-05T12:00:00Z")));
    expect(out.coupon?.change).toMatchObject({ kind: "apply", couponMonths: 2, replaces: "di_1" });
    expect([stripe.renew(), stripe.renew(), stripe.renew()].map((i) => i.charged)).toEqual([0, 0, 600]);
  });

  it("REVOKE on a PAST_DUE plan takes the coupon off too (P3e) — once the card is fixed, the next invoice is charged", async () => {
    const stripe = fakeStripe({});
    await grant(stripe, comp("plus", THREE_MONTHS), NOW);
    stripe.st.status = "past_due";
    const out = await applyCompToSubscription(db({ subscription_status: "past_due" }).client as never, "u1", comp(null, null), {
      stripe: stripe as never,
      now: stripe.at(nowSec + 3 * DAY),
    });
    expect(out.failed).toBe(false);
    expect(out.coupon?.change).toMatchObject({ kind: "remove", reason: "comp_released" });
    expect(ours(stripe)).toEqual([]);
    expect(stripe.st.metadata[COMP_COUPON_GRANT_KEY]).toBeUndefined();
    stripe.st.status = "active";
    expect(stripe.renew().charged).toBe(600);
  });

  it("a past_due plan is never GIVEN a coupon", async () => {
    const stripe = fakeStripe({ status: "past_due" });
    await applyCompToSubscription(db({ subscription_status: "past_due" }).client as never, "u1", comp("plus", THREE_MONTHS), {
      stripe: stripe as never,
      now: NOW,
    });
    expect(stripe.subscriptions.update).not.toHaveBeenCalled();
    expect(stripe.coupons.create).not.toHaveBeenCalled();
  });

  it("a failed attach leaves the subscription exactly as it was, and the admin sees the failure (P3a)", async () => {
    const stripe = fakeStripe({});
    await grant(stripe, comp("plus", ONE_MONTH), NOW);
    stripe.subscriptions.update.mockRejectedValueOnce(new Error("Stripe down"));
    const out = await grant(stripe, comp("plus", THREE_MONTHS), stripe.at(nowSec + DAY));
    expect(out.failed).toBe(true);
    expect(out.note).toMatch(/Stripe couldn't be updated/);
    // The old discount and grant are untouched — nothing was taken off.
    expect(ours(stripe)).toHaveLength(1);
    expect(stripe.st.metadata[COMP_COUPON_GRANT_KEY]).toBe(`${nowSec}:${sec(ONE_MONTH)}:1`);
    // A re-save applies it from the SAME grant start (never restarted at now).
    const again = await grant(stripe, comp("plus", THREE_MONTHS), stripe.at(nowSec + 2 * DAY));
    expect(again.coupon?.change).toMatchObject({ kind: "apply", grant: { startSec: nowSec } });
  });

  it("a coupon create always carries a FRESH idempotency key, and a deleted coupon is made again (P3f)", async () => {
    const coupons = new Map<string, Coupon>();
    const stripe = fakeStripe({ coupons });
    await ensureCompCoupon(stripe as never, 2);
    coupons.delete("pipglyph_comp_100off_2m"); // deleted in the dashboard
    await ensureCompCoupon(stripe as never, 2);
    expect(stripe.coupons.create).toHaveBeenCalledTimes(2);
    const keys = stripe.coupons.create.mock.calls.map((c) => (c as unknown as [unknown, { idempotencyKey: string }])[1].idempotencyKey);
    expect(new Set(keys).size).toBe(2);
    expect(coupons.has("pipglyph_comp_100off_2m")).toBe(true);
  });
});

// ---------------------------------------------------------------------------
describe("a plan changed OUTSIDE the app while couponed (the webhook's safety net)", () => {
  const NOV25 = sec("2026-11-25T12:00:00Z");

  it("the coupon left on an ANNUAL price comes off; the switch's invoice inside the discount means no credit on top", async () => {
    const stripe = fakeStripe({});
    await grant(stripe, comp("plus", THREE_MONTHS), NOW);
    stripe.renew(); // Nov 20, freed
    stripe.st.price = PLUS_ANNUAL;
    stripe.st.anchor = sec("2026-11-20T12:00:00Z");
    stripe.st.cycle = 1;
    stripe.at(NOV25 + 60);
    const eventSub = await stripe.subscriptions.retrieve("sub_1");
    const out = await reconcileCompBilling(db().client as never, stripe as never, "u1", eventSub as never, "plus", new Date((NOV25 + 60) * 1000));
    expect(out?.failed).toBe(false);
    expect(ours(stripe)).toEqual([]);
    expect(out?.note).toMatch(/Took the complimentary coupon off/);
  });

  it("the credit goes on BEFORE the coupon comes off; a failed removal is retried by a re-save without a second credit (P3a)", async () => {
    // A coupon grant from Nov 1 left on an annual plan whose current period
    // began before it (no invoice of it was freed): the comp moves onto the
    // credit from now.
    const stripe = fakeStripe({});
    await grant(stripe, comp("plus", THREE_MONTHS), NOW);
    stripe.st.price = PLUS_ANNUAL;
    stripe.st.anchor = sec("2026-06-01T12:00:00Z");
    stripe.st.cycle = 1;
    const real = stripe.subscriptions.update.getMockImplementation()!;
    stripe.subscriptions.update.mockImplementation(async (id, params, options) => {
      if ((params as { discounts?: unknown }).discounts === "") throw new Error("Stripe down");
      return real(id, params, options);
    });
    const out = await grant(stripe, comp("plus", THREE_MONTHS), stripe.at(NOV25 + 3600));
    expect(out.failed).toBe(true);
    expect(out.credit?.postedCents).toBeGreaterThan(0);
    expect(out.note).toMatch(/coupon couldn't be taken off/);
    expect(ours(stripe)).toHaveLength(1); // still on — nothing removed before its replacement
    const posted = stripe.customers.createBalanceTransaction.mock.calls.length;
    stripe.subscriptions.update.mockImplementation(real);
    const again = await grant(stripe, comp("plus", THREE_MONTHS), stripe.at(NOV25 + 7200));
    expect(again.failed).toBe(false);
    expect(stripe.customers.createBalanceTransaction.mock.calls.length).toBe(posted); // no second credit
    expect(ours(stripe)).toEqual([]);
  });

  it("a plan that matches its comp's billing is left alone (its own update event stops there)", async () => {
    const stripe = fakeStripe({});
    await grant(stripe, comp("plus", THREE_MONTHS), NOW);
    stripe.subscriptions.update.mockClear();
    const out = await reconcileCompBilling(db().client as never, stripe as never, "u1", (await stripe.subscriptions.retrieve("sub_1")) as never, "plus", NOW);
    expect(out).toBeNull();
    expect(stripe.subscriptions.update).not.toHaveBeenCalled();
    const plain = fakeStripe({});
    const stub = db();
    expect(await reconcileCompBilling(stub.client as never, plain as never, "u1", (await plain.subscriptions.retrieve("sub_1")) as never, "plus", NOW)).toBeNull();
    expect(stub.log).toEqual([]);
  });
});

// ---------------------------------------------------------------------------
describe("a comp change while a downgrade is scheduled (owner 2026-11-02)", () => {
  it("the schedule is RELEASED first and the admin is told what was cancelled", async () => {
    const stripe = fakeStripe({ price: PRO_MONTHLY, schedule: { id: "sub_sched_1", nextPrice: PLUS_MONTHLY } });
    const out = await releaseScheduleForCompChange(db().client as never, "u1", { stripe: stripe as never });
    expect(out).toEqual({ ok: true, note: "The scheduled change to Plus (monthly) was cancelled." });
    expect(stripe.subscriptionSchedules.release).toHaveBeenCalledWith("sub_sched_1");
    expect(stripe.subscriptions.retrieve).toHaveBeenCalledWith("sub_1", { expand: ["schedule.phases.items.price"] });
    // The comp then goes on a plan no phase will rewrite.
    const applied = await grant(stripe, comp("pro", THREE_MONTHS), NOW);
    expect(applied.coupon?.change.kind).toBe("apply");
    expect(stripe.st.schedule).toBeNull();
  });

  it("a release that FAILS refuses the comp change — never half applied", async () => {
    const stripe = fakeStripe({ price: PRO_MONTHLY, schedule: { id: "sub_sched_1", nextPrice: PLUS_MONTHLY } });
    stripe.subscriptionSchedules.release.mockRejectedValueOnce(new Error("Stripe down"));
    const out = await releaseScheduleForCompChange(db().client as never, "u1", { stripe: stripe as never });
    expect(out).toMatchObject({ ok: false, error: expect.stringMatching(/comp was not changed/) });
  });

  it("a read that fails refuses too; no schedule = nothing to say", async () => {
    const stripe = fakeStripe({});
    expect(await releaseScheduleForCompChange(db().client as never, "u1", { stripe: stripe as never })).toEqual({ ok: true, note: null });
    expect(stripe.subscriptionSchedules.release).not.toHaveBeenCalled();
    stripe.subscriptions.retrieve.mockRejectedValueOnce(new Error("Stripe down"));
    expect(await releaseScheduleForCompChange(db().client as never, "u1", { stripe: stripe as never })).toMatchObject({ ok: false });
  });
});
