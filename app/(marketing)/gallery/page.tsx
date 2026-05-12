import type { Metadata } from "next";
import Link from "next/link";
import { ArrowLeft, ArrowRight, Heart, Sparkles } from "lucide-react";
import { PageHeader } from "@/components/layout/page-header";
import { CardPreview } from "@/components/cards/card-preview";
import { Button } from "@/components/ui/button";
import { EmptyState } from "@/components/ui/empty-state";
import { GalleryFilters } from "@/components/gallery/gallery-filters";
import { listPublicCardsRich } from "@/lib/cards/queries";
import { isSupabaseConfigured } from "@/lib/supabase/env";
import {
  CARD_TYPE_VALUES,
  RARITY_VALUES,
  type ArtPosition,
  type CardType,
  type FrameStyle,
  type Rarity,
} from "@/types/card";

export const metadata: Metadata = {
  title: "Gallery",
  description: "Browse public custom cards forged by the CardForge community.",
  alternates: { canonical: "/gallery" },
};

const PAGE_SIZE = 24;

type GalleryPageProps = {
  searchParams: Promise<Record<string, string | string[] | undefined>>;
};

function firstString(value: string | string[] | undefined): string | null {
  if (Array.isArray(value)) return value[0] ?? null;
  return value ?? null;
}

export default async function GalleryPage({ searchParams }: GalleryPageProps) {
  const params = await searchParams;
  const cardTypeParam = firstString(params.type);
  const rarityParam = firstString(params.rarity);
  const searchParam = firstString(params.q);
  const sortParam = firstString(params.sort);
  const pageParam = firstString(params.page);

  const cardType = (CARD_TYPE_VALUES as readonly string[]).includes(
    cardTypeParam ?? "",
  )
    ? (cardTypeParam as CardType)
    : undefined;
  const rarity = (RARITY_VALUES as readonly string[]).includes(
    rarityParam ?? "",
  )
    ? (rarityParam as Rarity)
    : undefined;
  const sort: "recent" | "popular" =
    sortParam === "popular" ? "popular" : "recent";

  const pageRaw = Number.parseInt(pageParam ?? "1", 10);
  const page = Number.isFinite(pageRaw) && pageRaw >= 1 ? pageRaw : 1;

  const configured = isSupabaseConfigured();
  const cards = configured
    ? await listPublicCardsRich({
        cardType,
        rarity,
        search: searchParam ?? undefined,
        sort,
        limit: PAGE_SIZE,
        offset: (page - 1) * PAGE_SIZE,
      })
    : [];

  // We don't have a separate "total" query — `hasMore` is a heuristic: a
  // full page strongly suggests there's at least one more. The Next button
  // disappears once we return < PAGE_SIZE rows.
  const hasMore = cards.length === PAGE_SIZE;
  const hasPrev = page > 1;

  const buildHref = (nextPage: number) => {
    const qs = new URLSearchParams();
    if (cardTypeParam) qs.set("type", cardTypeParam);
    if (rarityParam) qs.set("rarity", rarityParam);
    if (searchParam) qs.set("q", searchParam);
    if (sortParam) qs.set("sort", sortParam);
    if (nextPage > 1) qs.set("page", String(nextPage));
    const query = qs.toString();
    return query ? `/gallery?${query}` : "/gallery";
  };

  return (
    <div className="mx-auto w-full max-w-7xl px-4 py-12 sm:px-6 lg:px-8">
      <PageHeader
        eyebrow="Public"
        title="Community gallery"
        description="Discover custom cards forged by the CardForge community. Filter, sort, and click into any card to view, like, or remix."
        actions={
          <Button asChild>
            <Link href="/create">Forge your own</Link>
          </Button>
        }
      />

      <div className="mt-8">
        <GalleryFilters />
      </div>

      <div className="mt-10">
        {!configured ? (
          <EmptyState
            icon={Sparkles}
            title="Gallery is offline"
            description="Supabase isn't configured for this deployment. The gallery will populate once env vars land."
          />
        ) : cards.length === 0 ? (
          <EmptyState
            icon={Sparkles}
            title="No cards match"
            description={
              cardType || rarity || searchParam
                ? "Try clearing the filters above, or be the first to publish a card that matches."
                : "Be the first to publish a public card — it'll show up here for everyone."
            }
            action={
              <Button asChild>
                <Link href="/create">Forge your own</Link>
              </Button>
            }
          />
        ) : (
          <>
            <div className="grid gap-5 sm:grid-cols-2 lg:grid-cols-3 xl:grid-cols-4">
              {cards.map((card) => (
                <GalleryCardTile key={card.id} card={card} />
              ))}
            </div>
            {hasPrev || hasMore ? (
              <div className="mt-10 flex items-center justify-between gap-3 border-t border-border/40 pt-6">
                <span className="text-xs text-subtle">
                  Page {page}
                </span>
                <div className="flex items-center gap-2">
                  {hasPrev ? (
                    <Button asChild variant="outline" size="sm">
                      <Link href={buildHref(page - 1)} scroll>
                        <ArrowLeft className="h-3.5 w-3.5" aria-hidden />
                        Previous
                      </Link>
                    </Button>
                  ) : null}
                  {hasMore ? (
                    <Button asChild size="sm">
                      <Link href={buildHref(page + 1)} scroll>
                        Next
                        <ArrowRight className="h-3.5 w-3.5" aria-hidden />
                      </Link>
                    </Button>
                  ) : null}
                </div>
              </div>
            ) : null}
          </>
        )}
      </div>
    </div>
  );
}

function GalleryCardTile({
  card,
}: {
  card: Awaited<ReturnType<typeof listPublicCardsRich>>[number];
}) {
  const ownerLabel =
    card.owner?.username ?? card.owner?.display_name ?? "Anonymous forger";

  return (
    <div className="flex flex-col gap-2">
      <Link
        href={`/card/${card.slug}`}
        className="block rounded-frame focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-primary/60 focus-visible:ring-offset-2 focus-visible:ring-offset-background"
        aria-label={`Open ${card.title}`}
      >
        <CardPreview
          title={card.title}
          cost={card.cost}
          cardType={card.card_type}
          supertype={card.supertype}
          subtypes={card.subtypes}
          rarity={card.rarity}
          colorIdentity={card.color_identity}
          rulesText={card.rules_text}
          flavorText={card.flavor_text}
          power={card.power}
          toughness={card.toughness}
          loyalty={card.loyalty}
          defense={card.defense}
          artistCredit={card.artist_credit}
          artUrl={card.art_url}
          artPosition={card.art_position as ArtPosition}
          frameStyle={card.frame_style as FrameStyle}
        />
      </Link>
      <div className="flex items-center justify-between gap-2 text-xs">
        {card.owner?.username ? (
          <Link
            href={`/profile/${card.owner.username}`}
            className="truncate font-mono text-muted transition-colors hover:text-foreground"
          >
            @{card.owner.username}
          </Link>
        ) : (
          <span className="truncate text-muted">{ownerLabel}</span>
        )}
        <span className="inline-flex items-center gap-1 text-muted">
          <Heart className="h-3 w-3" aria-hidden />
          {card.likes_count}
        </span>
      </div>
    </div>
  );
}
