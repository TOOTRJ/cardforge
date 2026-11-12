import { beforeEach, describe, expect, it, vi } from "vitest";
import { renderToStaticMarkup } from "react-dom/server";
import { chainClient, type ChainCall } from "@/tests/stubs/supabase-chain";

// What the page's one read (lib/referrals/queries.ts) is given: the viewer,
// and the rows their session reads through the column grant.
const view = vi.hoisted(() => ({
  user: { id: "me" } as { id: string } | null,
  /** The viewer's referrals (they are the referrer), as the database rows. */
  made: [] as Array<Record<string, unknown>>,
  /** The referral that brought the viewer (they are the friend), or null. */
  mine: null as Record<string, unknown> | null,
  profiles: [] as Array<{ id: string; username: string | null }>,
  /** The stored `site_settings` value of the program; null = no row (the defaults). */
  settings: null as unknown,
  /** Every table read, with its chain. */
  reads: [] as Array<{ table: string; calls: ChainCall[] }>,
}));

// The settings form (a client component) reads the router for its refresh;
// the page leaves through notFound / redirect.
vi.mock("next/navigation", () => ({
  useRouter: () => ({ refresh: () => {} }),
  notFound: () => {
    throw new Error("NEXT_NOT_FOUND");
  },
  redirect: (to: string) => {
    throw new Error(`NEXT_REDIRECT ${to}`);
  },
}));
// The page's frame reads the viewer's profile and badges: not under test.
vi.mock("@/components/layout/dashboard-shell", async () => {
  const { createElement: h } = await import("react");
  return { DashboardShell: ({ children }: { children: React.ReactNode }) => h("div", null, children) };
});
vi.mock("@/lib/billing/flags", async (original) => ({
  ...(await original<typeof import("@/lib/billing/flags")>()),
  isBillingEnabled: () => true,
}));
vi.mock("@/lib/supabase/env", async (original) => ({
  ...(await original<typeof import("@/lib/supabase/env")>()),
  isSupabaseConfigured: () => true,
}));
vi.mock("@/lib/supabase/server", () => ({
  getCurrentUser: async () => view.user,
  getCurrentProfile: async () => null,
  createClient: async () => {
    const stub = chainClient((table, calls) => {
      view.reads.push({ table, calls });
      if (table === "referrals") {
        return calls.some((c) => c.method === "eq" && c.args[0] === "referee_id") ? { data: view.mine } : { data: view.made };
      }
      if (table === "profiles") return { data: view.profiles };
      if (table === "site_settings") return { data: view.settings ? { value: view.settings } : null };
      // day_bank_entries: an empty bank.
      return { data: null };
    });
    return {
      from: stub.client.from,
      rpc: async (name: string) => ({ data: name === "my_referral_code" ? "d0000003" : null, error: null }),
    };
  },
}));

import { createElement } from "react";
import ReferralsPage, { metadata } from "@/app/(app)/dashboard/referrals/page";
import { getMyReferralDashboard } from "@/lib/referrals/queries";
import { DEFAULT_REFERRAL_SETTINGS } from "@/lib/referrals/settings";
import { buildReferralSummary, type ReferralRow } from "@/lib/referrals/summary";
import { activationRate, parseReferralStats, qualificationRate } from "@/lib/admin/referral-queries";
import { ReferralPanel } from "@/components/admin/referral-panel";
import { ReferralSettingsForm } from "@/components/admin/referral-settings-form";
import { REFERRAL_STATUS_LABELS } from "@/lib/referrals/rules";

// ---------------------------------------------------------------------------
// The referral dashboard's numbers (the user's page: the ladder's progress,
// the cards saved, the friends cap), the page itself — three steps, the
// cards EACH WITH ITS OWN ARTWORK and no plan (owner 2026-11-11: a referral
// rewards on the friend's cards alone; saved cards read "reward pending",
// never a promise) — and the admin panel's parse + render (v2: the
// chain, with "started a plan" as what came of it; per-day counts, the
// ladder's distribution, the days bank). "This month" is the UTC calendar
// month, as the database's friends cap counts it.
// ---------------------------------------------------------------------------

const NOW = new Date("2026-11-15T12:00:00Z");
const row = (over: Partial<ReferralRow>): ReferralRow => ({
  id: Math.random().toString(36).slice(2),
  username: "friend",
  status: "signed_up",
  signedUpAt: "2026-11-01T00:00:00Z",
  cardsSavedAt: null,
  rewardedAt: null,
  ladderStep: null,
  reward: null,
  ...over,
});

beforeEach(() => {
  view.user = { id: "me" };
  view.made = [];
  view.mine = null;
  view.profiles = [];
  view.settings = null;
  view.reads = [];
});

describe("buildReferralSummary", () => {
  it("counts joined, the cards saved, rewards earned (the ladder rung), this month's rewarded friends against the cap, and names the next reward", () => {
    const rows = [
      row({}),
      row({ status: "cards_saved", cardsSavedAt: "2026-11-02T00:00:00Z" }),
      row({ status: "rewarded", cardsSavedAt: "2026-11-02T00:00:00Z", rewardedAt: "2026-11-02T01:00:00Z", reward: "banked_days", ladderStep: 1 }),
      row({ status: "rewarded", cardsSavedAt: "2026-10-31T23:00:00Z", rewardedAt: "2026-10-31T23:59:59Z", reward: "credits", ladderStep: 2 }),
      row({ status: "capped", cardsSavedAt: "2026-11-03T00:00:00Z", rewardedAt: "2026-11-03T00:00:00Z" }),
      row({ status: "blocked", cardsSavedAt: "2026-11-04T00:00:00Z", rewardedAt: "2026-11-04T00:00:00Z" }),
    ];
    const summary = buildReferralSummary(rows, DEFAULT_REFERRAL_SETTINGS, NOW);
    // Whether a friend went on to a plan is no number of the user's page.
    expect(summary).not.toHaveProperty("cardOnFile");
    expect(summary).toEqual({
      joined: 6,
      cardsSaved: 5,
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

  it("the panel shows the chain — the plan after the reward, as what came of it — the day-by-day table (quiet days left out), the ladder's distribution, the bank's ledger, and links each top referrer", () => {
    const w = parseReferralStats(STATS);
    const html = renderToStaticMarkup(createElement(ReferralPanel, { summary: { last30: w, allTime: w } }));
    expect(html).toContain("Referrals and the days bank");
    // The chain's rows, in order: the reward's own steps, then the plan —
    // named as not needed for it.
    const chain = ["Signed up through a link", "Saved the cards", "Rewarded (both sides)", "Started a plan (not needed for the reward)", "Capped (friends a month)"];
    const places = chain.map((label) => html.indexOf(`>${label}<`));
    expect(places.every((at) => at > -1)).toBe(true);
    expect([...places].sort((a, b) => a - b)).toEqual(places);
    expect(html).not.toContain("Started a plan (card on file)");
    expect(html).toContain("Rewards granted (both sides)");
    expect(html).toContain("AI credits through the ladder");
    expect(html).not.toMatch(/free month/i);
    expect(html).toContain("Same inbox 1");
    expect(html).toContain('href="/admin/users?u=u1"');
    expect(html).toContain("@dev_pro");
    expect(html).toContain("30d cards saved 75%");
    // The plan's share is what came of the referrals, not "qualified": a
    // referral qualifies on the cards.
    expect(html).toContain("went on to a plan 50%");
    expect(html).not.toMatch(/qualified \d+%/);
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

  it("shows the rows whose cards are saved and whose reward is not given yet, the grants still owed, and the block reasons", () => {
    const w = parseReferralStats({ signedUp: 3, waiting: "2", grantsOwed: 1, blocked: 2, blockReasons: { email_reused: 1, account_deleted: 1 } });
    expect(w).toMatchObject({ waiting: 2, grantsOwed: 1 });
    const html = renderToStaticMarkup(createElement(ReferralPanel, { summary: { last30: w, allTime: w } }));
    expect(html).toContain("Waiting (cards saved, reward not given yet)");
    expect(html).not.toMatch(/no plan or email yet/);
    expect(html).toContain("1 reward is still owed");
    expect(html).toContain("Email already used 1");
    expect(html).toContain("account deleted 1");
    expect(html).toContain("Nothing moved in the last 30 days.");
  });

  it("the settings form lists the ladder step by step with the tail, the cards to save and the friends cap", () => {
    const html = renderToStaticMarkup(createElement(ReferralSettingsForm, { initial: DEFAULT_REFERRAL_SETTINGS }));
    expect(html).toContain("Referral 1");
    expect(html).toContain("Referral 10");
    expect(html).toContain("Every further referral");
    expect(html).toContain("Cards to save");
    expect(html).toContain("Rewarded friends a month");
    expect(html).toContain("Add a step");
    expect(html).not.toMatch(/free month/i);
  });

  it("the settings form says the rule: a card counts when it has artwork of its own, no plan — and that the cap, with the size of each step, is what limits made-up friends", () => {
    const html = renderToStaticMarkup(createElement(ReferralSettingsForm, { initial: DEFAULT_REFERRAL_SETTINGS }));
    // The description under the switch, whole: every sentence of it is a
    // statement about the program an admin acts on.
    const description = /<p class="text-xs leading-5 text-muted">([\s\S]*?)<\/p>/.exec(html)?.[1] ?? "";
    expect(description).toBe(
      "A referral qualifies when the friend has saved the cards below within the window. " +
        "A card counts when it has artwork of its own (a picture used on several cards counts once), and no plan is needed. " +
        "Rewards are DAYS INTO THE BANK (tier-less, no AI credits; using them takes a plan with a card on file) or AI credits at once — changed here, never with a deploy. " +
        "The referrer climbs the ladder by qualified referral; past its last step every further referral earns the tail. " +
        "OFF pauses new signups and rewards (a friend who qualifies meanwhile waits until it is on again); what was already given stays. " +
        "The friends cap counts every rewarded referral in a month; 0 means nobody is rewarded. " +
        "There is no card check any more, so the cap, with the size of each step, is what limits made-up friends.",
    );
    // A card on file is named once, for USING the days — never for earning them.
    expect(html.match(/card on file/g)).toHaveLength(1);
    expect(html).toContain("using them takes a plan with a card on file");
    expect(html).not.toMatch(/AND started a plan/);
    // Two claims the first version made that are not true: a paused
    // program's friend does not expire after 30 days (the row waits for as
    // long as it is off), and "five a month at the tail's days" is not the
    // most one account can earn (the ladder's steps are larger than the tail).
    expect(html).toContain("a friend who qualifies meanwhile waits until it is on again");
    expect(html).not.toContain("up to 30 days");
    expect(html).not.toContain("is the most plan time");
    // …nor the first version's "any picture will do" wording.
    expect(html).not.toContain("Only cards with artwork count");
    expect(html).not.toContain("so the cap is what limits made-up friends");
  });
});

// ---------------------------------------------------------------------------
// The user's own read and page.
// ---------------------------------------------------------------------------

/** A `referrals` row as the viewer's session reads it. A column the read no
 *  longer asks for is still in the "database" here: it must not travel. */
const dbRow = (over: Record<string, unknown>): Record<string, unknown> => ({
  id: "r1",
  referrer_id: "me",
  referee_id: "friend-1",
  status: "signed_up",
  signed_up_at: "2026-11-01T00:00:00Z",
  first_card_at: null,
  cards_saved_at: null,
  card_on_file_at: "2026-11-03T00:00:00Z",
  ladder_step: null,
  rewarded_at: null,
  referrer_reward: null,
  ...over,
});
const selectsOf = (table: string) =>
  view.reads.filter((r) => r.table === table).map((r) => String(r.calls.find((c) => c.method === "select")?.args[0] ?? ""));

describe("getMyReferralDashboard", () => {
  it("asks for the cards stamp and never for whether a friend started a plan", async () => {
    view.made = [dbRow({})];
    view.mine = { id: "r9", referrer_id: "them", status: "signed_up", cards_saved_at: null, first_card_at: null, referee_reward: null };
    await getMyReferralDashboard(NOW);
    const selects = selectsOf("referrals");
    expect(selects).toHaveLength(2);
    for (const columns of selects) {
      expect(columns).toContain("cards_saved_at");
      expect(columns).toContain("first_card_at");
      expect(columns).not.toContain("card_on_file_at");
      expect(columns).not.toContain("*");
    }
    // The friend's own row: their side only — never the referrer's reward.
    const own = selects.find((columns) => columns.includes("referee_reward"))!;
    expect(own).not.toContain("referrer_reward");
  });

  it("hands the page each friend's status, cards stamp and reward — and nothing about a plan", async () => {
    view.made = [
      dbRow({ id: "r1", referee_id: "friend-1", status: "cards_saved", cards_saved_at: "2026-11-02T00:00:00Z" }),
      dbRow({ id: "r2", referee_id: "friend-2", status: "first_card", first_card_at: "2026-10-20T00:00:00Z", signed_up_at: "2026-10-19T00:00:00Z" }),
      dbRow({ id: "r3", referee_id: null, status: "rewarded", cards_saved_at: "2026-10-05T00:00:00Z", rewarded_at: "2026-10-05T00:00:01Z", ladder_step: 1, referrer_reward: "banked_days", signed_up_at: "2026-10-01T00:00:00Z" }),
    ];
    view.profiles = [{ id: "friend-1", username: "ember_sphinx" }];
    const dashboard = (await getMyReferralDashboard(NOW))!;
    expect(dashboard.rows).toEqual([
      { id: "r1", username: "ember_sphinx", accountDeleted: false, status: "cards_saved", signedUpAt: "2026-11-01T00:00:00Z", cardsSavedAt: "2026-11-02T00:00:00Z", rewardedAt: null, ladderStep: null, reward: null },
      { id: "r2", username: null, accountDeleted: false, status: "first_card", signedUpAt: "2026-10-19T00:00:00Z", cardsSavedAt: "2026-10-20T00:00:00Z", rewardedAt: null, ladderStep: null, reward: null },
      { id: "r3", username: null, accountDeleted: true, status: "rewarded", signedUpAt: "2026-10-01T00:00:00Z", cardsSavedAt: "2026-10-05T00:00:00Z", rewardedAt: "2026-10-05T00:00:01Z", ladderStep: 1, reward: "banked_days" },
    ]);
    for (const r of dashboard.rows) expect(r).not.toHaveProperty("cardOnFileAt");
    expect(dashboard.summary).toMatchObject({ joined: 3, cardsSaved: 3, rewardsEarned: 1 });
    expect(dashboard.summary).not.toHaveProperty("cardOnFile");
    expect(dashboard.link).toMatch(/\?ref=d0000003$/);
    expect(dashboard.joinedThrough).toBeNull();
  });

  it("the referral that brought the viewer: who, where it stands, the cards, their own reward — no plan", async () => {
    view.profiles = [{ id: "them", username: "dev_pro" }];
    const through = async (mine: Record<string, unknown>) => {
      view.mine = { id: "r9", referrer_id: "them", status: "signed_up", cards_saved_at: null, first_card_at: null, referee_reward: null, card_on_file_at: "2026-11-03T00:00:00Z", ...mine };
      return (await getMyReferralDashboard(NOW))!.joinedThrough;
    };
    expect(await through({})).toEqual({ username: "dev_pro", status: "signed_up", cardsSaved: false, rewarded: null });
    expect(await through({ status: "cards_saved", cards_saved_at: "2026-11-02T00:00:00Z" })).toEqual({ username: "dev_pro", status: "cards_saved", cardsSaved: true, rewarded: null });
    expect(await through({ status: "first_card", first_card_at: "2026-10-02T00:00:00Z" })).toEqual({ username: "dev_pro", status: "first_card", cardsSaved: true, rewarded: null });
    expect(await through({ status: "rewarded", cards_saved_at: "2026-11-02T00:00:00Z", referee_reward: "banked_days" })).toEqual({ username: "dev_pro", status: "rewarded", cardsSaved: true, rewarded: true });
    expect(await through({ status: "capped", cards_saved_at: "2026-11-02T00:00:00Z", referee_reward: "none" })).toEqual({ username: "dev_pro", status: "capped", cardsSaved: true, rewarded: false });
  });

  it("is null for a visitor, and nothing is read", async () => {
    view.user = null;
    expect(await getMyReferralDashboard(NOW)).toBeNull();
    expect(view.reads).toEqual([]);
  });
});

describe("/dashboard/referrals — the page", () => {
  const page = async () => renderToStaticMarkup(await ReferralsPage());
  /** The text of every element matching `<tag …>text</tag>` (no nested tags). */
  const textsOf = (html: string, tag: string) => [...html.matchAll(new RegExp(`<${tag}[^>]*>([^<]*)</${tag}>`, "g"))].map((m) => m[1]);
  /** The page's markup with its tags taken out: the words as they read. */
  const wordsOf = (html: string) => html.replace(/<[^>]+>/g, "").replace(/&#x27;/g, "'");

  it("explains the program in THREE steps: share, cards each with its own artwork inside the window, both rewarded — no plan, no card", async () => {
    const html = await page();
    const steps = /<ol class="flex flex-col gap-3 text-sm text-muted">([\s\S]*?)<\/ol>/.exec(html)?.[1] ?? "";
    const items = steps.split("</li>").filter((li) => li.includes("<li")).map(wordsOf);
    expect(items).toEqual([
      "1. Share your link. A friend opens it and creates an account.",
      "2. They save 5 cards, each with its own artwork, within 30 days of signing up.",
      "3. You both get your reward. 7 free days go into their bank, and you get your next step on the ladder. Nobody has to start a plan or add a card to earn it.",
    ]);
    expect(html).not.toContain("4. You both get your reward");
    expect(html).not.toMatch(/They start a plan/);
    // The step's own heading is the count alone; the rest is its sentence.
    expect(steps).toContain(">2. They save 5 cards</span>, each with its own artwork, within 30 days of signing up.");
  });

  it("the steps follow the program's own settings", async () => {
    // A stored settings row: 3 cards in 14 days, 10 days for the friend.
    view.settings = { ...DEFAULT_REFERRAL_SETTINGS, activation: { cardsRequired: 3, windowDays: 14 }, friend: { days: 10 } };
    view.mine = { id: "r9", referrer_id: "them", status: "signed_up", cards_saved_at: null, first_card_at: null, referee_reward: null };
    const words = wordsOf(await page());
    expect(words).toContain("2. They save 3 cards, each with its own artwork, within 14 days of signing up.");
    expect(words).toContain("3. You both get your reward. 10 free days go into their bank");
    expect(words).toContain("You joined through a friend's link — save 3 cards, each with its own artwork, to get 10 free days.");
  });

  it("never makes a card on file a condition: a card is named only where banked days are USED", async () => {
    view.made = [dbRow({ status: "cards_saved", cards_saved_at: "2026-11-02T00:00:00Z" }), dbRow({ id: "r2", referee_id: "friend-2" })];
    view.mine = { id: "r9", referrer_id: "them", status: "signed_up", cards_saved_at: null, first_card_at: null, referee_reward: null };
    const html = await page();
    const words = wordsOf(html);
    expect(words).not.toMatch(/card on file/i);
    // The fine print: starting a plan is how the days are used, and that is
    // when a card is asked for.
    expect(words).toContain(
      "Banked days are a plan's free time. Starting a plan applies them all — that is when a card is asked for — and days earned later are applied from your billing page whenever you like. The plan bills at its usual price when the days end unless you cancel. A friend's card counts when it has artwork of its own; the same picture on several cards counts once. Up to 5 rewarded friends a month; past that, the extra friends that month earn nobody a reward. New accounts only, and one reward per email address.",
    );
    expect(words).not.toContain("Only cards with artwork count");
    // "A card" is spoken of twice on the whole page: not needed to earn the
    // reward (step 3), asked for when a plan is started (the fine print).
    expect(words.match(/\b(?:a|the|their|your) card\b[^.—]*/gi)).toEqual(["a card to earn it", "a card is asked for "]);
    // …and starting a plan the same two times — never as something to wait for.
    expect(words.match(/start(?:s|ed|ing)? a plan/gi)).toEqual(["start a plan", "Starting a plan"]);
    expect(words).not.toMatch(/waiting for a plan|waiting on a confirmed email/i);
  });

  it("the numbers: friends joined, saved their cards, rewards earned, rewarded this month — no 'Started a plan'", async () => {
    view.made = [
      dbRow({ id: "r1", status: "cards_saved", cards_saved_at: "2026-11-02T00:00:00Z" }),
      dbRow({ id: "r2", referee_id: "friend-2" }),
      dbRow({ id: "r3", referee_id: "friend-3", status: "rewarded", cards_saved_at: "2026-11-04T00:00:00Z", rewarded_at: new Date().toISOString(), ladder_step: 1, referrer_reward: "banked_days" }),
    ];
    const html = await page();
    const stats = /<dl class="grid grid-cols-2 gap-3 md:grid-cols-4">([\s\S]*?)<\/dl>/.exec(html)?.[1] ?? "";
    expect(textsOf(stats, "dt")).toEqual(["Friends joined", "Saved their cards", "Rewards earned", "Rewarded this month"]);
    expect(textsOf(stats, "dd")).toEqual(["3", "2", "1", "1 of 5"]);
    expect(html).not.toContain("Started a plan");
  });

  it("a friend whose cards are saved: the reward is PENDING — no plan is waited for, and nothing is promised (the check can still find the referral not eligible)", async () => {
    view.made = [
      dbRow({ id: "r1", referee_id: "friend-1", status: "cards_saved", cards_saved_at: "2026-11-02T00:00:00Z" }),
      dbRow({ id: "r2", referee_id: "friend-2", status: "first_card", first_card_at: "2026-10-02T00:00:00Z" }),
      dbRow({ id: "r3", referee_id: "friend-3" }),
      dbRow({ id: "r4", referee_id: "friend-4", status: "capped", cards_saved_at: "2026-11-02T00:00:00Z", rewarded_at: "2026-11-02T00:00:01Z", referrer_reward: "none" }),
      dbRow({ id: "r5", referee_id: "friend-5", status: "rewarded", cards_saved_at: "2026-11-02T00:00:00Z", rewarded_at: "2026-11-02T00:00:01Z", ladder_step: 2, referrer_reward: "credits" }),
    ];
    view.profiles = ["friend-1", "friend-2", "friend-3", "friend-4", "friend-5"].map((id) => ({ id, username: id.replace("-", "_") }));
    const html = await page();
    /** The "Your reward" cell of a friend's row (the last cell). */
    const rewardOf = (username: string) => {
      const tr = html.split("</tr>").find((r) => r.includes(`@${username}`)) ?? "";
      return wordsOf(tr.slice(tr.lastIndexOf("<td")));
    };
    expect(rewardOf("friend_1")).toBe("Cards saved — reward pending");
    expect(rewardOf("friend_2")).toBe("Cards saved — reward pending");
    expect(rewardOf("friend_3")).toBe("Waiting for their cards");
    expect(rewardOf("friend_4")).toBe("None — this month's limit of rewarded friends was reached");
    expect(rewardOf("friend_5")).toBe("AI credits · referral #2");
    // On a phone the same words read under the badge: twice a row.
    expect(html.match(/Cards saved — reward pending/g)).toHaveLength(4);
    // Never the first version's promise.
    expect(html).not.toContain("your reward is on its way");
    expect(html).not.toMatch(/waiting for a plan with a card on file|Pending — waiting on a confirmed email/);
  });

  it("'You joined through…' says what is left for the friend to do: the cards, each with its own artwork, and nothing about a plan — and saved cards are 'being checked', not promised", async () => {
    view.profiles = [{ id: "them", username: "dev_pro" }];
    const sentence = async (mine: Record<string, unknown> | null, named = true) => {
      view.profiles = named ? [{ id: "them", username: "dev_pro" }] : [];
      view.mine = mine && { id: "r9", referrer_id: "them", status: "signed_up", cards_saved_at: null, first_card_at: null, referee_reward: null, ...mine };
      // The sentence is its own paragraph in the rail (the small print follows it).
      const own = /<p[^>]*data-testid="referral-joined-through"[^>]*>([\s\S]*?)<\/p>/.exec(await page())?.[1];
      return own === undefined ? null : wordsOf(own);
    };
    expect(await sentence(null)).toBeNull();
    expect(await sentence({})).toBe("You joined through @dev_pro's link — save 5 cards, each with its own artwork, to get 7 free days.");
    expect(await sentence({}, false)).toBe("You joined through a friend's link — save 5 cards, each with its own artwork, to get 7 free days.");
    const saved = "You joined through @dev_pro's link — your cards are saved, and your reward is being checked.";
    expect(await sentence({ status: "cards_saved", cards_saved_at: "2026-11-02T00:00:00Z" })).toBe(saved);
    expect(await sentence({ status: "first_card", first_card_at: "2026-10-02T00:00:00Z" })).toBe(saved);
    expect(await sentence({ status: "rewarded", referee_reward: "banked_days" })).toBe("You joined through @dev_pro's link — your free days are in your bank.");
    expect(await sentence({ status: "rewarded", referee_reward: null })).toBe("You joined through @dev_pro's link — your reward is on its way.");
    expect(await sentence({ status: "blocked", referee_reward: null })).toBe("You joined through @dev_pro's link — your reward is on its way.");
    expect(await sentence({ status: "capped", referee_reward: "none" })).toBe("You joined through @dev_pro's link.");
    expect(await sentence({ status: "expired" })).toBe("You joined through @dev_pro's link.");
    for (const mine of [{}, { status: "cards_saved" }, { status: "first_card" }, { status: "rewarded", referee_reward: "banked_days" }, { status: "expired" }]) {
      expect(await sentence(mine)).not.toMatch(/plan|card on file/i);
    }
  });

  it("the page's description is about the cards, not a plan", () => {
    expect(metadata.description).toBe("Share your referral link: when a friend joins and saves their first cards, you both earn a reward.");
    expect(metadata.robots).toEqual({ index: false, follow: false });
  });
});
