import { describe, expect, it } from "vitest";
import {
  emailDomain,
  isDisposableDomain,
  normalizeReferralEmail,
  referralFraudVerdict,
} from "@/lib/referrals/fraud";
import { referralRewardFor } from "@/lib/referrals/reward";
import { DEFAULT_REFERRAL_SETTINGS, parseReferralSettings, rewardPhrase } from "@/lib/referrals/settings";
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

describe("how a side's reward is decided (the settings made concrete — lib/referrals/reward.ts)", () => {
  const friend = DEFAULT_REFERRAL_SETTINGS.friend;
  const referrer = DEFAULT_REFERRAL_SETTINGS.referrer;

  it("the friend: 30 free days of Plus whatever they are on (free, comped, paying — lib/billing/free-days.ts decides the shape)", () => {
    expect(referralRewardFor(friend, { subscription_tier: "free" })).toEqual({ kind: "free_days", tier: "plus", units: 1 });
    expect(referralRewardFor(friend, { subscription_tier: "pro", subscription_status: "active" })).toEqual({ kind: "free_days", tier: "plus", units: 1 });
  });

  it("the referrer: their OWN paid tier while the plan is live, Plus otherwise (owner 2026-11-05)", () => {
    expect(referralRewardFor(referrer, { subscription_tier: "free" })).toEqual({ kind: "free_days", tier: "plus", units: 1 });
    for (const status of ["active", "trialing"]) {
      expect(referralRewardFor(referrer, { subscription_tier: "pro", subscription_status: status })).toEqual({ kind: "free_days", tier: "pro", units: 1 });
    }
    expect(referralRewardFor(referrer, { subscription_tier: "pro", subscription_status: "canceled" })).toEqual({ kind: "free_days", tier: "plus", units: 1 });
  });

  it("an admin gets nothing; a 'credits' or 'none' setting is what it says", () => {
    expect(referralRewardFor(friend, { is_admin: true })).toEqual({ kind: "none", reason: "admin" });
    expect(referralRewardFor({ kind: "credits", amount: 20 }, { subscription_tier: "free" })).toEqual({ kind: "credits", amount: 20 });
    expect(referralRewardFor({ kind: "none" }, { subscription_tier: "free" })).toEqual({ kind: "none", reason: "settings" });
  });

  it("the settings parse with defaults for anything missing or malformed, and phrase themselves", () => {
    expect(parseReferralSettings(null)).toEqual(DEFAULT_REFERRAL_SETTINGS);
    expect(parseReferralSettings({ enabled: false, friend: { kind: "credits", amount: 20 }, caps: { perMonth: 99 } })).toEqual({
      ...DEFAULT_REFERRAL_SETTINGS,
      enabled: false,
      friend: { kind: "credits", amount: 20 },
    });
    expect(rewardPhrase({ kind: "free_days", tier: "plus", units: 1 })).toBe("30 free days of Plus");
    expect(rewardPhrase({ kind: "free_days", tier: "own", units: 2 })).toBe("60 free days of your plan");
    expect(rewardPhrase({ kind: "credits", amount: 1 })).toBe("1 AI credit");
    expect(rewardPhrase({ kind: "none" })).toBe("nothing");
  });
});
