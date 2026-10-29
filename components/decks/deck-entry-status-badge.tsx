import { Badge } from "@/components/ui/badge";
import { cn } from "@/lib/utils";
import { DECK_ENTRY_STATUS_LABELS, type DeckEntryStatus } from "@/types/deck";

// ---------------------------------------------------------------------------
// One deck entry's status badge (TODO DK2.6): Imported / Edited / Remix /
// Original / Not found from deckEntryStatus (lib/decks/entry-status.ts),
// or "No longer available" where the entry's PipGlyph card is gone
// (deckEntryUnavailable, D3). The deck list's rows and the pop-up share it,
// so both say the same word.
// ---------------------------------------------------------------------------

export const NO_LONGER_AVAILABLE = "No longer available";

const VARIANT: Record<DeckEntryStatus, "outline" | "primary" | "accent" | "gold"> = {
  imported: "outline",
  edited: "primary",
  remix: "accent",
  original: "gold",
  not_found: "outline",
};

export function DeckEntryStatusBadge({
  status,
  unavailable = false,
  small = false,
}: {
  status: DeckEntryStatus;
  unavailable?: boolean;
  /** The list row's size (10 px); the pop-up's default otherwise. */
  small?: boolean;
}) {
  return (
    <Badge
      variant={unavailable ? "outline" : VARIANT[status]}
      className={cn("shrink-0", small && "text-[10px]", unavailable && "border-dashed")}
      data-status={unavailable ? "unavailable" : status}
    >
      {unavailable ? NO_LONGER_AVAILABLE : DECK_ENTRY_STATUS_LABELS[status]}
    </Badge>
  );
}
