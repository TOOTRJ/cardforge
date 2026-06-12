import { cn } from "@/lib/utils";

// ---------------------------------------------------------------------------
// StatBadge — serif stat value over a small caps label (the "10K+ cards
// created" strip from the PipGlyph mockups). Compose several in a flex/grid
// row with dividers as needed.
// ---------------------------------------------------------------------------

type StatBadgeProps = {
  value: React.ReactNode;
  label: React.ReactNode;
  className?: string;
};

export function StatBadge({ value, label, className }: StatBadgeProps) {
  return (
    <div className={cn("flex flex-col items-center gap-1 text-center", className)}>
      <span className="font-display text-2xl font-semibold text-gold-strong sm:text-3xl">
        {value}
      </span>
      <span className="text-[11px] font-medium uppercase tracking-[0.14em] text-muted">
        {label}
      </span>
    </div>
  );
}
