import { AlertTriangle, Globe2, Sparkles } from "lucide-react";
import { SurfaceCard } from "@/components/ui/surface-card";
import { Badge } from "@/components/ui/badge";
import { UsageBarChart } from "@/components/settings/usage-bar-chart";
import { getAiUsageSnapshot } from "@/lib/ai/usage-queries";
import {
  getScryfallUsageSnapshot,
  type ScryfallAction,
} from "@/lib/scryfall/usage-queries";
import { cn } from "@/lib/utils";

// ---------------------------------------------------------------------------
// UsagePanel — Settings page surface showing AI + Scryfall usage at a
// glance. Server component; renders fresh data on every visit. RLS
// guarantees the counts are owner-scoped.
//
// Layout:
//   ┌─ AI assistant ─────────────────────────────────────┐
//   │ N / 200 today           N / 20 this minute        │
//   │ [——————————— 30-day bar chart ———————————]        │
//   └────────────────────────────────────────────────────┘
//   ┌─ Scryfall ─────────────────────────────────────────┐
//   │ Combined: N today  ·  N this minute                │
//   │ search   N / 2000 today                           │
//   │ named    N / 500 today                            │
//   │ import   N / 100 today                            │
//   │ [——————————— 30-day bar chart ———————————]        │
//   └────────────────────────────────────────────────────┘
//
// A red banner replaces the quota text on any row that has hit its cap.
// ---------------------------------------------------------------------------

const SCRYFALL_ACTION_LABEL: Record<ScryfallAction, string> = {
  search: "Search",
  named: "Lookup",
  import_art: "Art import",
};

export async function UsagePanel() {
  // Fetch both snapshots in parallel — neither depends on the other.
  const [ai, scryfall] = await Promise.all([
    getAiUsageSnapshot(),
    getScryfallUsageSnapshot(),
  ]);

  const aiOverDay = ai.today >= ai.limits.perDay;
  const aiOverMinute = ai.minute >= ai.limits.perMinute;

  return (
    <div className="flex flex-col gap-6">
      {/* AI assistant */}
      <SurfaceCard className="flex flex-col gap-4 p-6">
        <header className="flex items-center justify-between gap-3">
          <div className="flex items-center gap-3">
            <span className="flex h-9 w-9 items-center justify-center rounded-full bg-elevated text-primary">
              <Sparkles className="h-4 w-4" aria-hidden />
            </span>
            <div className="flex flex-col">
              <span className="font-display text-sm font-semibold tracking-wide text-foreground">
                AI assistant
              </span>
              <span className="text-xs text-muted">
                Combined across improve / cost / rarity / flavor / art prompt
                / balance / from concept.
              </span>
            </div>
          </div>
          {aiOverDay || aiOverMinute ? (
            <Badge variant="default" className="border-danger/50 bg-danger/15 text-danger">
              <AlertTriangle className="h-3 w-3" aria-hidden /> Limit
            </Badge>
          ) : null}
        </header>

        <div className="grid gap-3 sm:grid-cols-2">
          <QuotaRow
            label="Today"
            count={ai.today}
            limit={ai.limits.perDay}
            unit="AI calls"
          />
          <QuotaRow
            label="Last minute"
            count={ai.minute}
            limit={ai.limits.perMinute}
            unit="AI calls"
          />
        </div>

        <UsageBarChart data={ai.daily} unitLabel="AI calls" />
      </SurfaceCard>

      {/* Scryfall */}
      <SurfaceCard className="flex flex-col gap-4 p-6">
        <header className="flex items-center justify-between gap-3">
          <div className="flex items-center gap-3">
            <span className="flex h-9 w-9 items-center justify-center rounded-full bg-elevated text-primary">
              <Globe2 className="h-4 w-4" aria-hidden />
            </span>
            <div className="flex flex-col">
              <span className="font-display text-sm font-semibold tracking-wide text-foreground">
                Scryfall
              </span>
              <span className="text-xs text-muted">
                Combined activity. Per-action quotas listed below.
              </span>
            </div>
          </div>
        </header>

        <div className="grid gap-3 sm:grid-cols-2">
          <TotalRow
            label="Today (all actions)"
            count={scryfall.todayTotal}
          />
          <TotalRow
            label="Last minute (all)"
            count={scryfall.minuteTotal}
          />
        </div>

        <div className="flex flex-col gap-2">
          {scryfall.perAction.map((row) => {
            const dailyLimit = scryfall.limits[row.action].perDay;
            const minuteLimit = scryfall.limits[row.action].perMinute;
            const dayHit = row.today >= dailyLimit;
            const minuteHit = row.minute >= minuteLimit;
            return (
              <div
                key={row.action}
                className={cn(
                  "flex flex-wrap items-center justify-between gap-3 rounded-md border border-border/40 bg-background/40 px-3 py-2 text-xs",
                  (dayHit || minuteHit) && "border-danger/40 bg-danger/5",
                )}
              >
                <span className="font-medium text-foreground">
                  {SCRYFALL_ACTION_LABEL[row.action]}
                </span>
                <span className="flex flex-wrap items-center gap-3 text-subtle">
                  <span>
                    <span
                      className={cn(
                        "font-mono",
                        dayHit ? "text-danger" : "text-foreground",
                      )}
                    >
                      {row.today}
                    </span>
                    {" / "}
                    {dailyLimit} today
                  </span>
                  <span>
                    <span
                      className={cn(
                        "font-mono",
                        minuteHit ? "text-danger" : "text-foreground",
                      )}
                    >
                      {row.minute}
                    </span>
                    {" / "}
                    {minuteLimit} /min
                  </span>
                </span>
              </div>
            );
          })}
        </div>

        <UsageBarChart data={scryfall.daily} unitLabel="Scryfall calls" />
      </SurfaceCard>
    </div>
  );
}

// ---------------------------------------------------------------------------
// Compact quota cell. Bold the number; show the limit + unit next to it.
// Turns red when count >= limit so a hit is visually obvious.
// ---------------------------------------------------------------------------

function QuotaRow({
  label,
  count,
  limit,
  unit,
}: {
  label: string;
  count: number;
  limit: number;
  unit: string;
}) {
  const hit = count >= limit;
  return (
    <div
      className={cn(
        "flex flex-col gap-1 rounded-md border border-border/40 bg-background/40 px-3 py-2",
        hit && "border-danger/40 bg-danger/5",
      )}
    >
      <span className="text-[11px] uppercase tracking-wider text-subtle">
        {label}
      </span>
      <span className="flex items-baseline gap-1.5">
        <span
          className={cn(
            "font-display text-xl font-semibold tracking-tight",
            hit ? "text-danger" : "text-foreground",
          )}
        >
          {count}
        </span>
        <span className="text-xs text-muted">
          / {limit} {unit}
        </span>
      </span>
    </div>
  );
}

function TotalRow({ label, count }: { label: string; count: number }) {
  return (
    <div className="flex flex-col gap-1 rounded-md border border-border/40 bg-background/40 px-3 py-2">
      <span className="text-[11px] uppercase tracking-wider text-subtle">
        {label}
      </span>
      <span className="font-display text-xl font-semibold tracking-tight text-foreground">
        {count}
      </span>
    </div>
  );
}
