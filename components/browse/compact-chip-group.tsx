import Link from "next/link";
import { cn } from "@/lib/utils";

// ---------------------------------------------------------------------------
// The browse landings' COMPACT chip bar (owner 2026-11-03, DK8.7; /decks'
// format chips wear it too since DK8.9): a small label and one group of hub
// chips, each chip 28 px tall. Below lg a group is ONE line that scrolls
// sideways in its own box (a fade on its end says there is more); from lg
// it wraps. The gallery's HubLinks places two groups side by side from lg;
// DeckFormatLinks places one. Never a second copy of these classes.
// ---------------------------------------------------------------------------

export type CompactChip = { key: string; href: string; label: string; count: number; title?: string };

/** The compact bar's chip: 28 px tall (WCAG 2.5.8's 24 px with room). */
const COMPACT_CHIP_CLASS =
  "inline-flex h-7 shrink-0 items-center gap-1 rounded-full border border-border/60 bg-elevated/50 px-2.5 text-[11px] font-medium text-muted transition-colors hover:border-gold/40 hover:text-foreground focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-primary-bright/50";

export function CompactChipGroup({
  label,
  chips,
}: {
  label: string;
  chips: CompactChip[];
}) {
  return (
    <div className="flex min-w-0 items-start gap-2">
      {/* The visible label is decoration; the list carries the name. */}
      <span aria-hidden="true" className="w-20 shrink-0 pt-2 font-mono text-[10px] uppercase tracking-wider text-subtle lg:w-auto">{label}</span>
      {/* Below lg: one line that scrolls in its own box (a fade on the end,
          padding so the last chip and every focus ring clear it). From lg:
          wraps. */}
      <ul
        aria-label={label}
        className={cn(
          "flex min-w-0 flex-1 gap-1.5 overflow-x-auto px-0.5 py-0.5 pr-8 [scrollbar-width:none] [&::-webkit-scrollbar]:hidden",
          "[mask-image:linear-gradient(to_right,black_calc(100%-2rem),transparent)]",
          "lg:flex-wrap lg:overflow-visible lg:pr-0.5 lg:[mask-image:none]",
        )}
      >
        {chips.map((chip) => (
          <li key={chip.key} className="shrink-0">
            <Link href={chip.href} className={COMPACT_CHIP_CLASS} title={chip.title}>
              {chip.label}
              <span className="text-subtle">{chip.count}</span>
            </Link>
          </li>
        ))}
      </ul>
    </div>
  );
}
