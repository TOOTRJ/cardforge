import { cn } from "@/lib/utils";

// ---------------------------------------------------------------------------
// UsageBarChart — tiny SVG bar chart for the 30-day usage trend on the
// Settings page. No chart library; one <rect> per day, height scaled to
// the window's max count. Days with zero usage render as a 1px stub so
// the chart's baseline reads as "every day is present" rather than
// "data is missing here."
//
// Data input: an unordered list of `{ day: "YYYY-MM-DD", count: number }`.
// Missing days (no rows) get filled with zeros up to `days` worth of
// trailing buckets ending today.
// ---------------------------------------------------------------------------

type DailyCount = { day: string; count: number };

type UsageBarChartProps = {
  data: DailyCount[];
  days?: number;
  className?: string;
  /** Tooltip label suffix, e.g. "AI calls" → tooltip "2026-05-13: 14 AI calls" */
  unitLabel?: string;
};

const DEFAULT_DAYS = 30;
const SVG_HEIGHT = 64;
const BAR_GAP = 2;
const MIN_BAR_HEIGHT = 1;

function fillDays(
  data: DailyCount[],
  days: number,
): { day: string; count: number }[] {
  const byDay = new Map<string, number>();
  for (const row of data) byDay.set(row.day, row.count);

  // Build the trailing-N-days window ending today (UTC date, matching
  // the SQL function's `date_trunc('day', created_at)::date`).
  const buckets: { day: string; count: number }[] = [];
  const today = new Date();
  today.setUTCHours(0, 0, 0, 0);
  for (let i = days - 1; i >= 0; i--) {
    const d = new Date(today);
    d.setUTCDate(d.getUTCDate() - i);
    const key = d.toISOString().slice(0, 10);
    buckets.push({ day: key, count: byDay.get(key) ?? 0 });
  }
  return buckets;
}

export function UsageBarChart({
  data,
  days = DEFAULT_DAYS,
  className,
  unitLabel = "calls",
}: UsageBarChartProps) {
  const buckets = fillDays(data, days);
  const maxCount = Math.max(1, ...buckets.map((b) => b.count));

  // Use a fixed-width viewBox; the SVG itself stretches to fill its
  // parent via `preserveAspectRatio="none"`. Bar widths come out evenly.
  const VB_WIDTH = days * 10;
  const barWidth = Math.max(1, 10 - BAR_GAP);

  return (
    <svg
      role="img"
      aria-label={`${unitLabel} per day for the last ${days} days`}
      viewBox={`0 0 ${VB_WIDTH} ${SVG_HEIGHT}`}
      preserveAspectRatio="none"
      className={cn("h-16 w-full", className)}
    >
      {/* Baseline rail — faint line at the bottom so empty days still
          show "this day exists" rather than visual blankness. */}
      <line
        x1="0"
        x2={VB_WIDTH}
        y1={SVG_HEIGHT - 0.5}
        y2={SVG_HEIGHT - 0.5}
        stroke="color-mix(in oklab, var(--color-border) 60%, transparent)"
        strokeWidth="0.5"
      />
      {buckets.map((bucket, i) => {
        const height = Math.max(
          MIN_BAR_HEIGHT,
          (bucket.count / maxCount) * SVG_HEIGHT,
        );
        const x = i * 10;
        const y = SVG_HEIGHT - height;
        return (
          <rect
            key={bucket.day}
            x={x}
            y={y}
            width={barWidth}
            height={height}
            rx={0.5}
            fill={
              bucket.count === 0
                ? "color-mix(in oklab, var(--color-border) 80%, transparent)"
                : "var(--color-primary)"
            }
            opacity={bucket.count === 0 ? 0.5 : 0.85}
          >
            <title>{`${bucket.day}: ${bucket.count} ${unitLabel}`}</title>
          </rect>
        );
      })}
    </svg>
  );
}
