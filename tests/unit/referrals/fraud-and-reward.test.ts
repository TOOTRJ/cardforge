import { describe, expect, it } from "vitest";
import {
  emailDomain,
  isDisposableDomain,
  normalizeEmail,
  referralFraudVerdict,
} from "@/lib/referrals/fraud";
import { oneMonthCents, planReferralMonth } from "@/lib/referrals/reward";
import {
  REFERRAL_MONTH_DAYS,
  normalizeReferralCode,
  referralLink,
} from "@/lib/referrals/rules";

// ---------------------------------------------------------------------------
// The referral program's pure rules: codes and links, the fraud verdicts, and
// how "one free month" reaches each kind of account.
// ---------------------------------------------------------------------------

const NOW = new Date("2026-11-01T12:00:00Z");
const DAY = 86_400_000;
const at = (days: number) => new Date(NOW.getTime() + days * DAY).toISOString();

describe("codes and links", () => {
  it("a code is 8 lowercase hex characters; anything else is no code", () => {
    expect(normalizeReferralCode(" D0000003 ")).toBe("d0000003");
    for (const bad of ["d000003", "d00000033", "zzzzzzzz", "", null, 42, "d0000003;drop"]) {
      expect(normalizeReferralCode(bad)).toBeNull();
    }
  });
  it("the link is the home page with ?ref=", () => {
    expect(referralLink("https://pipglyph.com/", "d0000003")).toBe("https://pipglyph.com/?ref=d0000003");
  });
});

describe("fraud rules", () => {
  it("one inbox is one address: case, +tags, Gmail dots and googlemail.com", () => {
    expect(normalizeEmail("Jo.Smith+promo@GoogleMail.com")).toBe("josmith@gmail.com");
    expect(normalizeEmail("jo.smith@outlook.com")).toBe("jo.smith@outlook.com");
    expect(normalizeEmail("nope")).toBeNull();
    expect(emailDomain("a@Sub.Example.org")).toBe("sub.example.org");
  });

  it("self-referral by email blocks BOTH sides", () => {
    expect(referralFraudVerdict({ referrerEmail: "jo.smith@gmail.com", refereeEmail: "josmith+2@gmail.com", sameCard: false })).toEqual({
      block: "same_email",
      refereeRewarded: false,
    });
  });

  it("the same card on both Stripe customers blocks both sides", () => {
    expect(referralFraudVerdict({ referrerEmail: "a@gmail.com", refereeEmail: "b@gmail.com", sameCard: true })).toEqual({
      block: "same_card",
      refereeRewarded: false,
    });
  });

  it("a throwaway inbox (or a subdomain of one) blocks both sides", () => {
    expect(isDisposableDomain("mailinator.com")).toBe(true);
    expect(isDisposableDomain("x.mailinator.com")).toBe(true);
    expect(isDisposableDomain("gmail.com")).toBe(false);
    expect(referralFraudVerdict({ referrerEmail: "a@gmail.com", refereeEmail: "z@yopmail.com", sameCard: false })).toMatchObject({
      block: "disposable_email",
    });
  });

  it("the same CUSTOM domain: the friend keeps their month, the referrer gets none", () => {
    expect(referralFraudVerdict({ referrerEmail: "a@smallshop.com", refereeEmail: "b@smallshop.com", sameCard: false })).toEqual({
      block: "same_domain",
      refereeRewarded: true,
    });
  });

  it("free mail and reserved test domains never match on domain alone", () => {
    for (const domain of ["gmail.com", "outlook.com", "icloud.com", "proton.me", "dev.pipglyph.test"]) {
      expect(referralFraudVerdict({ referrerEmail: `a@${domain}`, refereeEmail: `b@${domain}`, sameCard: false }), domain).toEqual({ block: null });
    }
  });

  it("an account that wasn't new is not_new", () => {
    expect(referralFraudVerdict({ referrerEmail: null, refereeEmail: null, sameCard: false, notNew: true })).toMatchObject({ block: "not_new" });
  });
});

describe("how one free month is delivered", () => {
  it("a free user: a comp month of Plus from today", () => {
    expect(planReferralMonth({ subscription_tier: "free" }, NOW)).toEqual({ kind: "comp_month", tier: "plus", expiresAt: at(REFERRAL_MONTH_DAYS) });
  });

  it("a running comp: the month is added to its end, at its (higher) tier", () => {
    expect(planReferralMonth({ comp_tier: "pro", comp_expires_at: at(10) }, NOW)).toEqual({
      kind: "comp_month",
      tier: "pro",
      expiresAt: at(10 + REFERRAL_MONTH_DAYS),
    });
    // An expired comp counts for nothing.
    expect(planReferralMonth({ comp_tier: "pro", comp_expires_at: at(-1) }, NOW)).toMatchObject({ tier: "plus", expiresAt: at(REFERRAL_MONTH_DAYS) });
  });

  it("an open-ended comp or an admin: nothing to add", () => {
    expect(planReferralMonth({ comp_tier: "plus", comp_expires_at: null }, NOW)).toEqual({ kind: "none", reason: "comp_open_ended" });
    expect(planReferralMonth({ is_admin: true }, NOW)).toEqual({ kind: "none", reason: "admin" });
  });

  it("a renewing subscription (active OR trialing): a balance credit — dates and trial untouched", () => {
    for (const status of ["active", "trialing"]) {
      expect(
        planReferralMonth({ subscription_tier: "pro", subscription_status: status, stripe_customer_id: "cus_1", stripe_subscription_id: "sub_1" }, NOW),
      ).toEqual({ kind: "balance_credit", customerId: "cus_1", subscriptionId: "sub_1", tier: "pro" });
    }
  });

  it("a cancelled plan still running: a comp month that starts when the plan ends, at its tier", () => {
    expect(
      planReferralMonth(
        { subscription_tier: "pro", subscription_status: "active", stripe_customer_id: "cus_1", stripe_subscription_id: "sub_1", subscription_ends_at: at(5) },
        NOW,
      ),
    ).toEqual({ kind: "comp_month", tier: "pro", expiresAt: at(5 + REFERRAL_MONTH_DAYS) });
  });

  it("a broken payment (past_due): a comp month of Plus", () => {
    expect(planReferralMonth({ subscription_tier: "pro", subscription_status: "past_due", stripe_customer_id: "cus_1", stripe_subscription_id: "sub_1" }, NOW)).toMatchObject({
      kind: "comp_month",
      tier: "plus",
    });
  });

  it("one month's price: the monthly price, a twelfth of an annual one, the list price as a fallback", () => {
    expect(oneMonthCents({ unit_amount: 600, recurring: { interval: "month" } }, "plus")).toBe(600);
    expect(oneMonthCents({ unit_amount: 15000, recurring: { interval: "year" } }, "pro")).toBe(1250);
    expect(oneMonthCents(null, "pro")).toBe(1500);
  });
});
