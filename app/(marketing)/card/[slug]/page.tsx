import type { Metadata } from "next";
import Link from "next/link";
import { notFound } from "next/navigation";
import { ArrowLeft, GitFork, Heart, Pencil, Share2 } from "lucide-react";
import { CardPreview } from "@/components/cards/card-preview";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { SurfaceCard } from "@/components/ui/surface-card";
import { getCardBySlugPublic } from "@/lib/cards/queries";
import { getCurrentUser } from "@/lib/supabase/server";
import { isSupabaseConfigured } from "@/lib/supabase/env";
import type { ArtPosition, FrameStyle } from "@/types/card";

type Params = { slug: string };

function titleFromSlug(slug: string): string {
  return slug
    .split("-")
    .map((s) => (s ? s[0].toUpperCase() + s.slice(1) : ""))
    .join(" ");
}

export async function generateMetadata({
  params,
}: {
  params: Promise<Params>;
}): Promise<Metadata> {
  const { slug } = await params;
  if (!isSupabaseConfigured()) {
    return { title: titleFromSlug(slug) };
  }
  const card = await getCardBySlugPublic(slug);
  return {
    title: card?.title ?? titleFromSlug(slug),
    description: card?.flavor_text ?? "A custom trading card on CardForge.",
  };
}

export default async function CardDetailPage({
  params,
}: {
  params: Promise<Params>;
}) {
  const { slug } = await params;
  const card = isSupabaseConfigured() ? await getCardBySlugPublic(slug) : null;

  if (!card) {
    notFound();
  }

  const user = await getCurrentUser();
  const isOwner = Boolean(user && user.id === card.owner_id);

  return (
    <div className="mx-auto w-full max-w-6xl px-4 py-10 sm:px-6 lg:px-8">
      <Link
        href="/gallery"
        className="mb-6 inline-flex items-center gap-1 text-sm text-muted transition-colors hover:text-foreground"
      >
        <ArrowLeft className="h-4 w-4" aria-hidden />
        Back to gallery
      </Link>

      <div className="grid gap-10 lg:grid-cols-[minmax(0,360px)_1fr]">
        <div className="mx-auto w-full max-w-sm">
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
        </div>

        <div className="flex flex-col gap-6">
          <div className="flex flex-col gap-3">
            <Badge
              variant={card.visibility === "public" ? "primary" : "outline"}
              className="self-start"
            >
              {visibilityLabel(card.visibility)}
            </Badge>
            <h1 className="font-display text-3xl font-semibold tracking-tight text-foreground sm:text-4xl">
              {card.title}
            </h1>
            <p className="text-sm leading-6 text-muted">
              Slug: <span className="font-mono text-foreground">{card.slug}</span>
            </p>
          </div>

          <div className="flex flex-wrap items-center gap-2">
            {isOwner ? (
              <Button asChild>
                <Link href={`/card/${card.slug}/edit`}>
                  <Pencil className="h-4 w-4" aria-hidden /> Edit card
                </Link>
              </Button>
            ) : null}
            <Button variant="primary" disabled>
              <Heart className="h-4 w-4" aria-hidden /> Like
            </Button>
            <Button variant="secondary" disabled>
              <GitFork className="h-4 w-4" aria-hidden /> Remix
            </Button>
            <Button variant="ghost" disabled>
              <Share2 className="h-4 w-4" aria-hidden /> Share
            </Button>
          </div>

          <SurfaceCard className="grid gap-4 p-6 sm:grid-cols-2">
            <Detail
              label="Card type"
              value={card.card_type ? capitalize(card.card_type) : "—"}
            />
            <Detail
              label="Rarity"
              value={card.rarity ? capitalize(card.rarity) : "—"}
            />
            <Detail label="Cost" value={card.cost ?? "—"} />
            <Detail
              label="Color identity"
              value={
                card.color_identity.length > 0
                  ? card.color_identity.map(capitalize).join(", ")
                  : "—"
              }
            />
            <Detail
              label="Power / Toughness"
              value={
                card.power || card.toughness
                  ? `${card.power ?? "—"} / ${card.toughness ?? "—"}`
                  : "—"
              }
            />
            <Detail label="Visibility" value={visibilityLabel(card.visibility)} />
          </SurfaceCard>

          <SurfaceCard className="flex flex-col gap-3 p-6">
            <h2 className="font-display text-lg font-semibold text-foreground">
              Rules text
            </h2>
            <p className="whitespace-pre-line text-sm leading-6 text-muted">
              {card.rules_text?.trim() || "No rules text yet."}
            </p>
          </SurfaceCard>

          {card.flavor_text?.trim() ? (
            <SurfaceCard className="flex flex-col gap-3 p-6">
              <h2 className="font-display text-lg font-semibold text-foreground">
                Flavor text
              </h2>
              <p className="text-sm leading-6 italic text-muted">
                {card.flavor_text}
              </p>
            </SurfaceCard>
          ) : null}
        </div>
      </div>
    </div>
  );
}

function visibilityLabel(visibility: "private" | "unlisted" | "public"): string {
  switch (visibility) {
    case "public":
      return "Public";
    case "unlisted":
      return "Unlisted";
    default:
      return "Private";
  }
}

function capitalize(value: string): string {
  return value.charAt(0).toUpperCase() + value.slice(1);
}

function Detail({ label, value }: { label: string; value: string }) {
  return (
    <div className="flex flex-col gap-1">
      <span className="text-xs font-semibold uppercase tracking-wider text-subtle">
        {label}
      </span>
      <span className="text-sm text-foreground">{value}</span>
    </div>
  );
}
