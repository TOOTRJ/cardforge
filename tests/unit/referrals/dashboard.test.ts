import { describe, expect, it } from "vitest";
import { renderToStaticMarkup } from "react-dom/server";
import { createElement } from "react";
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
  it("counts joined, activated, months earned and this UTC month against the caps", () => {
    const rows = [
      row({}),
      row({ status: "rewarded", firstCardAt: "2026-11-02T00:00:00Z", rewardedAt: "2026-11-02T00:00:00Z", reward: "comp_month" }),
      row({ status: "rewarded", firstCardAt: "2026-10-31T23:00:00Z", rewardedAt: "2026-10-31T23:59:59Z", reward: "balance_credit" }),
      row({ status: "capped", firstCardAt: "2026-11-03T00:00:00Z", rewardedAt: "2026-11-03T00:00:00Z" }),
      row({ status: "blocked", firstCardAt: "2026-11-04T00:00:00Z" }),
    ];
    expect(buildReferralSummary(rows, NOW)).toEqual({
      joined: 5,
      activated: 4,
      monthsEarned: 2,
      thisMonth: 1,
      monthlyCap: REFERRAL_MONTHLY_CAP,
      lifetimeCap: REFERRAL_LIFETIME_CAP,
      lifetimeReached: false,
    });
  });
  it("says when the lifetime cap is reached", () => {
    const rows = Array.from({ length: REFERRAL_LIFETIME_CAP }, () => row({ status: "rewarded", rewardedAt: "2026-01-01T00:00:00Z" }));
    expect(buildReferralSummary(rows, NOW).lifetimeReached).toBe(true);
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
      monthsGranted: 4,
      topReferrers: [{ userId: "u1", username: "dev_pro", referrals: 3, activated: 2, rewarded: 2, months: 2 }, { nope: true }],
    });
    expect(parsed).toMatchObject({ signedUp: 4, firstCard: 3, rewarded: 2, capped: 0, monthsGranted: 4, blockReasons: { same_email: 1 } });
    expect(parsed.topReferrers).toEqual([{ userId: "u1", username: "dev_pro", referrals: 3, activated: 2, rewarded: 2, months: 2 }]);
    expect(activationRate(parsed)).toBe(75);
    expect(activationRate({ signedUp: 0, firstCard: 0 })).toBeNull();
  });

  it("the panel shows the chain, months granted, block reasons and links each top referrer to their admin page", () => {
    const w = parseReferralStats({
      signedUp: 2,
      firstCard: 1,
      rewarded: 1,
      blocked: 1,
      monthsGranted: 2,
      blockReasons: { disposable_email: 1 },
      topReferrers: [{ userId: "d0000000-0000-4000-a000-000000000002", username: "dev_pro", referrals: 2, activated: 1, rewarded: 1, months: 1 }],
    });
    const html = renderToStaticMarkup(createElement(ReferralPanel, { summary: { last30: w, allTime: w } }));
    expect(html).toContain("Referrals");
    expect(html).toContain("Free months granted");
    expect(html).toContain("Throwaway email 1");
    expect(html).toContain('href="/admin/users?u=d0000000-0000-4000-a000-000000000002"');
    expect(html).toContain("@dev_pro");
    expect(html).toContain("activation 30d: 50%");
  });
});
