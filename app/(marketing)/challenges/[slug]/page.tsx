import type { Metadata } from "next";
import Link from "next/link";
import { notFound } from "next/navigation";
import { ArrowRight, Hash } from "lucide-react";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { EmptyState } from "@/components/ui/empty-state";
import { SurfaceCard } from "@/components/ui/surface-card";
import { StarfieldBackdrop } from "@/components/ui/starfield-backdrop";
import { GalleryCardTile } from "@/components/cards/gallery-card-tile";
import {
  daysLeft,
  getChallengeBySlug,
  isActive,
  type Challenge,
} from "@/lib/challenges/queries";
import { listPublicCardsRich } from "@/lib/cards/queries";
import { buildCardPath } from "@/lib/cards/utils";
import { getSiteBaseUrl } from "@/lib/site-url";
import {
  breadcrumbJsonLd,
  itemListJsonLd,
  JsonLd,
} from "@/components/seo/json-ld";

type Params = { slug: string };

// ISR: a challenge page is identical for every viewer (entries come from
// the anonymous query; hearts re-check the session cookie client-side at
// click time). 60s keeps the entries grid feeling live mid-challenge
// while still absorbing traffic spikes on the CDN.
export const revalidate = 60;

// No params prebuilt (challenges are admin-seeded rows, unknown at build
// time) — exporting this opts the segment into on-demand ISR: each slug
// renders on first visit, then serves from cache for the revalidate
// window. Without it the segment stays fully dynamic.
export function generateStaticParams(): Array<{ slug: string }> {
  return [];
}

export async function generateMetadata({
  params,
}: {
  params: Promise<Params>;
}): Promise<Metadata> {
  const { slug } = await params;
  const challenge = await getChallengeBySlug(slug);
  if (!challenge) return { title: "Challenge not found" };
  return {
    title: `${challenge.title} — Design Challenge`,
    description: challenge.description.slice(0, 160),
    alternates: { canonical: `/challenges/${challenge.slug}` },
  };
}

export default async function ChallengeDetailPage({
  params,
}: {
  params: Promise<Params>;
}) {
  const { slug } = await params;
  const challenge = await getChallengeBySlug(slug);
  if (!challenge) notFound();

  const entries = await listPublicCardsRich({
    tag: challenge.tag,
    sort: "popular",
    limit: 24,
    anonymous: true,
  });
  const active = isActive(challenge);

  return (
    <div className="mx-auto w-full max-w-7xl px-4 py-16 sm:px-6 lg:px-8">
      <JsonLd
        data={breadcrumbJsonLd([
          { name: "Home", path: "/" },
          { name: "Challenges", path: "/challenges" },
          { name: challenge.title, path: `/challenges/${challenge.slug}` },
        ])}
      />
      <JsonLd data={buildChallengeEventJsonLd(challenge)} />
      {entries.length > 0 ? (
        <JsonLd
          data={itemListJsonLd({
            name: `${challenge.title} — challenge entries`,
            items: entries.map((card) => ({
              name: card.title,
              path: buildCardPath(card),
            })),
          })}
        />
      ) : null}
      {/* Hero */}
      <SurfaceCard tone="gold" className="relative overflow-hidden p-8 sm:p-12">
        <div className="absolute inset-0 bg-radial-glow" aria-hidden />
        <StarfieldBackdrop withGlyphs />
        <div className="relative flex flex-col items-start gap-4">
          <span className="text-xs font-semibold uppercase tracking-[0.18em] text-gold-strong">
            Design challenge
          </span>
          <h1 className="font-display text-4xl font-semibold tracking-tight text-foreground sm:text-5xl">
            {challenge.title}
          </h1>
          <p className="max-w-2xl text-sm leading-7 text-muted sm:text-base">
            {challenge.description}
          </p>
          <div className="flex flex-wrap items-center gap-2">
            {active ? (
              <Badge variant="gold">
                {daysLeft(challenge)} day{daysLeft(challenge) === 1 ? "" : "s"} left
              </Badge>
            ) : (
              <Badge variant="outline">Closed</Badge>
            )}
            <Badge variant="outline" className="gap-1">
              <Hash className="h-3 w-3" aria-hidden />
              {challenge.tag}
            </Badge>
          </div>
          <p className="text-xs leading-5 text-subtle">
            To enter: publish a card tagged{" "}
            <code className="rounded bg-elevated/70 px-1.5 py-0.5 font-mono text-[11px] text-foreground">
              {challenge.tag}
            </code>{" "}
            — community likes decide the spotlight.
          </p>
          {active ? (
            <div className="flex flex-wrap items-center gap-3 pt-1">
              <Button asChild size="lg">
                <Link href={`/create?tag=${encodeURIComponent(challenge.tag)}`}>
                  Start designing
                  <ArrowRight className="h-4 w-4" aria-hidden />
                </Link>
              </Button>
              <Button asChild size="lg" variant="ghost">
                <Link href="/challenges">All challenges</Link>
              </Button>
            </div>
          ) : (
            <Button asChild variant="outline">
              <Link href="/challenges">All challenges</Link>
            </Button>
          )}
        </div>
      </SurfaceCard>

      {/* Entries */}
      <section aria-labelledby="entries-heading" className="mt-12">
        <div className="mb-6 flex items-baseline justify-between gap-3">
          <h2
            id="entries-heading"
            className="font-display text-2xl font-semibold text-foreground"
          >
            Entries
          </h2>
          <span className="text-sm text-muted">
            {entries.length === 24 ? "24+" : entries.length}{" "}
            {entries.length === 1 ? "entry" : "entries"} · sorted by likes
          </span>
        </div>
        {entries.length === 0 ? (
          <EmptyState
            title="No entries yet"
            description={
              active
                ? "Be the first — publish a card with the challenge tag and it appears here."
                : "This challenge closed without public entries."
            }
            action={
              active ? (
                <Button asChild>
                  <Link href={`/create?tag=${encodeURIComponent(challenge.tag)}`}>
                    Forge the first entry
                  </Link>
                </Button>
              ) : undefined
            }
          />
        ) : (
          <div className="grid gap-5 sm:grid-cols-2 lg:grid-cols-3 xl:grid-cols-4">
            {entries.map((card) => (
              <GalleryCardTile key={card.id} card={card} isAuthed={false} />
            ))}
          </div>
        )}
      </section>
    </div>
  );
}

// ---------------------------------------------------------------------------
// Event JSON-LD — challenges are online events with a real window, which
// lets search engines surface "N days left" style context. Google's Event
// rich result requires a location; VirtualLocation + the online attendance
// mode is the correct shape for a web-only event.
// ---------------------------------------------------------------------------

function buildChallengeEventJsonLd(
  challenge: Challenge,
): Record<string, unknown> {
  const base = getSiteBaseUrl();
  const canonical = `${base}/challenges/${challenge.slug}`;
  return {
    "@context": "https://schema.org",
    "@type": "Event",
    name: challenge.title,
    description: challenge.description,
    startDate: challenge.starts_at,
    endDate: challenge.ends_at,
    eventStatus: "https://schema.org/EventScheduled",
    eventAttendanceMode: "https://schema.org/OnlineEventAttendanceMode",
    location: {
      "@type": "VirtualLocation",
      url: canonical,
    },
    organizer: {
      "@type": "Organization",
      name: "PipGlyph",
      url: base,
    },
    isAccessibleForFree: true,
    url: canonical,
  };
}
