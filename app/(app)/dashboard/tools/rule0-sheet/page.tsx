import type { Metadata } from "next";
import Link from "next/link";
import { ChevronRight, ScrollText } from "lucide-react";
import { ToolShell } from "@/components/tools/tool-shell";
import { EmptyState } from "@/components/ui/empty-state";
import { Badge } from "@/components/ui/badge";
import { NewDeckButton } from "@/components/decks/new-deck-provider";
import { listMyDecks } from "@/lib/decks/queries";
import { openTool } from "@/lib/tools/queries";
import { listMyTableSheets } from "@/lib/tools/rule0/queries";
import { tableSheetPath } from "@/lib/tools/rule0/model";
import { DECK_FORMAT_LABELS } from "@/types/deck";
import { VISIBILITY_LABELS } from "@/types/card";

// ---------------------------------------------------------------------------
// /dashboard/tools/rule0-sheet — the Rule 0 table sheet beta tool (migration
// 0190): pick one of your decks and open its sheet (/deck/<slug>/table-sheet,
// also reached from the deck page's "Table sheet"). Admins and testers while
// in beta (openTool: a 404 for anyone else). Free; the AI draft costs 1
// credit.
// ---------------------------------------------------------------------------

export const metadata: Metadata = {
  title: "Rule 0 Table Sheet",
  robots: { index: false, follow: false },
};

export const dynamic = "force-dynamic";

export default async function Rule0SheetToolPage() {
  const entry = await openTool("rule0-sheet");
  const [decks, sheets] = await Promise.all([listMyDecks(), listMyTableSheets(entry.userId)]);
  // Commander decks first (the brackets are Commander's), then by last edit.
  const ordered = [...decks].sort(
    (a, b) => Number(b.format === "commander") - Number(a.format === "commander"),
  );

  return (
    <ToolShell entry={entry}>
      <div className="flex flex-col gap-8">
        <div className="flex max-w-[38rem] flex-col gap-2 text-sm leading-6 text-muted">
          <p>
            Before a game, show the table what your deck is: its bracket beside a Game Changers check, how it plays and
            wins, and every custom card and proxy in it — named, so nobody is surprised mid-game.
          </p>
          <p>
            Open a deck&apos;s sheet to write your game plan (or let AI draft it for 1 credit). Show it on screen, print it on
            one page, or share the link — it carries a QR code to the deck.
          </p>
        </div>

        <section aria-labelledby="rule0-decks" className="flex flex-col gap-3">
          <h2 id="rule0-decks" className="font-display text-lg font-semibold text-foreground">
            Your decks
          </h2>
          {ordered.length === 0 ? (
            <EmptyState
              title="No decks yet"
              description="Make a deck, and its table sheet is one click away."
              action={<NewDeckButton>New deck</NewDeckButton>}
            />
          ) : (
            <ul className="flex flex-col divide-y divide-border/50 rounded-lg border border-border/60">
              {ordered.map((deck) => {
                const sheet = sheets.get(deck.id);
                const started = Boolean(sheet && (sheet.gamePlan || sheet.winConditions || sheet.tableNotes));
                return (
                  <li key={deck.id}>
                    <Link
                      href={tableSheetPath(deck.slug)}
                      className="group flex flex-wrap items-center justify-between gap-3 px-4 py-3 text-sm transition-colors hover:bg-elevated/60 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-inset focus-visible:ring-primary-bright/60"
                    >
                      <span className="flex min-w-0 items-center gap-3">
                        <ScrollText className="h-4 w-4 shrink-0 text-subtle" aria-hidden />
                        <span className="flex min-w-0 flex-col">
                          <span className="truncate font-medium text-foreground">{deck.title}</span>
                          <span className="text-xs text-muted">
                            {DECK_FORMAT_LABELS[deck.format]} · {deck.cards_count} card{deck.cards_count === 1 ? "" : "s"} ·{" "}
                            {VISIBILITY_LABELS[deck.visibility]}
                          </span>
                        </span>
                      </span>
                      <span className="flex items-center gap-2">
                        {sheet?.shared ? <Badge variant="gold">Shared</Badge> : null}
                        {started ? <Badge>Written</Badge> : <span className="text-xs text-subtle">Not started</span>}
                        <ChevronRight className="h-4 w-4 text-subtle transition-transform group-hover:translate-x-0.5" aria-hidden />
                        <span className="sr-only">Open the table sheet</span>
                      </span>
                    </Link>
                  </li>
                );
              })}
            </ul>
          )}
        </section>
      </div>
    </ToolShell>
  );
}
