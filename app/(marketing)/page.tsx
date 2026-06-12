import type { Metadata } from "next";
import Link from "next/link";
import { Suspense } from "react";
import { ArrowRight } from "lucide-react";
import { MarketingHero } from "@/components/marketing/marketing-hero";
import { FeatureGrid } from "@/components/marketing/feature-grid";
import { CardPreviewPlaceholder } from "@/components/cards/card-preview-placeholder";
import {
  TrendingCardsSection,
  TrendingCardsSectionSkeleton,
} from "@/components/gallery/trending-cards-section";
import { Button } from "@/components/ui/button";
import { PLANS } from "@/lib/billing/plans";
import { isBillingEnabled } from "@/lib/billing/flags";
import { listTrendingCards } from "@/lib/cards/queries";
import { getCurrentUser } from "@/lib/supabase/server";
import { isSupabaseConfigured } from "@/lib/supabase/env";

// Self-canonical for the homepage. Other metadata (title, OG, etc.) is
// inherited from the root layout; this just pins the canonical to "/" so it
// doesn't fall through to the metadataBase root ambiguously.
export const metadata: Metadata = {
  alternates: { canonical: "/" },
};

const galleryPlaceholder = [
  {
    title: "Sablethorn Pact",
    cost: "{2}{B}{B}",
    cardType: "enchantment" as const,
    rarity: "rare" as const,
    colorIdentity: "black" as const,
    artistCredit: "Anya Vale",
  },
  {
    title: "Verdant Reliquary",
    cost: "{1}{G}",
    cardType: "artifact" as const,
    rarity: "uncommon" as const,
    colorIdentity: "green" as const,
    artistCredit: "K. Mori",
  },
  {
    title: "Stormbound Herald",
    cost: "{2}{U}{R}",
    cardType: "creature" as const,
    rarity: "mythic" as const,
    colorIdentity: "multicolor" as const,
    artistCredit: "Lior Zane",
  },
  {
    title: "Quiet Pilgrim",
    cost: "{W}",
    cardType: "creature" as const,
    rarity: "common" as const,
    colorIdentity: "white" as const,
    artistCredit: "P. Rook",
  },
];

const VIEW_GALLERY_LINK = (
  <Button asChild variant="outline">
    <Link href="/gallery">
      View gallery
      <ArrowRight className="h-4 w-4" aria-hidden />
    </Link>
  </Button>
);

export default function HomePage() {
  return (
    <>
      <MarketingHero />
      <FeatureGrid />

      <section className="mx-auto w-full max-w-7xl px-4 py-24 sm:px-6 lg:px-8">
        {isSupabaseConfigured() ? (
          <Suspense fallback={<TrendingCardsSectionSkeleton count={4} />}>
            <HomeTrending />
          </Suspense>
        ) : (
          <PlaceholderGallery />
        )}
      </section>

      {isBillingEnabled() ? (
      <section className="mx-auto w-full max-w-5xl px-4 pb-16 sm:px-6 lg:px-8">
        <div className="flex flex-col items-center gap-8 text-center">
          <div className="flex flex-col gap-2">
            <span className="text-xs font-semibold uppercase tracking-[0.18em] text-primary-bright">
              Free to start
            </span>
            <h2 className="font-display text-3xl font-semibold tracking-tight text-foreground sm:text-4xl">
              Upgrade when you need more
            </h2>
            <p className="mx-auto max-w-2xl text-base leading-7 text-muted">
              The card maker is free forever — every frame, every card type.
              Plans add AI generation credits, watermark-free hi-res exports, the
              AI set generator, and premium finishes.
            </p>
          </div>
          <div className="grid w-full gap-4 sm:grid-cols-3">
            {PLANS.map((plan) => (
              <div
                key={plan.tier}
                className={`flex flex-col gap-1 rounded-xl border bg-surface/80 p-5 text-left ${
                  plan.featured
                    ? "border-primary/40 ring-1 ring-primary-bright/20"
                    : "border-border/70"
                }`}
              >
                <span className="font-display text-lg font-semibold text-foreground">
                  {plan.name}
                </span>
                <span className="font-display text-2xl font-semibold text-foreground">
                  ${plan.priceUsd}
                  <span className="text-sm font-normal text-muted">
                    {plan.priceUsd === 0 ? "" : "/mo"}
                  </span>
                </span>
                <span className="text-xs leading-5 text-muted">
                  {plan.tagline}
                </span>
              </div>
            ))}
          </div>
          <Button asChild size="lg">
            <Link href="/pricing">
              See full pricing
              <ArrowRight className="h-4 w-4" aria-hidden />
            </Link>
          </Button>
        </div>
      </section>
      ) : null}

      <section className="mx-auto w-full max-w-5xl px-4 pb-24 sm:px-6 lg:px-8">
        <div className="relative overflow-hidden rounded-frame border border-border bg-linear-to-br from-surface via-surface to-elevated p-10 sm:p-14">
          <div className="absolute inset-0 bg-radial-glow" aria-hidden />
          <div className="relative flex flex-col items-start gap-5">
            <h2 className="font-display text-3xl font-semibold tracking-tight text-foreground sm:text-4xl">
              Ready to forge your first card?
            </h2>
            <p className="max-w-xl text-base leading-7 text-muted">
              Phase 1 ships the foundation. The full editor, auth, and exports
              arrive in the phases ahead. You can already explore the navigation
              and layout shell today.
            </p>
            <div className="flex flex-wrap items-center gap-3">
              <Button asChild size="lg">
                <Link href="/create">Open the creator</Link>
              </Button>
              <Button asChild size="lg" variant="ghost">
                <Link href="/dashboard">Visit the dashboard</Link>
              </Button>
            </div>
          </div>
        </div>
      </section>
    </>
  );
}

async function HomeTrending() {
  const [trending, viewer] = await Promise.all([
    listTrendingCards({ limit: 4 }),
    getCurrentUser(),
  ]);
  if (trending.length === 0) return <PlaceholderGallery />;
  return (
    <TrendingCardsSection
      cards={trending}
      isAuthed={Boolean(viewer)}
      eyebrow="Trending now"
      heading="Top trending cards"
      description="The cards racking up the most likes, comments, and remixes this week."
      action={VIEW_GALLERY_LINK}
    />
  );
}

function PlaceholderGallery() {
  return (
    <>
      <div className="mb-10 flex flex-col items-start justify-between gap-4 md:flex-row md:items-end">
        <div className="flex flex-col gap-2">
          <span className="text-xs font-semibold uppercase tracking-[0.18em] text-primary-bright">
            Gallery preview
          </span>
          <h2 className="font-display text-3xl font-semibold tracking-tight text-foreground sm:text-4xl">
            Cards from the community
          </h2>
          <p className="max-w-2xl text-base leading-7 text-muted">
            Placeholder previews showcase the layout for the public gallery.
            Trending cards will populate here once the community starts forging.
          </p>
        </div>
        {VIEW_GALLERY_LINK}
      </div>

      <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-4">
        {galleryPlaceholder.map((card) => (
          <CardPreviewPlaceholder key={card.title} card={card} />
        ))}
      </div>
    </>
  );
}
