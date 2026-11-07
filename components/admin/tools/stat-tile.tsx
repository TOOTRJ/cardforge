import type { LucideIcon } from "lucide-react";
import { cn } from "@/lib/utils";

/** One number on an admin tools page: a label, the value and a short hint.
 *  Renders a <div> holding a <dt>/<dd> pair — put it inside a <dl>. */
export function StatTile({
  icon: Icon,
  label,
  value,
  hint,
  className,
}: {
  icon?: LucideIcon;
  label: string;
  value: number | string;
  hint?: string;
  className?: string;
}) {
  return (
    <div className={cn("flex flex-col gap-1 rounded-card border border-border/70 bg-surface/70 p-4", className)}>
      <dt className="flex items-center gap-1.5 text-xs font-medium uppercase tracking-wider text-subtle">
        {Icon ? <Icon className="h-3.5 w-3.5 text-gold-strong" aria-hidden /> : null}
        {label}
      </dt>
      <dd className="font-display text-2xl font-semibold tabular-nums text-foreground">
        {typeof value === "number" ? value.toLocaleString("en-US") : value}
      </dd>
      {hint ? <dd className="text-xs text-subtle">{hint}</dd> : null}
    </div>
  );
}
