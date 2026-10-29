import { SurfaceCard } from "@/components/ui/surface-card";
import { statusRows, TYPE_BUCKETS, type DeckAnalytics } from "@/lib/decks/analytics";
import {
  COLOR_IDENTITY_LABELS,
  COLOR_LETTER_IDENTITY,
  type ColorIdentity,
} from "@/types/card";
import { BarList, COLOR_DOT_CLASS } from "@/components/analytics/bar-list";
import { DECK_ENTRY_STATUS_COUNT_LABELS } from "@/types/deck";

// Deck-flavored sibling of SetAnalyticsPanel: mana curve, color pips, type
// breakdown, and the cards by status (Imported / Edited / Remix / Original).

type DeckAnalyticsPanelProps = {
  analytics: DeckAnalytics;
  /** The deck page's "Card status" rows — THE status count its chips and
   *  summary bar say too (deckStatusCountsOf, lib/decks/deck-view.ts: each
   *  card under the badge it wears, "No longer available" included). Left
   *  out, the rows come from `analytics.byStatus`. */
  statusCounts?: Array<{ key: string; label: string; count: number }>;
};

const WUBRG = ["W", "U", "B", "R", "G"] as const;

/** The Colors card's rows with a count, in display order. */
function colorRows(analytics: DeckAnalytics): Array<{ identity: ColorIdentity; count: number }> {
  const rows: Array<{ identity: ColorIdentity; count: number }> = [
    ...WUBRG.map((letter) => ({ identity: COLOR_LETTER_IDENTITY[letter], count: analytics.byColor[letter] })),
    { identity: "multicolor", count: analytics.multicolor },
    { identity: "colorless", count: analytics.byColor.C },
  ];
  return rows.filter((row) => row.count > 0);
}

export function DeckAnalyticsPanel({ analytics, statusCounts }: DeckAnalyticsPanelProps) {
  const colors = colorRows(analytics);
  const statuses =
    statusCounts ??
    statusRows(analytics).map((row) => ({ key: row.status, label: DECK_ENTRY_STATUS_COUNT_LABELS[row.status], count: row.count }));

  return (
    <div className="grid gap-4 md:grid-cols-2 lg:grid-cols-4">
      <SurfaceCard className="flex flex-col gap-2 p-5">
        <span className="text-xs font-semibold uppercase tracking-wider text-subtle">
          Deck size
        </span>
        <span className="font-display text-3xl font-semibold tracking-tight text-foreground">
          {/* Companions live outside the deck proper — match the number the
              format checker validates against. */}
          {analytics.total -
            analytics.byBoard.side -
            analytics.byBoard.companion}
        </span>
        <span className="text-xs text-muted">
          {analytics.byBoard.side > 0
            ? `+ ${analytics.byBoard.side} sideboard`
            : "Commander + mainboard, quantities counted"}
        </span>
      </SurfaceCard>

      <SurfaceCard className="flex flex-col gap-3 p-5">
        <span className="text-xs font-semibold uppercase tracking-wider text-subtle">
          Card status
        </span>
        {/* Imported / Edited / Remix / Original (+ Not found), physical
            cards (lib/decks/entry-status.ts) — what replaced "% proxied". */}
        <dl className="flex flex-col gap-1.5 text-sm">
          {statuses.map((row) => (
            <div key={row.key} className="flex items-baseline justify-between gap-3">
              <dt className="text-muted">{row.label}</dt>
              <dd className="font-mono text-foreground">{row.count}</dd>
            </div>
          ))}
        </dl>
      </SurfaceCard>

      <SurfaceCard className="flex flex-col gap-2 p-5">
        <span className="text-xs font-semibold uppercase tracking-wider text-subtle">
          Average mana value
        </span>
        <span className="font-display text-3xl font-semibold tracking-tight text-foreground">
          {analytics.averageManaValue !== null
            ? analytics.averageManaValue.toFixed(1)
            : "—"}
        </span>
        <span className="text-xs text-muted">
          Nonland cards · {analytics.lands} land
          {analytics.lands === 1 ? "" : "s"}
        </span>
      </SurfaceCard>

      <SurfaceCard className="flex flex-col gap-3 p-5">
        <span className="text-xs font-semibold uppercase tracking-wider text-subtle">
          Colors
        </span>
        <div className="flex flex-col gap-1.5">
          {/* WUBRG (a gold card counts once per colour), then the gold
              cards themselves (two or more colours, or a custom card saved
              as "multicolor"), then colorless. */}
          {colors.map(({ identity, count }) => (
            <div
              key={identity}
              className="flex items-center justify-between gap-3 text-xs"
            >
              <span className="flex items-center gap-2">
                <span
                  className={`inline-block h-2.5 w-2.5 rounded-full ${COLOR_DOT_CLASS[identity]}`}
                  aria-hidden
                />
                <span className="text-foreground">{COLOR_IDENTITY_LABELS[identity]}</span>
              </span>
              <span className="font-mono text-muted">{count}</span>
            </div>
          ))}
          {colors.length === 0 ? (
            <span className="text-xs text-muted">Add cards to see colors.</span>
          ) : null}
        </div>
      </SurfaceCard>

      <SurfaceCard className="flex flex-col gap-3 p-5 md:col-span-2">
        <span className="text-xs font-semibold uppercase tracking-wider text-subtle">
          Mana curve
        </span>
        <ManaCurve curve={analytics.curve} />
      </SurfaceCard>

      <SurfaceCard className="flex flex-col gap-3 p-5 md:col-span-2">
        <span className="text-xs font-semibold uppercase tracking-wider text-subtle">
          By type
        </span>
        <BarList
          emptyMessage="Add cards to see types."
          rows={TYPE_BUCKETS.filter(
            (bucket) => (analytics.byType[bucket] ?? 0) > 0,
          ).map((bucket) => ({
            key: bucket,
            label: bucket,
            count: analytics.byType[bucket] ?? 0,
          }))}
        />
      </SurfaceCard>
    </div>
  );
}

/** The curve's bars are a picture for sighted readers only; the same
 *  numbers are a visually hidden table for a screen reader (every value,
 *  zeros included — the bars' `title`s never reached one). */
function ManaCurve({ curve }: { curve: number[] }) {
  const max = curve.reduce((m, v) => Math.max(m, v), 0) || 1;
  const label = (mv: number) => (mv === 7 ? "7+" : String(mv));
  return (
    <>
      <div className="flex h-28 items-end gap-2" aria-hidden>
        {curve.map((count, mv) => (
          <div key={mv} className="flex flex-1 flex-col items-center gap-1">
            <span className="text-[10px] font-mono text-muted">
              {count > 0 ? count : ""}
            </span>
            <div
              className="w-full rounded-t bg-linear-to-t from-primary to-accent"
              style={{
                height: `${Math.max((count / max) * 80, count > 0 ? 4 : 0)}px`,
              }}
              title={`${count} card${count === 1 ? "" : "s"} at mana value ${label(mv)}`}
            />
            <span className="text-[10px] text-subtle">{label(mv)}</span>
          </div>
        ))}
      </div>
      <table className="sr-only">
        <caption>Mana curve: nonland cards at each mana value</caption>
        <thead>
          <tr>
            <th scope="col">Mana value</th>
            <th scope="col">Cards</th>
          </tr>
        </thead>
        <tbody>
          {curve.map((count, mv) => (
            <tr key={mv}>
              <th scope="row">{mv === 7 ? "7 or more" : mv}</th>
              <td>{count}</td>
            </tr>
          ))}
        </tbody>
      </table>
    </>
  );
}

