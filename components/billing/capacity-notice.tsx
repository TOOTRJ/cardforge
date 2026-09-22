import Link from "next/link";
import { AlertTriangle, Info, OctagonAlert } from "lucide-react";
import {
  describeCapacity,
  describeUsage,
  type CardCapacity,
} from "@/lib/billing/capacity-copy";
import { cn } from "@/lib/utils";

// ---------------------------------------------------------------------------
// CapacityNotice — the one place saved-card capacity is explained to the
// user: before creating a card (creator), before an AI batch (deck wizard,
// in-deck AI panel) and as the usage line on My Cards. Pure presentation;
// the copy comes from lib/billing/capacity-copy so every surface agrees.
// ---------------------------------------------------------------------------

const TONE_CLASS = {
  danger: "border-danger/50 bg-danger/10 text-foreground",
  warning: "border-gold/50 bg-gold/10 text-foreground",
  info: "border-border/60 bg-elevated/40 text-muted",
} as const;

const TONE_ICON = {
  danger: OctagonAlert,
  warning: AlertTriangle,
  info: Info,
} as const;

export function CapacityNotice({
  capacity,
  adding = 1,
  variant = "warning",
  className,
}: {
  capacity: CardCapacity | null;
  /** Cards the pending action would add (1 for the creator, the batch size for AI). */
  adding?: number;
  /** "warning" says something only when it matters; "usage" is the always-on meter. */
  variant?: "warning" | "usage";
  className?: string;
}) {
  const notice =
    variant === "usage" ? describeUsage(capacity) : describeCapacity(capacity, adding);
  if (!notice) return null;
  const Icon = TONE_ICON[notice.tone];
  const showActions = notice.tone !== "info";
  return (
    <div
      role={notice.tone === "danger" ? "alert" : "status"}
      className={cn(
        "flex flex-wrap items-center gap-x-3 gap-y-2 rounded-lg border px-4 py-3 text-sm",
        TONE_CLASS[notice.tone],
        className,
      )}
    >
      <Icon className="h-4 w-4 shrink-0" aria-hidden />
      <span className="min-w-0 flex-1 leading-6">{notice.message}</span>
      {showActions ? (
        <span className="flex shrink-0 items-center gap-3 text-xs font-semibold">
          <Link href="/dashboard/cards" className="underline-offset-2 hover:underline">
            Manage cards
          </Link>
          <Link href="/pricing" className="text-primary-bright underline-offset-2 hover:underline">
            Upgrade
          </Link>
        </span>
      ) : null}
    </div>
  );
}
