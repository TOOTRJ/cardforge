import { Layers } from "lucide-react";

// "In N decks" (TODO DK8.4) — the public decks a card's page lists, counted
// by their one rule (publicDeckCountsForCards, migration 0149). TEXT in a
// card tile's footer, outside the tile's link (no control in a link); the
// gallery tile and the trending tile both draw this one. None, or not read
// (a database 0149 hasn't reached): nothing.
export function InDecksCount({ count }: { count: number | undefined }) {
  if (!count) return null;
  return (
    <span className="inline-flex items-center gap-1 whitespace-nowrap text-xs text-muted">
      <Layers className="h-3 w-3" aria-hidden />
      In {count.toLocaleString("en-US")} deck{count === 1 ? "" : "s"}
    </span>
  );
}
