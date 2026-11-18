"use client";

import Link from "next/link";
import { useEffect, useId, useRef, useState } from "react";
import { History, Loader2, Lock, LockOpen, PenLine, RotateCcw, Undo2, Wand2 } from "lucide-react";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { ChipGroup, type ChipOption } from "@/components/ui/chip-group";
import { CardTile } from "@/components/cards/card-tile";
import { PrintingPicture } from "@/components/tools/collection/printing-tile";
import { cardToPreviewData } from "@/lib/cards/preview-data";
import { CARD_GRID_COMPACT_CLASS, DASHBOARD_COMPACT_GRID_SIZES } from "@/components/cards/card-grid";
import { inputClass } from "@/components/ui/field-classes";
import { cn } from "@/lib/utils";
import {
  REART_SAMPLE_MAX,
  reartStateCountsInStyle,
  reartStateIsSettled,
  reartStateLabel,
  type ReartStudioEntry,
} from "@/lib/tools/re-art/model";

export type ReartGridFilter = "all" | "todo" | "done" | "skipped" | "locked";

const FILTER_LABELS: Record<ReartGridFilter, string> = {
  all: "All",
  todo: "To paint",
  done: "In this style",
  skipped: "Left as they are",
  locked: "Locked",
};

/** The type buckets a card falls in (lib/tools/re-art/server.ts
 *  bucketOfItem), in words. */
const BUCKET_LABELS: Record<string, string> = {
  creature: "Creatures",
  spell: "Instants and sorceries",
  land: "Lands",
  permanent: "Artifacts and enchantments",
  planeswalker: "Planeswalkers",
  other: "Other",
};
const BUCKET_ORDER = ["creature", "spell", "permanent", "land", "planeswalker", "other"];

export function gridFilterOf(entry: ReartStudioEntry): Exclude<ReartGridFilter, "all" | "locked"> {
  if (entry.kind === "skip") return "skipped";
  // A locked card is left as it is by everything the tool does (0216).
  if (entry.locked) return "skipped";
  if (reartStateCountsInStyle(entry.state)) return "done";
  // A card that shows other art now is left as it is by a run over the
  // deck (a re-roll paints it): never "in this style", never "to paint".
  return reartStateIsSettled(entry.state) ? "skipped" : "todo";
}

/** The cards the list shows: the state chip, the type and the name typed —
 *  pure, so "Select all shown" and the list read one answer. */
export function shownEntries(
  entries: ReadonlyArray<ReartStudioEntry>,
  view: { filter: ReartGridFilter; bucket: string; query: string },
): ReartStudioEntry[] {
  const words = view.query.trim().toLowerCase();
  return entries.filter((entry) => {
    if (view.filter === "locked" ? !entry.locked : view.filter !== "all" && gridFilterOf(entry) !== view.filter) return false;
    if (view.bucket !== "all" && entry.bucket !== view.bucket) return false;
    return !words || entry.name.toLowerCase().includes(words);
  });
}

/** A card the selection can hold: one the tool can paint. */
const selectable = (entry: ReartStudioEntry) => entry.kind !== "skip";

/**
 * The deck's cards as the studio shows them: each one's picture (the
 * maker's card as it looks now, a real card's printing), where it stands
 * against the style, and what can be done to it — tried in the sample,
 * painted or re-rolled on its own, its old art put back, locked (0216).
 * Above them: the list's filters (state, type, name), and "Select cards",
 * which turns the cards' checkbox into a selection to paint, lock or unlock
 * together.
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
  onEarlier,
  onRestore,
  selection,
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
  /** Opens the card's earlier pictures (0215). Absent: not offered. */
  onEarlier?: (entry: ReartStudioEntry) => void;
  onRestore: (entry: ReartStudioEntry) => void;
  /** Selecting several cards, and locking (0216). Absent: neither is
   *  offered (the list on its own). */
  selection?: {
    selected: ReadonlySet<string>;
    onSelected: (next: Set<string>) => void;
    /** Paints the cards named (the studio prices them in its confirm). */
    onPaint: (entries: ReartStudioEntry[]) => void;
    /** Locks or unlocks the cards named. */
    onLock: (entries: ReartStudioEntry[], lock: boolean) => void;
    /** A lock or unlock is on its way. */
    working: boolean;
  };
}) {
  const noteId = useId();
  const [bucket, setBucket] = useState("all");
  const [query, setQuery] = useState("");
  const [selecting, setSelecting] = useState(false);

  const counts = { all: entries.length, todo: 0, done: 0, skipped: 0, locked: 0 };
  for (const entry of entries) {
    counts[gridFilterOf(entry)] += 1;
    if (entry.locked) counts.locked += 1;
  }
  const options: ChipOption<ReartGridFilter>[] = (Object.keys(FILTER_LABELS) as ReartGridFilter[])
    // "Locked" appears once a card is locked (or while it is the view).
    .filter((value) => value !== "locked" || counts.locked > 0 || filter === "locked")
    .map((value) => ({ value, label: `${FILTER_LABELS[value]} (${counts[value]})` }));
  const buckets = BUCKET_ORDER.filter((key) => entries.some((entry) => entry.bucket === key));
  const shown = shownEntries(entries, { filter, bucket, query });
  const sampleFull = sample.size >= REART_SAMPLE_MAX;

  const selected = selection?.selected ?? new Set<string>();
  const picked = entries.filter((entry) => selected.has(entry.id) && selectable(entry));
  const pickedToPaint = picked.filter((entry) => !entry.locked);
  const waiting = locked || Boolean(busy) || Boolean(selection?.working);
  // Picked cards the list isn't showing (a filter, a name typed): they are
  // still acted on, so the bar says how many.
  const shownIds = new Set(shown.map((entry) => entry.id));
  const pickedHidden = picked.filter((entry) => !shownIds.has(entry.id)).length;

  // A card that is locked or unlocked can LEAVE the view (a locked card is
  // among those left as they are; an unlocked one leaves "Locked"), and its
  // button with it. The focus is then handed to the card that took its
  // PLACE in the list (the last one, for the last; the name box when none
  // is left) — without scrolling: a mouse user keeps their place. Never
  // left on <body>, never moved for a card that is still listed, and
  // forgotten once the press is over, so a later re-read of the page moves
  // nothing.
  const lockPressed = useRef<{ id: string; index: number; wasLocked: boolean; sawWorking: boolean } | null>(null);
  const findRef = useRef<HTMLInputElement>(null);
  const lockWorking = Boolean(selection?.working);
  useEffect(() => {
    const pressed = lockPressed.current;
    if (!pressed) return;
    // The lock is on its way: wait for the page to re-read.
    if (lockWorking) {
      pressed.sawWorking = true;
      return;
    }
    if (document.querySelector(`[data-reart-lock="${pressed.id}"]`)) {
      // Still listed. Over once the page re-read (its lock turned) or the
      // request ended without one (a refusal): nothing to hand on.
      const now = entries.find((entry) => entry.id === pressed.id);
      if (pressed.sawWorking || !now || Boolean(now.locked) !== pressed.wasLocked) lockPressed.current = null;
      return;
    }
    lockPressed.current = null;
    const active = document.activeElement;
    // The maker moved on by themselves.
    if (active && active !== document.body) return;
    const buttons = [...document.querySelectorAll<HTMLElement>("[data-reart-lock]")];
    const next = buttons[Math.min(pressed.index, buttons.length - 1)];
    if (next) next.focus({ preventScroll: true });
    else findRef.current?.focus();
  });

  const toggleSelected = (id: string) => {
    if (!selection) return;
    const next = new Set(selected);
    if (next.has(id)) next.delete(id);
    else next.add(id);
    selection.onSelected(next);
  };

  return (
    <section aria-labelledby="reart-cards" className="flex min-w-0 flex-col gap-4">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <h2 id="reart-cards" className="font-display text-lg text-foreground">
          The deck&apos;s cards
        </h2>
        <ChipGroup ariaLabel="Show" keepCase size="sm" options={options} value={filter} onChange={onFilter} />
      </div>

      <div className="flex flex-wrap items-end gap-3">
        <label className="flex min-w-[12rem] flex-1 flex-col gap-1 text-xs text-muted">
          Find a card
          <input
            ref={findRef}
            type="search"
            value={query}
            onChange={(event) => setQuery(event.target.value)}
            placeholder="Type part of its name"
            className={inputClass(false)}
          />
        </label>
        {buckets.length > 1 ? (
          <label className="flex flex-col gap-1 text-xs text-muted">
            Type
            <select value={bucket} onChange={(event) => setBucket(event.target.value)} className={cn(inputClass(false), "pr-8")}>
              <option value="all">All types</option>
              {buckets.map((key) => (
                <option key={key} value={key}>
                  {BUCKET_LABELS[key] ?? key}
                </option>
              ))}
            </select>
          </label>
        ) : null}
        {selection ? (
          <Button
            // Its words say which way it goes (no pressed state beside a
            // label that changes: a screen reader would hear both).
            variant={selecting ? "secondary" : "outline"}
            size="sm"
            onClick={() => {
              // Leaving the mode lets go of what was picked: a selection
              // nobody can see must not be acted on later.
              if (selecting) selection.onSelected(new Set());
              setSelecting(!selecting);
            }}
          >
            {selecting ? "Done selecting" : "Select cards"}
          </Button>
        ) : null}
      </div>

      {selection && selecting ? (
        <div
          role="group"
          aria-label="Selected cards"
          className="flex flex-wrap items-center gap-2 rounded-lg border border-primary/40 bg-surface/60 px-3 py-2 text-sm"
        >
          <p role="status" className="mr-auto tabular-nums text-foreground">
            {picked.length} selected
            {pickedHidden > 0 ? <span className="text-muted"> · {pickedHidden} not shown</span> : null}
          </p>
          <Button
            variant="ghost"
            size="sm"
            onClick={() => selection.onSelected(new Set([...selected, ...shown.filter(selectable).map((entry) => entry.id)]))}
          >
            Select all shown
          </Button>
          <Button
            variant="ghost"
            size="sm"
            onClick={() => selection.onSelected(new Set())}
            aria-disabled={picked.length === 0 ? true : undefined}
            className={picked.length === 0 ? "cursor-not-allowed opacity-60" : undefined}
          >
            Clear
          </Button>
          <Button
            variant="outline"
            size="sm"
            onClick={() => {
              if (!waiting && picked.some((entry) => !entry.locked)) selection.onLock(picked.filter((entry) => !entry.locked), true);
            }}
            aria-disabled={waiting || !picked.some((entry) => !entry.locked) ? true : undefined}
            className={waiting || !picked.some((entry) => !entry.locked) ? "cursor-not-allowed opacity-60" : undefined}
          >
            <Lock className="h-4 w-4" aria-hidden />
            Lock
          </Button>
          <Button
            variant="outline"
            size="sm"
            onClick={() => {
              if (!waiting && picked.some((entry) => entry.locked)) selection.onLock(picked.filter((entry) => entry.locked), false);
            }}
            aria-disabled={waiting || !picked.some((entry) => entry.locked) ? true : undefined}
            className={waiting || !picked.some((entry) => entry.locked) ? "cursor-not-allowed opacity-60" : undefined}
          >
            <LockOpen className="h-4 w-4" aria-hidden />
            Unlock
          </Button>
          <Button
            size="sm"
            onClick={() => {
              if (!waiting && pickedToPaint.length > 0) selection.onPaint(pickedToPaint);
            }}
            aria-disabled={waiting || pickedToPaint.length === 0 || Boolean(paintBlocked) ? true : undefined}
            aria-describedby={paintBlocked ? "reart-paint-blocked" : undefined}
            className={waiting || pickedToPaint.length === 0 || paintBlocked ? "cursor-not-allowed opacity-60" : undefined}
          >
            <Wand2 className="h-4 w-4" aria-hidden />
            Paint selected…
          </Button>
        </div>
      ) : null}

      {paintBlocked ? (
        <p id="reart-paint-blocked" className="text-xs text-warning">
          {paintBlocked}
        </p>
      ) : null}
      {counts.locked > 0 ? (
        <p id={noteId} className="text-xs text-subtle">
          A locked card is left as it is by everything on this deck&apos;s page: a run, a sample, a re-roll, an earlier
          picture, old art back and an undo. Unlock it to change its picture. Another deck that holds the same card has
          its own locks.
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
            const isSelected = selected.has(entry.id);
            const working = busy === entry.id;
            const cardLocked = Boolean(entry.locked);
            const card = entry.card;
            const href = card ? (username ? `/card/${username}/${card.slug}` : `/card/${card.slug}/edit`) : null;
            const sampleId = `reart-sample-${entry.id}`;
            // A one-card action waits for a run, for another action — and
            // on a locked card until it is unlocked.
            const held = locked || Boolean(busy) || cardLocked;
            const lockNote = cardLocked ? noteId : undefined;
            return (
              <li key={entry.id} className="flex min-w-0 flex-col gap-2">
                <div
                  className={cn(
                    "relative",
                    (selecting ? isSelected : inSample) && "rounded-[4.3%] ring-2 ring-primary-bright ring-offset-2 ring-offset-background",
                  )}
                >
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
                    {cardLocked ? (
                      <Badge variant="outline">
                        <Lock className="mr-1 h-3 w-3" aria-hidden />
                        Locked
                      </Badge>
                    ) : null}
                    {entry.state === "in_style" ? <Badge variant="primary">In this style</Badge> : null}
                    {entry.state === "kept" ? <Badge variant="outline">Kept its own art</Badge> : null}
                    {entry.state === "changed" ? <Badge variant="outline">Has other art now</Badge> : null}
                    {entry.state === "earlier" ? <Badge variant="gold">Earlier style</Badge> : null}
                    {entry.board === "commander" ? <Badge variant="accent">Commander</Badge> : null}
                    {entry.words ? <Badge variant="outline">{entry.words.only ? "Only its own words" : "Own words"}</Badge> : null}
                    {entry.state === null || entry.kind === "skip" ? <span>{reartStateLabel(entry)}</span> : null}
                  </p>
                  {entry.paintedBy ? (
                    <p className="text-xs text-subtle">
                      {entry.restyled ? "Restyled from its art by" : "Painted by"} {entry.paintedBy}
                    </p>
                  ) : entry.restyled ? (
                    <p className="text-xs text-subtle">Restyled from its art</p>
                  ) : null}
                  {paintable ? (
                    <div className="flex flex-wrap items-center gap-x-3 gap-y-1.5">
                      {selection && selecting ? (
                        <label htmlFor={sampleId} className="inline-flex cursor-pointer items-center gap-1.5 text-xs text-muted hover:text-foreground">
                          <input
                            id={sampleId}
                            type="checkbox"
                            checked={isSelected}
                            onChange={() => toggleSelected(entry.id)}
                            className="h-4 w-4 accent-[var(--color-primary)]"
                          />
                          Select
                          <span className="sr-only">: {entry.name}</span>
                        </label>
                      ) : (
                        <label
                          htmlFor={sampleId}
                          className={cn(
                            "inline-flex items-center gap-1.5 text-xs text-muted",
                            locked || cardLocked || (sampleFull && !inSample) ? "opacity-60" : "cursor-pointer hover:text-foreground",
                          )}
                        >
                          <input
                            id={sampleId}
                            type="checkbox"
                            checked={inSample}
                            aria-disabled={locked || cardLocked || (sampleFull && !inSample) ? true : undefined}
                            aria-describedby={lockNote}
                            onChange={() => {
                              // A locked card can leave the sample, never join it.
                              if (locked || (cardLocked && !inSample) || (sampleFull && !inSample)) return;
                              onToggleSample(entry.id);
                            }}
                            className="h-4 w-4 accent-[var(--color-primary)]"
                          />
                          In the sample
                          <span className="sr-only">: {entry.name}</span>
                          {sampleFull && !inSample ? <span className="sr-only"> — the sample holds {REART_SAMPLE_MAX} cards</span> : null}
                        </label>
                      )}
                      {/* Opens the confirm (priced there; nothing is charged
                          before its Paint). While one card can't be painted
                          the link says why when pressed, and is described by
                          the note above the cards. */}
                      <button
                        type="button"
                        data-reart-paint={entry.id}
                        onClick={() => {
                          if (!held) onPaintOne(entry);
                        }}
                        aria-disabled={held || Boolean(paintBlocked) ? true : undefined}
                        aria-describedby={cn(paintBlocked && "reart-paint-blocked", lockNote) || undefined}
                        className={cn(
                          "inline-flex items-center gap-1 rounded-sm text-xs text-primary-bright underline-offset-2 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-primary-bright/60",
                          held || paintBlocked ? "cursor-not-allowed opacity-60" : "hover:underline",
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
                      {onEarlier && entry.earlier && entry.earlier.length > 0 ? (
                        <button
                          type="button"
                          data-earlier-pictures={entry.id}
                          onClick={() => {
                            if (!held) onEarlier(entry);
                          }}
                          aria-disabled={held ? true : undefined}
                          aria-describedby={lockNote}
                          className={cn(
                            "inline-flex items-center gap-1 rounded-sm text-xs text-muted underline-offset-2 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-primary-bright/60",
                            held ? "cursor-not-allowed opacity-60" : "hover:text-foreground hover:underline",
                          )}
                        >
                          <History className="h-3.5 w-3.5" aria-hidden />
                          Earlier pictures ({entry.earlier.length})…
                          <span className="sr-only"> — {entry.name}</span>
                        </button>
                      ) : null}
                      {entry.canRestore ? (
                        <button
                          type="button"
                          onClick={() => {
                            if (!held) onRestore(entry);
                          }}
                          aria-disabled={held ? true : undefined}
                          aria-describedby={lockNote}
                          className={cn(
                            "inline-flex items-center gap-1 rounded-sm text-xs text-muted underline-offset-2 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-primary-bright/60",
                            held ? "cursor-not-allowed opacity-60" : "hover:text-foreground hover:underline",
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
                      {selection ? (
                        <button
                          type="button"
                          data-reart-lock={entry.id}
                          onClick={() => {
                            if (waiting) return;
                            lockPressed.current = {
                              id: entry.id,
                              index: shown.findIndex((shownEntry) => shownEntry.id === entry.id),
                              wasLocked: cardLocked,
                              sawWorking: false,
                            };
                            selection.onLock([entry], !cardLocked);
                          }}
                          aria-disabled={waiting ? true : undefined}
                          className={cn(
                            "inline-flex items-center gap-1 rounded-sm text-xs text-muted underline-offset-2 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-primary-bright/60",
                            waiting ? "cursor-not-allowed opacity-60" : "hover:text-foreground hover:underline",
                          )}
                        >
                          {cardLocked ? <LockOpen className="h-3.5 w-3.5" aria-hidden /> : <Lock className="h-3.5 w-3.5" aria-hidden />}
                          {cardLocked ? "Unlock" : "Lock"}
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
