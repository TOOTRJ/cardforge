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
import { GlyphDivider } from "@/components/ui/glyph-divider";
import { StarfieldBackdrop } from "@/components/ui/starfield-backdrop";
import { GUIDE_LINKS } from "@/components/marketing/guide-cross-links";
import { StatBadge } from "@/components/ui/stat-badge";
import { PLANS } from "@/lib/billing/plans";
import { isBillingEnabled } from "@/lib/billing/flags";
import { countPublicCards, listTrendingCards } from "@/lib/cards/queries";
import { isSupabaseConfigured } from "@/lib/supabase/env";
import { FRAME_TEMPLATE_VALUES } from "@/types/card";

// Self-canonical for the homepage. Other metadata (title, OG, etc.) is
// inherited from the root layout; this just pins the canonical to "/" so it
// doesn't fall through to the metadataBase root ambiguously.
export const metadata: Metadata = {
  alternates: { canonical: "/" },
};

// ISR: the homepage is identical for every viewer (stats + trending use
// the cookie-free public client; auth chrome is the client island), so
// it's served from the CDN and re-baked at most every 5 minutes. Card
// mutations also purge it eagerly via revalidatePath("/").
export const revalidate = 300;

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

      {/* Stat strip + brand epigraph — the "engineered for precision" band. */}
      <section className="mx-auto w-full max-w-5xl px-4 pb-8 sm:px-6 lg:px-8">
        <GlyphDivider className="mb-10" />
        {isSupabaseConfigured() ? (
          <Suspense fallback={null}>
            <HomeStats />
          </Suspense>
        ) : null}
        <p className="mx-auto mt-10 max-w-2xl text-center font-display text-lg italic leading-8 text-muted sm:text-xl">
          &ldquo;The finest creations are born from control, intention, and
          imagination.&rdquo;
        </p>
        <GlyphDivider glyph="diamond" className="mt-10" />
      </section>

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
                    ? "border-gold/45 ring-1 ring-gold/20"
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
        <div className="relative overflow-hidden rounded-frame border border-gold/40 bg-linear-to-br from-surface via-surface to-elevated p-10 sm:p-14">
          <div className="absolute inset-0 bg-radial-glow" aria-hidden />
          <StarfieldBackdrop withGlyphs />
          <div className="relative flex flex-col items-start gap-5">
            <h2 className="font-display text-3xl font-semibold tracking-tight text-foreground sm:text-4xl">
              Ready to craft something legendary?
            </h2>
            <p className="max-w-xl text-base leading-7 text-muted">
              Join the creators already building worlds, one card at a time.
              You&apos;re building more than cards — you&apos;re building a
              legacy.
            </p>
            <div className="flex flex-wrap items-center gap-3">
              <Button asChild size="lg">
                <Link href="/create">Start your journey</Link>
              </Button>
              <Button asChild size="lg" variant="ghost">
                <Link href="/gallery">Browse the gallery</Link>
              </Button>
            </div>
          </div>
        </div>
      </section>

      {/* Guide links — internal links so the SEO landing pages aren't
          orphaned (crawlers weight homepage links heavily). */}
      <nav
        aria-label="Guides"
        className="mx-auto w-full max-w-5xl px-4 pb-16 sm:px-6 lg:px-8"
      >
        <p className="text-center text-sm text-muted">
          Guides:{" "}
          {GUIDE_LINKS.map((g, i) => (
            <span key={g.href}>
              {i > 0 ? " · " : ""}
              <Link
                href={g.href}
                className="font-medium text-primary-bright underline-offset-2 hover:underline"
              >
                {g.label}
              </Link>
            </span>
          ))}
        </p>
      </nav>
    </>
  );
}

async function HomeStats() {
  const cardCount = await countPublicCards();
  // Friendly rounding: 1,234 → "1.2K+". Below 100 the raw number reads
  // more honest than a padded "+".
  const cards =
    cardCount >= 1000
      ? `${(cardCount / 1000).toFixed(1).replace(/\.0$/, "")}K+`
      : `${cardCount}`;
  return (
    <div className="grid grid-cols-2 gap-8 sm:grid-cols-4">
      <StatBadge value={cards} label="Cards forged" />
      <StatBadge value={`${FRAME_TEMPLATE_VALUES.length}+`} label="Frame styles" />
      <StatBadge value="6" label="Mana identities" />
      <StatBadge value="∞" label="Possibilities" />
    </div>
  );
}

async function HomeTrending() {
  // Anonymous mode keeps this page static: no viewer lookup, no cookie
  // read. isAuthed=false just means the tile hearts render the
  // signed-out hint — QuickLikeButton re-checks the session cookie at
  // click time, so signed-in users on the cached page still like fine.
  const trending = await listTrendingCards({ limit: 4, anonymous: true });
  if (trending.length === 0) return <PlaceholderGallery />;
  return (
    <TrendingCardsSection
      cards={trending}
      isAuthed={false}
      eyebrow="Trending now"
      heading="Top trending cards"
      description="The cards racking up the most likes, comments, and remixes this week."
      action={VIEW_GALLERY_LINK}
      // First card images in the viewport — preload instead of lazy-load.
      priority
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
