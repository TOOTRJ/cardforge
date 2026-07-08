import type { Metadata } from "next";
import { Suspense } from "react";
import Link from "next/link";
import { ArrowRight, Hash } from "lucide-react";
import { PageHeader } from "@/components/layout/page-header";
import { FeaturedCreators } from "@/components/marketing/featured-creators";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { SurfaceCard } from "@/components/ui/surface-card";
import { StarfieldBackdrop } from "@/components/ui/starfield-backdrop";
import { GlyphDivider } from "@/components/ui/glyph-divider";
import {
  daysLeft,
  isActive,
  listChallenges,
} from "@/lib/challenges/queries";
import { listTrendingTags } from "@/lib/cards/queries";
import { breadcrumbJsonLd, JsonLd } from "@/components/seo/json-ld";

export const metadata: Metadata = {
  title: "Design Challenges",
  description:
    "Community design challenges on PipGlyph — a brief, a tag, and the gallery as the arena. Publish a card with the challenge tag to enter; community likes decide the spotlight.",
  alternates: { canonical: "/challenges" },
};

// ISR: challenges + trending tags are viewer-independent (cookie-free
// public client), so this page serves from the CDN and re-bakes at most
// every 5 minutes. Card mutations purge it eagerly.
export const revalidate = 300;

export default async function ChallengesPage() {
  const [challenges, trendingTags] = await Promise.all([
    listChallenges(),
    listTrendingTags(10),
  ]);
  const active = challenges.filter(isActive);
  const past = challenges.filter((c) => !isActive(c));

  return (
    <div className="mx-auto w-full max-w-7xl px-4 py-16 sm:px-6 lg:px-8">
      <JsonLd
        data={breadcrumbJsonLd([
          { name: "Home", path: "/" },
          { name: "Challenges", path: "/challenges" },
        ])}
      />
      <PageHeader
        eyebrow="Community"
        title="Design challenges"
        description="A brief, a tag, and the gallery as the arena. Publish a card with the challenge tag to enter — community likes decide the spotlight."
      />

      <Suspense fallback={null}>
        <FeaturedCreators />
      </Suspense>

      {/* Active challenges — hero treatment */}
      <div className="mt-10 flex flex-col gap-6">
        {active.length === 0 ? (
          <SurfaceCard className="p-8 text-center text-sm text-muted">
            No challenge is running right now — check back soon, or browse
            past briefs below.
          </SurfaceCard>
        ) : (
          active.map((challenge) => (
            <SurfaceCard
              key={challenge.id}
              tone="gold"
              className="relative overflow-hidden p-8 sm:p-10"
            >
              <div className="absolute inset-0 bg-radial-glow" aria-hidden />
              <StarfieldBackdrop withGlyphs />
              <div className="relative flex flex-col items-start gap-4">
                {challenge.featured ? (
                  <span className="text-xs font-semibold uppercase tracking-[0.18em] text-gold-strong">
                    Featured challenge
                  </span>
                ) : null}
                <h2 className="font-display text-3xl font-semibold tracking-tight text-foreground sm:text-4xl">
                  {challenge.title}
                </h2>
                <p className="max-w-2xl text-sm leading-7 text-muted sm:text-base">
                  {challenge.description}
                </p>
                <div className="flex flex-wrap items-center gap-2">
                  <Badge variant="gold">
                    {daysLeft(challenge)} day{daysLeft(challenge) === 1 ? "" : "s"} left
                  </Badge>
                  <Badge variant="outline" className="gap-1">
                    <Hash className="h-3 w-3" aria-hidden />
                    {challenge.tag}
                  </Badge>
                </div>
                <div className="flex flex-wrap items-center gap-3 pt-1">
                  <Button asChild>
                    <Link href={`/challenges/${challenge.slug}`}>
                      View challenge
                      <ArrowRight className="h-4 w-4" aria-hidden />
                    </Link>
                  </Button>
                  <Button asChild variant="outline">
                    <Link href={`/create?tag=${encodeURIComponent(challenge.tag)}`}>
                      Start designing
                    </Link>
                  </Button>
                </div>
              </div>
            </SurfaceCard>
          ))
        )}
      </div>

      {/* Trending topics */}
      {trendingTags.length > 0 ? (
        <section aria-labelledby="trending-topics" className="mt-16">
          <GlyphDivider className="mb-8" />
          <h2
            id="trending-topics"
            className="font-display mb-4 text-xl font-semibold text-foreground"
          >
            Trending topics
          </h2>
          <div className="flex flex-wrap gap-2">
            {trendingTags.map(({ tag, count }) => (
              <Link
                key={tag}
                href={`/gallery?tag=${encodeURIComponent(tag)}`}
                className="inline-flex items-center gap-1.5 rounded-full border border-border/60 bg-elevated/50 px-3 py-1.5 text-xs font-medium text-muted transition-colors hover:border-gold/40 hover:text-foreground"
              >
                <Hash className="h-3 w-3 text-gold" aria-hidden />
                {tag}
                <span className="text-subtle">{count}</span>
              </Link>
            ))}
          </div>
        </section>
      ) : null}

      {/* Past challenges */}
      {past.length > 0 ? (
        <section aria-labelledby="past-challenges" className="mt-16">
          <h2
            id="past-challenges"
            className="font-display mb-4 text-xl font-semibold text-foreground"
          >
            Past challenges
          </h2>
          <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-3">
            {past.map((challenge) => (
              <SurfaceCard key={challenge.id} className="flex flex-col gap-2 p-5">
                <h3 className="font-display text-lg font-semibold text-foreground">
                  {challenge.title}
                </h3>
                <p className="line-clamp-2 text-sm leading-6 text-muted">
                  {challenge.description}
                </p>
                <Link
                  href={`/challenges/${challenge.slug}`}
                  className="mt-auto pt-2 text-sm font-medium text-primary-bright hover:underline"
                >
                  See the entries →
                </Link>
              </SurfaceCard>
            ))}
          </div>
        </section>
      ) : null}
    </div>
  );
}
