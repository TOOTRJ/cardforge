import type { Metadata } from "next";
import Link from "next/link";
import { notFound } from "next/navigation";
import { ArrowLeft, Pencil } from "lucide-react";
import { CardPreview } from "@/components/cards/card-preview";
import { OracleText } from "@/components/cards/oracle-text";
import { ManaPip, ManaString } from "@/components/cards/mana-pip";
import { ExportButton } from "@/components/creator/export-button";
import { PrintButton } from "@/components/creator/print-button";
import { LikeButton } from "@/components/cards/like-button";
import { RemixButton } from "@/components/cards/remix-button";
import { ShareButton } from "@/components/cards/share-button";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { SurfaceCard } from "@/components/ui/surface-card";
import {
  countCardLikes,
  getCardBySlugPublic,
  hasUserLikedCard,
} from "@/lib/cards/queries";
import { CARD_TYPE_LABELS } from "@/types/card";
import { createClient, getCurrentUser } from "@/lib/supabase/server";
import { isSupabaseConfigured } from "@/lib/supabase/env";
import { getSiteBaseUrl } from "@/lib/site-url";
import { RENDER_PRESETS } from "@/lib/render/card-image";
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
  if (!card) {
    return { title: titleFromSlug(slug) };
  }

  const isShareable =
    card.visibility === "public" || card.visibility === "unlisted";
  const description =
    card.flavor_text?.trim() ||
    card.rules_text?.trim() ||
    "A custom trading card on Spellwright.";

  // Open Graph + Twitter previews use the rendered card image so social
  // unfurls show what the card actually looks like. Only emit them for
  // shareable visibilities — private cards shouldn't leak their preview
  // into link previews.
  const ogImageUrl = isShareable ? `/api/cards/${card.id}/og` : undefined;
  const { width, height } = RENDER_PRESETS.default;

  return {
    title: card.title,
    description,
    openGraph: ogImageUrl
      ? {
          title: `${card.title} · Spellwright`,
          description,
          type: "article",
          url: `/card/${card.slug}`,
          images: [
            {
              url: ogImageUrl,
              width,
              height,
              alt: `${card.title} card preview`,
            },
          ],
        }
      : undefined,
    twitter: ogImageUrl
      ? {
          card: "summary_large_image",
          title: `${card.title} · Spellwright`,
          description,
          images: [ogImageUrl],
        }
      : undefined,
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

  // Three parallel-ish reads: like count, current user's like, owner profile.
  // Each is independent, so we await them concurrently.
  const supabase = isSupabaseConfigured() ? await createClient() : null;

  const [likesCount, viewerLiked, ownerProfile] = await Promise.all([
    countCardLikes(card.id),
    user ? hasUserLikedCard(user.id, card.id) : Promise.resolve(false),
    supabase
      ? supabase
          .from("profiles")
          .select("id, username, display_name, avatar_url")
          .eq("id", card.owner_id)
          .maybeSingle()
          .then((res) => res.data ?? null)
      : Promise.resolve(null),
  ]);

  const createdAt = formatDate(card.created_at);
  const cardUrl = `${getSiteBaseUrl()}/card/${card.slug}`;

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
            <div className="flex flex-wrap items-center gap-2">
              <Badge
                variant={card.visibility === "public" ? "primary" : "outline"}
              >
                {visibilityLabel(card.visibility)}
              </Badge>
              {ownerProfile?.username ? (
                <Link
                  href={`/profile/${ownerProfile.username}`}
                  className="text-xs text-muted transition-colors hover:text-foreground"
                >
                  by{" "}
                  <span className="font-mono text-foreground">
                    @{ownerProfile.username}
                  </span>
                </Link>
              ) : null}
              <span className="text-xs text-subtle">· {createdAt}</span>
            </div>
            <h1 className="font-display text-3xl font-semibold tracking-tight text-foreground sm:text-4xl">
              {card.title}
            </h1>
            <p className="text-sm leading-6 text-muted">
              Slug: <span className="font-mono text-foreground">{card.slug}</span>
            </p>
          </div>

          <div className="flex flex-wrap items-center gap-2">
            <LikeButton
              cardId={card.id}
              cardSlug={card.slug}
              initialLiked={viewerLiked}
              initialCount={likesCount}
              requiresSignIn={!user}
            />
            <RemixButton
              cardId={card.id}
              cardSlug={card.slug}
              requiresSignIn={!user}
            />
            {isOwner ? (
              <>
                <Button asChild>
                  <Link href={`/card/${card.slug}/edit`}>
                    <Pencil className="h-4 w-4" aria-hidden /> Edit card
                  </Link>
                </Button>
                <ExportButton
                  cardId={card.id}
                  cardSlug={card.slug}
                  variant="outline"
                  label="Download HD PNG"
                />
              </>
            ) : null}
            {/* PDF download available for all shareable cards */}
            {(card.visibility === "public" || card.visibility === "unlisted") ? (
              <PrintButton
                cardId={card.id}
                cardSlug={card.slug}
                variant="outline"
              />
            ) : isOwner ? (
              <PrintButton
                cardId={card.id}
                cardSlug={card.slug}
                variant="outline"
              />
            ) : null}
            <ShareButton
              cardTitle={card.title}
              cardUrl={cardUrl}
              variant="ghost"
            />
          </div>

          <SurfaceCard className="grid gap-4 p-6 sm:grid-cols-2">
            <Detail
              label="Card type"
              value={card.card_type ? CARD_TYPE_LABELS[card.card_type] : "—"}
            />
            <Detail
              label="Rarity"
              value={card.rarity ? capitalize(card.rarity) : "—"}
            />
            <div className="flex flex-col gap-1">
              <span className="text-xs font-semibold uppercase tracking-wider text-subtle">
                Cost
              </span>
              {card.cost ? (
                <ManaString cost={card.cost} size="sm" />
              ) : (
                <span className="text-sm text-foreground">—</span>
              )}
            </div>
            <div className="flex flex-col gap-1">
              <span className="text-xs font-semibold uppercase tracking-wider text-subtle">
                Color identity
              </span>
              {card.color_identity.length > 0 ? (
                <div className="flex flex-wrap gap-1">
                  {card.color_identity.map((c) => {
                    const sym =
                      c === "white" ? "W"
                      : c === "blue" ? "U"
                      : c === "black" ? "B"
                      : c === "red" ? "R"
                      : c === "green" ? "G"
                      : c === "colorless" ? "C"
                      : "M";
                    return <ManaPip key={c} symbol={sym} size="sm" />;
                  })}
                </div>
              ) : (
                <span className="text-sm text-foreground">—</span>
              )}
            </div>
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
            <OracleText text={card.rules_text} className="text-sm text-muted" />
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

function formatDate(value: string): string {
  try {
    const date = new Date(value);
    return new Intl.DateTimeFormat("en-US", {
      month: "short",
      day: "numeric",
      year: "numeric",
    }).format(date);
  } catch {
    return "—";
  }
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
