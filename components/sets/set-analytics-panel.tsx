import { SurfaceCard } from "@/components/ui/surface-card";
import {
  CARD_TYPE_LABELS,
  CARD_TYPE_VALUES,
  COLOR_IDENTITY_VALUES,
  RARITY_VALUES,
  RARITY_LABELS,
  COLOR_IDENTITY_LABELS,
} from "@/types/card";
import type { SetAnalytics } from "@/lib/sets/analytics";
import { BarList, COLOR_DOT_CLASS } from "@/components/analytics/bar-list";

type SetAnalyticsPanelProps = {
  analytics: SetAnalytics;
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
                  className={`inline-block h-2.5 w-2.5 rounded-full ${COLOR_DOT_CLASS[color]}`}
                  aria-hidden
                />
                <span className="text-foreground">{COLOR_IDENTITY_LABELS[color]}</span>
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

