import { renderToStaticMarkup } from "react-dom/server";
import { beforeEach, describe, expect, it, vi } from "vitest";

// ---------------------------------------------------------------------------
// /admin/analytics — the Referrals tab as the admin reads it: the period's
// four numbers against the period before (friends referred, saved the
// cards, rewarded — then "Started a plan", what came of the referral and no
// step toward its reward since 2026-11-11), friends per day with its table
// twin, WHO WAS REFERRED with their data (the owner's ask) and what each
// side was given or why it has nothing yet (the owner's second ask), the
// program's panel and settings under it — and an honest "couldn't load" per
// block.
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
import { buildReferralPeriodStats, type ReferredFriend, type ReferredFriendsPage, type RewardSideFacts } from "@/lib/admin/analytics/referrals";
import type { RewardContext } from "@/lib/admin/analytics/referral-rewards";
import { parseReferralStats } from "@/lib/admin/referral-queries";
import { adminSaveReferralSettingsAction } from "@/lib/admin/referral-settings-actions";
import { DEFAULT_REFERRAL_SETTINGS } from "@/lib/referrals/settings";

const html = (node: React.ReactElement) => renderToStaticMarkup(node);
const params: AnalyticsParams = { tab: "referrals", days: 30, admins: false, tool: null, user: null, page: 1 };
const period = analyticsPeriod(30, new Date("2026-11-10T15:00:00Z"));

/** The program as it runs: 5 cards in 30 days, everything switched on. */
const rewardContext: RewardContext = {
  cardsRequired: 5,
  windowDays: 30,
  programEnabled: true,
  billingEnabled: true,
  hashKeySet: true,
  now: new Date("2026-11-10T15:00:00Z"),
};

const side = (over: Partial<RewardSideFacts> = {}): RewardSideFacts => ({ kind: null, days: null, credits: null, step: null, reason: null, ...over });
/** A row's reward facts: both sides still owed, both emails confirmed. */
const owed = (over: Partial<NonNullable<ReferredFriend["rewards"]>> = {}): NonNullable<ReferredFriend["rewards"]> => ({
  friend: side(),
  referrer: side(),
  grantAttempts: 0,
  friendEmailConfirmed: true,
  referrerEmailConfirmed: true,
  friendHasPlan: false,
  friendQualifyingCards: 0,
  ...over,
});

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
  rewards: owed({ friend: side({ kind: "banked_days", days: 7 }), referrer: side({ kind: "banked_days", days: 7, step: 1 }), friendHasPlan: true }),
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
    friend({ referralId: "r2", refereeId: null, refereeUsername: null, refereeJoinedAt: null, tier: null, cards: 0, publicCards: 0, lastCardAt: null, bankedDays: 0, status: "blocked", blockReason: "account_deleted", cardOnFileAt: null, rewardedAt: "2026-11-05T00:00:00Z", signedUpAt: "2026-10-20T00:00:00Z", rewards: owed({ friend: side({ kind: "none", reason: "account_deleted" }), referrer: side({ kind: "none" }), friendEmailConfirmed: null, friendHasPlan: null }) }),
    friend({ referralId: "r3", refereeId: "33333333-3333-4333-8333-333333333333", refereeUsername: "new_friend", status: "signed_up", cardsSavedAt: null, cardOnFileAt: null, rewardedAt: null, tier: "free", cards: 0, publicCards: 0, lastCardAt: null, bankedDays: 0, ladderStep: null, rewards: owed() }),
  ];
  const out = html(<ReferredFriendsTable page={pageOf(rows, { total: 3 })} params={params} rewardContext={rewardContext} />);
  /** The table row that holds `text` (its markup up to the row's end). */
  const rowOf = (text: string) => out.split("</tr>").find((row) => row.includes(text)) ?? "";

  it("names every column the owner asked for", () => {
    const headings = [...out.matchAll(/<th[^>]*>([^<]*)<\/th>/g)].map((m) => m[1]);
    expect(headings).toEqual(["Friend", "Referred by", "Joined", "Where they are", "Rewards", "Cards", "Last card", "Plan", "Started a plan", "Rewarded", "Days banked"]);
    // The plan's date is what came of the referral: it is not headed as a
    // condition ("Card on file") any more.
    expect(out).not.toContain("Card on file");
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
    expect(row.match(/Nov 4, 2026 UTC/g)).toHaveLength(2); // started a plan + rewarded
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
    expect(row.match(/>—<\/td>/g)).toHaveLength(3); // last card, started a plan, rewarded
  });

  it("Rewards says what each side was given on a rewarded row", () => {
    const row = rowOf("@ember_sphinx");
    expect(row).toContain("Friend:</span> 7 free days");
    expect(row).toContain("Referrer:</span> 7 free days (ladder step 1)");
    expect(row).not.toContain("Both sides");
  });

  it("Rewards says why nobody has a reward yet — once, for both sides, and it is the cards alone", () => {
    const row = rowOf("@new_friend");
    // The whole line: the cards, and no plan after them.
    expect(row).toContain("Both sides:</span> not yet — the friend has saved 0 of 5 cards (until Dec 2, 2026 UTC)</li>");
    expect(row).not.toMatch(/plan with a card on file|card on file|checkout/);
    expect(row).not.toContain("Friend:</span>");
    expect(row).not.toContain("Referrer:</span>");
  });

  it("Rewards counts the cards with artwork, and says how many of the friend's cards do not count", () => {
    const some = html(
      <ReferredFriendsTable
        page={pageOf([
          friend({ referralId: "r4", refereeUsername: "half_art", status: "signed_up", cardsSavedAt: null, cardOnFileAt: null, rewardedAt: null, tier: "free", cards: 5, publicCards: 0, bankedDays: 0, ladderStep: null, rewards: owed({ friendQualifyingCards: 3 }) }),
          friend({ referralId: "r5", refereeUsername: "one_short", status: "signed_up", cardsSavedAt: null, cardOnFileAt: null, rewardedAt: null, tier: "free", cards: 5, publicCards: 0, bankedDays: 0, ladderStep: null, rewards: owed({ friendQualifyingCards: 4 }) }),
        ])}
        params={params}
        rewardContext={rewardContext}
      />,
    );
    const rowIn = (text: string) => some.split("</tr>").find((row) => row.includes(text)) ?? "";
    expect(rowIn("@half_art")).toContain(
      "Both sides:</span> not yet — the friend has saved 3 of 5 cards (until Dec 2, 2026 UTC); 2 cards more have no artwork and do not count</li>",
    );
    expect(rowIn("@one_short")).toContain(
      "Both sides:</span> not yet — the friend has saved 4 of 5 cards (until Dec 2, 2026 UTC); 1 card more has no artwork and does not count</li>",
    );
    // The Cards column still counts every card the friend has.
    expect(rowIn("@half_art")).toContain("5 · 0 public");
  });

  it("a friend whose cards are saved and who never started a plan is waiting for nothing but the hourly check", () => {
    const qualified = friend({
      referralId: "r6",
      refereeUsername: "cards_only",
      status: "cards_saved",
      cardsSavedAt: "2026-11-10T14:30:00Z", // half an hour before the page was read
      cardOnFileAt: null,
      rewardedAt: null,
      tier: "free",
      cards: 5,
      bankedDays: 0,
      ladderStep: null,
      rewards: owed({ friendQualifyingCards: 5 }),
    });
    const row = html(<ReferredFriendsTable page={pageOf([qualified])} params={params} rewardContext={rewardContext} />)
      .split("</tr>")
      .find((r) => r.includes("@cards_only"))!;
    expect(row).toContain("Saved 5 cards");
    expect(row).toContain("Both sides:</span> not yet — everything is in place; the hourly check gives the reward</li>");
    expect(row).not.toMatch(/plan with a card on file|card on file/);
    // "Started a plan" and "Rewarded" are both still a dash.
    expect(row.match(/>—<\/td>/g)).toHaveLength(2);
  });

  it("Rewards says why a blocked referral gave nothing", () => {
    expect(rowOf("Account deleted")).toContain("Both sides:</span> none — the friend&#x27;s account was deleted");
  });

  it("Rewards is a dash on a database that has no reward facts yet (the app deployed before 0206)", () => {
    const before = html(<ReferredFriendsTable page={pageOf([friend({ rewards: null })])} params={params} rewardContext={rewardContext} />);
    expect(before).not.toContain("referral-rewards");
    expect(before).not.toMatch(/not yet|Both sides|Friend:<\/span>/);
    expect(before).toContain(">Rewards</th>");
  });

  it("says which rows of how many, with no pager when one page holds them all", () => {
    expect(out).toContain("Showing 1–3 of 3");
    expect(out).not.toContain(">Previous<");
    expect(out).not.toContain(">Next<");
  });

  it("pages with links that keep the tab and the period", () => {
    const fifty = Array.from({ length: 50 }, (_, i) => friend({ referralId: `r${i}` }));
    const first = html(<ReferredFriendsTable page={pageOf(fifty, { total: 120 })} params={{ ...params, days: 90 }} rewardContext={rewardContext} />);
    expect(first).toContain("Showing 1–50 of 120");
    expect(first).toContain('href="/admin/analytics?tab=referrals&amp;days=90&amp;page=2"');
    expect(first).not.toContain(">Previous<");

    const middle = html(<ReferredFriendsTable page={pageOf(fifty, { total: 120, page: 2 })} params={{ ...params, page: 2 }} rewardContext={rewardContext} />);
    expect(middle).toContain("Showing 51–100 of 120");
    expect(middle).toContain('href="/admin/analytics?tab=referrals"'); // Previous = page 1, the plain address
    expect(middle).toContain('href="/admin/analytics?tab=referrals&amp;page=3"');

    const last = html(<ReferredFriendsTable page={pageOf(fifty.slice(0, 20), { total: 120, page: 3 })} params={{ ...params, page: 3 }} rewardContext={rewardContext} />);
    expect(last).toContain("Showing 101–120 of 120");
    expect(last).toContain(">Previous<");
    expect(last).not.toContain(">Next<");
  });

  it("says so when nobody was referred yet, and offers the way back from a page past the end", () => {
    expect(html(<ReferredFriendsTable page={pageOf([], { total: 0 })} params={params} rewardContext={rewardContext} />)).toContain("Nobody has joined through a referral link yet.");
    const past = html(<ReferredFriendsTable page={pageOf([], { total: 0, page: 9 })} params={{ ...params, page: 9 }} rewardContext={rewardContext} />);
    expect(past).toContain("There are no referrals on this page.");
    expect(past).toContain('href="/admin/analytics?tab=referrals"');
  });
});

describe("ReferralsTabView", () => {
  const out = html(<ReferralsTabView params={params} stats={stats} friends={pageOf([friend({})])} summary={summary} settings={DEFAULT_REFERRAL_SETTINGS} />);

  it("leads with the period's four numbers, each against the period before", () => {
    const tiles = [...out.matchAll(/<dt[^>]*>([^<]*)<\/dt><dd[^>]*>([^<]*)<\/dd>/g)].map((m) => [m[1], m[2]]);
    // The reward's own steps first; the plan last — it is what came of the
    // referral, not a step toward its reward.
    expect(tiles).toEqual([
      ["Friends referred", "3"],
      ["Saved their 5 cards", "1"],
      ["Rewarded", "1"],
      ["Started a plan", "1"],
    ]);
    expect(out.match(/vs the previous 30 days/g)).toHaveLength(4);
    expect(out).toContain("Referrals in the last 30 days");
  });

  it("each number says what it counts: the cards carry artwork, and the plan is not needed for the reward", () => {
    /** A tile's last line (its hint), by its label. */
    const hintOf = (label: string) => {
      const tile = out.slice(out.indexOf(`>${label}</dt>`));
      const lines = [...tile.slice(0, tile.indexOf("</div>")).matchAll(/<dd class="text-xs text-subtle">([^<]*)<\/dd>/g)].map((m) => m[1]);
      return lines.at(-1);
    };
    expect(hintOf("Friends referred")).toBe("Signed up through a link");
    expect(hintOf("Saved their 5 cards")).toBe("With artwork, within 30 days of joining");
    expect(hintOf("Rewarded")).toBe("Both sides got their reward");
    expect(hintOf("Started a plan")).toBe("Became a subscriber — not needed for the reward");
  });

  it("says the rule above the numbers: the cards with artwork, and no plan", () => {
    expect(out).toContain(
      "A referral rewards both sides once the friend has saved 5 cards with artwork within 30 days of joining. No plan is needed for the reward; &quot;Started a plan&quot; counts the friends who went on to subscribe. Each number counts the friends who reached that point in the period, whenever they joined.",
    );
    // Nothing above the per-day chart makes a card on file a condition.
    const numbers = out.slice(0, out.indexOf("Friends referred per day"));
    expect(numbers).not.toMatch(/card on file/i);
    expect(numbers).not.toContain("and started a plan");
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
    expect(custom).toContain("has saved 3 cards with artwork within 14 days of joining");
    expect(custom).toContain("With artwork, within 14 days of joining");
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
