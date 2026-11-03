import { describe, expect, it } from "vitest";
import {
  billingActionErrorText,
  compPlanLockMessage,
  compPlanLockText,
  compPlanSwitchLock,
  couponPlanSwitchLock,
  laterPlanSwitchLock,
} from "@/lib/billing/comp-switch-lock";
import { billingViewerFromProfile, billingViewerFromUser } from "@/lib/billing/viewer";
import { pricingCtaFor } from "@/components/billing/pricing-cta";

// ---------------------------------------------------------------------------
// BL1 (owner 2026-11-02): no plan switches while a comp is on. The ONE rule
// (compPlanSwitchLock), the storefront's buttons it turns into a line
// (pricingCtaFor → "comp_locked") and the words, date in the viewer's zone.
// The server actions' refusals are in stripe-actions.test.ts.
// ---------------------------------------------------------------------------

const NOW = new Date("2026-11-02T12:00:00Z");
const END = "2027-02-01T12:00:00.000Z";
const lock = (over: Partial<Parameters<typeof compPlanSwitchLock>[0]> = {}) =>
  compPlanSwitchLock(
    { compTier: "plus", compExpiresAt: END, subscribedTier: "plus", subscriptionStatus: "active", ...over },
    NOW,
  );

describe("compPlanSwitchLock", () => {
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

describe("the storefront: no 'Switch to …' while a comp is on", () => {
  const profile = {
    subscription_status: "active",
    stripe_customer_id: "cus_1",
    subscription_tier: "plus",
    comp_tier: "pro",
    comp_expires_at: "2099-01-01T00:00:00.000Z",
  };
  it("the server's viewer carries the lock; every paid card says the line instead of a button", () => {
    const viewer = billingViewerFromProfile(profile, { isPaid: true, effectiveTier: "pro" });
    expect(viewer.planSwitchLock).toEqual({ until: "2099-01-01T00:00:00.000Z" });
    expect(pricingCtaFor(viewer, "plus")).toEqual({ kind: "comp_locked", until: "2099-01-01T00:00:00.000Z" });
    expect(pricingCtaFor(viewer, "pro")).toEqual({ kind: "comp_locked", until: "2099-01-01T00:00:00.000Z" });
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
  it("no comp (or a comp below the plan): 'Switch to …' as before", () => {
    const plain = billingViewerFromProfile({ ...profile, comp_tier: null, comp_expires_at: null }, { isPaid: true, effectiveTier: "plus" });
    expect(plain.planSwitchLock).toBeNull();
    expect(pricingCtaFor(plain, "pro")).toEqual({ kind: "checkout", label: "Switch to Pro" });
    const below = billingViewerFromProfile({ ...profile, subscription_tier: "pro", comp_tier: "plus" }, { isPaid: true, effectiveTier: "pro" });
    expect(pricingCtaFor(below, "plus")).toEqual({ kind: "checkout", label: "Switch to Plus" });
  });
});
