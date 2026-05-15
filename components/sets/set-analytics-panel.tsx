import { SurfaceCard } from "@/components/ui/surface-card";
import {
  CARD_TYPE_LABELS,
  CARD_TYPE_VALUES,
  COLOR_IDENTITY_VALUES,
  RARITY_VALUES,
  type CardType,
  type ColorIdentity,
  type Rarity,
} from "@/types/card";
import type { SetAnalytics } from "@/lib/sets/analytics";

type SetAnalyticsPanelProps = {
  analytics: SetAnalytics;
};


const RARITY_LABELS: Record<Rarity, string> = {
  common: "Common",
  uncommon: "Uncommon",
  rare: "Rare",
  mythic: "Mythic",
};

const COLOR_LABELS: Record<ColorIdentity, string> = {
  white: "White",
  blue: "Blue",
  black: "Black",
  red: "Red",
  green: "Green",
  colorless: "Colorless",
  multicolor: "Multicolor",
};

const COLOR_DOT: Record<ColorIdentity, string> = {
  white: "bg-amber-200",
  blue: "bg-sky-400",
  black: "bg-zinc-500",
  red: "bg-rose-400",
  green: "bg-emerald-400",
  colorless: "bg-slate-400",
  multicolor: "bg-linear-to-r from-fuchsia-400 to-amber-300",
};

export function SetAnalyticsPanel({ analytics }: SetAnalyticsPanelProps) {
  return (
    <div className="grid gap-4 md:grid-cols-2 lg:grid-cols-4">
      <SurfaceCard className="flex flex-col gap-2 p-5">
        <span className="text-xs font-semibold uppercase tracking-wider text-subtle">
          Total cards
        </span>
        <span className="font-display text-3xl font-semibold tracking-tight text-foreground">
          {analytics.total}
        </span>
      </SurfaceCard>

      <SurfaceCard className="flex flex-col gap-2 p-5">
        <span className="text-xs font-semibold uppercase tracking-wider text-subtle">
          Average cost
        </span>
        <span className="font-display text-3xl font-semibold tracking-tight text-foreground">
          {analytics.averageCost !== null
            ? analytics.averageCost.toFixed(1)
            : "—"}
        </span>
        <span className="text-xs text-muted">
          {analytics.averageCostSampleSize > 0
            ? `Across ${analytics.averageCostSampleSize} parseable cost${
                analytics.averageCostSampleSize === 1 ? "" : "s"
              }`
            : "Add cards with costs to see this"}
        </span>
      </SurfaceCard>

      <SurfaceCard className="flex flex-col gap-3 p-5">
        <span className="text-xs font-semibold uppercase tracking-wider text-subtle">
          By type
        </span>
        <BarList
          rows={CARD_TYPE_VALUES.map((type) => ({
            key: type,
            label: CARD_TYPE_LABELS[type],
            count: analytics.byCardType[type] ?? 0,
          }))}
        />
      </SurfaceCard>

      <SurfaceCard className="flex flex-col gap-3 p-5">
        <span className="text-xs font-semibold uppercase tracking-wider text-subtle">
          By rarity
        </span>
        <BarList
          rows={RARITY_VALUES.map((rarity) => ({
            key: rarity,
            label: RARITY_LABELS[rarity],
            count: analytics.byRarity[rarity] ?? 0,
          }))}
        />
      </SurfaceCard>

      <SurfaceCard className="flex flex-col gap-3 p-5 md:col-span-2 lg:col-span-4">
        <span className="text-xs font-semibold uppercase tracking-wider text-subtle">
          By color identity
        </span>
        <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-4">
          {COLOR_IDENTITY_VALUES.map((color) => (
            <div
              key={color}
              className="flex items-center justify-between gap-3 rounded-md border border-border/60 bg-elevated px-3 py-2 text-xs"
            >
              <span className="flex items-center gap-2">
                <span
                  className={`inline-block h-2.5 w-2.5 rounded-full ${COLOR_DOT[color]}`}
                  aria-hidden
                />
                <span className="text-foreground">{COLOR_LABELS[color]}</span>
              </span>
              <span className="font-mono text-muted">
                {analytics.byColor[color] ?? 0}
              </span>
            </div>
          ))}
        </div>
      </SurfaceCard>
    </div>
  );
}

function BarList({
  rows,
}: {
  rows: Array<{ key: string; label: string; count: number }>;
}) {
  const max = rows.reduce((m, r) => Math.max(m, r.count), 0) || 1;
  return (
    <ul className="flex flex-col gap-1.5">
      {rows.map((row) => (
        <li key={row.key} className="flex items-center gap-2 text-xs">
          <span className="w-20 shrink-0 text-muted">{row.label}</span>
          <span className="relative h-2 flex-1 overflow-hidden rounded-full bg-elevated">
            <span
              className="absolute inset-y-0 left-0 bg-linear-to-r from-primary to-accent"
              style={{ width: `${(row.count / max) * 100}%` }}
            />
          </span>
          <span className="w-6 shrink-0 text-right font-mono text-muted">
            {row.count}
          </span>
        </li>
      ))}
    </ul>
  );
}
