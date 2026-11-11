import { renderToStaticMarkup } from "react-dom/server";
import { beforeEach, describe, expect, it, vi } from "vitest";

// ---------------------------------------------------------------------------
// /admin/analytics — the Referrals tab as the admin reads it: the period's
// four numbers against the period before, friends per day with its table
// twin, WHO WAS REFERRED with their data (the owner's ask), the program's
// panel and settings under it — and an honest "couldn't load" per block.
// ---------------------------------------------------------------------------

vi.mock("next/link", () => ({
  default: ({ href, children, className }: { href: string; children: React.ReactNode; className?: string }) => (
    <a href={href} className={className}>
      {children}
    </a>
  ),
}));
// The settings form (a client component) reads the router for its refresh.
vi.mock("next/navigation", () => ({ useRouter: () => ({ refresh: () => {} }) }));

const reads = vi.hoisted(() => ({
  stats: vi.fn(),
  friends: vi.fn(),
  summary: vi.fn(),
  settings: vi.fn(),
  revalidated: [] as string[],
  upsert: vi.fn(async () => ({ error: null })),
}));

vi.mock("@/lib/admin/analytics/referrals", async (original) => ({
  ...(await original<typeof import("@/lib/admin/analytics/referrals")>()),
  getReferralPeriodStats: reads.stats,
  getReferredFriends: reads.friends,
}));
vi.mock("@/lib/admin/referral-queries", async (original) => ({
  ...(await original<typeof import("@/lib/admin/referral-queries")>()),
  getReferralStats: reads.summary,
}));
vi.mock("@/lib/referrals/settings-server", () => ({ readReferralSettings: reads.settings }));
vi.mock("@/lib/supabase/admin", () => ({
  isAdminConfigured: () => true,
  createAdminClient: () => ({ from: () => ({ upsert: reads.upsert }) }),
}));
vi.mock("@/lib/supabase/server", () => ({ getCurrentProfile: async () => ({ id: "admin-1", is_admin: true }) }));
vi.mock("next/cache", () => ({ revalidatePath: (path: string) => void reads.revalidated.push(path) }));

import { ReferralsTab, ReferralsTabView } from "@/components/admin/analytics/tabs/referrals-tab";
import { ReferredFriendsTable } from "@/components/admin/analytics/referred-friends-table";
import { analyticsPeriod, type AnalyticsParams } from "@/lib/admin/analytics/params";
import { buildReferralPeriodStats, type ReferredFriend, type ReferredFriendsPage } from "@/lib/admin/analytics/referrals";
import { parseReferralStats } from "@/lib/admin/referral-queries";
import { adminSaveReferralSettingsAction } from "@/lib/admin/referral-settings-actions";
import { DEFAULT_REFERRAL_SETTINGS } from "@/lib/referrals/settings";

const html = (node: React.ReactElement) => renderToStaticMarkup(node);
const params: AnalyticsParams = { tab: "referrals", days: 30, admins: false, tool: null, user: null, page: 1 };
const period = analyticsPeriod(30, new Date("2026-11-10T15:00:00Z"));

const friend = (over: Partial<ReferredFriend>): ReferredFriend => ({
  referralId: "r1",
  refereeId: "11111111-1111-4111-8111-111111111111",
  refereeUsername: "ember_sphinx",
  refereeJoinedAt: "2026-11-02T08:00:00Z",
  referrerId: "22222222-2222-4222-8222-222222222222",
  referrerUsername: "dev_pro",
  signedUpAt: "2026-11-02T08:05:00Z",
  status: "rewarded",
  blockReason: null,
  cardsSavedAt: "2026-11-03T00:00:00Z",
  cardOnFileAt: "2026-11-04T00:00:00Z",
  rewardedAt: "2026-11-04T00:00:01Z",
  ladderStep: 1,
  tier: "plus",
  cards: 1218,
  publicCards: 15,
  lastCardAt: "2026-11-09T00:00:00Z",
  bankedDays: 7,
  ...over,
});

const pageOf = (rows: ReferredFriend[], over: Partial<ReferredFriendsPage> = {}): ReferredFriendsPage => ({ rows, total: rows.length, page: 1, pageSize: 50, ...over });

const stats = buildReferralPeriodStats(
  [
    { status: "rewarded", signed_up_at: "2026-11-02T08:05:00Z", first_card_at: null, cards_saved_at: "2026-11-03T00:00:00Z", card_on_file_at: "2026-11-04T00:00:00Z", rewarded_at: "2026-11-04T00:00:01Z" },
    { status: "signed_up", signed_up_at: "2026-11-02T09:00:00Z", first_card_at: null, cards_saved_at: null, card_on_file_at: null, rewarded_at: null },
    { status: "signed_up", signed_up_at: "2026-11-09T09:00:00Z", first_card_at: null, cards_saved_at: null, card_on_file_at: null, rewarded_at: null },
    { status: "signed_up", signed_up_at: "2026-10-01T09:00:00Z", first_card_at: null, cards_saved_at: null, card_on_file_at: null, rewarded_at: null },
  ],
  period,
);
const summary = { last30: parseReferralStats({ signedUp: 3 }), allTime: parseReferralStats({ signedUp: 4 }) };

beforeEach(() => {
  reads.stats.mockReset().mockResolvedValue(stats);
  reads.friends.mockReset().mockResolvedValue(pageOf([friend({})]));
  reads.summary.mockReset().mockResolvedValue(summary);
  reads.settings.mockReset().mockResolvedValue(DEFAULT_REFERRAL_SETTINGS);
  reads.revalidated = [];
  reads.upsert.mockClear();
});

describe("ReferredFriendsTable", () => {
  const rows = [
    friend({}),
    friend({ referralId: "r2", refereeId: null, refereeUsername: null, refereeJoinedAt: null, tier: null, cards: 0, publicCards: 0, lastCardAt: null, bankedDays: 0, status: "blocked", blockReason: "account_deleted", cardOnFileAt: null, rewardedAt: "2026-11-05T00:00:00Z", signedUpAt: "2026-10-20T00:00:00Z" }),
    friend({ referralId: "r3", refereeId: "33333333-3333-4333-8333-333333333333", refereeUsername: "new_friend", status: "signed_up", cardsSavedAt: null, cardOnFileAt: null, rewardedAt: null, tier: "free", cards: 0, publicCards: 0, lastCardAt: null, bankedDays: 0, ladderStep: null }),
  ];
  const out = html(<ReferredFriendsTable page={pageOf(rows, { total: 3 })} params={params} cardsRequired={5} />);
  /** The table row that holds `text` (its markup up to the row's end). */
  const rowOf = (text: string) => out.split("</tr>").find((row) => row.includes(text)) ?? "";

  it("names every column the owner asked for", () => {
    for (const heading of ["Friend", "Referred by", "Joined", "Where they are", "Cards", "Last card", "Plan", "Card on file", "Rewarded", "Days banked"]) {
      expect(out).toContain(`>${heading}</th>`);
    }
    expect(out).toMatch(/<caption[^>]*>Referred friends, newest referral first<\/caption>/);
  });

  it("links the friend and the referrer to their admin pages", () => {
    expect(out).toContain('href="/admin/users?u=11111111-1111-4111-8111-111111111111"');
    expect(out).toContain("@ember_sphinx");
    expect(out).toContain('href="/admin/users?u=22222222-2222-4222-8222-222222222222"');
    expect(out).toContain("@dev_pro");
  });

  it("shows the friend's data: where they are, cards (all and public), last card, plan, the dates and the days banked", () => {
    const row = rowOf("@ember_sphinx");
    expect(row).toContain("Rewarded");
    expect(row).toContain("1,218 · 15 public");
    expect(row).toContain("Nov 9, 2026 UTC"); // last card
    expect(row).toContain("Plus");
    expect(row).toContain("Nov 2, 2026 UTC"); // joined
    expect(row.match(/Nov 4, 2026 UTC/g)).toHaveLength(2); // card on file + rewarded
    expect(row).toMatch(/>7<\/td>/);
  });

  it("keeps a friend whose account is gone: no link, no made-up numbers, the reason in plain words", () => {
    const row = rowOf("Account deleted");
    expect(row).toContain("Blocked: friend&#x27;s account deleted");
    expect(row).toContain("Oct 20, 2026 UTC"); // the referral's own date stands in for "Joined"
    expect(row.match(/@dev_pro/g)).toHaveLength(1);
    expect(row.match(/href=/g)).toHaveLength(1);
    // A blocked row's settle date is not a reward.
    expect(row).not.toContain("Nov 5, 2026");
    expect(row).not.toMatch(/N\/A|null|undefined|NaN/);
  });

  it("a friend who only signed up reads so, with dashes where nothing happened yet", () => {
    const row = rowOf("@new_friend");
    expect(row).toContain("Signed up");
    expect(row).toContain("0 · 0 public");
    expect(row).toContain("Free");
    expect(row.match(/>—<\/td>/g)).toHaveLength(3); // last card, card on file, rewarded
  });

  it("says which rows of how many, with no pager when one page holds them all", () => {
    expect(out).toContain("Showing 1–3 of 3");
    expect(out).not.toContain(">Previous<");
    expect(out).not.toContain(">Next<");
  });

  it("pages with links that keep the tab and the period", () => {
    const fifty = Array.from({ length: 50 }, (_, i) => friend({ referralId: `r${i}` }));
    const first = html(<ReferredFriendsTable page={pageOf(fifty, { total: 120 })} params={{ ...params, days: 90 }} />);
    expect(first).toContain("Showing 1–50 of 120");
    expect(first).toContain('href="/admin/analytics?tab=referrals&amp;days=90&amp;page=2"');
    expect(first).not.toContain(">Previous<");

    const middle = html(<ReferredFriendsTable page={pageOf(fifty, { total: 120, page: 2 })} params={{ ...params, page: 2 }} />);
    expect(middle).toContain("Showing 51–100 of 120");
    expect(middle).toContain('href="/admin/analytics?tab=referrals"'); // Previous = page 1, the plain address
    expect(middle).toContain('href="/admin/analytics?tab=referrals&amp;page=3"');

    const last = html(<ReferredFriendsTable page={pageOf(fifty.slice(0, 20), { total: 120, page: 3 })} params={{ ...params, page: 3 }} />);
    expect(last).toContain("Showing 101–120 of 120");
    expect(last).toContain(">Previous<");
    expect(last).not.toContain(">Next<");
  });

  it("says so when nobody was referred yet, and offers the way back from a page past the end", () => {
    expect(html(<ReferredFriendsTable page={pageOf([], { total: 0 })} params={params} />)).toContain("Nobody has joined through a referral link yet.");
    const past = html(<ReferredFriendsTable page={pageOf([], { total: 0, page: 9 })} params={{ ...params, page: 9 }} />);
    expect(past).toContain("There are no referrals on this page.");
    expect(past).toContain('href="/admin/analytics?tab=referrals"');
  });
});

describe("ReferralsTabView", () => {
  const out = html(<ReferralsTabView params={params} stats={stats} friends={pageOf([friend({})])} summary={summary} settings={DEFAULT_REFERRAL_SETTINGS} />);

  it("leads with the period's four numbers, each against the period before", () => {
    const tiles = [...out.matchAll(/<dt[^>]*>([^<]*)<\/dt><dd[^>]*>([^<]*)<\/dd>/g)].map((m) => [m[1], m[2]]);
    expect(tiles).toEqual([
      ["Friends referred", "3"],
      ["Saved their 5 cards", "1"],
      ["Card on file", "1"],
      ["Rewarded", "1"],
    ]);
    expect(out.match(/vs the previous 30 days/g)).toHaveLength(4);
    expect(out).toContain("Referrals in the last 30 days");
  });

  it("charts friends per day in the one chart hue, with a table twin holding the same numbers", () => {
    expect(out).toContain("Friends referred per day");
    expect(out).toMatch(/2 friends<\/p><p[^>]*>Nov 2/);
    expect(out).toMatch(/<caption[^>]*>Friends referred per day<\/caption>/);
    expect(out).not.toMatch(/bg-chart-2/);
  });

  it("then who was referred, then the program's panel with its settings", () => {
    const friends = out.indexOf("Referred friends");
    const panel = out.indexOf("Referrals and the days bank");
    const settings = out.indexOf("Program settings");
    expect(out.indexOf("Friends referred per day")).toBeLessThan(friends);
    expect(friends).toBeGreaterThan(-1);
    expect(friends).toBeLessThan(panel);
    expect(panel).toBeLessThan(settings);
    expect(out).toContain("@ember_sphinx");
  });

  it("speaks of free days, never a free month, and of the settings' own bar", () => {
    expect(out).not.toMatch(/free month/i);
    const custom = html(
      <ReferralsTabView
        params={params}
        stats={stats}
        friends={pageOf([friend({ status: "cards_saved" })])}
        summary={summary}
        settings={{ ...DEFAULT_REFERRAL_SETTINGS, activation: { cardsRequired: 3, windowDays: 14 } }}
      />,
    );
    expect(custom).toContain("Saved their 3 cards");
    expect(custom).toContain("has saved 3 cards within 14 days of joining");
    expect(custom).toContain("Saved 3 cards");
  });

  it("a read that failed says so for its own block and leaves the rest standing", () => {
    const noStats = html(<ReferralsTabView params={params} stats={null} friends={pageOf([friend({})])} summary={summary} />);
    expect(noStats).toContain("load the period&#x27;s referral numbers");
    expect(noStats).not.toContain("Friends referred per day");
    expect(noStats).toContain("@ember_sphinx");

    const noFriends = html(<ReferralsTabView params={params} stats={stats} friends={null} summary={summary} />);
    expect(noFriends).toContain("load the referred friends");
    expect(noFriends).not.toContain("Nobody has joined");
    expect(noFriends).toContain("Referrals and the days bank");

    const noSummary = html(<ReferralsTabView params={params} stats={stats} friends={pageOf([])} summary={null} />);
    expect(noSummary).toContain("load the referral program&#x27;s totals and settings");
    expect(noSummary).not.toContain("Program settings");
    expect(noSummary.match(/data-testid="admin-load-error"/g)).toHaveLength(1);
  });
});

describe("ReferralsTab", () => {
  it("reads the page's period and table page, and renders what it read", async () => {
    const out = html(await ReferralsTab({ params: { ...params, days: 7, page: 2 } }));
    expect(reads.stats).toHaveBeenCalledTimes(1);
    expect(reads.stats.mock.calls[0][0]).toMatchObject({ days: 7 });
    expect(reads.friends).toHaveBeenCalledWith(2);
    expect(reads.summary).toHaveBeenCalledTimes(1);
    expect(out).toContain("Referrals in the last 7 days");
    expect(out).toContain("Program settings");
  });

  it("is a page of load errors, not a crash, when every read fails", async () => {
    reads.stats.mockResolvedValue(null);
    reads.friends.mockResolvedValue(null);
    reads.summary.mockResolvedValue(null);
    const out = html(await ReferralsTab({ params }));
    expect(out.match(/data-testid="admin-load-error"/g)).toHaveLength(3);
  });
});

describe("the settings form's save", () => {
  it("refreshes the Referrals tab's page (where the form lives now) and the user's referral page", async () => {
    const result = await adminSaveReferralSettingsAction(DEFAULT_REFERRAL_SETTINGS);
    expect(result).toMatchObject({ ok: true });
    expect(reads.upsert).toHaveBeenCalledTimes(1);
    expect(reads.revalidated).toEqual(["/admin/analytics", "/dashboard/referrals"]);
  });
});
