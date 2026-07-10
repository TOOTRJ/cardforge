import type { Metadata } from "next";
import Link from "next/link";
import { BookOpen, Plus } from "lucide-react";
import { DashboardShell } from "@/components/layout/dashboard-shell";
import { PageHeader } from "@/components/layout/page-header";
import { SurfaceCard } from "@/components/ui/surface-card";
import { EmptyState } from "@/components/ui/empty-state";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { listMyDecks } from "@/lib/decks/queries";
import { DECK_FORMAT_LABELS, coverObjectPosition } from "@/types/deck";
import { isDesignAiConfigured } from "@/lib/ai/provider";
import { batchCardLimit } from "@/lib/ai/generation-limits";
import { AiDeckPanel } from "@/components/decks/ai-deck-panel";

export const metadata: Metadata = {
  title: "Decks",
  description:
    "Build MTG decks, import decklists, and remix real cards into your own custom proxies.",
};

export default async function DecksPage() {
  const [decks, maxCards] = await Promise.all([listMyDecks(), batchCardLimit()]);

  return (
    <DashboardShell>
      <PageHeader
        eyebrow="Library"
        title="My decks"
        description="Build decks from real cards and your own creations, then remix every card into a custom proxy."
        actions={
          <Button asChild>
            <Link href="/dashboard/decks/new">
              <Plus className="h-4 w-4" aria-hidden />
              New deck
            </Link>
          </Button>
        }
      />

      <div className="mt-8">
        <AiDeckPanel
          mode="new"
          aiConfigured={isDesignAiConfigured()}
          maxCards={maxCards}
        />
      </div>

      <div className="mt-6">
        {decks.length === 0 ? (
          <EmptyState
            icon={BookOpen}
            title="No decks yet"
            description="Create your first deck — pick a format, add cards, and remix the real ones into custom proxies."
            action={
              <Button asChild>
                <Link href="/dashboard/decks/new">Create a deck</Link>
              </Button>
            }
          />
        ) : (
          <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-3">
            {decks.map((deck) => (
              <DeckTile key={deck.id} deck={deck} />
            ))}
          </div>
        )}
      </div>
    </DashboardShell>
  );
}

function DeckTile({
  deck,
}: {
  deck: Awaited<ReturnType<typeof listMyDecks>>[number];
}) {
  const remixPct =
    deck.cards_count > 0
      ? Math.round((deck.remixed_count / deck.cards_count) * 100)
      : 0;

  return (
    <Link
      href={`/deck/${deck.slug}`}
      className="group block rounded-frame focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-primary-bright/60 focus-visible:ring-offset-2 focus-visible:ring-offset-background"
    >
      <SurfaceCard className="flex h-full flex-col gap-3 overflow-hidden p-0 transition-colors group-hover:border-border-strong">
        <div className="relative aspect-video w-full overflow-hidden bg-elevated">
          {deck.cover_url ? (
            // eslint-disable-next-line @next/next/no-img-element
            <img
              src={deck.cover_url}
              alt={`${deck.title} cover`}
              className="h-full w-full object-cover transition-transform group-hover:scale-105"
              style={{
                objectPosition: coverObjectPosition(deck.cover_position),
              }}
            />
          ) : (
            <div className="flex h-full w-full items-center justify-center bg-linear-to-br from-elevated via-surface to-background">
              <BookOpen className="h-8 w-8 text-subtle" aria-hidden />
            </div>
          )}
          <div className="absolute left-3 top-3 flex items-center gap-2">
            <Badge
              variant={deck.visibility === "public" ? "primary" : "outline"}
            >
              {visibilityLabel(deck.visibility)}
            </Badge>
            <Badge variant="outline">{DECK_FORMAT_LABELS[deck.format]}</Badge>
          </div>
        </div>

        <div className="flex flex-col gap-2 p-5">
          <h3 className="font-display text-lg font-semibold text-foreground">
            {deck.title}
          </h3>
          {deck.description ? (
            <p className="line-clamp-2 text-sm leading-6 text-muted">
              {deck.description}
            </p>
          ) : (
            <p className="text-sm text-subtle italic">No description yet.</p>
          )}
          <div className="mt-2 flex items-center justify-between text-xs text-muted">
            <span>
              {deck.cards_count} card{deck.cards_count === 1 ? "" : "s"}
              {deck.cards_count > 0 ? ` · ${remixPct}% proxied` : ""}
            </span>
            <span className="opacity-0 transition-opacity group-hover:opacity-100">
              Open deck →
            </span>
          </div>
          {deck.cards_count > 0 ? (
            <div
              className="h-1 w-full overflow-hidden rounded-full bg-elevated"
              role="progressbar"
              aria-valuenow={remixPct}
              aria-valuemin={0}
              aria-valuemax={100}
              aria-label="Proxy progress"
            >
              <div
                className="h-full rounded-full bg-primary transition-[width]"
                style={{ width: `${remixPct}%` }}
              />
            </div>
          ) : null}
        </div>
      </SurfaceCard>
    </Link>
  );
}

function visibilityLabel(visibility: string): string {
  switch (visibility) {
    case "public":
      return "Public";
    case "unlisted":
      return "Unlisted";
    default:
      return "Private";
  }
}
