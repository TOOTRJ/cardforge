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
import { formatCount } from "@/lib/admin/analytics/series";
import { getReferralStats, type ReferralStatsSummary } from "@/lib/admin/referral-queries";
import { DEFAULT_REFERRAL_SETTINGS, type ReferralSettings } from "@/lib/referrals/settings";
import { readReferralSettings } from "@/lib/referrals/settings-server";
import { createAdminClient } from "@/lib/supabase/admin";

// ---------------------------------------------------------------------------
// /admin/analytics — the Referrals tab. Top to bottom:
//   1. the period's four numbers against the period before: friends
//      referred, saved the cards, card on file, rewarded — each counted by
//      its own date;
//   2. friends referred per day;
//   3. WHO WAS REFERRED, with their data (owner 2026-11-10) — a page of 50;
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
  return <ReferralsTabView params={params} stats={stats} friends={friends} summary={summary} settings={settings} />;
}

/** The tab's markup, from data already read (null = that read failed). */
export function ReferralsTabView({
  params,
  stats,
  friends,
  summary,
  settings = DEFAULT_REFERRAL_SETTINGS,
}: {
  params: AnalyticsParams;
  stats: ReferralPeriodStats | null;
  friends: ReferredFriendsPage | null;
  summary: ReferralStatsSummary | null;
  settings?: ReferralSettings;
}) {
  const { cardsRequired, windowDays } = settings.activation;
  const cards = `${cardsRequired} ${cardsRequired === 1 ? "card" : "cards"}`;
  const before = previousPeriodLabel(params.days);
  return (
    <div className="flex flex-col gap-6">
      <Section
        title={`Referrals in ${periodLabel(params.days)}`}
        description={`A referral rewards both sides once the friend has saved ${cards} within ${windowDays} days of joining and started a plan with a card on file. Each number counts the friends who reached that step in the period, whenever they joined.`}
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
              hint={`Within ${windowDays} days of joining`}
            />
            <KpiTile
              label="Card on file"
              value={formatCount(stats.current.cardOnFile)}
              current={stats.current.cardOnFile}
              previous={stats.previous.cardOnFile}
              previousLabel={before}
              hint="Started a plan"
            />
            <KpiTile
              label="Rewarded"
              value={formatCount(stats.current.rewarded)}
              current={stats.current.rewarded}
              previous={stats.previous.rewarded}
              previousLabel={before}
              hint="Both sides got their reward"
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
        description="Everyone who joined through a referral link, newest first, with what they have done since. This list covers all time, whatever period is picked above. Dates are UTC."
      >
        {friends ? (
          <ReferredFriendsTable page={friends} params={params} cardsRequired={cardsRequired} />
        ) : (
          <AdminLoadError what="the referred friends" />
        )}
      </TablePanel>

      {summary ? <ReferralPanel summary={summary} settings={settings} /> : <AdminLoadError what="the referral program's totals and settings" />}
    </div>
  );
}
