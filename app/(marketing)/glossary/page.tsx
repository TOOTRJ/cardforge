import type { Metadata } from "next";
import Link from "next/link";
import { ArrowRight } from "lucide-react";
import { Breadcrumbs } from "@/components/layout/breadcrumbs";
import { PageHeader } from "@/components/layout/page-header";
import { Button } from "@/components/ui/button";
import { GlyphDivider } from "@/components/ui/glyph-divider";
import { GlossaryBrowser } from "@/components/content/glossary-browser";
import { definedTermSetJsonLd, JsonLd } from "@/components/seo/json-ld";
import { GLOSSARY_PATH, GLOSSARY_TERMS } from "@/lib/content/glossary";
import { siteOpenGraph, siteTwitter } from "@/lib/seo/share-metadata";

// ---------------------------------------------------------------------------
// /glossary — the words on a Magic card and the words PipGlyph uses (TODO
// NV9), from lib/content/glossary.ts: the one list the creator's "Proxy,
// import or remix?" key reads too. An A–Z jump list, the entries by letter,
// an anchor per entry (/glossary#proxy), and a DefinedTermSet that says the
// same words the page shows.
//
// Hard guarantee of static rendering: a future cookie or header read fails
// the build instead of silently losing CDN cacheability. The filter is a
// client island over HTML that already holds every entry.
// ---------------------------------------------------------------------------

export const dynamic = "error";

const TITLE = "MTG Glossary — Magic Card and Card-Making Terms";
const DESCRIPTION =
  "Plain definitions of the words on a Magic: The Gathering card — pip, frame, type line, mana value, double-faced cards — and the words PipGlyph uses: proxy, import, remix and original.";

export const metadata: Metadata = {
  title: TITLE,
  description: DESCRIPTION,
  alternates: { canonical: GLOSSARY_PATH },
  openGraph: siteOpenGraph({
    title: `${TITLE} · PipGlyph`,
    description: DESCRIPTION,
    type: "website",
    siteName: "PipGlyph",
    url: GLOSSARY_PATH,
  }),
  twitter: siteTwitter({
    title: `${TITLE} · PipGlyph`,
    description: DESCRIPTION,
  }),
};

export default function GlossaryPage() {
  return (
    <div className="mx-auto w-full max-w-7xl px-4 py-12 sm:px-6 lg:px-8 lg:py-16">
      <JsonLd
        data={definedTermSetJsonLd({
          name: "PipGlyph glossary",
          description: DESCRIPTION,
          path: GLOSSARY_PATH,
          terms: GLOSSARY_TERMS.map((entry) => ({
            id: entry.id,
            name: entry.term,
            description: entry.definition,
            alternateNames: entry.aliases,
          })),
        })}
      />
      <Breadcrumbs
        items={[
          { name: "Home", path: "/" },
          { name: "Learn", path: "/learn" },
          { name: "Glossary", path: GLOSSARY_PATH },
        ]}
      />

      <PageHeader
        eyebrow="Glossary"
        title="The card maker's glossary"
        description="Plain definitions of what's printed on a Magic card, from pip and frame to type line and mana value — and the words PipGlyph uses for the cards you make here."
      />

      <GlossaryBrowser />

      <GlyphDivider className="my-16" />
      <section
        aria-labelledby="glossary-cta-heading"
        className="relative overflow-hidden rounded-frame border border-border bg-surface p-8 sm:p-10"
      >
        <div className="absolute inset-0 bg-radial-glow opacity-60" aria-hidden />
        <div className="relative flex flex-col gap-4">
          <h2
            id="glossary-cta-heading"
            className="font-display text-2xl font-semibold text-foreground"
          >
            Put the words on a card
          </h2>
          <p className="max-w-lg text-sm leading-6 text-muted">
            The creator gives each part of a card its own field, with a live preview as you
            type. No account needed to start.
          </p>
          <div className="flex flex-wrap gap-3">
            <Button asChild size="lg">
              <Link href="/create">Open the creator</Link>
            </Button>
            <Button asChild size="lg" variant="ghost">
              <Link href="/learn">
                Read the guides
                <ArrowRight className="h-4 w-4" aria-hidden />
              </Link>
            </Button>
          </div>
        </div>
      </section>
    </div>
  );
}
