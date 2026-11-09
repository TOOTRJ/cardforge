import type { Metadata } from "next";
import Link from "next/link";
import { ArrowUpRight } from "lucide-react";
import { ToolShell } from "@/components/tools/tool-shell";
import { PlayDeckList } from "@/components/tools/play-exports/play-deck-list";
import { SurfaceCard } from "@/components/ui/surface-card";
import { listMyDecks } from "@/lib/decks/queries";
import { guideSteps, PLAY_GUIDES } from "@/lib/tools/play-exports/guides";
import { PLAY_TARGET_LABELS, PLAY_TARGETS } from "@/lib/tools/play-exports/model";
import { openTool } from "@/lib/tools/queries";

// ---------------------------------------------------------------------------
// /dashboard/tools/play-exports — the play-surface exports beta tool: a deck
// or a selection of cards as the files Cockatrice, Draftmancer and Tabletop
// Simulator load (lib/tools/play-exports). This page is its deck door and
// its how-to; the same dialog opens from a deck page's "Play online" and My
// Cards' selection. Free on every plan: admins and testers while in beta
// (openTool: a 404 for anyone else).
// ---------------------------------------------------------------------------

export const metadata: Metadata = {
  title: "Play Exports",
  robots: { index: false, follow: false },
};

export const dynamic = "force-dynamic";

const WHAT_GOES_IN = [
  "Your PipGlyph cards go in as custom cards: their name, cost, type line, rules and stats, and their picture — the same picture the gallery shows, with the pipglyph.com mark.",
  "Real cards go in by name, so each app plays them from its own card database.",
  "Private cards have no shared picture. Cockatrice and Draftmancer show their text; Tabletop Simulator leaves them out. Make a card unlisted to include its picture.",
  "Double-faced cards keep both faces where the app has them.",
  "The maybeboard stays out, and so does any card in someone else's deck that you can't see.",
];

export default async function PlayExportsPage() {
  const entry = await openTool("play-exports");
  const decks = await listMyDecks();
  return (
    <ToolShell entry={entry}>
      <div className="flex flex-col gap-10">
        <p className="max-w-[38rem] text-sm leading-6 text-muted">
          Playtest your cards online. Pick a deck and an app, download one file, and load it — no card editor, no
          copying pictures by hand. You can also press <span className="text-foreground">Play online</span> on any deck
          page, or select cards in{" "}
          <Link href="/dashboard/cards" className="text-primary-bright underline-offset-2 hover:underline">
            My Cards
          </Link>{" "}
          and press it in the selection bar.
        </p>

        <div className="grid grid-cols-1 gap-6 lg:grid-cols-[minmax(0,3fr)_minmax(0,2fr)]">
          <section aria-labelledby="play-decks" className="flex min-w-0 flex-col gap-3">
            <h2 id="play-decks" className="font-display text-lg text-foreground">
              Your decks
            </h2>
            <PlayDeckList
              decks={decks.map((deck) => ({
                id: deck.id,
                title: deck.title,
                format: deck.format ?? null,
                cards: deck.cards_count,
                visibility: deck.visibility,
              }))}
            />
          </section>

          <SurfaceCard as="section" aria-labelledby="play-inside" className="flex min-w-0 flex-col gap-3 p-5">
            <h2 id="play-inside" className="font-display text-lg text-foreground">
              What goes in the files
            </h2>
            <ul className="flex list-disc flex-col gap-2 pl-5 text-sm leading-6 text-muted marker:text-subtle">
              {WHAT_GOES_IN.map((line) => (
                <li key={line}>{line}</li>
              ))}
            </ul>
          </SurfaceCard>
        </div>

        <section aria-labelledby="play-howto" className="flex flex-col gap-4">
          <h2 id="play-howto" className="font-display text-lg text-foreground">
            Loading the file
          </h2>
          <div className="grid grid-cols-1 gap-4 md:grid-cols-3">
            {PLAY_TARGETS.map((target) => {
              const guide = PLAY_GUIDES[target];
              return (
                <SurfaceCard
                  key={target}
                  as="section"
                  id={target}
                  aria-labelledby={`play-howto-${target}`}
                  className="flex min-w-0 scroll-mt-24 flex-col gap-3 p-5"
                >
                  <div className="flex flex-col gap-1">
                    <h3 id={`play-howto-${target}`} className="font-display text-base text-foreground">
                      {PLAY_TARGET_LABELS[target]}
                    </h3>
                    <p className="text-xs text-subtle">{guide.file}</p>
                  </div>
                  <p className="text-sm text-muted">{guide.summary}</p>
                  <ol className="flex list-decimal flex-col gap-1.5 pl-5 text-sm text-foreground marker:text-subtle">
                    {guideSteps(target, "deck").map((step) => (
                      <li key={step}>{step}</li>
                    ))}
                  </ol>
                  <ul className="flex flex-col gap-1.5 text-xs leading-5 text-muted">
                    {guide.notes.map((note) => (
                      <li key={note}>{note}</li>
                    ))}
                  </ul>
                  <a
                    href={guide.site.href}
                    target="_blank"
                    rel="noopener noreferrer"
                    className="mt-auto inline-flex items-center gap-1 self-start text-sm text-primary-bright underline-offset-2 hover:underline"
                  >
                    {guide.site.label}
                    <ArrowUpRight className="h-3.5 w-3.5" aria-hidden />
                    <span className="sr-only">(opens in a new tab)</span>
                  </a>
                </SurfaceCard>
              );
            })}
          </div>
          <p className="text-xs text-subtle">
            Forge isn&apos;t here yet: it needs a rules script for every card, which a card&apos;s text alone can&apos;t give it.
          </p>
        </section>
      </div>
    </ToolShell>
  );
}
