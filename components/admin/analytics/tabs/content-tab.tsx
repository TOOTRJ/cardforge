import Link from "next/link";
import { AdminLoadError } from "@/components/admin/admin-load-error";
import {
  ChartCard,
  DailyColumns,
  DailyTable,
  EmptyNote,
  KpiRow,
  KpiTile,
  RankedBars,
  RankedTable,
  Section,
  TablePanel,
  type RankedRow,
} from "@/components/admin/analytics/charts";
import { ListTable, PersonLink } from "@/components/admin/analytics/list-table";
import { getContentStats, type ContentStats, type ContentTopRow } from "@/lib/admin/analytics/content";
import { analyticsPeriod, periodLabel, previousPeriodLabel, type AnalyticsParams } from "@/lib/admin/analytics/params";
import { formatCount, formatRate } from "@/lib/admin/analytics/series";
import { buildCardPath } from "@/lib/cards/utils";

// ---------------------------------------------------------------------------
// /admin/analytics — the Content tab: what people make and look at. One
// read (0203's admin_content_stats) for the period and the one before it:
// six numbers, a chart a day for cards made, card views and decks made, who
// can see the period's cards, and the most viewed PUBLIC cards and decks (a
// private or unlisted title is never listed here).
// "Include admins" is the page's switch: off, the team's own cards, decks
// and likes are left out. A view carries no user, so views follow the
// content that is kept in.
// ---------------------------------------------------------------------------

export async function ContentTab({ params }: { params: AnalyticsParams }) {
  const stats = await getContentStats(analyticsPeriod(params.days), params.admins);
  return <ContentTabView params={params} stats={stats} />;
}

const linkClass = "font-medium text-primary-bright hover:underline";

/** Who can see the cards made in the period: three bars, most open first. */
export function visibilityRows(totals: ContentStats["current"]): RankedRow[] {
  if (totals.cardsCreated <= 0) return [];
  const share = (part: number) => formatRate(part, totals.cardsCreated);
  return [
    { key: "public", label: "Public", value: totals.cardsPublic, note: share(totals.cardsPublic) },
    { key: "unlisted", label: "Unlisted (link only)", value: totals.cardsUnlisted, note: share(totals.cardsUnlisted) },
    { key: "private", label: "Private", value: totals.cardsPrivate, note: share(totals.cardsPrivate) },
  ];
}

function TopTable({
  caption,
  thing,
  rows,
  hrefOf,
  empty,
}: {
  caption: string;
  /** The first column's heading: "Card" / "Deck". */
  thing: string;
  rows: ContentTopRow[];
  hrefOf: (row: ContentTopRow) => string;
  empty: string;
}) {
  if (rows.length === 0) return <EmptyNote>{empty}</EmptyNote>;
  return (
    <ListTable
      caption={caption}
      columns={[{ label: thing }, { label: "Made by" }, { label: "Views", kind: "number" }]}
      rows={rows.map((row) => ({
        key: row.id,
        cells: [
          <Link key="thing" href={hrefOf(row)} className={linkClass}>
            {row.title}
          </Link>,
          row.ownerId ? <PersonLink key="by" userId={row.ownerId} username={row.username} /> : "—",
          formatCount(row.views),
        ],
      }))}
    />
  );
}

/** The tab's markup, from data already read (null = the read failed). */
export function ContentTabView({ params, stats }: { params: AnalyticsParams; stats: ContentStats | null }) {
  const period = periodLabel(params.days);
  if (!stats) return <AdminLoadError what={`what was made and viewed in ${period}`} />;
  const { current, previous } = stats;
  const before = previousPeriodLabel(params.days);
  const likes = current.cardLikes + current.deckLikes;
  const visibility = visibilityRows(current);
  return (
    <div className="flex flex-col gap-6">
      <Section
        title={`Made and viewed in ${period}`}
        description={
          <>
            {params.admins
              ? "The team's own cards, decks and likes are counted too."
              : "The team's own cards, decks and likes are left out."}{" "}
            A view is one person opening a card or deck page on one day; an owner&rsquo;s visits to their own page never
            count. Days are UTC.
          </>
        }
      >
        <KpiRow>
          <KpiTile
            label="Cards created"
            value={formatCount(current.cardsCreated)}
            current={current.cardsCreated}
            previous={previous.cardsCreated}
            previousLabel={before}
          />
          <KpiTile
            label="Public cards created"
            value={formatCount(current.cardsPublic)}
            current={current.cardsPublic}
            previous={previous.cardsPublic}
            previousLabel={before}
            hint={current.cardsCreated > 0 ? `${formatRate(current.cardsPublic, current.cardsCreated)} of the cards made` : undefined}
          />
          <KpiTile
            label="Decks created"
            value={formatCount(current.decksCreated)}
            current={current.decksCreated}
            previous={previous.decksCreated}
            previousLabel={before}
          />
          <KpiTile
            label="Likes"
            value={formatCount(likes)}
            current={likes}
            previous={previous.cardLikes + previous.deckLikes}
            previousLabel={before}
            hint={`${formatCount(current.cardLikes)} on cards · ${formatCount(current.deckLikes)} on decks`}
          />
          <KpiTile
            label="Card views"
            value={formatCount(current.cardViews)}
            current={current.cardViews}
            previous={previous.cardViews}
            previousLabel={before}
          />
          <KpiTile
            label="Deck views"
            value={formatCount(current.deckViews)}
            current={current.deckViews}
            previous={previous.deckViews}
            previousLabel={before}
          />
        </KpiRow>
      </Section>

      <div className="grid grid-cols-1 gap-4 lg:grid-cols-2">
        <ChartCard
          title="Cards created per day"
          description="Cards saved for the first time, by UTC day. A card deleted since is not counted."
          chart={<DailyColumns points={stats.cardsPerDay} unit={["card", "cards"]} />}
          table={<DailyTable points={stats.cardsPerDay} caption="Cards created per day" column="Cards" />}
        />
        <ChartCard
          title="Card views per day"
          description="Card pages opened, by UTC day: one per person and card a day."
          chart={<DailyColumns points={stats.cardViewsPerDay} unit={["view", "views"]} />}
          table={<DailyTable points={stats.cardViewsPerDay} caption="Card views per day" column="Views" />}
        />
        <ChartCard
          title="Decks created per day"
          description="Decks started, by UTC day."
          chart={<DailyColumns points={stats.decksPerDay} unit={["deck", "decks"]} />}
          table={<DailyTable points={stats.decksPerDay} caption="Decks created per day" column="Decks" />}
        />
        <ChartCard
          title="Who can see the cards made in this period"
          description="The cards created in the period, by who can see them today."
          chart={<RankedBars rows={visibility} max={current.cardsCreated} empty="No cards were made in this period." />}
          table={
            <RankedTable rows={visibility} caption="Cards made in the period, by who can see them" columns={["Who can see them", "Cards", "Share of the cards made"]} />
          }
        />
      </div>

      <div className="grid grid-cols-1 gap-4 lg:grid-cols-2">
        <TablePanel
          title="Most viewed cards"
          description={`The ten public cards opened most in ${period}. Private and unlisted cards are counted above but never named here.`}
        >
          <TopTable
            caption="Most viewed public cards"
            thing="Card"
            rows={stats.topCards}
            hrefOf={(row) => buildCardPath({ slug: row.slug, owner: { username: row.username } })}
            empty="No public card was opened in this period."
          />
        </TablePanel>
        <TablePanel
          title="Most viewed decks"
          description={`The ten public decks opened most in ${period}. Private and unlisted decks are counted above but never named here.`}
        >
          <TopTable
            caption="Most viewed public decks"
            thing="Deck"
            rows={stats.topDecks}
            hrefOf={(row) => `/deck/${row.slug}`}
            empty="No public deck was opened in this period."
          />
        </TablePanel>
      </div>
    </div>
  );
}
