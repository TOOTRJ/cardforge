import { readFileSync } from "node:fs";
import { join } from "node:path";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { chainClient, type ChainAnswer, type ChainCall } from "@/tests/stubs/supabase-chain";

// ---------------------------------------------------------------------------
// /admin/analytics — the Referrals tab's data (lib/admin/analytics/referrals.ts).
// The period's four numbers are each counted by THEIR OWN date; "where they
// are" has plain words for every status and block reason the database
// allows; the referred-friends rows are read defensively; and both reads
// answer null when they fail — never an empty list as the truth. Each read
// checks the viewer is an admin ITSELF (requireAdminClient): for anyone else
// it is null and nothing is asked of the database.
// ---------------------------------------------------------------------------

const db = vi.hoisted(() => ({
  resolve: null as null | ((table: string, calls: ChainCall[]) => ChainAnswer),
  rpc: null as null | ((name: string, args: Record<string, unknown>) => ChainAnswer),
  rpcCalls: [] as Array<[string, Record<string, unknown>]>,
  tableCalls: [] as Array<{ table: string; calls: ChainCall[] }>,
  /** Whether the viewer is an admin: what requireAdminClient answers. */
  admin: true,
  /** How often a read asked who the viewer is. */
  gate: 0,
}));

function fakeAdmin() {
  const stub = chainClient((table, calls) => {
    db.tableCalls.push({ table, calls });
    return db.resolve!(table, calls);
  });
  return {
    ...stub.client,
    rpc: async (name: string, args: Record<string, unknown>) => {
      db.rpcCalls.push([name, args]);
      return { data: null, error: null, ...db.rpc!(name, args) };
    },
  };
}

// The reads' own gate: the service client for an admin, null for anyone else.
vi.mock("@/lib/admin/users-queries", () => ({
  requireAdminClient: async () => {
    db.gate += 1;
    return db.admin ? fakeAdmin() : null;
  },
}));
// …and the only way to a client: a read that built the service client
// itself would never have asked who is looking.
vi.mock("@/lib/supabase/admin", () => ({
  isAdminConfigured: () => true,
  createAdminClient: () => {
    throw new Error("an analytics read takes its client from requireAdminClient, never createAdminClient");
  },
}));

import { analyticsPeriod } from "@/lib/admin/analytics/params";
import {
  REFERRED_FRIENDS_PAGE_SIZE,
  buildReferralPeriodStats,
  countReferralSteps,
  getReferralPeriodStats,
  getReferredFriends,
  pageRangeText,
  parseReferredFriends,
  referralStandingText,
  rewardedOn,
  tierName,
  type ReferralStampRow,
} from "@/lib/admin/analytics/referrals";
import { REFERRAL_BLOCK_LABELS } from "@/lib/admin/referral-queries";

const NOW = new Date("2026-11-10T15:00:00Z");
// [Nov 4 00:00Z, Nov 10 15:00Z); the one before is the same stretch 7 days
// earlier, cut at the same time of day: [Oct 28 00:00Z, Nov 3 15:00Z). The
// rest of Nov 3 is in neither.
const period = analyticsPeriod(7, NOW);

const stamp = (over: Partial<ReferralStampRow>): ReferralStampRow => ({
  status: "signed_up",
  signed_up_at: "2026-11-05T10:00:00Z",
  first_card_at: null,
  cards_saved_at: null,
  card_on_file_at: null,
  rewarded_at: null,
  ...over,
});

beforeEach(() => {
  db.resolve = () => ({ data: [] });
  db.rpc = () => ({ data: [] });
  db.rpcCalls = [];
  db.tableCalls = [];
  db.admin = true;
  db.gate = 0;
});

describe("countReferralSteps", () => {
  it("counts every step by its own date, not the signup's", () => {
    const rows = [
      // Joined before the window, saved the cards and started a plan inside it.
      stamp({ status: "cards_saved", signed_up_at: "2026-10-20T00:00:00Z", cards_saved_at: "2026-11-06T00:00:00Z", card_on_file_at: "2026-11-07T00:00:00Z" }),
      // Joined inside it, nothing more yet.
      stamp({}),
      // Joined and rewarded inside it.
      stamp({ status: "rewarded", cards_saved_at: "2026-11-05T12:00:00Z", card_on_file_at: "2026-11-05T13:00:00Z", rewarded_at: "2026-11-05T13:00:01Z" }),
    ];
    expect(countReferralSteps(rows, period.since, period.until)).toEqual({ signedUp: 2, cardsSaved: 2, cardOnFile: 2, rewarded: 1 });
  });

  it("the window is [from, to): its first instant is in, its last is out", () => {
    const rows = [
      stamp({ signed_up_at: "2026-11-04T00:00:00.000Z" }), // `since`: the period's first instant
      stamp({ signed_up_at: "2026-11-10T15:00:00.000Z" }), // `until` itself is outside
      stamp({ signed_up_at: "2026-11-03T23:59:59.999Z" }), // the last instant before the period
      stamp({ signed_up_at: "2026-11-03T15:00:00.000Z" }), // `previousUntil` itself is outside
      stamp({ signed_up_at: "2026-11-03T14:59:59.999Z" }), // the previous period's last instant
      stamp({ signed_up_at: "2026-10-28T00:00:00.000Z" }), // `previousSince`: its first
      stamp({ signed_up_at: "2026-10-27T23:59:59.999Z" }), // the last instant before it
    ];
    expect(countReferralSteps(rows, period.since, period.until).signedUp).toBe(1);
    expect(countReferralSteps(rows, period.previousSince, period.previousUntil).signedUp).toBe(2);
  });

  it("a capped or blocked row carries a rewarded_at and rewarded nobody", () => {
    const at = "2026-11-06T00:00:00Z";
    const rows = [stamp({ status: "capped", rewarded_at: at }), stamp({ status: "blocked", rewarded_at: at }), stamp({ status: "rewarded", rewarded_at: at })];
    expect(countReferralSteps(rows, period.since, period.until).rewarded).toBe(1);
  });

  it("reads 0177's first_card_at on a row that has no cards_saved_at, and survives a broken date", () => {
    const rows = [stamp({ status: "first_card", first_card_at: "2026-11-06T00:00:00Z" }), stamp({ signed_up_at: "not a date", cards_saved_at: "" })];
    expect(countReferralSteps(rows, period.since, period.until)).toEqual({ signedUp: 1, cardsSaved: 1, cardOnFile: 0, rewarded: 0 });
  });
});

describe("buildReferralPeriodStats", () => {
  const rows = [
    stamp({ signed_up_at: "2026-11-04T00:00:00Z" }),
    stamp({ signed_up_at: "2026-11-09T23:00:00Z" }),
    stamp({ signed_up_at: "2026-11-09T01:00:00Z" }),
    stamp({ signed_up_at: "2026-10-30T12:00:00Z", status: "rewarded", cards_saved_at: "2026-10-31T00:00:00Z", card_on_file_at: "2026-11-01T00:00:00Z", rewarded_at: "2026-11-01T00:00:00Z" }),
  ];
  const stats = buildReferralPeriodStats(rows, period);

  it("answers the period and the one before it", () => {
    expect(stats.current).toEqual({ signedUp: 3, cardsSaved: 0, cardOnFile: 0, rewarded: 0 });
    expect(stats.previous).toEqual({ signedUp: 1, cardsSaved: 1, cardOnFile: 1, rewarded: 1 });
  });

  it("gives one point per UTC day of the period, quiet days as zero, adding up to the period's signups", () => {
    expect(stats.perDay.map((p) => p.day)).toEqual(period.dayKeys);
    expect(stats.perDay.find((p) => p.day === "2026-11-09")?.value).toBe(2);
    expect(stats.perDay.find((p) => p.day === "2026-11-05")?.value).toBe(0);
    expect(stats.perDay.reduce((sum, p) => sum + p.value, 0)).toBe(stats.current.signedUp);
  });

  it("the one before is [previousSince, previousUntil) — the same stretch 7 days earlier — for every step; the rest of that earlier day is in neither period", () => {
    expect(period.previousSince.toISOString()).toBe("2026-10-28T00:00:00.000Z");
    expect(period.previousUntil.toISOString()).toBe("2026-11-03T15:00:00.000Z");
    expect(period.previousUntil.getTime() - period.previousSince.getTime()).toBe(period.until.getTime() - period.since.getTime());
    const none = { signedUp: 0, cardsSaved: 0, cardOnFile: 0, rewarded: 0 };
    const once = { signedUp: 1, cardsSaved: 1, cardOnFile: 1, rewarded: 1 };
    const every = (at: string): ReferralStampRow => stamp({ status: "rewarded", signed_up_at: at, cards_saved_at: at, card_on_file_at: at, rewarded_at: at });
    const stepsAt = (at: string) => {
      const built = buildReferralPeriodStats([every(at)], period);
      return { current: built.current, previous: built.previous, charted: built.perDay.reduce((sum, p) => sum + p.value, 0) };
    };
    // The previous period's two edges.
    expect(stepsAt("2026-10-28T00:00:00.000Z")).toEqual({ current: none, previous: once, charted: 0 });
    expect(stepsAt("2026-10-27T23:59:59.999Z")).toEqual({ current: none, previous: none, charted: 0 });
    expect(stepsAt("2026-11-03T14:59:59.999Z")).toEqual({ current: none, previous: once, charted: 0 });
    // From its cut at 15:00 to the period's start: neither.
    expect(stepsAt("2026-11-03T15:00:00.000Z")).toEqual({ current: none, previous: none, charted: 0 });
    expect(stepsAt("2026-11-03T20:00:00.000Z")).toEqual({ current: none, previous: none, charted: 0 });
    expect(stepsAt("2026-11-03T23:59:59.999Z")).toEqual({ current: none, previous: none, charted: 0 });
    // The period's own edges have not moved.
    expect(stepsAt("2026-11-04T00:00:00.000Z")).toEqual({ current: once, previous: none, charted: 1 });
    expect(stepsAt("2026-11-10T14:59:59.999Z")).toEqual({ current: once, previous: none, charted: 1 });
    expect(stepsAt("2026-11-10T15:00:00.000Z")).toEqual({ current: none, previous: none, charted: 0 });
    // Each step by its own date: joined in the previous period, saved the
    // cards in the gap, started a plan in this one.
    const spread = stamp({ status: "cards_saved", signed_up_at: "2026-11-01T09:00:00Z", cards_saved_at: "2026-11-03T18:00:00Z", card_on_file_at: "2026-11-05T09:00:00Z" });
    const built = buildReferralPeriodStats([spread], period);
    expect(built.previous).toEqual({ ...none, signedUp: 1 });
    expect(built.current).toEqual({ ...none, cardOnFile: 1 });
  });
});

describe("referralStandingText", () => {
  // The words for every value the database allows.
  const STATUS_WORDS: Record<string, string> = {
    signed_up: "Signed up",
    first_card: "Saved their first card",
    cards_saved: "Saved 5 cards",
    rewarded: "Rewarded",
    capped: "Not rewarded: over the monthly friend limit",
    blocked: "Blocked",
    expired: "Expired: ran out of time",
  };
  const BLOCK_WORDS: Record<string, string> = {
    same_email: "Blocked: same inbox",
    same_card: "Blocked: same card",
    same_domain: "Blocked: same company domain (friend rewarded)",
    disposable_email: "Blocked: throwaway email",
    not_new: "Blocked: not a new account",
    account_deleted: "Blocked: friend's account deleted",
    email_reused: "Blocked: email already used",
  };
  const migration = (name: string) => readFileSync(join(process.cwd(), "supabase/migrations", name), "utf8");
  const listOf = (sql: string, pattern: RegExp): string[] => [...(pattern.exec(sql)?.[1] ?? "").matchAll(/'([a-z_]+)'/g)].map((m) => m[1]);

  it("has words for every status in 0180's CHECK", () => {
    const statuses = listOf(migration("0180_referrals_v2.sql"), /constraint referrals_status_check\s+check \(status in \(([^)]*)\)\)/);
    expect(statuses.length).toBe(7);
    expect([...statuses].sort()).toEqual(Object.keys(STATUS_WORDS).sort());
    for (const status of statuses) expect(referralStandingText(status, null)).toBe(STATUS_WORDS[status]);
  });

  it("has words for every block reason in 0177's CHECK — and the panel's list names each one", () => {
    const reasons = listOf(migration("0177_referrals.sql"), /block_reason is null or block_reason in \(([^)]*)\)/);
    expect(reasons.length).toBe(7);
    expect([...reasons].sort()).toEqual(Object.keys(BLOCK_WORDS).sort());
    expect(Object.keys(REFERRAL_BLOCK_LABELS).sort()).toEqual([...reasons].sort());
    for (const reason of reasons) expect(referralStandingText("blocked", reason)).toBe(BLOCK_WORDS[reason]);
  });

  it("a block reason only speaks on a blocked row", () => {
    expect(referralStandingText("rewarded", "same_domain")).toBe("Rewarded");
    expect(referralStandingText("signed_up", "not_new")).toBe("Signed up");
  });

  it("says how many cards the program asks for", () => {
    expect(referralStandingText("cards_saved", null, 3)).toBe("Saved 3 cards");
    expect(referralStandingText("cards_saved", null, 1)).toBe("Saved 1 card");
  });

  it("a value it does not know reads as words, never as nothing or a raw code", () => {
    expect(referralStandingText("on_hold", null)).toBe("On hold");
    expect(referralStandingText("blocked", "shared_device")).toBe("Blocked: shared device");
    expect(referralStandingText("", null)).toBe("Unknown");
  });
});

describe("parseReferredFriends", () => {
  const raw = {
    referral_id: "r1",
    referee_id: "u-friend",
    referee_username: "friend",
    referee_joined_at: "2026-11-01T00:00:00Z",
    referrer_id: "u-ref",
    referrer_username: "referrer",
    signed_up_at: "2026-11-01T00:05:00Z",
    status: "rewarded",
    block_reason: null,
    cards_saved_at: "2026-11-02T00:00:00Z",
    card_on_file_at: "2026-11-03T00:00:00Z",
    rewarded_at: "2026-11-03T00:00:01Z",
    ladder_step: 2,
    referee_tier: "plus",
    referee_cards: "18",
    referee_public_cards: 15,
    referee_last_card_at: "2026-11-09T00:00:00Z",
    referee_banked_days: "7",
    total_count: "240",
  };

  it("shapes a row, reading counts that arrive as strings", () => {
    expect(parseReferredFriends([raw])).toEqual({
      total: 240,
      rows: [
        {
          referralId: "r1",
          refereeId: "u-friend",
          refereeUsername: "friend",
          refereeJoinedAt: "2026-11-01T00:00:00Z",
          referrerId: "u-ref",
          referrerUsername: "referrer",
          signedUpAt: "2026-11-01T00:05:00Z",
          status: "rewarded",
          blockReason: null,
          cardsSavedAt: "2026-11-02T00:00:00Z",
          cardOnFileAt: "2026-11-03T00:00:00Z",
          rewardedAt: "2026-11-03T00:00:01Z",
          ladderStep: 2,
          tier: "plus",
          cards: 18,
          publicCards: 15,
          lastCardAt: "2026-11-09T00:00:00Z",
          bankedDays: 7,
          // 0202's columns alone: no reward facts to read.
          rewards: null,
        },
      ],
    });
  });

  it("reads 0206's reward facts: each side's recorded reward and detail, the attempts, the emails, the plan", () => {
    const [row] = parseReferredFriends([
      {
        ...raw,
        referrer_reward: "credits",
        referee_reward: "banked_days",
        referrer_reward_detail: { kind: "credits", credits: "5", step: 2 },
        referee_reward_detail: { kind: "banked_days", days: 7, entryId: "e1" },
        grant_attempts: "1",
        referee_email_confirmed: true,
        referrer_email_confirmed: false,
        referee_has_plan: true,
      },
    ]).rows;
    expect(row.rewards).toEqual({
      friend: { kind: "banked_days", days: 7, credits: null, step: null, reason: null, spent: false },
      referrer: { kind: "credits", days: null, credits: 5, step: 2, reason: null, spent: false },
      grantAttempts: 1,
      friendEmailConfirmed: true,
      referrerEmailConfirmed: false,
      friendHasPlan: true,
    });
  });

  it("a side still owed, a 'none' with its reason, and facts the database could not tell", () => {
    const [row] = parseReferredFriends([
      {
        ...raw,
        referrer_reward: null,
        referee_reward: "none",
        referrer_reward_detail: {},
        referee_reward_detail: { kind: "none", reason: "email_reused", preBankedEntryId: "e9", spent: true },
        grant_attempts: 0,
        referee_email_confirmed: null,
        referrer_email_confirmed: null,
        referee_has_plan: null,
      },
    ]).rows;
    expect(row.rewards).toEqual({
      friend: { kind: "none", days: null, credits: null, step: null, reason: "email_reused", spent: true },
      referrer: { kind: null, days: null, credits: null, step: null, reason: null, spent: false },
      grantAttempts: 0,
      friendEmailConfirmed: null,
      referrerEmailConfirmed: null,
      friendHasPlan: null,
    });
  });

  it("reads 0177's reward in 30-day units as days", () => {
    const [row] = parseReferredFriends([
      { ...raw, referrer_reward: "free_days", referee_reward: "free_days", referrer_reward_detail: { kind: "free_days", tier: "plus", units: 1 }, referee_reward_detail: { kind: "free_days", units: 2 } },
    ]).rows;
    expect(row.rewards?.referrer.days).toBe(30);
    expect(row.rewards?.friend.days).toBe(60);
  });

  it("a detail that is not an object reads as no detail, never a throw", () => {
    for (const detail of [null, "x", 7, ["days", 7]]) {
      const [row] = parseReferredFriends([{ ...raw, referrer_reward: "banked_days", referee_reward: "banked_days", referrer_reward_detail: detail, referee_reward_detail: detail }]).rows;
      expect(row.rewards?.friend).toEqual({ kind: "banked_days", days: null, credits: null, step: null, reason: null, spent: false });
    }
  });

  it("keeps a friend whose account is gone, with nothing of theirs", () => {
    const gone = { ...raw, referee_id: null, referee_username: null, referee_joined_at: null, referee_tier: null, referee_cards: 0, referee_public_cards: 0, referee_last_card_at: null, referee_banked_days: 0, status: "blocked", block_reason: "account_deleted", ladder_step: null };
    const [row] = parseReferredFriends([gone]).rows;
    expect(row).toMatchObject({ refereeId: null, refereeUsername: null, tier: null, cards: 0, bankedDays: 0, ladderStep: null, blockReason: "account_deleted" });
  });

  it("drops what is not a referral and never throws on a strange answer", () => {
    expect(parseReferredFriends(null)).toEqual({ rows: [], total: 0 });
    expect(parseReferredFriends({})).toEqual({ rows: [], total: 0 });
    expect(parseReferredFriends([null, "x", { referral_id: "r" }, { ...raw, referrer_id: null }]).rows).toEqual([]);
  });
});

describe("small readers", () => {
  it("rewardedOn is the reward's day only on a rewarded row", () => {
    expect(rewardedOn({ status: "rewarded", rewardedAt: "2026-11-03T00:00:00Z" })).toBe("2026-11-03T00:00:00Z");
    expect(rewardedOn({ status: "capped", rewardedAt: "2026-11-03T00:00:00Z" })).toBeNull();
    expect(rewardedOn({ status: "blocked", rewardedAt: "2026-11-03T00:00:00Z" })).toBeNull();
  });

  it("tierName names the plan, and nothing for an account that is gone", () => {
    expect([tierName("free"), tierName("plus"), tierName("pro"), tierName(null)]).toEqual(["Free", "Plus", "Pro", null]);
  });

  it("pageRangeText says which rows of how many", () => {
    const rows = Array.from({ length: 50 }, () => ({}) as never);
    expect(pageRangeText({ rows, total: 1240, page: 1, pageSize: 50 })).toBe("Showing 1–50 of 1,240");
    expect(pageRangeText({ rows: rows.slice(0, 7), total: 107, page: 3, pageSize: 50 })).toBe("Showing 101–107 of 107");
    expect(pageRangeText({ rows: [], total: 0, page: 1, pageSize: 50 })).toBeNull();
  });
});

describe("getReferralPeriodStats", () => {
  it("reads every row with any date since the previous period began — past PostgREST's 1,000-row page", async () => {
    const all = Array.from({ length: 2300 }, (_, i) => stamp({ signed_up_at: new Date(period.since.getTime() + i * 1000).toISOString() }));
    db.resolve = (_table, calls) => {
      const [from, to] = calls.find((c) => c.method === "range")!.args as [number, number];
      return { data: all.slice(from, Math.min(to + 1, from + 1000)) };
    };
    const stats = await getReferralPeriodStats(period);
    expect(stats?.current.signedUp).toBe(2300);
    const reads = db.tableCalls.filter((c) => c.table === "referrals");
    expect(reads.length).toBeGreaterThanOrEqual(3);
    const or = reads[0].calls.find((c) => c.method === "or")!.args[0] as string;
    const from = period.previousSince.toISOString();
    for (const column of ["signed_up_at", "cards_saved_at", "first_card_at", "card_on_file_at", "rewarded_at"]) {
      expect(or).toContain(`${column}.gte.${from}`);
    }
    // A stable order ending on the id, or pages could repeat or skip rows.
    expect(reads[0].calls.filter((c) => c.method === "order").map((c) => c.args[0])).toEqual(["signed_up_at", "id"]);
  });

  it("is null when a page fails — never the rows read so far as the whole", async () => {
    const log = vi.spyOn(console, "error").mockImplementation(() => {});
    db.resolve = (_table, calls) => {
      const [from] = calls.find((c) => c.method === "range")!.args as [number, number];
      return from === 0 ? { data: Array.from({ length: 1000 }, () => stamp({})) } : { data: null, error: { message: "statement timeout" } };
    };
    expect(await getReferralPeriodStats(period)).toBeNull();
    expect(log).toHaveBeenCalledWith(expect.stringContaining("referrals read failed"), "statement timeout");
    log.mockRestore();
  });
});

describe("getReferredFriends", () => {
  it("asks for one page of 50 at the page's offset", async () => {
    db.rpc = () => ({ data: [{ referral_id: "r1", referrer_id: "u", signed_up_at: "2026-11-01T00:00:00Z", total_count: 120 }] });
    const page = await getReferredFriends(3);
    expect(db.rpcCalls).toEqual([["admin_referred_friends", { p_limit: REFERRED_FRIENDS_PAGE_SIZE, p_offset: 100 }]]);
    expect(page).toMatchObject({ total: 120, page: 3, pageSize: 50 });
    expect(page?.rows).toHaveLength(1);
  });

  it("a page that is not a whole number from 1 up is page 1", async () => {
    await getReferredFriends(0);
    await getReferredFriends(Number.NaN);
    expect(db.rpcCalls.map(([, args]) => args.p_offset)).toEqual([0, 0]);
  });

  it("is null when the read fails", async () => {
    const log = vi.spyOn(console, "error").mockImplementation(() => {});
    db.rpc = () => ({ data: null, error: { message: "boom" } });
    expect(await getReferredFriends(1)).toBeNull();
    expect(log).toHaveBeenCalledWith(expect.stringContaining("admin_referred_friends failed"), "boom");
    log.mockRestore();
  });
});

describe("a viewer who is not an admin gets nothing — each read asks for itself", () => {
  it("getReferralPeriodStats and getReferredFriends are null, and no table or function is read", async () => {
    const log = vi.spyOn(console, "error").mockImplementation(() => {});
    db.admin = false;
    // A database that WOULD answer: nothing below may reach it.
    db.resolve = () => ({ data: [stamp({})] });
    db.rpc = () => ({ data: [{ referral_id: "r1", referrer_id: "u", signed_up_at: "2026-11-01T00:00:00Z", total_count: 1 }] });

    expect(await getReferralPeriodStats(period)).toBeNull();
    expect(await getReferredFriends(1)).toBeNull();
    expect(await getReferredFriends(3)).toBeNull();

    // each asked who the viewer is…
    expect(db.gate).toBe(3);
    // …and stopped there
    expect(db.tableCalls).toEqual([]);
    expect(db.rpcCalls).toEqual([]);
    // not a failed read: nothing to log
    expect(log).not.toHaveBeenCalled();
    log.mockRestore();
  });

  it("an admin's read asks who the viewer is once, before anything else", async () => {
    expect(await getReferralPeriodStats(period)).not.toBeNull();
    expect(db.gate).toBe(1);
    expect(await getReferredFriends(1)).not.toBeNull();
    expect(db.gate).toBe(2);
  });
});
