import type { Metadata } from "next";
import Link from "next/link";
import { ArrowLeft, GitFork, Heart, Share2 } from "lucide-react";
import { CardPreviewPlaceholder } from "@/components/cards/card-preview-placeholder";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { SurfaceCard } from "@/components/ui/surface-card";

type Params = { slug: string };

export async function generateMetadata({
  params,
}: {
  params: Promise<Params>;
}): Promise<Metadata> {
  const { slug } = await params;
  return {
    title: `${slug.replace(/-/g, " ")}`,
    description: "A custom trading card on CardForge.",
  };
}

export default async function CardDetailPage({
  params,
}: {
  params: Promise<Params>;
}) {
  const { slug } = await params;
  const title = slug
    .split("-")
    .map((s) => s[0]?.toUpperCase() + s.slice(1))
    .join(" ");

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
          <CardPreviewPlaceholder
            card={{
              title,
              cost: "{2}{U}{R}",
              cardType: "creature",
              rarity: "rare",
              colorIdentity: "multicolor",
              artistCredit: "Placeholder",
            }}
          />
        </div>

        <div className="flex flex-col gap-6">
          <div className="flex flex-col gap-3">
            <Badge variant="primary" className="self-start">Public</Badge>
            <h1 className="font-display text-3xl font-semibold tracking-tight text-foreground sm:text-4xl">
              {title}
            </h1>
            <p className="text-sm leading-6 text-muted">
              Slug: <span className="font-mono text-foreground">{slug}</span>
            </p>
          </div>

          <div className="flex flex-wrap items-center gap-2">
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
            <Detail label="Card type" value="Creature" />
            <Detail label="Rarity" value="Rare" />
            <Detail label="Cost" value="{2}{U}{R}" />
            <Detail label="Color identity" value="Multicolor" />
            <Detail label="Power / Toughness" value="3 / 4" />
            <Detail label="Visibility" value="Public" />
          </SurfaceCard>

          <SurfaceCard className="flex flex-col gap-3 p-6">
            <h2 className="font-display text-lg font-semibold text-foreground">
              Rules text
            </h2>
            <p className="text-sm leading-6 text-muted">
              Generic rules text appears here. Once the data model and creator
              ship, the structured fields render automatically.
            </p>
          </SurfaceCard>

          <SurfaceCard className="flex flex-col gap-3 p-6">
            <h2 className="font-display text-lg font-semibold text-foreground">
              Flavor text
            </h2>
            <p className="text-sm leading-6 italic text-muted">
              “Every forge needs a first spark.”
            </p>
          </SurfaceCard>
        </div>
      </div>
    </div>
  );
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
