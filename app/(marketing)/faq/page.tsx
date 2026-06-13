import type { Metadata } from "next";
import Link from "next/link";
import { ArrowRight } from "lucide-react";
import { Button } from "@/components/ui/button";
import { GlyphDivider } from "@/components/ui/glyph-divider";
import { breadcrumbJsonLd, JsonLd } from "@/components/seo/json-ld";
import { allFaqEntries, FAQ_TOPICS } from "@/lib/content/faq";

// ---------------------------------------------------------------------------
// /faq — the site-wide Q&A hub.
//
// Renders every topic from lib/content/faq.ts (the landing pages render
// their own subsets of the same source) with ONE combined FAQPage
// JSON-LD. Aggregated Q&A pages like this are prime extraction targets
// for AI answer engines — each answer is written to stand alone.
// ---------------------------------------------------------------------------

// Hard guarantee of static rendering: if a future change introduces a
// cookie/header read on this page, the build fails instead of silently
// losing CDN cacheability.
export const dynamic = "error";

export const metadata: Metadata = {
  title: "FAQ — Custom MTG Card Making, Answered",
  description:
    "Every common question about making custom Magic: The Gathering cards on PipGlyph — the card maker, mana pips and custom symbols, AI generation, sharing, sets, printing, remixing, and challenges.",
  alternates: { canonical: "/faq" },
  openGraph: {
    title: "PipGlyph FAQ — Custom MTG Card Making, Answered",
    description:
      "Direct answers about the card maker, mana pip editor, AI generation, exports and printing, sets, sharing, and community challenges.",
    type: "article",
  },
};

export default function FaqPage() {
  const faqJsonLd = {
    "@context": "https://schema.org",
    "@type": "FAQPage",
    mainEntity: allFaqEntries().map(({ q, a }) => ({
      "@type": "Question",
      name: q,
      acceptedAnswer: { "@type": "Answer", text: a },
    })),
  };

  return (
    <div className="mx-auto w-full max-w-4xl px-4 py-16 sm:px-6 lg:px-8">
      <JsonLd data={faqJsonLd} />
      <JsonLd
        data={breadcrumbJsonLd([
          { name: "Home", path: "/" },
          { name: "FAQ", path: "/faq" },
        ])}
      />

      {/* Hero */}
      <div className="mb-10 flex flex-col gap-4">
        <span className="text-xs font-semibold uppercase tracking-[0.18em] text-primary-bright">
          Help & answers
        </span>
        <h1 className="font-display text-4xl font-semibold leading-tight tracking-tight text-foreground sm:text-5xl">
          Frequently asked questions
        </h1>
        <p className="max-w-2xl text-lg leading-7 text-muted">
          Everything about designing, sharing, and printing custom MTG-style
          cards on PipGlyph — in one place.
        </p>
      </div>

      {/* Topic anchor nav */}
      <nav aria-label="FAQ topics" className="mb-12">
        <ul className="flex flex-wrap gap-x-5 gap-y-2 text-sm">
          {FAQ_TOPICS.map((topic) => (
            <li key={topic.slug}>
              <a
                href={`#${topic.slug}`}
                className="font-medium text-primary-bright underline-offset-4 hover:underline"
              >
                {topic.title}
              </a>
            </li>
          ))}
        </ul>
      </nav>

      {/* Topics */}
      <div className="flex flex-col gap-14">
        {FAQ_TOPICS.map((topic) => (
          <section key={topic.slug} aria-labelledby={topic.slug}>
            <div className="mb-6 flex flex-wrap items-baseline justify-between gap-2">
              {/* scroll-mt keeps the anchored heading clear of the sticky header */}
              <h2
                id={topic.slug}
                className="font-display scroll-mt-24 text-2xl font-semibold text-foreground"
              >
                {topic.title}
              </h2>
              {topic.guideHref ? (
                <Link
                  href={topic.guideHref}
                  className="inline-flex items-center gap-1 text-sm font-medium text-primary-bright underline-offset-4 hover:underline"
                >
                  Full guide
                  <ArrowRight className="h-3.5 w-3.5" aria-hidden />
                </Link>
              ) : null}
            </div>
            <div className="flex flex-col gap-7">
              {topic.entries.map(({ q, a }) => (
                <div key={q}>
                  <h3 className="font-display mb-2 text-lg font-semibold text-foreground">
                    {q}
                  </h3>
                  <p className="text-sm leading-7 text-muted">{a}</p>
                </div>
              ))}
            </div>
          </section>
        ))}
      </div>

      {/* CTA */}
      <GlyphDivider className="my-14" />
      <section
        aria-labelledby="cta-heading"
        className="relative overflow-hidden rounded-frame border border-border bg-surface p-10"
      >
        <div className="absolute inset-0 bg-radial-glow opacity-60" aria-hidden />
        <div className="relative flex flex-col gap-4">
          <h2
            id="cta-heading"
            className="font-display text-2xl font-semibold text-foreground"
          >
            Still curious? The editor answers fastest.
          </h2>
          <p className="max-w-lg text-sm leading-6 text-muted">
            The whole card creator is open without an account — build something
            and see for yourself.
          </p>
          <div className="flex flex-wrap gap-3">
            <Button asChild size="lg">
              <Link href="/preview">Try the card creator</Link>
            </Button>
            <Button asChild size="lg" variant="ghost">
              <Link href="/gallery">Browse the gallery</Link>
            </Button>
          </div>
        </div>
      </section>
    </div>
  );
}
