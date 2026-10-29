import type { Metadata } from "next";
import { VISIBILITY_LABELS, type Visibility } from "@/types/card";
import Link from "next/link";
import Image from "next/image";
import { BookOpen, Plus } from "lucide-react";
import { DashboardShell } from "@/components/layout/dashboard-shell";
import { PageHeader } from "@/components/layout/page-header";
import { SurfaceCard } from "@/components/ui/surface-card";
import { EmptyState } from "@/components/ui/empty-state";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { listMyDecks } from "@/lib/decks/queries";
import { DECK_FORMAT_LABELS } from "@/types/deck";
import { deckCoverOf } from "@/lib/decks/cover";
import { listDeckCoverColors } from "@/lib/decks/cover-colors";

export const metadata: Metadata = {
  title: "Decks",
  description:
    "Build MTG decks, import decklists, and remix real cards into your own custom proxies.",
};

export default async function DecksPage() {
  const decks = await listMyDecks();
  // The colours each deck's default cover is picked by (the owner's
  // session: private decks too) — what the deck's page reads.
  const coverColors = await listDeckCoverColors(decks.map((deck) => deck.id));

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
          <div className="grid grid-cols-1 gap-4 sm:grid-cols-2 lg:grid-cols-3">
            {decks.map((deck) => (
              <DeckTile key={deck.id} deck={deck} coverColors={coverColors.get(deck.id) ?? null} />
            ))}
          </div>
        )}
      </div>
    </DashboardShell>
  );
}

function DeckTile({
  deck,
  coverColors,
}: {
  deck: Awaited<ReturnType<typeof listMyDecks>>[number];
  coverColors: readonly string[] | null;
}) {
  const remixPct =
    deck.cards_count > 0
      ? Math.round((deck.remixed_count / deck.cards_count) * 100)
      : 0;

  // The owner's upload (only one we store, migration 0127) or the default
  // its colours pick — the picture the deck's own page draws.
  const cover = deckCoverOf(deck, coverColors);
  return (
    <Link
      href={`/deck/${deck.slug}`}
      className="group block min-w-0 rounded-frame focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-primary-bright/60 focus-visible:ring-offset-2 focus-visible:ring-offset-background"
    >
      <SurfaceCard className="flex h-full flex-col gap-3 overflow-hidden p-0 transition-colors group-hover:border-border-strong">
        <div className="relative aspect-video w-full overflow-hidden bg-elevated">
          <Image
            src={cover.src}
            alt={`${deck.title} cover`}
            fill
            sizes="(min-width: 1024px) 33vw, (min-width: 640px) 50vw, 100vw"
            className="object-cover transition-transform group-hover:scale-105"
            style={cover.objectPosition ? { objectPosition: cover.objectPosition } : undefined}
          />
          {/* Every deck has a picture now (an upload or a dark default), so
              the badges sit on their own page-coloured backing in both
              themes — as the public tile's do. */}
          <div className="absolute left-3 top-3 flex items-center gap-2">
            <Badge
              variant={deck.visibility === "public" ? "primary" : "outline"}
              className="bg-background/85 backdrop-blur"
            >
              {(VISIBILITY_LABELS[deck.visibility as Visibility] ?? deck.visibility)}
            </Badge>
            <Badge variant="outline" className="bg-background/85 backdrop-blur">
              {DECK_FORMAT_LABELS[deck.format]}
            </Badge>
          </div>
        </div>

        <div className="flex flex-col gap-2 p-5">
          <h3 className="font-display text-lg font-semibold text-foreground [overflow-wrap:anywhere]">
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

