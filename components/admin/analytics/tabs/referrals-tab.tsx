import { AdminLoadError } from "@/components/admin/admin-load-error";
import { ChartCard, DailyColumns, DailyTable, KpiRow, KpiTile, Section, TablePanel } from "@/components/admin/analytics/charts";
import { ReferredFriendsTable } from "@/components/admin/analytics/referred-friends-table";
import { ReferralPanel } from "@/components/admin/referral-panel";
import { analyticsPeriod, periodLabel, previousPeriodLabel, type AnalyticsParams } from "@/lib/admin/analytics/params";
import {
  getReferralPeriodStats,
  getReferredFriends,
  type ReferralPeriodStats,
  type ReferredFriendsPage,
} from "@/lib/admin/analytics/referrals";
import type { RewardContext } from "@/lib/admin/analytics/referral-rewards";
import { formatCount } from "@/lib/admin/analytics/series";
import { getReferralStats, type ReferralStatsSummary } from "@/lib/admin/referral-queries";
import { DEFAULT_REFERRAL_SETTINGS, type ReferralSettings } from "@/lib/referrals/settings";
import { readReferralSettings } from "@/lib/referrals/settings-server";
import { referralEmailHashKey } from "@/lib/referrals/email-fingerprint";
import { isBillingEnabled } from "@/lib/billing/flags";
import { createAdminClient } from "@/lib/supabase/admin";

// ---------------------------------------------------------------------------
// /admin/analytics — the Referrals tab. Top to bottom:
//   1. the period's four numbers against the period before: friends
//      referred, saved the cards, rewarded — and started a plan, which is
//      what came of the referral, not a step toward its reward (owner
//      2026-11-11) — each counted by its own date;
//   2. friends referred per day;
//   3. WHO WAS REFERRED, with their data (owner 2026-11-10) — a page of 50,
//      each row saying what both sides were given or why a side has
//      nothing yet (owner 2026-11-11);
//   4. the program's panel as it stood on the Users page (the chain over 30
//      days and all time, top referrers, the days bank) and its settings.
// A referral is a referral whoever made it: this tab has no "Include
// admins" switch. A block whose read failed says so; the rest still shows.
// ---------------------------------------------------------------------------

export async function ReferralsTab({ params }: { params: AnalyticsParams }) {
  const period = analyticsPeriod(params.days);
  const [stats, friends, summary, settings] = await Promise.all([
    getReferralPeriodStats(period),
    getReferredFriends(params.page),
    getReferralStats(),
    readReferralSettings(createAdminClient()),
  ]);
  return (
    <ReferralsTabView
      params={params}
      stats={stats}
      friends={friends}
      summary={summary}
      settings={settings}
      // What the reward step checks beside the settings: read here, on the
      // server, so the reasons name the switch that is really off.
      server={{ billingEnabled: isBillingEnabled(), hashKeySet: referralEmailHashKey() !== null, now: new Date() }}
    />
  );
}

/** The server's side of a reward's conditions (the settings are the rest). */
export type ReferralServerState = Pick<RewardContext, "billingEnabled" | "hashKeySet" | "now">;

/** The tab's markup, from data already read (null = that read failed). */
export function ReferralsTabView({
  params,
  stats,
  friends,
  summary,
  settings = DEFAULT_REFERRAL_SETTINGS,
  server,
}: {
  params: AnalyticsParams;
  stats: ReferralPeriodStats | null;
  friends: ReferredFriendsPage | null;
  summary: ReferralStatsSummary | null;
  settings?: ReferralSettings;
  /** Absent = everything on, now (a test of the markup). */
  server?: ReferralServerState;
}) {
  const { cardsRequired, windowDays } = settings.activation;
  const rewardContext: RewardContext = {
    cardsRequired,
    windowDays,
    programEnabled: settings.enabled,
    billingEnabled: server?.billingEnabled ?? true,
    hashKeySet: server?.hashKeySet ?? true,
    now: server?.now ?? new Date(),
  };
  const cards = `${cardsRequired} ${cardsRequired === 1 ? "card" : "cards"}`;
  const before = previousPeriodLabel(params.days);
  return (
    <div className="flex flex-col gap-6">
      <Section
        title={`Referrals in ${periodLabel(params.days)}`}
        description={`A referral rewards both sides once the friend has saved ${cards}, each with its own artwork, within ${windowDays} days of joining. No plan is needed for the reward; "Started a plan" counts the friends who went on to subscribe. Each number counts the friends who reached that point in the period, whenever they joined.`}
      >
        {stats ? (
          <KpiRow className="md:grid-cols-4 xl:grid-cols-4">
            <KpiTile
              label="Friends referred"
              value={formatCount(stats.current.signedUp)}
              current={stats.current.signedUp}
              previous={stats.previous.signedUp}
              previousLabel={before}
              hint="Signed up through a link"
            />
            <KpiTile
              label={`Saved their ${cards}`}
              value={formatCount(stats.current.cardsSaved)}
              current={stats.current.cardsSaved}
              previous={stats.previous.cardsSaved}
              previousLabel={before}
              hint={`Each with its own artwork, within ${windowDays} days of joining`}
            />
            <KpiTile
              label="Rewarded"
              value={formatCount(stats.current.rewarded)}
              current={stats.current.rewarded}
              previous={stats.previous.rewarded}
              previousLabel={before}
              hint="Both sides got their reward"
            />
            <KpiTile
              label="Started a plan"
              value={formatCount(stats.current.cardOnFile)}
              current={stats.current.cardOnFile}
              previous={stats.previous.cardOnFile}
              previousLabel={before}
              hint="Became a subscriber — not needed for the reward"
            />
          </KpiRow>
        ) : (
          <AdminLoadError what="the period's referral numbers" />
        )}
      </Section>

      {stats ? (
        <ChartCard
          title="Friends referred per day"
          description={`People who joined through a referral link, by UTC day, in ${periodLabel(params.days)}.`}
          chart={<DailyColumns points={stats.perDay} unit={["friend", "friends"]} />}
          table={<DailyTable points={stats.perDay} caption="Friends referred per day" column="Friends" />}
        />
      ) : null}

      <TablePanel
        title="Referred friends"
        description="Everyone who joined through a referral link, newest first, with what they have done since. Rewards says what each side was given, or why a side has nothing yet. This list covers all time, whatever period is picked above. Dates are UTC."
      >
        {friends ? (
          <ReferredFriendsTable page={friends} params={params} rewardContext={rewardContext} />
        ) : (
          <AdminLoadError what="the referred friends" />
        )}
      </TablePanel>

      {summary ? <ReferralPanel summary={summary} settings={settings} /> : <AdminLoadError what="the referral program's totals and settings" />}
    </div>
  );
}
