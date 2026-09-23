import type { Metadata } from "next";
import Link from "next/link";
import { notFound } from "next/navigation";
import { ArrowRight, BookOpen, Sparkles } from "lucide-react";
import { Button } from "@/components/ui/button";
import { PageHeader } from "@/components/layout/page-header";
import { GalleryCardTile } from "@/components/cards/gallery-card-tile";
import { HubLinks } from "@/components/cards/hub-links";
import { breadcrumbJsonLd, itemListJsonLd, JsonLd } from "@/components/seo/json-ld";
import { listGalleryCards } from "@/lib/cards/queries";
import { HUB_TYPES, isHubType, listTypeHubs, TYPE_HUB_COPY, TYPE_HUB_MIN_CARDS } from "@/lib/cards/hubs";
import { CARD_TYPE_LABELS } from "@/types/card";

// ---------------------------------------------------------------------------
// /gallery/type/[type] — one page per card type (creature, instant, …) with a
// factual intro, the design guide for the type, and the community's most
// liked public cards of that type. ISR, cookie-free. Indexed as soon as the
// type has a public card; noindex, follow until then.
// ---------------------------------------------------------------------------

export const revalidate = 3600;
export const dynamicParams = false;

type Params = { type: string };

export function generateStaticParams(): Params[] {
  return HUB_TYPES.map((type) => ({ type }));
}

export async function generateMetadata({ params }: { params: Promise<Params> }): Promise<Metadata> {
  const { type } = await params;
  if (!isHubType(type)) notFound();
  const copy = TYPE_HUB_COPY[type];
  const count = (await listTypeHubs()).find((hub) => hub.type === type)?.count ?? 0;
  const description = `${copy.intro.split(". ")[0]}. ${count} public custom ${CARD_TYPE_LABELS[type].toLowerCase()} card${count === 1 ? "" : "s"} to browse, remix or print.`;
  return {
    title: `${copy.title} — browse, remix, make your own`,
    description,
    alternates: { canonical: `/gallery/type/${type}` },
    robots: count >= TYPE_HUB_MIN_CARDS ? undefined : { index: false, follow: true },
    openGraph: { title: `${copy.title} · PipGlyph`, description, type: "website", url: `/gallery/type/${type}` },
  };
}

export default async function TypeHubPage({ params }: { params: Promise<Params> }) {
  const { type } = await params;
  if (!isHubType(type)) notFound();
  const copy = TYPE_HUB_COPY[type];
  const [cards, hubs] = await Promise.all([
    listGalleryCards({ cardType: type, sort: "popular", limit: 24, anonymous: true }),
    listTypeHubs(),
  ]);
  const count = hubs.find((hub) => hub.type === type)?.count ?? 0;
  const label = CARD_TYPE_LABELS[type].toLowerCase();

  return (
    <div className="mx-auto w-full max-w-7xl px-4 py-12 sm:px-6 lg:px-8">
      <JsonLd
        data={breadcrumbJsonLd([
          { name: "Home", path: "/" },
          { name: "Gallery", path: "/gallery" },
          { name: copy.title, path: `/gallery/type/${type}` },
        ])}
      />
      <JsonLd
        data={itemListJsonLd({
          name: copy.title,
          items: cards.map((card) => ({
            name: card.title,
            path: `/card/${card.owner?.username ?? "card"}/${card.slug}`,
          })),
        })}
      />
      <PageHeader eyebrow="Gallery · card type" title={copy.title} description={copy.intro} />
      <p className="mt-4 text-sm text-muted">
        {count} public custom {label} card{count === 1 ? "" : "s"} so far
        {copy.guide ? (
          <>
            {" "}
            · read{" "}
            <Link href={copy.guide.href} className="text-foreground underline decoration-border-strong underline-offset-4 hover:decoration-foreground">
              {copy.guide.label}
            </Link>
          </>
        ) : null}
        .
      </p>
      <div className="mt-8 grid gap-5 sm:grid-cols-2 lg:grid-cols-3 xl:grid-cols-4">
        {cards.map((card) => (
          <GalleryCardTile key={card.id} card={card} isAuthed={false} />
        ))}
      </div>
      <div className="mt-10 flex flex-wrap items-center gap-3 border-t border-border/40 pt-6">
        <Button asChild size="sm">
          <Link href="/create">
            <Sparkles className="h-3.5 w-3.5" aria-hidden />
            Design a {label}
          </Link>
        </Button>
        {copy.guide ? (
          <Button asChild variant="outline" size="sm">
            <Link href={copy.guide.href}>
              <BookOpen className="h-3.5 w-3.5" aria-hidden />
              {copy.guide.label}
            </Link>
          </Button>
        ) : null}
        <Button asChild variant="ghost" size="sm">
          <Link href={`/gallery/browse?type=${type}`}>
            Every {label} in the gallery
            <ArrowRight className="h-3.5 w-3.5" aria-hidden />
          </Link>
        </Button>
      </div>
      <HubLinks currentType={type} />
    </div>
  );
}
