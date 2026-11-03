import { beforeEach, describe, expect, it, vi } from "vitest";

const stripe = vi.hoisted(() => ({ retrieve: vi.fn() }));
vi.mock("@/lib/stripe/client", () => ({
  getStripe: () => ({ subscriptions: { retrieve: stripe.retrieve } }),
  isStripeConfigured: () => true,
}));

import {
  billingActionErrorText,
  compPlanLockMessage,
  compPlanLockText,
  compPlanSwitchLock,
  couponPlanSwitchLock,
  laterPlanSwitchLock,
  subscriptionCompLock,
} from "@/lib/billing/comp-switch-lock";
import { COMP_COUPON_GRANT_KEY, type DiscountLike } from "@/lib/billing/comp-coupon";
import { COMP_CREDIT_GRANT_KEY, TRIAL_END_BEFORE_COMP_KEY } from "@/lib/billing/comp-stripe";
import { billingViewerFromProfile, billingViewerFromUser } from "@/lib/billing/viewer";
import {
  COMP_LOCK_TAIL_DAYS,
  STOREFRONT_LOCK_READ_TIMEOUT_MS,
  compMayStillLock,
  readSubscriptionCompLock,
  viewerPlanSwitchLock,
} from "@/lib/stripe/plan-switch-lock";
import { pricingCtaFor } from "@/components/billing/pricing-cta";

// ---------------------------------------------------------------------------
// BL1 (owner 2026-11-02): no plan switches while a comp is on. THE lock is
// the comp as Stripe pays for it (subscriptionCompLock, read by the server
// and — through viewerPlanSwitchLock — by the storefront); the profile's
// comp (compPlanSwitchLock) is only the page's fallback when Stripe can't be
// read. The storefront's buttons turn into a line (pricingCtaFor →
// "comp_locked"), the date in the viewer's zone. The server actions'
// refusals are in stripe-actions.test.ts.
// ---------------------------------------------------------------------------

const NOW = new Date("2026-11-02T12:00:00Z");
const END = "2027-02-01T12:00:00.000Z";
const lock = (over: Partial<Parameters<typeof compPlanSwitchLock>[0]> = {}) =>
  compPlanSwitchLock(
    { compTier: "plus", compExpiresAt: END, subscribedTier: "plus", subscriptionStatus: "active", ...over },
    NOW,
  );

describe("compPlanSwitchLock — the profile fallback the page shows when Stripe can't be read", () => {
  it("an unexpired comp at or above the plan, on a subscription Stripe still has, locks switching until its end", () => {
    expect(lock()).toEqual({ until: END });
    expect(lock({ compTier: "pro" })).toEqual({ until: END });
    expect(lock({ subscriptionStatus: "trialing" })).toEqual({ until: END });
    expect(lock({ subscriptionStatus: "past_due" })).toEqual({ until: END });
    expect(lock({ compExpiresAt: null })).toEqual({ until: null });
  });
  it("nothing to lock: no comp, an expired one, one below the plan, or no live subscription", () => {
    expect(lock({ compTier: null })).toBeNull();
    expect(lock({ compExpiresAt: "2026-11-01T00:00:00Z" })).toBeNull();
    expect(lock({ compTier: "plus", subscribedTier: "pro" })).toBeNull();
    expect(lock({ subscriptionStatus: "canceled" })).toBeNull();
    expect(lock({ subscriptionStatus: null })).toBeNull();
  });
  it("one line, the date a <LocalDate> part (UTC on the server, the viewer's zone in a toast)", () => {
    expect(compPlanLockText(END)).toEqual([
      "Your plan is complimentary until ",
      { date: END },
      " — you can change plans after that.",
    ]);
    expect(compPlanLockMessage(END, "UTC")).toBe(
      "Your plan is complimentary until February 1, 2027 — you can change plans after that.",
    );
    // Tokyo is already Feb 1 → still Feb 1; Honolulu sees Feb 1 at 02:00 → Feb 1.
    expect(compPlanLockMessage("2027-02-01T03:00:00.000Z", "Pacific/Honolulu")).toMatch(/January 31, 2027/);
    expect(
      billingActionErrorText({ error: "UTC fallback", compLock: { until: END, note: "Until then, x." } }),
    ).toMatch(/^Your plan is complimentary until .+ — you can change plans after that\. Until then, x\.$/);
    expect(billingActionErrorText({ error: "Couldn't open the billing portal." })).toBe("Couldn't open the billing portal.");
  });
});

describe("the coupon a comp leaves running (the 15-day round-up)", () => {
  const nowSec = NOW.getTime() / 1000;
  const sub = (discounts: unknown[]) => ({ status: "active", discounts }) as never;
  const ours = (end: number | null) => ({ id: "di_1", end, source: { coupon: "pipglyph_comp_100off_2m" } });
  it("our running coupon locks until its end; an ended one, or anyone else's coupon, doesn't", () => {
    const end = nowSec + 10 * 86400;
    expect(couponPlanSwitchLock(sub([ours(end)]), nowSec)).toEqual({ until: new Date(end * 1000).toISOString() });
    expect(couponPlanSwitchLock(sub([ours(nowSec - 1)]), nowSec)).toBeNull();
    expect(couponPlanSwitchLock(sub([{ id: "di_2", end, source: { coupon: "SUBSCRIBER_PACKS_20" } }]), nowSec)).toBeNull();
    expect(couponPlanSwitchLock(sub([]), nowSec)).toBeNull();
  });
  it("the later of the comp and the coupon wins; no end date beats any date", () => {
    const a = { until: "2027-01-01T00:00:00.000Z" };
    const b = { until: "2027-01-20T00:00:00.000Z" };
    expect(laterPlanSwitchLock(a, b)).toBe(b);
    expect(laterPlanSwitchLock(b, a)).toBe(b);
    expect(laterPlanSwitchLock(null, a)).toBe(a);
    expect(laterPlanSwitchLock(a, null)).toBe(a);
    expect(laterPlanSwitchLock(null, null)).toBeNull();
    expect(laterPlanSwitchLock(a, { until: null })).toEqual({ until: null });
  });
});

describe("THE lock: the comp as Stripe pays for it (subscriptionCompLock — findings P1, P3a)", () => {
  const nowSec = NOW.getTime() / 1000;
  const endSec = nowSec + 60 * 86400;
  const at = (s: number) => new Date(s * 1000).toISOString();
  const base = { status: "active", discounts: [] as DiscountLike[], metadata: {} as Record<string, string> };
  const ours = (end: number) => ({ id: "di_1", end, source: { coupon: "pipglyph_comp_100off_2m" } });

  it("an open coupon grant, our running discount, a #688 credit grant, a comp-held trial: locked until the latest end", () => {
    expect(subscriptionCompLock({ ...base, metadata: { [COMP_COUPON_GRANT_KEY]: `${nowSec - 86400}:${endSec}:2` } }, nowSec)).toEqual({ until: at(endSec) });
    // The round-up tail: the grant has ended, the discount still runs.
    expect(
      subscriptionCompLock(
        { ...base, metadata: { [COMP_COUPON_GRANT_KEY]: `${nowSec - 60 * 86400}:${nowSec - 86400}:2` }, discounts: [ours(endSec)] },
        nowSec,
      ),
    ).toEqual({ until: at(endSec) });
    expect(subscriptionCompLock({ ...base, metadata: { [COMP_CREDIT_GRANT_KEY]: `${nowSec - 86400}:${endSec}` } }, nowSec)).toEqual({ until: at(endSec) });
    expect(
      subscriptionCompLock({ ...base, status: "trialing", trial_end: endSec, metadata: { [TRIAL_END_BEFORE_COMP_KEY]: String(nowSec + 86400) } }, nowSec),
    ).toEqual({ until: at(endSec) });
    // The later of two.
    expect(
      subscriptionCompLock(
        { ...base, metadata: { [COMP_COUPON_GRANT_KEY]: `${nowSec - 86400}:${nowSec + 86400}:1` }, discounts: [ours(endSec)] },
        nowSec,
      ),
    ).toEqual({ until: at(endSec) });
  });

  it("a comp that put NOTHING on Stripe locks nothing — a legacy no-end-date or > 730-day comp on a paying plan included (P3a)", () => {
    expect(subscriptionCompLock(base, nowSec)).toBeNull();
    // A plain trial (no comp held it), an ended grant with no discount left,
    // another coupon, a cancelled subscription.
    expect(subscriptionCompLock({ ...base, status: "trialing", trial_end: endSec }, nowSec)).toBeNull();
    expect(subscriptionCompLock({ ...base, metadata: { [COMP_COUPON_GRANT_KEY]: `${nowSec - 9e5}:${nowSec - 1}:1` } }, nowSec)).toBeNull();
    expect(subscriptionCompLock({ ...base, discounts: [{ id: "di_2", end: endSec, source: { coupon: "SUBSCRIBER_PACKS_20" } }] }, nowSec)).toBeNull();
    expect(subscriptionCompLock({ ...base, status: "canceled", metadata: { [COMP_COUPON_GRANT_KEY]: `${nowSec}:${endSec}:2` } }, nowSec)).toBeNull();
  });
});

describe("the storefront: no 'Switch to …' while a comp holds the plan", () => {
  const profile = { subscription_status: "active", stripe_customer_id: "cus_1" };
  const LOCK = { until: "2099-01-01T00:00:00.000Z" };
  it("the server's viewer carries the lock it was given; every paid card says the line instead of a button", () => {
    const viewer = billingViewerFromProfile(profile, { isPaid: true, effectiveTier: "pro" }, LOCK);
    expect(viewer.planSwitchLock).toEqual(LOCK);
    expect(pricingCtaFor(viewer, "plus")).toEqual({ kind: "comp_locked", until: LOCK.until });
    expect(pricingCtaFor(viewer, "pro")).toEqual({ kind: "comp_locked", until: LOCK.until });
    // The free card still opens the (comped, no-switch) portal to manage.
    expect(pricingCtaFor(viewer, "free")).toEqual({ kind: "portal", label: "Manage plan" });
  });
  it("the /api/me viewer (the upgrade modal) carries it too", () => {
    const viewer = billingViewerFromUser({
      id: "u1",
      username: null,
      displayName: null,
      avatarUrl: null,
      isPaid: true,
      tier: "pro",
      hasLiveSubscription: true,
      hasBillingAccount: true,
      planSwitchLock: { until: null },
    } as never);
    expect(pricingCtaFor(viewer, "pro")).toEqual({ kind: "comp_locked", until: null });
  });
  it("no lock: 'Switch to …' as before", () => {
    const plain = billingViewerFromProfile(profile, { isPaid: true, effectiveTier: "plus" });
    expect(plain.planSwitchLock).toBeNull();
    expect(pricingCtaFor(plain, "pro")).toEqual({ kind: "checkout", label: "Switch to Pro" });
  });
});

describe("viewerPlanSwitchLock: the page shows the lock the server enforces (P3b)", () => {
  const nowSec = Math.floor(Date.now() / 1000);
  const tailEnd = nowSec + 10 * 86400;
  const row = {
    stripe_subscription_id: "sub_1",
    subscription_status: "active",
    subscription_tier: "plus",
    comp_tier: "plus",
    // The comp has ENDED; its rounded-up coupon still runs (the tail).
    comp_expires_at: new Date((nowSec - 86400) * 1000).toISOString(),
  };
  beforeEach(() => {
    stripe.retrieve.mockReset();
  });

  it("the round-up tail locks the grid as it locks the server, read from the subscription", async () => {
    stripe.retrieve.mockResolvedValue({
      id: "sub_1",
      status: "active",
      metadata: { [COMP_COUPON_GRANT_KEY]: `${nowSec - 40 * 86400}:${nowSec - 86400}:2` },
      discounts: [{ id: "di_1", end: tailEnd, source: { coupon: "pipglyph_comp_100off_2m" } }],
    });
    expect(await viewerPlanSwitchLock(row)).toEqual({ until: new Date(tailEnd * 1000).toISOString() });
    // A bounded read: a few seconds, no retry, never the SDK's 80 s (round-3 item 1).
    expect(stripe.retrieve).toHaveBeenCalledWith(
      "sub_1",
      { expand: ["discounts"] },
      { timeout: STOREFRONT_LOCK_READ_TIMEOUT_MS, maxNetworkRetries: 0 },
    );
    expect(STOREFRONT_LOCK_READ_TIMEOUT_MS).toBeLessThanOrEqual(5000);
  });

  it("a comp that ended more than the tail ago costs no Stripe call (comp_tier is never cleared)", async () => {
    const old = { ...row, comp_expires_at: new Date((nowSec - (COMP_LOCK_TAIL_DAYS + 1) * 86400) * 1000).toISOString() };
    expect(await viewerPlanSwitchLock(old)).toBeNull();
    expect(stripe.retrieve).not.toHaveBeenCalled();
    // The tail covers a rounded-up coupon: at most one monthly period past the comp.
    expect(COMP_LOCK_TAIL_DAYS).toBeGreaterThan(31);
  });

  it("compMayStillLock: current, no end, or ended within the tail", () => {
    const now = Date.parse("2026-11-02T00:00:00Z");
    const day = 86_400_000;
    expect(compMayStillLock({ comp_tier: null, comp_expires_at: null }, now)).toBe(false);
    expect(compMayStillLock({ comp_tier: "plus", comp_expires_at: null }, now)).toBe(true);
    expect(compMayStillLock({ comp_tier: "plus", comp_expires_at: new Date(now + day).toISOString() }, now)).toBe(true);
    expect(compMayStillLock({ comp_tier: "plus", comp_expires_at: new Date(now - 44 * day).toISOString() }, now)).toBe(true);
    expect(compMayStillLock({ comp_tier: "plus", comp_expires_at: new Date(now - 46 * day).toISOString() }, now)).toBe(false);
  });

  it("never comped (or no subscription): no Stripe call, no lock", async () => {
    expect(await viewerPlanSwitchLock({ ...row, comp_tier: null })).toBeNull();
    expect(await viewerPlanSwitchLock({ ...row, stripe_subscription_id: null })).toBeNull();
    expect(await viewerPlanSwitchLock(null)).toBeNull();
    expect(stripe.retrieve).not.toHaveBeenCalled();
  });

  it("Stripe unreadable: the profile's comp stands in (display only)", async () => {
    stripe.retrieve.mockRejectedValue(new Error("Stripe down"));
    const live = { ...row, comp_expires_at: "2099-01-01T00:00:00.000Z" };
    expect(await viewerPlanSwitchLock(live)).toEqual({ until: "2099-01-01T00:00:00.000Z" });
    expect(await viewerPlanSwitchLock(row)).toBeNull();
  });

  it("a plan set to END with nothing on Stripe yet shows the lock the server enforces while the comp would hold it (round-3 item 4)", async () => {
    stripe.retrieve.mockResolvedValue({ id: "sub_1", status: "active", metadata: {}, discounts: [] });
    const until = new Date((nowSec + 30 * 86400) * 1000).toISOString();
    const ending = { ...row, comp_tier: "pro", subscription_tier: "pro", comp_expires_at: until, cancel_at_period_end: true };
    expect(await viewerPlanSwitchLock(ending)).toEqual({ until });
    expect(await viewerPlanSwitchLock({ ...ending, cancel_at_period_end: false, subscription_ends_at: until })).toEqual({ until });
    // Renewing as usual, or a comp below the plan: nothing to lock.
    expect(await viewerPlanSwitchLock({ ...ending, cancel_at_period_end: false })).toBeNull();
    expect(await viewerPlanSwitchLock({ ...ending, comp_tier: "plus" })).toBeNull();
  });

  it("a subscription Stripe says is gone (resource_missing) locks nothing, never 'unreadable' (round-3 item 2)", async () => {
    const client = { subscriptions: { retrieve: stripe.retrieve } };
    stripe.retrieve.mockRejectedValue(Object.assign(new Error("No such subscription"), { code: "resource_missing", statusCode: 404 }));
    expect(await readSubscriptionCompLock(client as never, "sub_gone")).toBeNull();
    stripe.retrieve.mockRejectedValue(Object.assign(new Error("timeout"), { type: "StripeConnectionError" }));
    expect(await readSubscriptionCompLock(client as never, "sub_1")).toBe("unreadable");
  });
});
