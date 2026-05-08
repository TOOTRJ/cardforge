import type { Metadata } from "next";
import Link from "next/link";
import { ArrowLeft } from "lucide-react";
import { CardPreviewPlaceholder } from "@/components/cards/card-preview-placeholder";
import { PageHeader } from "@/components/layout/page-header";
import { SurfaceCard } from "@/components/ui/surface-card";
import { Badge } from "@/components/ui/badge";

type Params = { username: string };

export async function generateMetadata({
  params,
}: {
  params: Promise<Params>;
}): Promise<Metadata> {
  const { username } = await params;
  return {
    title: `@${username}`,
    description: `Custom cards forged by @${username} on CardForge.`,
  };
}

export default async function ProfilePage({
  params,
}: {
  params: Promise<Params>;
}) {
  const { username } = await params;
  const displayName = username
    .split(/[-_]/)
    .map((s) => s[0]?.toUpperCase() + s.slice(1))
    .join(" ") || username;

  const cards = Array.from({ length: 4 }, (_, i) => ({
    id: String(i),
    slug: `${username}-card-${i + 1}`,
    title: `${displayName} Card ${i + 1}`,
    cost: "{2}{U}",
    cardType: "creature" as const,
    rarity: "rare" as const,
    colorIdentity: "blue" as const,
    artistCredit: displayName,
  }));

  return (
    <div className="mx-auto w-full max-w-7xl px-4 py-12 sm:px-6 lg:px-8">
      <Link
        href="/gallery"
        className="mb-6 inline-flex items-center gap-1 text-sm text-muted transition-colors hover:text-foreground"
      >
        <ArrowLeft className="h-4 w-4" aria-hidden />
        Back to gallery
      </Link>

      <SurfaceCard className="flex flex-col items-start gap-4 p-8 sm:flex-row sm:items-center sm:justify-between">
        <div className="flex items-center gap-4">
          <span className="flex h-16 w-16 items-center justify-center rounded-full bg-linear-to-br from-primary to-accent font-display text-xl font-semibold text-primary-foreground">
            {displayName[0]?.toUpperCase()}
          </span>
          <div className="flex flex-col gap-1">
            <h1 className="font-display text-2xl font-semibold tracking-tight text-foreground">
              {displayName}
            </h1>
            <span className="font-mono text-sm text-muted">@{username}</span>
          </div>
        </div>
        <div className="flex items-center gap-2">
          <Badge>{cards.length} cards</Badge>
          <Badge variant="outline">0 sets</Badge>
        </div>
      </SurfaceCard>

      <PageHeader
        className="mt-10"
        eyebrow="Cards"
        title={`Forged by ${displayName}`}
        description="Public cards published by this creator. Authentication and real card data ship in later phases."
      />

      <div className="mt-8 grid gap-5 sm:grid-cols-2 lg:grid-cols-3 xl:grid-cols-4">
        {cards.map((card) => (
          <Link key={card.id} href={`/card/${card.slug}`} className="block">
            <CardPreviewPlaceholder card={card} />
          </Link>
        ))}
      </div>
    </div>
  );
}
