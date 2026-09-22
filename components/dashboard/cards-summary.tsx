import Link from "next/link";
import { Layers } from "lucide-react";
import { SurfaceCard } from "@/components/ui/surface-card";
import { Badge } from "@/components/ui/badge";
import { getCardCapacity } from "@/lib/cards/capacity";
import { CAPACITY_WARN_AT, overCapacity, remainingCapacity } from "@/lib/billing/capacity-copy";
import { planForTier } from "@/lib/billing/plans";
import { cn } from "@/lib/utils";

// ---------------------------------------------------------------------------
// CardsSummaryCard — dashboard panel for the OTHER quota that stops a save:
// saved cards against the plan's limit. Same shape as the credits panel so
// the two read as a pair: saved / limit / remaining, a bar, one plain
// sentence, and the way out. Server component; RLS-scoped count.
// ---------------------------------------------------------------------------

export async function CardsSummaryCard() {
  const capacity = await getCardCapacity();
  if (!capacity) return null;

  const remaining = remainingCapacity(capacity);
  const unlimited = remaining === null;
  const plan = planForTier(capacity.tier);
  const cap = capacity.cap.toLocaleString("en-US");
  const used = capacity.used.toLocaleString("en-US");
  const tone: "default" | "warning" | "danger" = unlimited
    ? "default"
    : remaining === 0
      ? "danger"
      : remaining <= CAPACITY_WARN_AT
        ? "warning"
        : "default";
  const pct = unlimited ? 0 : Math.min(100, Math.round((capacity.used / capacity.cap) * 100));
  // Over the cap — a lapsed Plus/Pro plan keeps every card (the capacity
  // trigger only blocks inserts): say so plainly instead of "50 of 50".
  const over = unlimited ? 0 : overCapacity(capacity);
  const sentence = unlimited
    ? `Unlimited saved cards on ${plan.name} — ${used} so far.`
    : over > 0
      ? `You have ${used} cards, ${over.toLocaleString("en-US")} over the ${plan.name} plan's ${cap}-card limit. They're safe — but new saves need room or a plan with space.`
      : remaining === 0
        ? `You've used all ${cap} card slots on ${plan.name}. Delete a card or upgrade to save more.`
        : `${remaining.toLocaleString("en-US")} more card${remaining === 1 ? "" : "s"} before you reach the ${plan.name} plan's ${cap}-card limit.`;

  return (
    <SurfaceCard
      className={cn(
        "mt-6 flex flex-col gap-5 p-6",
        tone === "danger" && "border-danger/40",
        tone === "warning" && "border-gold/40",
      )}
    >
      <header className="flex items-start justify-between gap-3">
        <div className="flex items-center gap-3">
          <span className="flex h-10 w-10 items-center justify-center rounded-full bg-elevated text-primary-bright">
            <Layers className="h-5 w-5" aria-hidden />
          </span>
          <div className="flex flex-col">
            <span className="font-display text-sm font-semibold tracking-wide text-foreground">
              Saved cards
            </span>
            <span className="text-xs text-muted">
              Every card you keep — drafts included — counts toward the limit.
            </span>
          </div>
        </div>
        <Badge variant={capacity.tier === "free" ? "outline" : "primary"}>{plan.name} plan</Badge>
      </header>

      <div className="grid gap-3 sm:grid-cols-3">
        <Stat label="Saved" value={used} unit="cards" emphasis={tone} />
        <Stat label="Limit" value={unlimited ? "∞" : cap} unit={unlimited ? "unlimited" : "cards"} />
        {over > 0 ? (
          <Stat label="Over by" value={over.toLocaleString("en-US")} unit={over === 1 ? "card" : "cards"} emphasis="danger" />
        ) : (
          <Stat
          label="Remaining"
          value={unlimited ? "∞" : remaining.toLocaleString("en-US")}
          unit={unlimited ? "" : remaining === 1 ? "slot" : "slots"}
          emphasis={tone}
        />
        )}
      </div>

      {unlimited ? null : (
        <div className="flex flex-col gap-1.5">
          <div
            className="h-2 w-full overflow-hidden rounded-full bg-background/60"
            role="progressbar"
            aria-valuenow={capacity.used}
            aria-valuemin={0}
            aria-valuemax={capacity.cap}
            aria-label="Saved cards against the plan limit"
          >
            <div
              className={cn(
                "h-full rounded-full transition-all",
                tone === "danger" ? "bg-danger" : tone === "warning" ? "bg-gold" : "bg-primary",
              )}
              style={{ width: `${pct}%` }}
            />
          </div>
          <p className="text-xs text-subtle">
            {used} of {cap} card slots used ({pct}%).
          </p>
        </div>
      )}

      <p
        className={cn(
          "text-sm leading-6",
          tone === "danger" ? "text-danger" : tone === "warning" ? "text-foreground" : "text-muted",
        )}
      >
        {sentence}
      </p>

      <div className="flex flex-wrap gap-x-5 gap-y-2 text-xs font-semibold">
        <Link
          href="/dashboard/cards"
          className="text-primary-bright underline-offset-4 hover:underline"
        >
          Manage cards →
        </Link>
        {unlimited ? null : (
          <Link href="/pricing" className="text-primary-bright underline-offset-4 hover:underline">
            Upgrade for more room →
          </Link>
        )}
      </div>
    </SurfaceCard>
  );
}

function Stat({
  label,
  value,
  unit,
  emphasis = "default",
}: {
  label: string;
  value: number | string;
  unit: string;
  emphasis?: "default" | "warning" | "danger";
}) {
  return (
    <div
      className={cn(
        "flex flex-col gap-1 rounded-md border border-border/40 bg-background/40 px-3 py-2.5",
        emphasis === "danger" && "border-danger/40 bg-danger/5",
        emphasis === "warning" && "border-gold/40 bg-gold/5",
      )}
    >
      <span className="text-[11px] uppercase tracking-wider text-subtle">{label}</span>
      <span className="flex items-baseline gap-1.5">
        <span
          className={cn(
            "font-display text-2xl font-semibold tracking-tight",
            emphasis === "danger" ? "text-danger" : "text-foreground",
          )}
        >
          {value}
        </span>
        {unit ? <span className="text-xs text-muted">{unit}</span> : null}
      </span>
    </div>
  );
}
