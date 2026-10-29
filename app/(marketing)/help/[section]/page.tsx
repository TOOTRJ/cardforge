import type { Metadata } from "next";
import Link from "next/link";
import { notFound } from "next/navigation";
import { ArrowRight, Lightbulb, LifeBuoy } from "lucide-react";
import { ArticleToc } from "@/components/content/article-toc";
import { HelpSectionIcon } from "@/components/content/help-icons";
import { HelpSectionLinks } from "@/components/content/help-section-links";
import { Breadcrumbs } from "@/components/layout/breadcrumbs";
import { faqJsonLd, JsonLd } from "@/components/seo/json-ld";
import { Button } from "@/components/ui/button";
import { IconTile } from "@/components/ui/icon-tile";
import { SurfaceCard } from "@/components/ui/surface-card";
import type { TocItem } from "@/lib/content/articles";
import {
  getHelpSection,
  HELP_PATH,
  HELP_SECTION_SLUGS,
  helpGroupEntries,
  helpSectionMarkupEntries,
  helpSectionPath,
  landingPageOf,
  type HelpHowTo,
  type HelpSection,
} from "@/lib/content/help";
import { siteOpenGraph, siteTwitter } from "@/lib/seo/share-metadata";

// ---------------------------------------------------------------------------
// /help/[section] — one help topic (TODO NV6): its how-to, then its answers
// in groups, every one under its stable anchor (lib/content/help.ts).
//
// Fully static: the eight sections are the only params (anything else is a
// real 404 — dynamicParams = false, and notFound() in both the metadata and
// the page, ahead of any boundary). Every section is indexed and
// self-canonical. Its FAQPage JSON-LD carries only the answers whose ONE
// markup home is this page — a landing page's answers are shown here too,
// with a link back, but marked up there (faqMarkupHomeOf).
// ---------------------------------------------------------------------------

type Params = { section: string };

export function generateStaticParams(): Params[] {
  return HELP_SECTION_SLUGS.map((section) => ({ section }));
}

export const dynamic = "error";
export const dynamicParams = false;

export async function generateMetadata({
  params,
}: {
  params: Promise<Params>;
}): Promise<Metadata> {
  const { section: slug } = await params;
  const section = getHelpSection(slug);
  if (!section) notFound();
  const path = helpSectionPath(section.slug);
  const title = `${section.title} · Help`;
  return {
    title,
    description: section.description,
    alternates: { canonical: path },
    openGraph: siteOpenGraph({
      title: `${title} · PipGlyph`,
      description: section.description,
      type: "website",
      siteName: "PipGlyph",
      url: path,
    }),
    twitter: siteTwitter({
      title: `${title} · PipGlyph`,
      description: section.description,
    }),
  };
}

export default async function HelpSectionPage({
  params,
}: {
  params: Promise<Params>;
}) {
  const { section: slug } = await params;
  const section = getHelpSection(slug);
  if (!section) notFound();

  const path = helpSectionPath(section.slug);
  const markup = helpSectionMarkupEntries(section);
  const toc = tocOf(section);

  return (
    <div className="mx-auto w-full max-w-7xl px-4 py-12 sm:px-6 lg:grid lg:grid-cols-[minmax(0,48rem)_minmax(0,1fr)] lg:gap-x-12 lg:px-8 lg:py-16">
      <div className="min-w-0 max-w-3xl">
        {markup.length > 0 ? <JsonLd data={faqJsonLd(markup)} /> : null}
        <Breadcrumbs
          items={[
            { name: "Home", path: "/" },
            { name: "Help", path: HELP_PATH },
            { name: section.title, path },
          ]}
        />

        <header className="flex flex-col gap-4 border-b border-gold/20 pb-8">
          <span className="inline-flex items-center gap-2 text-xs font-semibold uppercase tracking-[0.18em] text-gold-strong">
            <HelpSectionIcon slug={section.slug} className="h-4 w-4" />
            Help centre
          </span>
          <h1 className="font-display text-3xl font-semibold tracking-tight text-foreground sm:text-4xl">
            {section.title}
          </h1>
          <p className="text-base leading-7 text-muted">{section.intro}</p>
        </header>

        <div className="lg:hidden">
          <ArticleToc items={toc} />
        </div>

        {section.howTo ? <HowToCard howTo={section.howTo} /> : null}

        {section.groups.map((group) => (
          <section key={group.id} aria-labelledby={group.id} className="mt-12">
            <h2
              id={group.id}
              className="scroll-mt-24 font-display text-2xl font-semibold tracking-tight text-foreground"
            >
              {group.title}
            </h2>
            <div className="mt-4 flex flex-col divide-y divide-border/50">
              {helpGroupEntries(group).map((entry) => {
                const landing = landingPageOf(entry.id);
                return (
                  // The anchor is the whole answer, so `:target` (a link
                  // to /help/<section>#<id>) marks the answer it opens on.
                  <div
                    key={entry.id}
                    id={entry.id}
                    className="-mx-4 scroll-mt-24 rounded-card px-4 py-6 transition-colors target:bg-surface/80 target:ring-1 target:ring-gold/40"
                  >
                    <h3 className="font-display text-lg font-semibold leading-snug text-foreground">
                      {entry.q}
                    </h3>
                    <p className="mt-2 text-sm leading-7 text-muted">{entry.a}</p>
                    {landing ? (
                      <p className="mt-2 text-xs text-subtle">
                        From the{" "}
                        <Link
                          href={landing.href}
                          className="rounded-sm text-primary-bright underline decoration-primary-bright/50 underline-offset-2 hover:decoration-primary-bright focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-primary-bright/60"
                        >
                          {landing.label}
                        </Link>{" "}
                        page
                      </p>
                    ) : null}
                  </div>
                );
              })}
            </div>
          </section>
        ))}

        <StillStuck />

        <HelpSectionLinks
          current={section.slug}
          label="Other help topics"
          className="mt-14 border-t border-border/40 pt-8"
        />
      </div>

      <aside className="hidden lg:block">
        <div className="sticky top-24 max-h-[calc(100vh-7rem)] overflow-y-auto pt-16">
          <ArticleToc items={toc} variant="sidebar" />
        </div>
      </aside>
    </div>
  );
}

/** "On this page": the how-to, each group, each question. */
function tocOf(section: HelpSection): TocItem[] {
  return [
    ...(section.howTo ? [{ depth: 2 as const, text: section.howTo.title, id: section.howTo.id }] : []),
    ...section.groups.flatMap((group) => [
      { depth: 2 as const, text: group.title, id: group.id },
      ...helpGroupEntries(group).map((entry) => ({
        depth: 3 as const,
        text: entry.q,
        id: entry.id,
      })),
    ]),
  ];
}

function HowToCard({ howTo }: { howTo: HelpHowTo }) {
  const titleId = `${howTo.id}-title`;
  return (
    <section
      id={howTo.id}
      aria-labelledby={titleId}
      className="mt-10 scroll-mt-24 rounded-frame border border-gold/30 bg-surface/70 p-6 sm:p-8"
    >
      <p className="text-xs font-semibold uppercase tracking-[0.18em] text-gold-strong">
        How to
      </p>
      <h2
        id={titleId}
        className="mt-2 font-display text-2xl font-semibold tracking-tight text-foreground"
      >
        {howTo.title}
      </h2>
      <p className="mt-2 text-sm leading-6 text-muted">{howTo.summary}</p>

      {/* role="list": Safari drops a list's semantics with its markers. */}
      <ol role="list" className="mt-6 flex flex-col gap-5">
        {howTo.steps.map((step, index) => (
          <li key={step.title} className="flex gap-4">
            <span
              aria-hidden
              className="flex h-8 w-8 shrink-0 items-center justify-center rounded-full border border-gold/50 bg-background/60 text-sm font-semibold tabular-nums text-gold-strong"
            >
              {index + 1}
            </span>
            <div className="flex min-w-0 flex-col gap-1 pt-1">
              <h3 className="text-base font-semibold text-foreground">
                <span className="sr-only">Step {index + 1}: </span>
                {step.title}
              </h3>
              <p className="text-sm leading-6 text-muted">{step.body}</p>
            </div>
          </li>
        ))}
      </ol>

      {howTo.tip ? (
        <p className="mt-6 flex gap-3 rounded-card border border-border/60 bg-background/40 p-4 text-sm leading-6 text-muted">
          <Lightbulb className="mt-0.5 h-4 w-4 shrink-0 text-gold" aria-hidden />
          <span>{howTo.tip}</span>
        </p>
      ) : null}

      <div className="mt-6">
        <Button asChild>
          <Link href={howTo.cta.href}>
            {howTo.cta.label}
            <ArrowRight className="h-4 w-4" aria-hidden />
          </Link>
        </Button>
      </div>
    </section>
  );
}

function StillStuck() {
  return (
    <SurfaceCard className="mt-14 flex flex-col gap-4 p-6 sm:flex-row sm:items-center">
      <IconTile tone="purple" size="lg">
        <LifeBuoy aria-hidden />
      </IconTile>
      <div className="flex min-w-0 flex-1 flex-col gap-1">
        <h2 className="font-display text-lg font-semibold text-foreground">Still stuck?</h2>
        <p className="text-sm leading-6 text-muted">
          Search every answer from the{" "}
          <Link
            href={HELP_PATH}
            className="rounded-sm text-primary-bright underline decoration-primary-bright/50 underline-offset-2 hover:decoration-primary-bright focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-primary-bright/60"
          >
            help centre
          </Link>
          , or tell us what you were trying to do — the{" "}
          <Link
            href="/feedback"
            className="rounded-sm text-primary-bright underline decoration-primary-bright/50 underline-offset-2 hover:decoration-primary-bright focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-primary-bright/60"
          >
            feedback form
          </Link>{" "}
          reaches the team once you&apos;re signed in.
        </p>
      </div>
    </SurfaceCard>
  );
}
