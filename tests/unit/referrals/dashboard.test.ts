import { describe, expect, it } from "vitest";
import { renderToStaticMarkup } from "react-dom/server";
import { createElement } from "react";
import { DEFAULT_REFERRAL_SETTINGS } from "@/lib/referrals/settings";
import { buildReferralSummary, type ReferralRow } from "@/lib/referrals/summary";
import { activationRate, parseReferralStats } from "@/lib/admin/referral-queries";
import { ReferralPanel } from "@/components/admin/referral-panel";
import { REFERRAL_LIFETIME_CAP, REFERRAL_MONTHLY_CAP, REFERRAL_STATUS_LABELS } from "@/lib/referrals/rules";

// ---------------------------------------------------------------------------
// The referral dashboard's numbers (the user's page) and the admin panel's
// parse + render. "This month" is the UTC calendar month, as the database's
// cap counts it.
// ---------------------------------------------------------------------------

const NOW = new Date("2026-11-15T12:00:00Z");
const row = (over: Partial<ReferralRow>): ReferralRow => ({
  id: Math.random().toString(36).slice(2),
  username: "friend",
  status: "signed_up",
  signedUpAt: "2026-11-01T00:00:00Z",
  firstCardAt: null,
  rewardedAt: null,
  reward: null,
  ...over,
});

describe("buildReferralSummary", () => {
  it("counts joined, activated, rewards earned and this UTC month against the settings' caps", () => {
    const rows = [
      row({}),
      row({ status: "rewarded", firstCardAt: "2026-11-02T00:00:00Z", rewardedAt: "2026-11-02T00:00:00Z", reward: "free_days" }),
      row({ status: "rewarded", firstCardAt: "2026-10-31T23:00:00Z", rewardedAt: "2026-10-31T23:59:59Z", reward: "credits" }),
      row({ status: "capped", firstCardAt: "2026-11-03T00:00:00Z", rewardedAt: "2026-11-03T00:00:00Z" }),
      row({ status: "blocked", firstCardAt: "2026-11-04T00:00:00Z" }),
    ];
    expect(buildReferralSummary(rows, DEFAULT_REFERRAL_SETTINGS.caps, NOW)).toEqual({
      joined: 5,
      activated: 4,
      rewardsEarned: 2,
      thisMonth: 1,
      monthlyCap: REFERRAL_MONTHLY_CAP,
      lifetimeCap: REFERRAL_LIFETIME_CAP,
      lifetimeReached: false,
    });
  });
  it("says when the lifetime cap is reached — the settings' cap, not a constant", () => {
    const rows = Array.from({ length: 2 }, () => row({ status: "rewarded", rewardedAt: "2026-01-01T00:00:00Z" }));
    expect(buildReferralSummary(rows, { ...DEFAULT_REFERRAL_SETTINGS.caps, lifetime: 2 }, NOW).lifetimeReached).toBe(true);
    expect(buildReferralSummary(rows, DEFAULT_REFERRAL_SETTINGS.caps, NOW).lifetimeReached).toBe(false);
  });
  it("a blocked referral never names its reason to the user", () => {
    expect(REFERRAL_STATUS_LABELS.blocked).toBe("Not eligible");
  });
});

describe("admin referral stats", () => {
  it("parses the RPC's jsonb defensively", () => {
    expect(parseReferralStats(null)).toMatchObject({ signedUp: 0, topReferrers: [], blockReasons: {} });
    const parsed = parseReferralStats({
      signedUp: 4,
      firstCard: "3",
      rewarded: 2,
      blocked: 1,
      blockReasons: { same_email: 1 },
      rewardsGranted: 4,
      topReferrers: [{ userId: "u1", username: "dev_pro", referrals: 3, activated: 2, rewarded: 2, rewards: 2 }, { nope: true }],
    });
    expect(parsed).toMatchObject({ signedUp: 4, firstCard: 3, rewarded: 2, capped: 0, rewardsGranted: 4, blockReasons: { same_email: 1 } });
    expect(parsed.topReferrers).toEqual([{ userId: "u1", username: "dev_pro", referrals: 3, activated: 2, rewarded: 2, rewards: 2 }]);
    expect(activationRate(parsed)).toBe(75);
    expect(activationRate({ signedUp: 0, firstCard: 0 })).toBeNull();
  });

  it("the panel shows the chain, rewards granted, block reasons and links each top referrer to their admin page", () => {
    const w = parseReferralStats({
      signedUp: 2,
      firstCard: 1,
      rewarded: 1,
      blocked: 1,
      rewardsGranted: 2,
      blockReasons: { disposable_email: 1 },
      topReferrers: [{ userId: "d0000000-0000-4000-a000-000000000002", username: "dev_pro", referrals: 2, activated: 1, rewarded: 1, rewards: 1 }],
    });
    const html = renderToStaticMarkup(createElement(ReferralPanel, { summary: { last30: w, allTime: w } }));
    expect(html).toContain("Referrals");
    expect(html).toContain("Rewards granted (both sides)");
    expect(html).not.toMatch(/free month/i);
    expect(html).toContain("Throwaway email 1");
    expect(html).toContain('href="/admin/users?u=d0000000-0000-4000-a000-000000000002"');
    expect(html).toContain("@dev_pro");
    expect(html).toContain("activation 30d: 50%");
    expect(html).not.toContain("still owed");
  });

  it("shows the rows waiting on a confirmed email, the grants still owed, and the new block reasons", () => {
    const w = parseReferralStats({
      signedUp: 3,
      waiting: "2",
      grantsOwed: 1,
      blocked: 2,
      blockReasons: { email_reused: 1, account_deleted: 1 },
    });
    expect(w).toMatchObject({ waiting: 2, grantsOwed: 1 });
    const html = renderToStaticMarkup(createElement(ReferralPanel, { summary: { last30: w, allTime: w } }));
    expect(html).toContain("Waiting (an email not confirmed yet)");
    expect(html).toContain("1 reward is still owed");
    expect(html).toContain("Email already used 1");
    expect(html).toContain("account deleted 1");
  });
});
