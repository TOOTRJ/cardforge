// Owner-only bar on the deck page when the deck's latest AI job left cards
// unfinished. Its "Regenerate them" re-ran the failed steps through the
// global runner — and a failed card step was refunded, so a re-run reserves
// its credits again (generation-provider's retryJob). While deck AI is paused
// (owner 2026-10-28, TODO DK1 — D6: only work that is ALREADY paid for
// finishes, lib/ai/deck-ai-pause.ts; the step route refuses a failed deck
// step too) the bar still says what didn't generate and why it can't be
// regenerated, and the button is "Coming soon".

import { RotateCcw, TriangleAlert } from "lucide-react";
import { SurfaceCard } from "@/components/ui/surface-card";
import { DeckAiComingSoonButton, DeckAiPausedNote } from "@/components/decks/deck-ai-coming-soon";

const PAUSED_NOTE_ID = "deck-regenerate-paused-note";

export function DeckRegenerateBar({
  failedCount,
  failedLabels,
}: {
  /** The job a regenerate would re-run; unread while deck AI is paused. */
  jobId: string;
  failedCount: number;
  failedLabels: string[];
}) {
  const preview = failedLabels.slice(0, 3).join(", ");

  return (
    <SurfaceCard className="mt-8 flex flex-wrap items-center gap-4 border-danger/40 bg-danger/5 p-5">
      <TriangleAlert className="h-5 w-5 shrink-0 text-danger" aria-hidden />
      {/* A floor on the text's width: on a phone the button wraps under it
          instead of squeezing it to a word per line. */}
      <div className="flex min-w-48 flex-1 flex-col gap-0.5">
        <span className="text-sm font-semibold text-foreground">
          {failedCount} {failedCount === 1 ? "card didn't" : "cards didn't"} generate
        </span>
        <span className="truncate text-xs text-muted">
          {preview}
          {failedLabels.length > 3 ? ` +${failedLabels.length - 3} more` : ""} — usually a hiccup painting the art.
        </span>
        <DeckAiPausedNote id={PAUSED_NOTE_ID} />
      </div>
      <DeckAiComingSoonButton
        label={`Regenerate ${failedCount === 1 ? "it" : "them"}`}
        icon={<RotateCcw className="h-4 w-4" aria-hidden />}
        describedBy={PAUSED_NOTE_ID}
      />
    </SurfaceCard>
  );
}
