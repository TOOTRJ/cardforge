import type { Metadata } from "next";
import Link from "next/link";
import { notFound } from "next/navigation";
import { ArrowRight, Hash, Sparkles } from "lucide-react";
import { Button } from "@/components/ui/button";
import { PageHeader } from "@/components/layout/page-header";
import { GalleryCardTile } from "@/components/cards/gallery-card-tile";
import { HubLinks } from "@/components/cards/hub-links";
import { breadcrumbJsonLd, itemListJsonLd, JsonLd } from "@/components/seo/json-ld";
import { listGalleryCards } from "@/lib/cards/queries";
import { isIndexableTagHub, listTagHubs, resolveTagHub, TAG_HUB_MIN_CARDS } from "@/lib/cards/hubs";

// ---------------------------------------------------------------------------
// /gallery/tag/[tag] — a real page per discovery tag, built from the public
// cards that carry it (migration 0108's counts + list_gallery_cards). Any tag
// renders; only tags with TAG_HUB_MIN_CARDS+ public cards are indexed and
// sitemapped — the rest are noindex, follow, like the thin guide tag hubs.
// Cookie-free (public client) so the page is ISR.
// ---------------------------------------------------------------------------

export const revalidate = 3600;
export const dynamicParams = true;

type Params = { tag: string };

export async function generateStaticParams(): Promise<Params[]> {
  const hubs = await listTagHubs();
  return hubs.filter(isIndexableTagHub).map((hub) => ({ tag: hub.slug }));
}

export async function generateMetadata({ params }: { params: Promise<Params> }): Promise<Metadata> {
  const { tag } = await params;
  const hub = await resolveTagHub(tag);
  if (!hub) notFound();
  const description = `${hub.count} custom Magic: The Gathering-style card${hub.count === 1 ? "" : "s"} tagged "${hub.tag}", designed with PipGlyph's free card creator. Browse them, remix one, or make your own.`;
  return {
    title: `Custom MTG cards tagged "${hub.tag}"`,
    description,
    alternates: { canonical: `/gallery/tag/${hub.slug}` },
    robots: isIndexableTagHub(hub) ? undefined : { index: false, follow: true },
    openGraph: {
      title: `Custom MTG cards tagged "${hub.tag}" · PipGlyph`,
      description,
      type: "website",
      url: `/gallery/tag/${hub.slug}`,
    },
  };
}

export default async function TagHubPage({ params }: { params: Promise<Params> }) {
  const { tag } = await params;
  const hub = await resolveTagHub(tag);
  if (!hub) notFound();
  const cards = await listGalleryCards({ tag: hub.tag, sort: "popular", limit: 24, anonymous: true });
  const galleryHref = `/gallery/browse?tag=${encodeURIComponent(hub.tag)}`;

  return (
    <div className="mx-auto w-full max-w-7xl px-4 py-12 sm:px-6 lg:px-8">
      <JsonLd
        data={breadcrumbJsonLd([
          { name: "Home", path: "/" },
          { name: "Gallery", path: "/gallery" },
          { name: `#${hub.tag}`, path: `/gallery/tag/${hub.slug}` },
        ])}
      />
      <JsonLd
        data={itemListJsonLd({
          name: `Custom MTG cards tagged "${hub.tag}"`,
          items: cards.map((card) => ({
            name: card.title,
            path: `/card/${card.owner?.username ?? "card"}/${card.slug}`,
          })),
        })}
      />
      <PageHeader
        eyebrow="Gallery · tag"
        title={`Custom MTG cards tagged "${hub.tag}"`}
        description={`${hub.count} public card${hub.count === 1 ? "" : "s"} carry the #${hub.tag} tag — all designed with PipGlyph's card creator. ${
          hub.count < TAG_HUB_MIN_CARDS ? "A young tag: add yours to grow it." : "Sorted by what the community liked most."
        }`}
      />
      <div className="mt-8 grid gap-5 sm:grid-cols-2 lg:grid-cols-3 xl:grid-cols-4">
        {cards.map((card) => (
          <GalleryCardTile key={card.id} card={card} isAuthed={false} />
        ))}
      </div>
      <div className="mt-10 flex flex-wrap items-center gap-3 border-t border-border/40 pt-6">
        <Button asChild size="sm">
          <Link href="/create">
            <Sparkles className="h-3.5 w-3.5" aria-hidden />
            Make your own #{hub.tag} card
          </Link>
        </Button>
        <Button asChild variant="outline" size="sm">
          <Link href={galleryHref}>
            <Hash className="h-3.5 w-3.5" aria-hidden />
            Every card tagged {hub.tag}
            <ArrowRight className="h-3.5 w-3.5" aria-hidden />
          </Link>
        </Button>
      </div>
      <HubLinks currentTag={hub.slug} />
    </div>
  );
}
