import { describe, expect, it } from "vitest";
import {
  emailDomain,
  isDisposableDomain,
  normalizeReferralEmail,
  referralFraudVerdict,
} from "@/lib/referrals/fraud";
import { oneMonthCents, planReferralMonth } from "@/lib/referrals/reward";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import {
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
    expect(normalizeReferralEmail("Jo.Smith+promo@GoogleMail.com")).toBe("josmith@gmail.com");
    expect(normalizeReferralEmail("jo.smith@outlook.com")).toBe("jo.smith@outlook.com");
    expect(normalizeReferralEmail("nope")).toBeNull();
    expect(emailDomain("a@Sub.Example.org")).toBe("sub.example.org");
  });

  it("normalizeReferralEmail answers the shared case table (its SQL twin, normalize_referral_email, is held to the same file)", () => {
    const cases = JSON.parse(
      readFileSync(join(process.cwd(), "tests/unit/referrals/email-normalization-cases.json"), "utf8"),
    ) as Array<[string | null, string | null]>;
    expect(cases.length).toBeGreaterThan(15);
    for (const [input, expected] of cases) {
      expect(normalizeReferralEmail(input), JSON.stringify(input)).toBe(expected);
    }
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
  it("a free user: a month of Plus (the database places it and grants ONE Plus allotment)", () => {
    expect(planReferralMonth({ subscription_tier: "free" }, NOW)).toEqual({ kind: "plus_month" });
  });

  it("a running or expired comp with an end date: a month of Plus (the database starts it after the comp)", () => {
    expect(planReferralMonth({ comp_tier: "pro", comp_expires_at: at(10) }, NOW)).toEqual({ kind: "plus_month" });
    expect(planReferralMonth({ comp_tier: "pro", comp_expires_at: at(-1) }, NOW)).toEqual({ kind: "plus_month" });
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

  it("a cancelled plan still running, or a broken payment: a month of Plus, never a balance credit", () => {
    const sub = { subscription_tier: "pro", stripe_customer_id: "cus_1", stripe_subscription_id: "sub_1" };
    expect(planReferralMonth({ ...sub, subscription_status: "active", subscription_ends_at: at(5) }, NOW)).toEqual({ kind: "plus_month" });
    expect(planReferralMonth({ ...sub, subscription_status: "active", cancel_at_period_end: true }, NOW)).toEqual({ kind: "plus_month" });
    expect(planReferralMonth({ ...sub, subscription_status: "past_due" }, NOW)).toEqual({ kind: "plus_month" });
  });

  it("one month's price: the monthly price, a twelfth of an annual one, the list price as a fallback", () => {
    expect(oneMonthCents({ unit_amount: 600, recurring: { interval: "month" } }, "plus")).toBe(600);
    expect(oneMonthCents({ unit_amount: 15000, recurring: { interval: "year" } }, "pro")).toBe(1250);
    expect(oneMonthCents(null, "pro")).toBe(1500);
  });
});
