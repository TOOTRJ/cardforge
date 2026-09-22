import type { Metadata } from "next";
import Link from "next/link";
import { notFound } from "next/navigation";
import { ArrowRight, Sparkles } from "lucide-react";
import { Button } from "@/components/ui/button";
import { PageHeader } from "@/components/layout/page-header";
import { breadcrumbJsonLd, itemListJsonLd, JsonLd } from "@/components/seo/json-ld";
import { PublicDeckTile } from "@/app/(marketing)/decks/decks-view";
import { DeckFormatLinks } from "@/components/decks/deck-format-links";
import { listPublicDecks } from "@/lib/decks/queries";
import { FORMAT_HUB_MIN_DECKS, formatHubCopy, isDeckFormat, listFormatHubs } from "@/lib/cards/hubs";
import { DECK_FORMAT_VALUES } from "@/types/deck";

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
  const description = `${count} public ${copy.title.replace("Custom ", "custom ").toLowerCase()} on PipGlyph — imported decklists, remixed proxies and AI builds. Browse, copy a list, or build your own.`;
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

  return (
    <div className="mx-auto w-full max-w-7xl px-4 py-12 sm:px-6 lg:px-8">
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
      <div className="mt-8 grid gap-5 sm:grid-cols-2 lg:grid-cols-3">
        {decks.map((deck) => (
          <PublicDeckTile key={deck.id} deck={deck} />
        ))}
      </div>
      <div className="mt-10 flex flex-wrap items-center gap-3 border-t border-border/40 pt-6">
        <Button asChild size="sm">
          <Link href="/dashboard/decks/new">
            <Sparkles className="h-3.5 w-3.5" aria-hidden />
            Build a {copy.title.replace("Custom ", "").replace(" decks", "")} deck
          </Link>
        </Button>
        <Button asChild variant="ghost" size="sm">
          <Link href={`/decks?format=${format}`}>
            Every deck in this format
            <ArrowRight className="h-3.5 w-3.5" aria-hidden />
          </Link>
        </Button>
      </div>
      <DeckFormatLinks current={format} />
    </div>
  );
}
