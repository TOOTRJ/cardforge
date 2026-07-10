import { SurfaceCard } from "@/components/ui/surface-card";
import { TYPE_BUCKETS, type DeckAnalytics } from "@/lib/decks/analytics";

// Deck-flavored sibling of SetAnalyticsPanel: mana curve, color pips, type
// breakdown, and the remix-progress headline number.

type DeckAnalyticsPanelProps = {
  analytics: DeckAnalytics;
};

const COLOR_LABELS: Record<keyof DeckAnalytics["byColor"], string> = {
  W: "White",
  U: "Blue",
  B: "Black",
  R: "Red",
  G: "Green",
  C: "Colorless",
};

const COLOR_DOT: Record<keyof DeckAnalytics["byColor"], string> = {
  W: "bg-amber-200",
  U: "bg-sky-400",
  B: "bg-zinc-500",
  R: "bg-rose-400",
  G: "bg-emerald-400",
  C: "bg-slate-400",
};

const COLOR_KEYS = ["W", "U", "B", "R", "G", "C"] as const;

export function DeckAnalyticsPanel({ analytics }: DeckAnalyticsPanelProps) {
  const remixPct =
    analytics.total > 0
      ? Math.round((analytics.remixed / analytics.total) * 100)
      : 0;

  return (
    <div className="grid gap-4 md:grid-cols-2 lg:grid-cols-4">
      <SurfaceCard className="flex flex-col gap-2 p-5">
        <span className="text-xs font-semibold uppercase tracking-wider text-subtle">
          Deck size
        </span>
        <span className="font-display text-3xl font-semibold tracking-tight text-foreground">
          {analytics.total - analytics.byBoard.side}
        </span>
        <span className="text-xs text-muted">
          {analytics.byBoard.side > 0
            ? `+ ${analytics.byBoard.side} sideboard`
            : "Commander + mainboard, quantities counted"}
        </span>
      </SurfaceCard>

      <SurfaceCard className="flex flex-col gap-2 p-5">
        <span className="text-xs font-semibold uppercase tracking-wider text-subtle">
          Remixed
        </span>
        <span className="font-display text-3xl font-semibold tracking-tight text-foreground">
          {remixPct}%
        </span>
        <span className="text-xs text-muted">
          {analytics.remixed} of {analytics.total} cards have a custom proxy
        </span>
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
          {COLOR_KEYS.map((color) =>
            analytics.byColor[color] > 0 ? (
              <div
                key={color}
                className="flex items-center justify-between gap-3 text-xs"
              >
                <span className="flex items-center gap-2">
                  <span
                    className={`inline-block h-2.5 w-2.5 rounded-full ${COLOR_DOT[color]}`}
                    aria-hidden
                  />
                  <span className="text-foreground">{COLOR_LABELS[color]}</span>
                </span>
                <span className="font-mono text-muted">
                  {analytics.byColor[color]}
                </span>
              </div>
            ) : null,
          )}
          {COLOR_KEYS.every((c) => analytics.byColor[c] === 0) ? (
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

function ManaCurve({ curve }: { curve: number[] }) {
  const max = curve.reduce((m, v) => Math.max(m, v), 0) || 1;
  return (
    <div className="flex h-28 items-end gap-2" role="img" aria-label="Mana curve">
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
            title={`${count} card${count === 1 ? "" : "s"} at mana value ${mv === 7 ? "7+" : mv}`}
          />
          <span className="text-[10px] text-subtle">{mv === 7 ? "7+" : mv}</span>
        </div>
      ))}
    </div>
  );
}

function BarList({
  rows,
}: {
  rows: Array<{ key: string; label: string; count: number }>;
}) {
  if (rows.length === 0) {
    return <span className="text-xs text-muted">Add cards to see types.</span>;
  }
  const max = rows.reduce((m, r) => Math.max(m, r.count), 0) || 1;
  return (
    <ul className="flex flex-col gap-1.5">
      {rows.map((row) => (
        <li key={row.key} className="flex items-center gap-2 text-xs">
          <span className="w-24 shrink-0 text-muted">{row.label}</span>
          <span className="relative h-2 flex-1 overflow-hidden rounded-full bg-elevated">
            <span
              className="absolute inset-y-0 left-0 bg-linear-to-r from-primary to-accent"
              style={{ width: `${(row.count / max) * 100}%` }}
            />
          </span>
          <span className="w-8 shrink-0 text-right font-mono text-muted">
            {row.count}
          </span>
        </li>
      ))}
    </ul>
  );
}
