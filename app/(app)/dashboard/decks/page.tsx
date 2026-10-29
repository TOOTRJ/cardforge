import type { Metadata } from "next";
import Link from "next/link";
import { BookOpen, Plus } from "lucide-react";
import { DashboardShell } from "@/components/layout/dashboard-shell";
import { PageHeader } from "@/components/layout/page-header";
import { EmptyState } from "@/components/ui/empty-state";
import { Button } from "@/components/ui/button";
import { DECK_GRID_CLASS, DECK_GRID_SIZES, DeckTile } from "@/components/decks/deck-tile";
import { listMyDecks } from "@/lib/decks/queries";
import { listDeckTileArt } from "@/lib/decks/tile-art";
import { getDeckCapacity } from "@/lib/decks/capacity";
import { DeckCapacityMeter } from "@/components/decks/deck-capacity";
import { deckCountsTowardCap } from "@/lib/billing/deck-capacity-copy";
import { DeckFeedbackButton } from "@/components/feedback/deck-feedback-dialog";
import { DeckBetaBanner } from "@/components/decks/deck-beta-banner";

export const metadata: Metadata = {
  title: "Decks",
  description:
    "Build MTG decks, import decklists, and customize real cards into your own proxies.",
};

export default async function DecksPage() {
  const [decks, deckCapacity] = await Promise.all([listMyDecks(), getDeckCapacity()]);
  // Each deck's colours and fan (the owner's session: private decks too) —
  // what the deck's page reads, and what a visitor's tile shows: a private
  // card stands in no fan, the owner's view included (DeckTile, DK8.1).
  const art = await listDeckTileArt(decks);
  // The decks the private-deck cap counts — at the cap each gets "Make
  // public" and "Delete" in the meter (TODO DK3.3).
  const cappedDecks = decks
    .filter((deck) => deckCountsTowardCap(deck.visibility))
    .map((deck) => ({ id: deck.id, title: deck.title, visibility: deck.visibility }));

  return (
    <DashboardShell>
      {/* The dashboard is signed in (its layout sends anyone else to log in). */}
      <DeckBetaBanner signedIn className="mb-6" />
      <PageHeader
        eyebrow="Library"
        title="My decks"
        description="Build decks from real cards and your own creations, then customize the real ones."
        actions={
          <div className="flex flex-wrap items-center gap-2">
            <DeckFeedbackButton signedIn className="h-10" />
            <Button asChild>
              <Link href="/dashboard/decks/new">
                <Plus className="h-4 w-4" aria-hidden />
                New deck
              </Link>
            </Button>
          </div>
        }
      />

      <div className="mt-8">
        <DeckCapacityMeter capacity={deckCapacity} cappedDecks={cappedDecks} />
      </div>

      <div className="mt-6">
        {decks.length === 0 ? (
          <EmptyState
            icon={BookOpen}
            title="No decks yet"
            description="Create your first deck — pick a format, add cards, and customize the real ones."
            action={
              <Button asChild>
                <Link href="/dashboard/decks/new">Create a deck</Link>
              </Button>
            }
          />
        ) : (
          <div className={DECK_GRID_CLASS}>
            {decks.map((deck) => (
              <DeckTile key={deck.id} deck={deck} art={art.get(deck.id)} variant="owner" sizes={DECK_GRID_SIZES} />
            ))}
          </div>
        )}
      </div>
    </DashboardShell>
  );
}
