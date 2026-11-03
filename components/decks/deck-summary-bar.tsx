"use client";

import Link from "next/link";
import { AlertTriangle, ArrowRight, CheckCircle2, Crown } from "lucide-react";
import { InfoTip } from "@/components/ui/info-tip";
import type { DeckSummary } from "@/lib/decks/deck-summary";
import { ENTRY_BADGE_LABELS } from "@/lib/decks/deck-view";
import { TOTAL_MANA_VALUE_ARTICLE_HREF, TOTAL_MANA_VALUE_HELP } from "@/lib/decks/deck-help";
import type { DeckWarning } from "@/lib/decks/format-rules";
import { deckEntryAnchor } from "@/lib/decks/return-to";
import { cn } from "@/lib/utils";

// ---------------------------------------------------------------------------
// The deck's sticky summary bar (TODO DK5.9, WD5): the count against the
// format's size, the commander, the format check (the OWNER's alone — a
// visitor never sees it, #645 / TODO DK0.9), the composition, the average
// mana value and the lands, and — for the owner — "Edit next": the next
// unchanged import in the order the list shows, opened in its Customize
// flow (`/create?deckCard=`) with its way back (TODO DK5.5): saved, the
// creator returns to the deck at that card's anchor (`#next-<id>`) and the
// focus comes back here — to an "Edit next" that by then names the next
// one, so the walk goes on with one key.
//
// It sticks to the bottom of the screen while the cards scroll and rests
// under the last of them (sticky, never fixed): it never covers what comes
// after the card area, and the last row is never left under it. It is a
// plain landmark of links and text — nothing to trap the focus — and the
// openers above keep clear of it when the focus scrolls them into view
// (scroll-margin). It is one line at every width: the size, the commander
// and the check always; the total mana value from 1024 px, the composition
// from 1280 px, the average and the lands from 1536 px (all of them in the
// breakdown below).
//
// TODO DK11: the total mana value carries an info box (hover or keyboard
// focus; a press pins it) that says how it is counted and links to the
// guide on comparing decks by it; the format check's count opens the list
// of its issues the same way, and an issue about a card (too many copies)
// is a link that scrolls to THAT card's row and puts the focus on it
// (`onGoToEntry`, the list's: a filter or a folded group hiding the row is
// lifted first).
// ---------------------------------------------------------------------------

const SIZE_TONE: Record<DeckSummary["sizeState"], string> = {
  ok: "text-foreground",
  short: "text-gold",
  over: "text-gold",
  free: "text-foreground",
};

function Item({ children, className }: { children: React.ReactNode; className?: string }) {
  return <li className={cn("flex shrink-0 items-center gap-1.5 whitespace-nowrap", className)}>{children}</li>;
}

export function DeckSummaryBar({
  summary,
  formatIssues,
  onGoToEntry,
  editNext,
  onEditNext,
  onEditIntent,
  unchanged,
  canManage,
  className,
}: {
  summary: DeckSummary;
  /** The owner's format check (empty = passes); null for a visitor. */
  formatIssues: readonly DeckWarning[] | null;
  /** Scroll to an entry's row and focus it (an issue's link). */
  onGoToEntry?: (entryId: string) => void;
  /** The next unchanged import the Customize flow takes, or null. */
  editNext: { href: string; name: string } | null;
  /** The deck's edit drawer (TODO DK5.18): "Edit next" opens it there (a
   *  modified click still follows the link). Left out: the link, as on main. */
  onEditNext?: () => void;
  /** Fetch the drawer's chunk ahead (hover / focus on "Edit next"). */
  onEditIntent?: () => void;
  /** Cards still as imported (the composition's Imported). */
  unchanged: number;
  canManage: boolean;
  /** The owner's page on a phone lifts it over the editing bar. */
  className?: string;
}) {
  const sizeText = summary.target ? `${summary.size} / ${summary.target}` : `${summary.size}`;
  const sizeLabel = summary.target
    ? `${summary.size} of ${summary.target} cards${summary.sizeState === "ok" ? "" : summary.sizeState === "short" ? ", short of the format's size" : ", over the format's size"}`
    : `${summary.size} cards`;
  const commanders = summary.commanders;

  return (
    <section
      aria-label="Deck summary"
      className={cn(
        "sticky bottom-2 z-20 rounded-frame border border-border bg-surface/95 px-3 py-2 shadow-[0_-12px_40px_-24px_rgba(0,0,0,0.7)] backdrop-blur supports-[backdrop-filter]:bg-surface/85 sm:bottom-3 sm:px-4 sm:py-2.5",
        className,
      )}
    >
      <div className="flex items-center gap-x-4 gap-y-1">
        <ul className="flex min-w-0 flex-1 items-center gap-x-4 overflow-hidden py-1 text-xs text-muted sm:text-sm">
          <Item className={SIZE_TONE[summary.sizeState]}>
            <span aria-hidden className="font-mono font-semibold tabular-nums">
              {sizeText}
            </span>
            <span className="sr-only">{sizeLabel}</span>
            <span aria-hidden className="text-subtle">
              cards
            </span>
          </Item>
          {commanders ? (
            <Item className="min-w-0 shrink">
              <Crown className={cn("h-3.5 w-3.5 shrink-0", commanders.length > 0 ? "text-gold" : "text-subtle")} aria-hidden />
              {commanders.length > 0 ? (
                <span className="min-w-0 truncate">
                  <span className="sr-only">Commander: </span>
                  <span className="text-foreground">{commanders.join(" & ")}</span>
                </span>
              ) : (
                <span className="min-w-0 truncate">No commander yet</span>
              )}
            </Item>
          ) : null}
          {formatIssues !== null ? (
            <Item>
              {formatIssues.length === 0 ? (
                <>
                  <CheckCircle2 className="h-3.5 w-3.5 text-primary-bright" aria-hidden />
                  <span>Format check passes</span>
                </>
              ) : (
                <FormatIssues issues={formatIssues} onGoToEntry={onGoToEntry} />
              )}
            </Item>
          ) : null}
          <Item className="hidden lg:flex">
            Total mana value{" "}
            <span className="font-mono tabular-nums text-foreground">{formatTotal(summary.totalManaValue)}</span>
            <TotalManaValueTip />
          </Item>
          <Item className="hidden xl:flex">
            <span className="sr-only">Composition: </span>
            {summary.composition
              .map((row) => `${ENTRY_BADGE_LABELS[row.badge]} ${row.count}`)
              .join(" · ")}
          </Item>
          {summary.averageManaValue !== null ? (
            <Item className="hidden 2xl:flex">
              Avg mana value <span className="font-mono tabular-nums text-foreground">{summary.averageManaValue.toFixed(1)}</span>
            </Item>
          ) : null}
          <Item className="hidden 2xl:flex">
            Lands <span className="font-mono tabular-nums text-foreground">{summary.lands}</span>
          </Item>
        </ul>
        {canManage && editNext ? (
          <Link
            href={editNext.href}
            onClick={
              onEditNext
                ? (event) => {
                    if (event.defaultPrevented || event.button !== 0 || event.metaKey || event.ctrlKey || event.shiftKey || event.altKey) return;
                    event.preventDefault();
                    onEditNext();
                  }
                : undefined
            }
            onPointerEnter={onEditIntent}
            onFocus={onEditIntent}
            data-edit-next=""
            data-edit-next-name={editNext.name}
            className="inline-flex shrink-0 items-center gap-1.5 rounded-md text-xs font-medium text-primary-bright underline-offset-4 hover:underline focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-primary-bright/50 sm:text-sm"
            aria-label={`Edit next: customize ${editNext.name}${unchanged > 0 ? ` (${unchanged} card${unchanged === 1 ? "" : "s"} not changed yet)` : ""}`}
          >
            <span className="hidden text-muted xl:inline">
              {unchanged} not changed yet ·
            </span>
            Edit next
            <ArrowRight className="h-3.5 w-3.5" aria-hidden />
          </Link>
        ) : null}
      </div>
    </section>
  );
}

/** A whole number as it is; a half mana (Un-sets) to one place. */
function formatTotal(value: number): string {
  return Number.isInteger(value) ? String(value) : value.toFixed(1);
}

/** How the total mana value is counted, and the guide (TODO DK11 (b)) —
 *  the bar's and the breakdown's one box. */
export function TotalManaValueTip({ side = "top" }: { side?: "top" | "bottom" }) {
  return (
    <InfoTip label="About total mana value" side={side}>
      <p className="font-semibold text-foreground">{TOTAL_MANA_VALUE_HELP.title}</p>
      <p className="mt-1">{TOTAL_MANA_VALUE_HELP.body}</p>
      <p className="mt-1">{TOTAL_MANA_VALUE_HELP.use}</p>
      <p className="mt-2">
        <Link
          href={TOTAL_MANA_VALUE_ARTICLE_HREF}
          className="font-medium text-primary-bright underline-offset-4 hover:underline focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-primary-bright/60"
        >
          {TOTAL_MANA_VALUE_HELP.linkLabel}
        </Link>
      </p>
    </InfoTip>
  );
}

const ISSUE_LINK =
  "rounded-sm text-foreground underline decoration-gold/50 underline-offset-4 hover:decoration-gold focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-primary-bright/60";

/** The owner's format issues: the count, and the list on hover / focus —
 *  an issue about a card links to that card's row (TODO DK11 (d)). */
function FormatIssues({
  issues,
  onGoToEntry,
}: {
  issues: readonly DeckWarning[];
  onGoToEntry?: (entryId: string) => void;
}) {
  const count = `${issues.length} format issue${issues.length === 1 ? "" : "s"}`;
  return (
    <InfoTip
      label={count}
      side="top"
      align="start"
      className="w-80"
      triggerClassName="text-gold underline-offset-4 hover:underline"
      trigger={
        <>
          <AlertTriangle className="h-3.5 w-3.5" aria-hidden />
          {count}
        </>
      }
    >
      <p className="font-semibold text-foreground">Format check</p>
      <ul className="mt-1.5 flex flex-col gap-1.5">
        {issues.map((issue, index) => {
          const entryId = issue.entryIds?.[0];
          return (
            <li key={`${issue.code}-${index}`} className="flex gap-1.5">
              <AlertTriangle className="mt-1 h-3 w-3 shrink-0 text-gold" aria-hidden />
              {entryId && onGoToEntry ? (
                <a
                  href={deckEntryAnchor(entryId)}
                  data-format-issue-entry={entryId}
                  className={ISSUE_LINK}
                  onClick={(event) => {
                    event.preventDefault();
                    onGoToEntry(entryId);
                  }}
                >
                  {issue.message}
                </a>
              ) : (
                <span>{issue.message}</span>
              )}
            </li>
          );
        })}
      </ul>
      <p className="mt-2">
        <a href="#format-check" className="font-medium text-primary-bright underline-offset-4 hover:underline focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-primary-bright/60">
          Open the format check
        </a>
      </p>
    </InfoTip>
  );
}
