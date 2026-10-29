import type { LucideIcon } from "lucide-react";
import { cn } from "@/lib/utils";
import { CompassStar } from "@/components/ui/compass-star";

type EmptyStateProps = {
  icon?: LucideIcon;
  title: string;
  /** The title's heading level — 3 by default (an empty state usually sits
   *  under a section heading); 2 where it follows the page's h1 directly. */
  headingLevel?: 2 | 3;
  description?: string;
  action?: React.ReactNode;
  className?: string;
};

export function EmptyState({
  icon: Icon,
  title,
  headingLevel = 3,
  description,
  action,
  className,
}: EmptyStateProps) {
  const Heading = headingLevel === 2 ? "h2" : "h3";
  return (
    <div
      className={cn(
        "flex flex-col items-center justify-center gap-4 rounded-xl border border-dashed border-border bg-surface/40 px-6 py-16 text-center",
        className,
      )}
    >
      <span className="flex h-12 w-12 items-center justify-center rounded-full bg-elevated text-gold">
        {Icon ? (
          <Icon className="h-5 w-5" aria-hidden />
        ) : (
          <CompassStar className="h-5 w-5" />
        )}
      </span>
      <div className="flex max-w-md flex-col gap-1.5">
        <Heading className="font-display text-lg font-semibold text-foreground">{title}</Heading>
        {description ? (
          <p className="text-sm leading-6 text-muted">{description}</p>
        ) : null}
      </div>
      {action ? <div className="flex flex-wrap items-center gap-2">{action}</div> : null}
    </div>
  );
}
