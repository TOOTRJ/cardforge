import type { Metadata } from "next";
import Link from "next/link";
import { ArrowRight, BookOpen, LifeBuoy, ListChecks, Megaphone } from "lucide-react";
import { HelpHashForward } from "@/components/content/help-hash-forward";
import { HelpSectionIcon } from "@/components/content/help-icons";
import { HelpSearch } from "@/components/content/help-search";
import { Breadcrumbs } from "@/components/layout/breadcrumbs";
import { PageHeader } from "@/components/layout/page-header";
import { collectionPageJsonLd, JsonLd } from "@/components/seo/json-ld";
import { Button } from "@/components/ui/button";
import { IconTile } from "@/components/ui/icon-tile";
import { SurfaceCard } from "@/components/ui/surface-card";
import {
  HELP_PATH,
  HELP_SECTIONS,
  helpForwardTargets,
  helpSearchItems,
  helpSectionEntries,
  helpSectionPath,
  LEGACY_FAQ_ANCHORS,
  type HelpSection,
} from "@/lib/content/help";
import { siteOpenGraph, siteTwitter } from "@/lib/seo/share-metadata";
import { PageContainer } from "@/components/layout/page-container";

// ---------------------------------------------------------------------------
// /help — the help centre's hub (TODO NV6): a filter box over every answer
// and how-to, the how-tos, and the eight sections with their first
// questions. It carries no FAQPage of its own: every answer is marked up on
// its one home (lib/content/help.ts), and the hub only links to them.
//
// /faq is a 308 here (proxy.ts). Its old topic anchors arrive as
// /help#exports and the forwarder island sends them on; without JavaScript
// the ids on the section cards still scroll to the right topic.
//
// Static: the answers are code (lib/content/faq.ts), so nothing here reads
// a cookie, a header or the database.
// ---------------------------------------------------------------------------

export const dynamic = "error";

const TITLE = "Help & FAQ — Custom MTG Card Making, Answered";
const DESCRIPTION =
  "Answers about making custom Magic: The Gathering cards on PipGlyph — the creator, importing real cards, decks, printing and exports, AI credits, sharing and your account.";

export const metadata: Metadata = {
  title: TITLE,
  description: DESCRIPTION,
  alternates: { canonical: HELP_PATH },
  openGraph: siteOpenGraph({
    title: `${TITLE} · PipGlyph`,
    description: DESCRIPTION,
    type: "website",
    siteName: "PipGlyph",
    url: HELP_PATH,
  }),
  twitter: siteTwitter({
    title: `${TITLE} · PipGlyph`,
    description: DESCRIPTION,
  }),
};

/** The questions a section card names before "All N answers". */
const QUESTIONS_PER_CARD = 3;

export default function HelpPage() {
  const howTos = HELP_SECTIONS.flatMap((section) =>
    section.howTo ? [{ section, howTo: section.howTo }] : [],
  );
  const answerCount = HELP_SECTIONS.reduce(
    (sum, section) => sum + helpSectionEntries(section).length,
    0,
  );

  return (
    <PageContainer className="py-12 lg:py-16">
      <HelpHashForward targets={helpForwardTargets()} />
      <JsonLd
        data={collectionPageJsonLd({
          name: "PipGlyph help centre",
          description: DESCRIPTION,
          path: HELP_PATH,
          items: HELP_SECTIONS.map((section) => ({
            name: section.title,
            path: helpSectionPath(section.slug),
          })),
        })}
      />
      <Breadcrumbs
        items={[
          { name: "Home", path: "/" },
          { name: "Help", path: HELP_PATH },
        ]}
      />

      <PageHeader
        eyebrow="Help & FAQ"
        title="How can we help?"
        description={`${answerCount} answers and ${howTos.length} short how-tos about using PipGlyph — the creator, imports, decks, printing, credits and your account. Designing the cards themselves is what the guides in Learn are for.`}
        actions={
          <Button asChild variant="outline">
            <Link href="/learn">
              <BookOpen className="h-4 w-4" aria-hidden />
              Design guides
            </Link>
          </Button>
        }
      />

      <div className="mt-8 max-w-2xl">
        <HelpSearch items={helpSearchItems()} />
      </div>

      {/* How-tos */}
      <section aria-labelledby="hub-how-tos" className="mt-14">
        <h2
          id="hub-how-tos"
          className="mb-5 flex items-center gap-2 font-display text-2xl font-semibold text-foreground"
        >
          <ListChecks className="h-5 w-5 text-gold" aria-hidden />
          Step by step
        </h2>
        <ul className="grid gap-4 md:grid-cols-2 xl:grid-cols-3">
          {howTos.map(({ section, howTo }) => (
            <li key={howTo.id} className="flex">
              <Link
                href={`${helpSectionPath(section.slug)}#${howTo.id}`}
                className="group flex w-full items-start gap-4 rounded-card border border-border/70 bg-surface/60 p-5 transition-colors hover:border-border-strong hover:bg-surface focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-primary-bright/60"
              >
                <IconTile tone="gold">
                  <HelpSectionIcon slug={section.slug} />
                </IconTile>
                <span className="flex min-w-0 flex-col gap-1">
                  <span className="font-display text-base font-semibold text-foreground group-hover:text-primary-bright">
                    {howTo.title}
                  </span>
                  <span className="text-sm leading-6 text-muted">{howTo.summary}</span>
                  <span className="text-xs text-subtle">
                    <span className="sr-only">In </span>
                    {section.title} · {howTo.steps.length} steps
                  </span>
                </span>
              </Link>
            </li>
          ))}
        </ul>
      </section>

      {/* Sections */}
      <section aria-labelledby="hub-topics" className="mt-16">
        <h2
          id="hub-topics"
          className="mb-5 flex items-center gap-2 font-display text-2xl font-semibold text-foreground"
        >
          <LifeBuoy className="h-5 w-5 text-primary-bright" aria-hidden />
          Browse by topic
        </h2>
        <ul className="grid gap-5 md:grid-cols-2 xl:grid-cols-4">
          {HELP_SECTIONS.map((section) => (
            <li key={section.slug} className="flex">
              <SectionCard section={section} />
            </li>
          ))}
        </ul>
      </section>

      {/* Elsewhere */}
      <section
        aria-labelledby="hub-more"
        className="relative mt-16 overflow-hidden rounded-frame border border-border bg-surface p-8 sm:p-10"
      >
        <div className="absolute inset-0 bg-radial-glow opacity-60" aria-hidden />
        <div className="relative flex flex-col gap-4">
          <h2 id="hub-more" className="font-display text-2xl font-semibold text-foreground">
            Still stuck?
          </h2>
          <p className="max-w-xl text-sm leading-6 text-muted">
            Tell us what you were trying to do — the feedback form reaches the team once
            you&apos;re signed in. New features and fixes land on What&apos;s new first.
          </p>
          <div className="flex flex-wrap gap-3">
            <Button asChild size="lg">
              <Link href="/feedback">Send feedback</Link>
            </Button>
            <Button asChild size="lg" variant="ghost">
              <Link href="/news">
                <Megaphone className="h-4 w-4" aria-hidden />
                What&apos;s new
              </Link>
            </Button>
          </div>
        </div>
      </section>
    </PageContainer>
  );
}

/** One section: its title (the link to its page), one line, its first
 *  questions (each a link to its answer) and the count. The questions are
 *  links of their own, so the card is not one big link. The old /faq topic
 *  anchors that forward here sit on the card as ids, for a browser without
 *  JavaScript. */
function SectionCard({ section }: { section: HelpSection }) {
  const path = helpSectionPath(section.slug);
  const entries = helpSectionEntries(section);
  const first = entries.slice(0, QUESTIONS_PER_CARD);
  const legacyIds = Object.entries(LEGACY_FAQ_ANCHORS)
    .filter(([, target]) => target === path || target.startsWith(`${path}#`))
    .map(([anchor]) => anchor);
  return (
    <SurfaceCard
      id={section.slug}
      className="relative flex w-full scroll-mt-24 flex-col gap-4 p-6 transition-colors hover:border-border-strong"
    >
      {legacyIds.map((anchor) => (
        <span key={anchor} id={anchor} aria-hidden className="absolute -top-24" />
      ))}
      <IconTile size="lg">
        <HelpSectionIcon slug={section.slug} />
      </IconTile>
      <div className="flex flex-col gap-1">
        <h3 className="font-display text-lg font-semibold tracking-tight text-foreground">
          <Link
            href={path}
            className="rounded-sm hover:text-primary-bright focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-primary-bright/60"
          >
            {section.title}
          </Link>
        </h3>
        <p className="text-sm leading-6 text-muted">{section.description}</p>
      </div>
      <ul className="flex flex-col gap-2 border-t border-border/50 pt-4">
        {first.map((entry) => (
          <li key={entry.id}>
            <Link
              href={`${path}#${entry.id}`}
              className="group inline-flex items-start gap-2 rounded-sm text-sm focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-primary-bright/60"
            >
              <ArrowRight className="mt-1 h-3.5 w-3.5 shrink-0 text-primary-bright" aria-hidden />
              <span className="text-foreground underline-offset-4 group-hover:underline">
                {entry.q}
              </span>
            </Link>
          </li>
        ))}
      </ul>
      <Link
        href={path}
        className="mt-auto inline-flex items-center gap-1 self-start rounded-sm text-sm font-medium text-primary-bright hover:underline focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-primary-bright/60"
      >
        All {entries.length} answers
        <span className="sr-only"> in {section.title}</span>
        <ArrowRight className="h-3.5 w-3.5" aria-hidden />
      </Link>
    </SurfaceCard>
  );
}
