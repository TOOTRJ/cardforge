import Link from "next/link";
import { CompactChipGroup } from "@/components/browse/compact-chip-group";
import { listFormatHubs } from "@/lib/cards/hubs";
import { DECK_FORMAT_LABELS } from "@/types/deck";

// Internal links to the per-format deck hubs — at the top of the decks
// landing, under the browse grid and on every format hub. Server component;
// counts are ISR-cached with the page. "top" is the gallery's COMPACT bar
// (CompactChipGroup, DK8.9): one line that scrolls sideways below lg, wrapped
// from lg; "bottom" keeps the full labelled block.
export async function DeckFormatLinks({
  current,
  placement = "bottom",
}: {
  current?: string;
  /** "top" = the landing's compact bar under the header; "bottom" = the full
   *  block under a divider. */
  placement?: "top" | "bottom";
}) {
  const hubs = (await listFormatHubs()).filter((hub) => hub.count > 0 && hub.format !== current);
  if (hubs.length === 0) return null;
  if (placement === "top") {
    return (
      <nav aria-label="Browse decks by format" className="mt-3 grid grid-cols-1 gap-2">
        <CompactChipGroup
          label="Formats"
          chips={hubs.map((hub) => ({
            key: hub.format,
            href: `/decks/format/${hub.format}`,
            label: DECK_FORMAT_LABELS[hub.format],
            count: hub.count,
          }))}
        />
      </nav>
    );
  }
  return (
    <nav aria-label="Browse decks by format" className="mt-12 flex flex-col gap-2 border-t border-border/40 pt-8">
      <span className="font-mono text-[11px] uppercase tracking-wider text-muted">Browse by format</span>
      <div className="flex flex-wrap gap-2">
        {hubs.map((hub) => (
          <Link
            key={hub.format}
            href={`/decks/format/${hub.format}`}
            className="inline-flex items-center gap-1.5 rounded-full border border-border/60 bg-elevated/50 px-3 py-1.5 text-xs font-medium text-muted transition-colors hover:border-gold/40 hover:text-foreground"
          >
            {DECK_FORMAT_LABELS[hub.format]}
            <span className="text-subtle">{hub.count}</span>
          </Link>
        ))}
      </div>
    </nav>
  );
}
