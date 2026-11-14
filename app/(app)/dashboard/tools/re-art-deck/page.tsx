import type { Metadata } from "next";
import Link from "next/link";
import { ChevronRight, Layers } from "lucide-react";
import { ToolShell } from "@/components/tools/tool-shell";
import { ReartStudio } from "@/components/tools/re-art/reart-studio";
import { ReartRunList } from "@/components/tools/re-art/reart-run-list";
import { openTool } from "@/lib/tools/queries";
import { getCurrentUsername } from "@/lib/supabase/server";
import { listDeckPageCards, listMyDecks } from "@/lib/decks/queries";
import { getCardCapacity } from "@/lib/cards/capacity";
import { getFreshCreditBalance } from "@/lib/ai/rate-limit";
import { isGatewayConfigured } from "@/lib/ai/provider";
import { rowHasBakedBack } from "@/lib/cards/faces";
import {
  getOwnedDeck,
  listReartRuns,
  readDeckStyle,
  readCardWords,
  readPaintedCards,
  readReartPicturesByCard,
  bucketOfItem,
} from "@/lib/tools/re-art/server";
import {
  REART_CREDITS_PER_FACE,
  classifyReartEntry,
  reartCardFacts,
  type ReartStudioEntry,
} from "@/lib/tools/re-art/model";
import { isUuid } from "@/lib/ids";

// ---------------------------------------------------------------------------
// /dashboard/tools/re-art-deck — the Re-art deck beta tool (migration 0191):
// one of your decks, one art style, every card painted in it. Without a deck
// the page lists your decks and your recent runs; with `?deck=<id>` it is
// the deck's studio (the style, a sample, the whole deck, each card's
// re-roll). The deck page's owner bar links here. Admins and testers while
// in beta (openTool: a 404 for anyone else).
// ---------------------------------------------------------------------------

export const metadata: Metadata = {
  title: "Re-art deck",
  robots: { index: false, follow: false },
};

export const dynamic = "force-dynamic";

export default async function ReartDeckPage({ searchParams }: { searchParams: Promise<{ deck?: string | string[] }> }) {
  const entry = await openTool("re-art-deck");
  const params = await searchParams;
  const deckParam = typeof params.deck === "string" && isUuid(params.deck) ? params.deck : null;
  const deck = deckParam ? await getOwnedDeck(entry.userId, deckParam) : null;

  if (!deck) {
    const [decks, runs] = await Promise.all([listMyDecks(), listReartRuns(entry.userId, null)]);
    const titles = new Map(decks.map((d) => [d.id, d.title]));
    return (
      <ToolShell entry={entry}>
        <div className="flex flex-col gap-10">
          <div className="max-w-[38rem] text-sm leading-6 text-muted">
            <p>
              Pick one of your decks and give it one look: define its art style once, try it on a few cards, then paint
              the whole deck. Real cards become your own versions with the new art; your own cards get new art on them,
              and you can put their old art back.
            </p>
            {deckParam ? (
              <p role="alert" className="mt-3 rounded-md border border-warning/40 bg-warning/10 p-3 text-warning">
                That deck isn&apos;t one of yours — pick one below.
              </p>
            ) : null}
          </div>

          <section aria-labelledby="reart-decks" className="flex flex-col gap-3">
            <h2 id="reart-decks" className="font-display text-lg text-foreground">
              Your decks
            </h2>
            {decks.length === 0 ? (
              <p className="text-sm text-muted">
                You have no decks yet.{" "}
                <Link href="/dashboard/decks/new" className="text-primary-bright underline-offset-2 hover:underline">
                  Start a deck
                </Link>{" "}
                and come back to re-art it.
              </p>
            ) : (
              <ul className="grid grid-cols-1 gap-2 sm:grid-cols-2 xl:grid-cols-3">
                {decks.map((d) => (
                  <li key={d.id}>
                    <Link
                      href={`/dashboard/tools/re-art-deck?deck=${d.id}`}
                      className="group flex items-center gap-3 rounded-lg border border-border/60 bg-surface/50 px-4 py-3 transition-colors hover:border-border-strong hover:bg-elevated focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-primary-bright/60"
                    >
                      <Layers className="h-4 w-4 shrink-0 text-muted" aria-hidden />
                      <span className="min-w-0 flex-1">
                        <span className="block truncate font-medium text-foreground">{d.title}</span>
                        <span className="block text-xs text-muted">
                          {d.cards_count} card{d.cards_count === 1 ? "" : "s"}
                        </span>
                      </span>
                      <ChevronRight className="h-4 w-4 shrink-0 text-subtle group-hover:text-foreground" aria-hidden />
                    </Link>
                  </li>
                ))}
              </ul>
            )}
          </section>

          {runs.length > 0 ? (
            <ReartRunList
              runs={runs.map((run) => ({ ...run, deckTitle: run.deckId ? (titles.get(run.deckId) ?? null) : null }))}
              showDeck
            />
          ) : null}
        </div>
      </ToolShell>
    );
  }

  const [items, style, painted, words, runs, username, capacity, balance] = await Promise.all([
    listDeckPageCards(deck.id),
    readDeckStyle(deck.id),
    readPaintedCards(deck.id),
    readCardWords(deck.id),
    listReartRuns(entry.userId, deck.id),
    getCurrentUsername(),
    getCardCapacity(),
    getFreshCreditBalance(),
  ]);

  // Re-art's pictures on these cards from ANY of the maker's decks (a card
  // can be in several): what the one-card confirm says a paint replaces.
  const reartPictures = await readReartPicturesByCard(
    items.flatMap(({ card }) => (card && card.owner_id === entry.userId ? [card.id] : [])),
  );

  const entries: ReartStudioEntry[] = items.map(({ entry: e, card }) => {
    const classified = classifyReartEntry({
      board: e.board,
      cardId: e.card_id,
      scryfallId: e.scryfall_id,
      typeLine: e.type_line,
      card,
      ownerId: entry.userId,
    });
    const done = card ? painted.get(card.id) : undefined;
    const own = classified.kind === "own" ? card : null;
    // "In this style" only while Re-art's picture is still on the card;
    // "Put the old art back" only while it can work.
    const facts = reartCardFacts({
      painted: done,
      styleVersion: style?.version ?? null,
      cardArtUrl: card?.art_url,
      reartPictures: card ? (reartPictures.pictures.get(card.id) ?? []) : [],
      reartPicturesKnown: reartPictures.complete,
    });
    return {
      id: e.id,
      name: card?.title || e.name,
      quantity: e.quantity,
      board: e.board,
      typeLine: e.type_line,
      imageUrl: e.image_url,
      kind: classified.kind,
      skipMessage: classified.kind === "skip" ? classified.message : null,
      card: own,
      bucket: bucketOfItem({ entry: e, card, cardOwner: null }),
      state: facts.state,
      canRestore: facts.canRestore,
      artNow: facts.artNow,
      words: classified.kind === "skip" ? null : (words.get(e.id) ?? null),
      // The prompt's preview fills {rules} / {flavor} from the maker's own
      // card; a real card's are read from its printing when it is painted.
      rulesText: own?.rules_text ?? null,
      flavorText: own?.flavor_text ?? null,
      credits: own ? REART_CREDITS_PER_FACE * (rowHasBakedBack(own) ? 2 : 1) : REART_CREDITS_PER_FACE,
    };
  });

  // A run that stopped with cards still to paint can be picked up again.
  const paused = runs.find((run) => run.status === "generating" && run.waiting > 0) ?? null;

  return (
    <ToolShell entry={entry}>
      <ReartStudio
        deck={deck}
        storedStyle={style}
        entries={entries}
        username={username}
        capacity={capacity}
        balance={balance}
        aiAvailable={isGatewayConfigured()}
        pausedRunId={paused?.id ?? null}
        runs={runs}
      />
    </ToolShell>
  );
}
