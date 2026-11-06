import { describe, expect, it, vi } from "vitest";
import { renderToStaticMarkup } from "react-dom/server";

// The settings form (a client component) reads the router for its refresh.
vi.mock("next/navigation", () => ({ useRouter: () => ({ refresh: () => {} }) }));
import { createElement } from "react";
import { DEFAULT_REFERRAL_SETTINGS } from "@/lib/referrals/settings";
import { buildReferralSummary, type ReferralRow } from "@/lib/referrals/summary";
import { activationRate, parseReferralStats, qualificationRate } from "@/lib/admin/referral-queries";
import { ReferralPanel } from "@/components/admin/referral-panel";
import { ReferralSettingsForm } from "@/components/admin/referral-settings-form";
import { REFERRAL_STATUS_LABELS } from "@/lib/referrals/rules";

// ---------------------------------------------------------------------------
// The referral dashboard's numbers (the user's page: the ladder's progress,
// the two bars, the friends cap) and the admin panel's parse + render (v2:
// the chain with the card on file, per-day counts, the ladder's
// distribution, the days bank). "This month" is the UTC calendar month, as
// the database's friends cap counts it.
// ---------------------------------------------------------------------------

const NOW = new Date("2026-11-15T12:00:00Z");
const row = (over: Partial<ReferralRow>): ReferralRow => ({
  id: Math.random().toString(36).slice(2),
  username: "friend",
  status: "signed_up",
  signedUpAt: "2026-11-01T00:00:00Z",
  cardsSavedAt: null,
  cardOnFileAt: null,
  rewardedAt: null,
  ladderStep: null,
  reward: null,
  ...over,
});

describe("buildReferralSummary", () => {
  it("counts joined, the two bars, rewards earned (the ladder rung), this month's rewarded friends against the cap, and names the next reward", () => {
    const rows = [
      row({}),
      row({ status: "cards_saved", cardsSavedAt: "2026-11-02T00:00:00Z" }),
      row({ status: "rewarded", cardsSavedAt: "2026-11-02T00:00:00Z", cardOnFileAt: "2026-11-02T01:00:00Z", rewardedAt: "2026-11-02T01:00:00Z", reward: "banked_days", ladderStep: 1 }),
      row({ status: "rewarded", cardsSavedAt: "2026-10-31T23:00:00Z", cardOnFileAt: "2026-10-31T23:30:00Z", rewardedAt: "2026-10-31T23:59:59Z", reward: "credits", ladderStep: 2 }),
      row({ status: "capped", cardsSavedAt: "2026-11-03T00:00:00Z", cardOnFileAt: "2026-11-03T00:00:00Z", rewardedAt: "2026-11-03T00:00:00Z" }),
      row({ status: "blocked", cardsSavedAt: "2026-11-04T00:00:00Z", cardOnFileAt: "2026-11-04T00:00:00Z", rewardedAt: "2026-11-04T00:00:00Z" }),
    ];
    expect(buildReferralSummary(rows, DEFAULT_REFERRAL_SETTINGS, NOW)).toEqual({
      joined: 6,
      cardsSaved: 5,
      cardOnFile: 4,
      rewardsEarned: 2,
      // As the claim counts it: the rewarded and the referrer-blocked rows
      // (their friend was rewarded); the capped row rewarded nobody.
      friendsThisMonth: 2,
      friendsPerMonth: DEFAULT_REFERRAL_SETTINGS.caps.friendsPerMonth,
      nextReward: { kind: "days", days: 7 },
      nextRewardPhrase: "7 free days",
      ladderLength: 10,
      pastLadder: false,
    });
  });
  it("past the ladder every further referral earns the tail — the settings' ladder, not a constant", () => {
    const rows = Array.from({ length: 10 }, (_, i) => row({ status: "rewarded", rewardedAt: "2026-01-01T00:00:00Z", ladderStep: i + 1, reward: "banked_days" }));
    const s = buildReferralSummary(rows, DEFAULT_REFERRAL_SETTINGS, NOW);
    expect(s).toMatchObject({ rewardsEarned: 10, pastLadder: true, nextReward: DEFAULT_REFERRAL_SETTINGS.tail, nextRewardPhrase: "7 free days" });
    const shorter = buildReferralSummary(rows.slice(0, 2), { ...DEFAULT_REFERRAL_SETTINGS, ladder: DEFAULT_REFERRAL_SETTINGS.ladder.slice(0, 2), tail: { kind: "credits", amount: 3 } }, NOW);
    expect(shorter).toMatchObject({ pastLadder: true, nextRewardPhrase: "3 AI credits", ladderLength: 2 });
  });
  it("a blocked referral never names its reason to the user; both qualified names read the same", () => {
    expect(REFERRAL_STATUS_LABELS.blocked).toBe("Not eligible");
    expect(REFERRAL_STATUS_LABELS.cards_saved).toBe(REFERRAL_STATUS_LABELS.first_card);
  });
});

const STATS = {
  signedUp: 4,
  cardsSaved: "3",
  cardOnFile: 2,
  rewarded: 2,
  blocked: 1,
  blockReasons: { same_email: 1 },
  rewardsGranted: 4,
  ladderCredits: 15,
  ladderSteps: { "1": 3, "2": 1, "10+": 1 },
  topReferrers: [{ userId: "u1", username: "dev_pro", referrals: 3, activated: 2, cardOnFile: 2, rewarded: 2, rewards: 2, step: 2 }, { nope: true }],
  perDay: [
    { day: "2026-11-01", signedUp: 1, cardsSaved: 0, cardOnFile: 0, rewarded: 0 },
    { day: "2026-11-02", signedUp: 0, cardsSaved: 0, cardOnFile: 0, rewarded: 0 },
    { day: "2026-11-03", signedUp: 2, cardsSaved: 1, cardOnFile: 1, rewarded: 1 },
    { nope: true },
  ],
  bank: {
    bankedDays: 21,
    reservedDays: 7,
    appliedDays: 14,
    revokedDays: 7,
    appliedCheckouts: 1,
    appliedCheckoutDays: 7,
    appliedHolds: 1,
    appliedHoldDays: 7,
    usersWithBank: 2,
    signupEntries: 5,
    signupApplied: 1,
    signupRevoked: 1,
    signupBanked: 3,
    bySource: { signup: { days: 35, entries: 5 }, referral_step: { days: 14, entries: 2 }, admin: { days: 14, entries: 1 } },
  },
};

describe("admin referral stats (v2)", () => {
  it("parses the RPC's jsonb defensively — 0177's firstCard still reads as cardsSaved", () => {
    expect(parseReferralStats(null)).toMatchObject({ signedUp: 0, topReferrers: [], blockReasons: {}, perDay: [], ladderSteps: {}, bank: { bankedDays: 0, bySource: {} } });
    expect(parseReferralStats({ signedUp: 2, firstCard: 1 })).toMatchObject({ cardsSaved: 1 });
    const parsed = parseReferralStats(STATS);
    expect(parsed).toMatchObject({ signedUp: 4, cardsSaved: 3, cardOnFile: 2, rewarded: 2, capped: 0, rewardsGranted: 4, ladderCredits: 15, blockReasons: { same_email: 1 }, ladderSteps: { "1": 3, "2": 1, "10+": 1 } });
    expect(parsed.topReferrers).toEqual([{ userId: "u1", username: "dev_pro", referrals: 3, activated: 2, cardOnFile: 2, rewarded: 2, rewards: 2, step: 2 }]);
    expect(parsed.perDay).toHaveLength(3);
    expect(parsed.bank).toMatchObject({ bankedDays: 21, appliedCheckouts: 1, usersWithBank: 2, bySource: { admin: { days: 14, entries: 1 } } });
    expect(activationRate(parsed)).toBe(75);
    expect(qualificationRate(parsed)).toBe(50);
    expect(activationRate({ signedUp: 0, cardsSaved: 0 })).toBeNull();
  });

  it("the panel shows the chain with the card on file, the day-by-day table (quiet days left out), the ladder's distribution, the bank's ledger, and links each top referrer", () => {
    const w = parseReferralStats(STATS);
    const html = renderToStaticMarkup(createElement(ReferralPanel, { summary: { last30: w, allTime: w } }));
    expect(html).toContain("Referrals and the days bank");
    expect(html).toContain("Started a plan (card on file)");
    expect(html).toContain("Rewards granted (both sides)");
    expect(html).toContain("AI credits through the ladder");
    expect(html).not.toMatch(/free month/i);
    expect(html).toContain("Same inbox 1");
    expect(html).toContain('href="/admin/users?u=u1"');
    expect(html).toContain("@dev_pro");
    expect(html).toContain("30d cards saved 75%");
    expect(html).toContain("qualified 50%");
    // The ladder's distribution, ordered with "10+" last.
    expect(html).toMatch(/Referrers by rewarded referrals: 1 → 3 · 2 → 1 · 10\+ → 1/);
    // The days: 11-02 had nothing and is left out.
    expect(html).toContain("2026-11-01");
    expect(html).not.toContain("2026-11-02");
    expect(html).toContain("2026-11-03");
    // The bank.
    expect(html).toContain("Days banked (waiting)");
    expect(html).toContain("Admin comps 14 d / 1");
    expect(html).not.toContain("still owed");
  });

  it("shows the rows waiting on the plan or an email, the grants still owed, and the block reasons", () => {
    const w = parseReferralStats({ signedUp: 3, waiting: "2", grantsOwed: 1, blocked: 2, blockReasons: { email_reused: 1, account_deleted: 1 } });
    expect(w).toMatchObject({ waiting: 2, grantsOwed: 1 });
    const html = renderToStaticMarkup(createElement(ReferralPanel, { summary: { last30: w, allTime: w } }));
    expect(html).toContain("Waiting (cards saved, no plan or email yet)");
    expect(html).toContain("1 reward is still owed");
    expect(html).toContain("Email already used 1");
    expect(html).toContain("account deleted 1");
    expect(html).toContain("Nothing moved in the last 30 days.");
  });

  it("the settings form lists the ladder step by step with the tail, the two bars and the friends cap", () => {
    const html = renderToStaticMarkup(createElement(ReferralSettingsForm, { initial: DEFAULT_REFERRAL_SETTINGS }));
    expect(html).toContain("Referral 1");
    expect(html).toContain("Referral 10");
    expect(html).toContain("Every further referral");
    expect(html).toContain("Cards to save");
    expect(html).toContain("Rewarded friends a month");
    expect(html).toContain("Add a step");
    expect(html).not.toMatch(/free month/i);
  });
});
