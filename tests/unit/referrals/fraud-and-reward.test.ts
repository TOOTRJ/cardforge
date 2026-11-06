import { describe, expect, it } from "vitest";
import {
  emailDomain,
  isDisposableDomain,
  normalizeReferralEmail,
  referralFraudVerdict,
} from "@/lib/referrals/fraud";
import { friendRewardFor, referrerRewardFor } from "@/lib/referrals/reward";
import {
  DEFAULT_REFERRAL_LADDER,
  DEFAULT_REFERRAL_SETTINGS,
  friendRewardPhrase,
  ladderRewardFor,
  parseReferralSettings,
  rewardStepPhrase,
} from "@/lib/referrals/settings";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import {
  normalizeReferralCode,
  referralLink,
} from "@/lib/referrals/rules";

// ---------------------------------------------------------------------------
// The referral program's pure rules: codes and links, the fraud verdicts, and
// how a reward (days into the bank, or credits) reaches each side (v2).
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

describe("how a side's reward is decided (the settings made concrete — lib/referrals/reward.ts, v2)", () => {
  it("the friend: the settings' days, banked, whatever they are on; 0 days = nothing", () => {
    expect(friendRewardFor(DEFAULT_REFERRAL_SETTINGS, { subscription_tier: "free" })).toEqual({ kind: "days", days: 7 });
    expect(friendRewardFor(DEFAULT_REFERRAL_SETTINGS, { subscription_tier: "pro", subscription_status: "active" })).toEqual({ kind: "days", days: 7 });
    expect(friendRewardFor({ friend: { days: 0 } }, { subscription_tier: "free" })).toEqual({ kind: "none", reason: "settings" });
  });

  it("the referrer: the LADDER by qualified-referral count (owner 2026-11-06), the tail past it", () => {
    const expected: Array<[number, unknown]> = [
      [1, { kind: "days", days: 7 }],
      [2, { kind: "credits", amount: 5 }],
      [3, { kind: "days", days: 7 }],
      [4, { kind: "credits", amount: 10 }],
      [5, { kind: "days", days: 14 }],
      [6, { kind: "credits", amount: 20 }],
      [7, { kind: "days", days: 21 }],
      [8, { kind: "credits", amount: 50 }],
      [9, { kind: "days", days: 21 }],
      [10, { kind: "days", days: 30 }],
      [11, { kind: "days", days: 7 }],
      [40, { kind: "days", days: 7 }],
    ];
    for (const [step, reward] of expected) {
      expect(referrerRewardFor(DEFAULT_REFERRAL_SETTINGS, step, { subscription_tier: "free" }), `step ${step}`).toEqual(reward);
    }
    expect(DEFAULT_REFERRAL_LADDER).toHaveLength(10);
    expect(ladderRewardFor(DEFAULT_REFERRAL_SETTINGS, 0)).toEqual({ kind: "none" });
    expect(ladderRewardFor(DEFAULT_REFERRAL_SETTINGS, 1.5)).toEqual({ kind: "none" });
  });

  it("an admin gets nothing on either side; a 'none' step is what it says", () => {
    expect(friendRewardFor(DEFAULT_REFERRAL_SETTINGS, { is_admin: true })).toEqual({ kind: "none", reason: "admin" });
    expect(referrerRewardFor(DEFAULT_REFERRAL_SETTINGS, 1, { is_admin: true })).toEqual({ kind: "none", reason: "admin" });
    expect(referrerRewardFor({ ladder: [{ kind: "none" }], tail: { kind: "none" } }, 1, { subscription_tier: "free" })).toEqual({ kind: "none", reason: "settings" });
  });

  it("the settings parse with defaults for anything missing or malformed — a v1 row keeps its switch and friends cap — and phrase themselves", () => {
    expect(parseReferralSettings(null)).toEqual(DEFAULT_REFERRAL_SETTINGS);
    expect(
      parseReferralSettings({ enabled: false, friend: { kind: "credits", amount: 20 }, referrer: { kind: "free_days", tier: "own", units: 1 }, caps: { perMonth: 99, lifetime: 5, friendsPerMonth: 9 } }),
    ).toEqual({ ...DEFAULT_REFERRAL_SETTINGS, enabled: false, caps: { friendsPerMonth: 9 } });
    expect(parseReferralSettings({ ...DEFAULT_REFERRAL_SETTINGS, ladder: [{ kind: "days", days: 0 }] }).ladder).toEqual(DEFAULT_REFERRAL_LADDER);
    expect(rewardStepPhrase({ kind: "days", days: 1 })).toBe("1 free day");
    expect(rewardStepPhrase({ kind: "days", days: 30 })).toBe("30 free days");
    expect(rewardStepPhrase({ kind: "credits", amount: 1 })).toBe("1 AI credit");
    expect(rewardStepPhrase({ kind: "none" })).toBe("nothing");
    expect(friendRewardPhrase(DEFAULT_REFERRAL_SETTINGS)).toBe("7 free days");
    expect(friendRewardPhrase({ friend: { days: 0 } })).toBe("nothing");
    // Never "a free month" anywhere in the words.
    expect(JSON.stringify([rewardStepPhrase({ kind: "days", days: 30 }), friendRewardPhrase(DEFAULT_REFERRAL_SETTINGS)])).not.toMatch(/month/);
  });
});
