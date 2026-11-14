"use client";

import Link from "next/link";
import { Loader2, PenLine, RotateCcw, Undo2, Wand2 } from "lucide-react";
import { Badge } from "@/components/ui/badge";
import { ChipGroup, type ChipOption } from "@/components/ui/chip-group";
import { CardTile } from "@/components/cards/card-tile";
import { PrintingPicture } from "@/components/tools/collection/printing-tile";
import { cardToPreviewData } from "@/lib/cards/preview-data";
import { CARD_GRID_COMPACT_CLASS, DASHBOARD_COMPACT_GRID_SIZES } from "@/components/cards/card-grid";
import { cn } from "@/lib/utils";
import {
  REART_SAMPLE_MAX,
  reartStateCountsInStyle,
  reartStateIsSettled,
  reartStateLabel,
  type ReartStudioEntry,
} from "@/lib/tools/re-art/model";

export type ReartGridFilter = "all" | "todo" | "done" | "skipped";

const FILTER_LABELS: Record<ReartGridFilter, string> = {
  all: "All",
  todo: "To paint",
  done: "In this style",
  skipped: "Left as they are",
};

export function gridFilterOf(entry: ReartStudioEntry): Exclude<ReartGridFilter, "all"> {
  if (entry.kind === "skip") return "skipped";
  if (reartStateCountsInStyle(entry.state)) return "done";
  // A card that shows other art now is left as it is by a run over the
  // deck (a re-roll paints it): never "in this style", never "to paint".
  return reartStateIsSettled(entry.state) ? "skipped" : "todo";
}

/**
 * The deck's cards as the studio shows them: each one's picture (the
 * maker's card as it looks now, a real card's printing), where it stands
 * against the style, and what can be done to it — tried in the sample,
 * painted or re-rolled on its own, its old art put back.
 */
export function ReartCardGrid({
  entries,
  username,
  filter,
  onFilter,
  sample,
  onToggleSample,
  busy,
  locked,
  paintBlocked = null,
  onPaintOne,
  onEditWords,
  onRestore,
}: {
  entries: ReartStudioEntry[];
  username: string | null;
  filter: ReartGridFilter;
  onFilter: (next: ReartGridFilter) => void;
  sample: ReadonlySet<string>;
  onToggleSample: (id: string) => void;
  /** The card a one-card action is working on. */
  busy: string | null;
  /** A run is going: one-card actions wait. */
  locked: boolean;
  /** Why one card can't be painted right now (no saved style, or the form
   *  shows a style that isn't saved), or null. Said above the cards; the
   *  studio says it again when a paint link is pressed. */
  paintBlocked?: string | null;
  onPaintOne: (entry: ReartStudioEntry) => void;
  /** Opens the card's own words (0209). Absent: not offered. */
  onEditWords?: (entry: ReartStudioEntry) => void;
  onRestore: (entry: ReartStudioEntry) => void;
}) {
  const counts = { all: entries.length, todo: 0, done: 0, skipped: 0 };
  for (const entry of entries) counts[gridFilterOf(entry)] += 1;
  const options: ChipOption<ReartGridFilter>[] = (Object.keys(FILTER_LABELS) as ReartGridFilter[]).map((value) => ({
    value,
    label: `${FILTER_LABELS[value]} (${counts[value]})`,
  }));
  const shown = filter === "all" ? entries : entries.filter((entry) => gridFilterOf(entry) === filter);
  const sampleFull = sample.size >= REART_SAMPLE_MAX;

  return (
    <section aria-labelledby="reart-cards" className="flex min-w-0 flex-col gap-4">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <h2 id="reart-cards" className="font-display text-lg text-foreground">
          The deck&apos;s cards
        </h2>
        <ChipGroup ariaLabel="Show" keepCase size="sm" options={options} value={filter} onChange={onFilter} />
      </div>
      {paintBlocked ? (
        <p id="reart-paint-blocked" className="text-xs text-warning">
          {paintBlocked}
        </p>
      ) : null}
      {shown.length === 0 ? (
        <p className="rounded-lg border border-border/50 p-6 text-center text-sm text-muted">No cards here.</p>
      ) : (
        <div className="@container">
        <ul className={cn(CARD_GRID_COMPACT_CLASS, "gap-y-6")}>
          {shown.map((entry) => {
            const paintable = entry.kind !== "skip";
            const inSample = sample.has(entry.id);
            const working = busy === entry.id;
            const card = entry.card;
            const href = card ? (username ? `/card/${username}/${card.slug}` : `/card/${card.slug}/edit`) : null;
            const sampleId = `reart-sample-${entry.id}`;
            return (
              <li key={entry.id} className="flex min-w-0 flex-col gap-2">
                <div className={cn("relative", inSample && "rounded-[4.3%] ring-2 ring-primary-bright ring-offset-2 ring-offset-background")}>
                  {card && href ? (
                    <CardTile
                      thumbnail={{
                        renderedImageUrl: card.rendered_image_url,
                        renderedThumbUrl: card.rendered_thumb_url,
                        renderedBackThumbUrl: card.rendered_back_thumb_url,
                        title: card.title,
                        previewData: cardToPreviewData(card),
                        sizes: DASHBOARD_COMPACT_GRID_SIZES,
                      }}
                      body={(slot) => (
                        <Link
                          href={href}
                          className={slot.className}
                          style={slot.style}
                          data-tile-body={slot["data-tile-body"]}
                          aria-label={`${card.title} — open the card`}
                        >
                          {slot.children}
                        </Link>
                      )}
                    />
                  ) : (
                    <PrintingPicture imageUrl={entry.imageUrl} name={entry.name} className={cn(!paintable && "opacity-60")} />
                  )}
                  {entry.quantity > 1 ? (
                    <span className="pointer-events-none absolute left-2 top-2 rounded-md bg-black/70 px-1.5 py-0.5 text-xs font-semibold tabular-nums text-white">
                      ×{entry.quantity}
                    </span>
                  ) : null}
                </div>
                <div className="flex min-w-0 flex-col gap-1.5">
                  <p className="truncate text-sm font-medium text-foreground" title={entry.name}>
                    {entry.name}
                  </p>
                  <p className="flex flex-wrap items-center gap-1.5 text-xs text-muted">
                    {entry.state === "in_style" ? <Badge variant="primary">In this style</Badge> : null}
                    {entry.state === "kept" ? <Badge variant="outline">Kept its own art</Badge> : null}
                    {entry.state === "changed" ? <Badge variant="outline">Has other art now</Badge> : null}
                    {entry.state === "earlier" ? <Badge variant="gold">Earlier style</Badge> : null}
                    {entry.board === "commander" ? <Badge variant="accent">Commander</Badge> : null}
                    {entry.words ? <Badge variant="outline">{entry.words.only ? "Only its own words" : "Own words"}</Badge> : null}
                    {entry.state === null || entry.kind === "skip" ? <span>{reartStateLabel(entry)}</span> : null}
                  </p>
                  {entry.paintedBy ? <p className="text-xs text-subtle">Painted by {entry.paintedBy}</p> : null}
                  {paintable ? (
                    <div className="flex flex-wrap items-center gap-x-3 gap-y-1.5">
                      <label
                        htmlFor={sampleId}
                        className={cn(
                          "inline-flex items-center gap-1.5 text-xs text-muted",
                          locked || (sampleFull && !inSample) ? "opacity-60" : "cursor-pointer hover:text-foreground",
                        )}
                      >
                        <input
                          id={sampleId}
                          type="checkbox"
                          checked={inSample}
                          aria-disabled={locked || (sampleFull && !inSample) ? true : undefined}
                          onChange={() => {
                            if (locked || (sampleFull && !inSample)) return;
                            onToggleSample(entry.id);
                          }}
                          className="h-4 w-4 accent-[var(--color-primary)]"
                        />
                        In the sample
                        <span className="sr-only">: {entry.name}</span>
                        {sampleFull && !inSample ? <span className="sr-only"> — the sample holds {REART_SAMPLE_MAX} cards</span> : null}
                      </label>
                      {/* Opens the confirm (priced there; nothing is charged
                          before its Paint). While one card can't be painted
                          the link says why when pressed, and is described by
                          the note above the cards. */}
                      <button
                        type="button"
                        onClick={() => {
                          if (!locked && !busy) onPaintOne(entry);
                        }}
                        aria-disabled={locked || Boolean(busy) || Boolean(paintBlocked) ? true : undefined}
                        aria-describedby={paintBlocked ? "reart-paint-blocked" : undefined}
                        className={cn(
                          "inline-flex items-center gap-1 rounded-sm text-xs text-primary-bright underline-offset-2 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-primary-bright/60",
                          locked || busy || paintBlocked ? "cursor-not-allowed opacity-60" : "hover:underline",
                        )}
                      >
                        {entry.state ? (
                          <RotateCcw className="h-3.5 w-3.5" aria-hidden />
                        ) : (
                          <Wand2 className="h-3.5 w-3.5" aria-hidden />
                        )}
                        {entry.state ? "Re-roll…" : "Paint this one…"}
                        {entry.kind === "own" ? (
                          <span className="text-muted">
                            · {entry.credits} credit{entry.credits === 1 ? "" : "s"}
                          </span>
                        ) : null}
                        <span className="sr-only"> — {entry.name}</span>
                      </button>
                      {onEditWords ? (
                        <button
                          type="button"
                          onClick={() => {
                            if (!locked) onEditWords(entry);
                          }}
                          aria-disabled={locked ? true : undefined}
                          className={cn(
                            "inline-flex items-center gap-1 rounded-sm text-xs text-muted underline-offset-2 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-primary-bright/60",
                            locked ? "cursor-not-allowed opacity-60" : "hover:text-foreground hover:underline",
                          )}
                        >
                          <PenLine className="h-3.5 w-3.5" aria-hidden />
                          {entry.words ? "Edit its words…" : "Its own words…"}
                          <span className="sr-only"> — {entry.name}</span>
                        </button>
                      ) : null}
                      {entry.canRestore ? (
                        <button
                          type="button"
                          onClick={() => {
                            if (!locked && !busy) onRestore(entry);
                          }}
                          aria-disabled={locked || Boolean(busy) ? true : undefined}
                          className={cn(
                            "inline-flex items-center gap-1 rounded-sm text-xs text-muted underline-offset-2 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-primary-bright/60",
                            locked || busy ? "cursor-not-allowed opacity-60" : "hover:text-foreground hover:underline",
                          )}
                        >
                          {working ? (
                            <Loader2 className="h-3.5 w-3.5 animate-spin" aria-hidden />
                          ) : (
                            <Undo2 className="h-3.5 w-3.5" aria-hidden />
                          )}
                          Old art back
                          <span className="sr-only"> — {entry.name}</span>
                        </button>
                      ) : null}
                    </div>
                  ) : null}
                </div>
              </li>
            );
          })}
        </ul>
        </div>
      )}
    </section>
  );
}
