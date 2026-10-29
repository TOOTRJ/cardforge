import type { ReactNode } from "react";
import { DeckChartCard } from "@/components/decks/deck-chart-card";
import {
  BarsTable,
  ChartLegend,
  ColorBalance,
  ColorBalanceTable,
  HorizontalBars,
  StatTile,
  type BarRowData,
} from "@/components/decks/deck-chart-parts";
import { DeckManaCurve, ManaCurveTable } from "@/components/decks/deck-mana-curve";
import type { DeckAnalytics } from "@/lib/decks/analytics";
import type { DeckCharts } from "@/lib/decks/deck-charts";
import type { KeywordCount, KeywordKind } from "@/lib/decks/keyword-frequency";

// ---------------------------------------------------------------------------
// The deck page's breakdown (TODO DK7.1 / DK7.3) — free for every viewer.
// Headline numbers first (the deck's size, its lands, the average and
// median mana value without lands), then the charts: the curve (its bars
// filter the list above), colour symbols against sources, types, rarity,
// the cards by status (THE status count the list's chips and the summary
// bar say, deckStatusCountsOf) and the keywords. Every number is
// computeDeckCharts' (lib/decks/deck-charts.ts: the entries' effective
// fields, the maybeboard never counted); every chart has its table. The
// playtest (draw odds, the sample hand — DK7.2) is the page's next section.
// ---------------------------------------------------------------------------

type DeckAnalyticsPanelProps = {
  analytics: DeckAnalytics;
  charts: DeckCharts;
  /** The deck page's "Composition" rows — THE status count its chips and
   *  summary bar say too (deckStatusCountsOf, lib/decks/deck-view.ts: each
   *  card under the badge it wears, "No longer available" included). */
  statusCounts: Array<{ key: string; label: string; count: number }>;
};

const KIND_TAGS: Partial<Record<KeywordKind, string>> = {
  action: "action",
  "ability-word": "ability word",
  new: "new",
};

const formatValue = (value: number | null) => (value === null ? "—" : Number.isInteger(value) ? String(value) : value.toFixed(1));

/** A keyword list: the first `shown` rows, the rest behind a native
 *  disclosure (no script, every row still in the table). */
function KeywordBars({ keywords, total, shown = 8 }: { keywords: KeywordCount[]; total: number; shown?: number }) {
  const rows: BarRowData[] = keywords.map((keyword) => ({
    key: keyword.key,
    label: keyword.name,
    count: keyword.cards,
    tag: KIND_TAGS[keyword.kind],
  }));
  if (rows.length <= shown + 1) return <HorizontalBars rows={rows} total={total} />;
  return (
    <div className="flex flex-col gap-2.5">
      <HorizontalBars rows={rows.slice(0, shown)} total={total} />
      <details className="group">
        <summary className="cursor-pointer list-none text-xs font-medium text-primary-bright underline-offset-4 hover:underline [&::-webkit-details-marker]:hidden">
          <span className="group-open:hidden">Show {rows.length - shown} more</span>
          <span className="hidden group-open:inline">Show fewer</span>
        </summary>
        <div className="mt-2.5">
          <HorizontalBars rows={rows.slice(shown)} total={total} />
        </div>
      </details>
    </div>
  );
}

function Empty({ children }: { children: ReactNode }) {
  return <p className="text-xs leading-5 text-muted">{children}</p>;
}

export function DeckAnalyticsPanel({ analytics, charts, statusCounts }: DeckAnalyticsPanelProps) {
  // Companions live outside the deck proper — the number the format check
  // validates against.
  const deckSize = analytics.total - analytics.byBoard.side - analytics.byBoard.companion;
  const statusTotal = statusCounts.reduce((sum, row) => sum + row.count, 0);
  const statusRows: BarRowData[] = statusCounts.map((row) => ({ key: row.key, label: row.label, count: row.count }));
  const typeRows: BarRowData[] = charts.types.map((row) => ({ key: row.key, label: row.label, count: row.count }));
  const rarityRows: BarRowData[] = charts.rarity.map((row) => ({ key: row.key, label: row.label, count: row.count }));
  const { keywords } = charts;
  const offCurve = [
    charts.lands > 0 ? `${charts.lands} land${charts.lands === 1 ? "" : "s"}` : null,
    charts.noManaValue > 0 ? `${charts.noManaValue} with no mana value` : null,
  ].filter(Boolean);

  return (
    <div className="flex flex-col gap-4">
      <div className="grid grid-cols-2 gap-4 lg:grid-cols-4">
        <StatTile
          label="Deck size"
          value={deckSize}
          detail={analytics.byBoard.side > 0 ? `+ ${analytics.byBoard.side} sideboard` : "Commander + mainboard, quantities counted"}
        />
        <StatTile label="Lands" value={analytics.lands} detail="Kept off the curve and the averages" />
        <StatTile label="Average mana value" value={formatValue(charts.averageManaValue)} detail="Nonland cards — lands excluded" />
        <StatTile label="Median mana value" value={formatValue(charts.medianManaValue)} detail="Nonland cards — lands excluded" />
      </div>

      <div className="grid gap-4 lg:grid-cols-3">
        <DeckChartCard
          className="lg:col-span-2"
          title="Mana curve"
          description={
            <>
              {charts.curveCards} nonland card{charts.curveCards === 1 ? "" : "s"} by mana value, sideboard included
              {offCurve.length > 0 ? ` — ${offCurve.join(" and ")} left off` : ""}.
            </>
          }
          accessibleChart
          chart={<DeckManaCurve curve={charts.curve} />}
          table={<ManaCurveTable curve={charts.curve} />}
        />
        <DeckChartCard
          title="Card types"
          description="Every card in the deck, sideboard included — an artifact creature counts as a creature."
          chart={typeRows.length > 0 ? <HorizontalBars rows={typeRows} total={charts.total} /> : <Empty>Add cards to see types.</Empty>}
          table={<BarsTable caption="Cards by type" label="Type" rows={typeRows} total={charts.total} />}
        />

        <DeckChartCard
          className="lg:col-span-2"
          title="Color symbols and sources"
          description={
            <>
              Each color&rsquo;s share of the symbols in the costs against its share of the mana sources. A source is a land or a
              PipGlyph card whose text adds mana; a real card not made on PipGlyph counts only as a land.
            </>
          }
          chart={
            charts.colors.length > 0 ? (
              <div className="flex flex-col gap-3">
                <ChartLegend
                  items={[
                    { label: "Symbols in costs", swatch: "chart-1" },
                    { label: "Mana sources", swatch: "chart-2" },
                  ]}
                />
                <ColorBalance rows={charts.colors} />
              </div>
            ) : (
              <Empty>No colored mana symbols or sources yet.</Empty>
            )
          }
          table={<ColorBalanceTable rows={charts.colors} />}
        />
        <DeckChartCard
          title="Rarity"
          description="By each card's printed rarity (an edited card's own)."
          chart={rarityRows.length > 0 ? <HorizontalBars rows={rarityRows} total={charts.total} /> : <Empty>No rarities yet.</Empty>}
          table={<BarsTable caption="Cards by rarity" label="Rarity" rows={rarityRows} total={charts.total} />}
        />

        <DeckChartCard
          title="Composition"
          description="Every card by status: imported, edited, remixed or original."
          chart={<HorizontalBars rows={statusRows} total={statusTotal} />}
          table={<BarsTable caption="Cards by status" label="Status" rows={statusRows} total={statusTotal} />}
        />
        <DeckChartCard
          className="lg:col-span-2"
          title="Keywords"
          description={
            keywords.cardsRead > 0
              ? `Read from the rules text of ${keywords.cardsRead} of the ${charts.total} cards: the ones made on PipGlyph (a real card’s text isn’t on the page). Counted in cards.`
              : "Read from the rules text of the cards made on PipGlyph."
          }
          chart={
            keywords.cardsRead === 0 ? (
              <Empty>No card made on PipGlyph here yet — customize one to see its keywords.</Empty>
            ) : keywords.evergreen.length + keywords.mechanics.length === 0 ? (
              <Empty>No keywords on these cards.</Empty>
            ) : (
              <div className="grid gap-5 md:grid-cols-2">
                <div className="flex min-w-0 flex-col gap-2.5">
                  <h4 className="text-xs font-semibold uppercase tracking-wider text-subtle">Evergreen</h4>
                  {keywords.evergreen.length > 0 ? (
                    <KeywordBars keywords={keywords.evergreen} total={keywords.cardsRead} />
                  ) : (
                    <Empty>None.</Empty>
                  )}
                </div>
                <div className="flex min-w-0 flex-col gap-2.5">
                  <h4 className="text-xs font-semibold uppercase tracking-wider text-subtle">Mechanics</h4>
                  {keywords.mechanics.length > 0 ? (
                    <KeywordBars keywords={keywords.mechanics} total={keywords.cardsRead} />
                  ) : (
                    <Empty>None.</Empty>
                  )}
                </div>
              </div>
            )
          }
          table={
            <BarsTable
              caption="Keywords, by the cards that print them"
              label="Keyword"
              rows={[...keywords.evergreen, ...keywords.mechanics].map((keyword) => ({
                key: keyword.key,
                label: keyword.name,
                count: keyword.cards,
                tag: keyword.kind === "evergreen" ? "evergreen" : KIND_TAGS[keyword.kind] ?? "keyword",
              }))}
              total={keywords.cardsRead}
            />
          }
        />
      </div>
    </div>
  );
}
