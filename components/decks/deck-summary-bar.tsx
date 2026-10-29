import Link from "next/link";
import { AlertTriangle, ArrowRight, CheckCircle2, Crown } from "lucide-react";
import type { DeckSummary } from "@/lib/decks/deck-summary";
import { ENTRY_BADGE_LABELS } from "@/lib/decks/deck-view";
import { cn } from "@/lib/utils";

// ---------------------------------------------------------------------------
// The deck's sticky summary bar (TODO DK5.9, WD5): the count against the
// format's size, the commander, the format check (the OWNER's alone — a
// visitor never sees it, #645 / TODO DK0.9), the composition, the average
// mana value and the lands, and — for the owner — "Edit next": the next
// unchanged import in the order the list shows, opened in its Customize
// flow (`/create?deckCard=`).
//
// It sticks to the bottom of the screen while the cards scroll and rests
// under the last of them (sticky, never fixed): it never covers what comes
// after the card area, and the last row is never left under it. It is a
// plain landmark of links and text — nothing to trap the focus — and the
// openers above keep clear of it when the focus scrolls them into view
// (scroll-margin). It is one line at every width: the size, the commander
// and the check always; the composition from 1280 px, the average and the
// lands from 1536 px (all of them in the breakdown below).
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
  editNext,
  unchanged,
  canManage,
}: {
  summary: DeckSummary;
  /** The owner's format check (0 = passes); null for a visitor. */
  formatIssues: number | null;
  /** The next unchanged import the Customize flow takes, or null. */
  editNext: { href: string; name: string } | null;
  /** Cards still as imported (the composition's Imported). */
  unchanged: number;
  canManage: boolean;
}) {
  const sizeText = summary.target ? `${summary.size} / ${summary.target}` : `${summary.size}`;
  const sizeLabel = summary.target
    ? `${summary.size} of ${summary.target} cards${summary.sizeState === "ok" ? "" : summary.sizeState === "short" ? ", short of the format's size" : ", over the format's size"}`
    : `${summary.size} cards`;
  const commanders = summary.commanders;

  return (
    <section
      aria-label="Deck summary"
      className="sticky bottom-2 z-20 rounded-frame border border-border bg-surface/95 px-3 py-2 shadow-[0_-12px_40px_-24px_rgba(0,0,0,0.7)] backdrop-blur supports-[backdrop-filter]:bg-surface/85 sm:bottom-3 sm:px-4 sm:py-2.5"
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
                <span>No commander yet</span>
              )}
            </Item>
          ) : null}
          {formatIssues !== null ? (
            <Item>
              {formatIssues === 0 ? (
                <>
                  <CheckCircle2 className="h-3.5 w-3.5 text-primary-bright" aria-hidden />
                  <span>Format check passes</span>
                </>
              ) : (
                <a
                  href="#format-check"
                  className="inline-flex items-center gap-1.5 rounded-sm text-gold underline-offset-4 hover:underline focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-primary-bright/50"
                >
                  <AlertTriangle className="h-3.5 w-3.5" aria-hidden />
                  {formatIssues} format issue{formatIssues === 1 ? "" : "s"}
                </a>
              )}
            </Item>
          ) : null}
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
