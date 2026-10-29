import type { Metadata } from "next";
import Link from "next/link";
import { notFound } from "next/navigation";
import { ArrowRight } from "lucide-react";
import { Button } from "@/components/ui/button";
import { PageHeader } from "@/components/layout/page-header";
import { breadcrumbJsonLd, itemListJsonLd, JsonLd } from "@/components/seo/json-ld";
import { DECK_GRID_CLASS, DECK_GRID_SIZES, DeckTile } from "@/components/decks/deck-tile";
import { listDeckTileArt } from "@/lib/decks/tile-art";
import { DeckFormatLinks } from "@/components/decks/deck-format-links";
import { NewDeckButton } from "@/components/decks/new-deck-provider";
import { listPublicDecks } from "@/lib/decks/queries";
import { FORMAT_HUB_MIN_DECKS, formatHubCopy, isDeckFormat, listFormatHubs } from "@/lib/cards/hubs";
import { DECK_FORMAT_VALUES } from "@/types/deck";
import { PageContainer } from "@/components/layout/page-container";

// ---------------------------------------------------------------------------
// /decks/format/[format] — one page per deck format with the community's
// public decks in it. ISR, cookie-free. Indexed once the format holds
// FORMAT_HUB_MIN_DECKS non-empty public decks; noindex, follow until then.
// ---------------------------------------------------------------------------

export const revalidate = 3600;
export const dynamicParams = false;

type Params = { format: string };

export function generateStaticParams(): Params[] {
  return DECK_FORMAT_VALUES.map((format) => ({ format }));
}

export async function generateMetadata({ params }: { params: Promise<Params> }): Promise<Metadata> {
  const { format } = await params;
  if (!isDeckFormat(format)) notFound();
  const copy = formatHubCopy(format);
  const count = (await listFormatHubs()).find((hub) => hub.format === format)?.count ?? 0;
  const description = `${count} public ${copy.title.replace("Custom ", "custom ").toLowerCase()} on PipGlyph — imported decklists rebuilt card by card as proxies. Browse, copy a list, or build your own.`;
  return {
    title: `${copy.title} — browse and build`,
    description,
    alternates: { canonical: `/decks/format/${format}` },
    robots: count >= FORMAT_HUB_MIN_DECKS ? undefined : { index: false, follow: true },
    openGraph: { title: `${copy.title} · PipGlyph`, description, type: "website", url: `/decks/format/${format}` },
  };
}

export default async function FormatHubPage({ params }: { params: Promise<Params> }) {
  const { format } = await params;
  if (!isDeckFormat(format)) notFound();
  const copy = formatHubCopy(format);
  const [decks, hubs] = await Promise.all([
    listPublicDecks({ format, sort: "popular", limit: 24, anonymous: true }),
    listFormatHubs(),
  ]);
  const count = hubs.find((hub) => hub.format === format)?.count ?? 0;
  const art = await listDeckTileArt(decks, { anonymous: true });

  return (
    <PageContainer className="py-12">
      <JsonLd
        data={breadcrumbJsonLd([
          { name: "Home", path: "/" },
          { name: "Community decks", path: "/decks" },
          { name: copy.title, path: `/decks/format/${format}` },
        ])}
      />
      <JsonLd
        data={itemListJsonLd({
          name: copy.title,
          items: decks.map((deck) => ({ name: deck.title, path: `/deck/${deck.slug}` })),
        })}
      />
      <PageHeader eyebrow="Decks · format" title={copy.title} description={copy.intro} />
      <p className="mt-4 text-sm text-muted">
        {count} public deck{count === 1 ? "" : "s"} in this format so far.
      </p>
      <div className={`mt-8 ${DECK_GRID_CLASS}`}>
        {decks.map((deck) => (
          <DeckTile
            key={deck.id}
            deck={deck}
            art={art.get(deck.id)}
            sizes={DECK_GRID_SIZES}
            likeRedirect={`/decks/format/${format}`}
          />
        ))}
      </div>
      <div className="mt-10 flex flex-wrap items-center gap-3 border-t border-border/40 pt-6">
        <NewDeckButton format={format} size="sm">
          Build a {copy.title.replace("Custom ", "").replace(" decks", "")} deck
        </NewDeckButton>
        <Button asChild variant="ghost" size="sm">
          <Link href={`/decks/browse?format=${format}`}>
            Every deck in this format
            <ArrowRight className="h-3.5 w-3.5" aria-hidden />
          </Link>
        </Button>
      </div>
      <DeckFormatLinks current={format} />
    </PageContainer>
  );
}
