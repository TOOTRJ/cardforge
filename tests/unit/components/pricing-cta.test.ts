import { describe, expect, it } from "vitest";
import { pricingCtaFor } from "@/components/billing/pricing-cta";
import {
  ANONYMOUS_BILLING_VIEWER,
  type BillingViewer,
} from "@/components/billing/use-billing-viewer";
import { TRIAL_DAYS } from "@/lib/billing/plans";

// ---------------------------------------------------------------------------
// The storefront CTA table — every viewer state × every plan card. The bug
// this pins (2026-09-22): a comped/admin account was offered "Manage plan",
// which opens a billing portal the account doesn't have.
// ---------------------------------------------------------------------------

const viewer = (overrides: Partial<BillingViewer>): BillingViewer => ({
  ...ANONYMOUS_BILLING_VIEWER,
  loaded: true,
  ...overrides,
});

const signedIn = (overrides: Partial<BillingViewer> = {}) =>
  viewer({ isSignedIn: true, ...overrides });

describe("pricingCtaFor", () => {
  it("anonymous: signup links everywhere, the paid cards leading with the trial", () => {
    const anon = viewer({});
    expect(pricingCtaFor(anon, "free")).toEqual({ kind: "signup", label: "Get started free" });
    expect(pricingCtaFor(anon, "plus")).toEqual({ kind: "signup", label: `Start free — ${TRIAL_DAYS}-day trial` });
    expect(pricingCtaFor(anon, "pro").kind).toBe("signup");
  });

  it("free account, never subscribed: nothing on the free card, a trial checkout on each paid card", () => {
    const free = signedIn({ currentTier: "free" });
    expect(pricingCtaFor(free, "free")).toEqual({ kind: "none" });
    expect(pricingCtaFor(free, "plus")).toEqual({ kind: "checkout", label: `Try Plus free for ${TRIAL_DAYS} days` });
    expect(pricingCtaFor(free, "pro")).toEqual({ kind: "checkout", label: `Try Pro free for ${TRIAL_DAYS} days` });
  });

  it("lapsed (canceled) subscriber: no trial promise — 'Choose', and no portal on the free card", () => {
    const lapsed = signedIn({
      currentTier: "free",
      hasSubscribed: true,
      hasBillingAccount: true,
      subscriptionStatus: "canceled",
    });
    expect(pricingCtaFor(lapsed, "free")).toEqual({ kind: "none" });
    expect(pricingCtaFor(lapsed, "plus")).toEqual({ kind: "checkout", label: "Choose Plus" });
    expect(pricingCtaFor(lapsed, "pro")).toEqual({ kind: "checkout", label: "Choose Pro" });
  });

  it("live Plus subscriber: manage in the portal, switch to Pro in place", () => {
    const plus = signedIn({
      isPaid: true,
      currentTier: "plus",
      hasSubscribed: true,
      hasBillingAccount: true,
      hasLiveSubscription: true,
      subscriptionStatus: "active",
    });
    expect(pricingCtaFor(plus, "free")).toEqual({ kind: "portal", label: "Manage plan" });
    expect(pricingCtaFor(plus, "pro")).toEqual({ kind: "checkout", label: "Switch to Pro" });
    // The Plus card itself shows the "current plan" badge (PlanCard), but the
    // table still answers consistently.
    expect(pricingCtaFor(plus, "plus")).toEqual({ kind: "checkout", label: "Switch to Plus" });
  });

  it("trialing subscriber: same as live — the switch carries the trial", () => {
    const trial = signedIn({
      isPaid: true,
      currentTier: "plus",
      hasSubscribed: true,
      hasBillingAccount: true,
      hasLiveSubscription: true,
      subscriptionStatus: "trialing",
    });
    expect(pricingCtaFor(trial, "pro")).toEqual({ kind: "checkout", label: "Switch to Pro" });
    expect(pricingCtaFor(trial, "free")).toEqual({ kind: "portal", label: "Manage plan" });
  });

  it("comped Pro (or admin) with NO billing account: no portal button anywhere, a real checkout on the other tier", () => {
    const comped = signedIn({ isPaid: true, currentTier: "pro" });
    expect(pricingCtaFor(comped, "free")).toEqual({ kind: "none" });
    expect(pricingCtaFor(comped, "plus")).toEqual({ kind: "checkout", label: `Try Plus free for ${TRIAL_DAYS} days` });
  });

  it("payment broken (past_due / unpaid / incomplete): every paid card opens the portal to fix the card", () => {
    for (const status of ["past_due", "unpaid", "incomplete"]) {
      const delinquent = signedIn({
        currentTier: "free",
        hasSubscribed: true,
        hasBillingAccount: true,
        subscriptionStatus: status,
      });
      expect(pricingCtaFor(delinquent, "plus"), status).toEqual({ kind: "portal", label: "Update payment to continue" });
      expect(pricingCtaFor(delinquent, "pro"), status).toEqual({ kind: "portal", label: "Update payment to continue" });
      expect(pricingCtaFor(delinquent, "free"), status).toEqual({ kind: "none" });
    }
  });
});
