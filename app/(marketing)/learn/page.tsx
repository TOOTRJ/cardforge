import type { Metadata } from "next";
import Link from "next/link";
import { ArrowRight, Hammer, LifeBuoy, Megaphone, type LucideIcon } from "lucide-react";
import { Breadcrumbs } from "@/components/layout/breadcrumbs";
import { PageHeader } from "@/components/layout/page-header";
import { Button } from "@/components/ui/button";
import { IconTile } from "@/components/ui/icon-tile";
import { SurfaceCard } from "@/components/ui/surface-card";
import { CATEGORY_ICONS } from "@/components/content/category-icons";
import { collectionPageJsonLd, JsonLd } from "@/components/seo/json-ld";
import { categoryPath } from "@/lib/content/article-categories";
import { listCategoryShelves, type CategoryShelf } from "@/lib/content/articles";
import { getNewsFeed } from "@/lib/updates/queries";
import { formatReleaseDate, updateAnchorId, type SiteUpdate } from "@/lib/updates/shared";
import { siteOpenGraph, siteTwitter } from "@/lib/seo/share-metadata";

// ---------------------------------------------------------------------------
// /learn — the hub of everything a reader learns from (TODO NV4): the four
// article categories (lib/content/article-categories.ts) with their counts
// and newest guides, the latest three "What's new" posts, and the pages
// about USING PipGlyph (Help & FAQ, What's new, Tools), kept apart from the
// design guides on purpose — mixing the two was the old "Guides" confusion.
//
// ISR, cookie-free: the guides are read from content/articles/ at build
// time and the updates through the cached public feed (lib/updates/queries,
// the /news page's read). An admin save purges that feed's tag and this
// path (lib/updates/actions); otherwise it refreshes every 5 minutes.
// ---------------------------------------------------------------------------

export const revalidate = 300;

const TITLE = "Learn — Custom MTG Card Design Guides & Reference";
const DESCRIPTION =
  "Guides to designing custom Magic: The Gathering cards, a rules and card reference, card maker comparisons and MTG lore — plus what's new on PipGlyph.";

export const metadata: Metadata = {
  title: TITLE,
  description: DESCRIPTION,
  alternates: { canonical: "/learn" },
  openGraph: siteOpenGraph({
    title: `${TITLE} · PipGlyph`,
    description: DESCRIPTION,
    type: "website",
    siteName: "PipGlyph",
    url: "/learn",
  }),
  twitter: siteTwitter({
    title: `${TITLE} · PipGlyph`,
    description: DESCRIPTION,
  }),
};

/** The newest guides a category card names. */
const LATEST_PER_CATEGORY = 3;
/** The "What's new" strip. */
const LATEST_UPDATES = 3;

type UsingLink = { href: string; label: string; description: string; icon: LucideIcon };

const USING_PIPGLYPH: UsingLink[] = [
  {
    href: "/help",
    label: "Help & FAQ",
    description: "Answers and how-tos: the creator, imports, decks, printing and credits.",
    icon: LifeBuoy,
  },
  {
    href: "/news",
    label: "What's new",
    description: "Every update as it ships, and what we're building next.",
    icon: Megaphone,
  },
  {
    href: "/tools",
    label: "Tools",
    description: "The card creator, AI generator, pip editor, decks and print sheets.",
    icon: Hammer,
  },
];

export default async function LearnPage() {
  const shelves = listCategoryShelves();
  const { updates } = await getNewsFeed();
  const latest = updates.slice(0, LATEST_UPDATES);
  const guideCount = shelves.reduce((sum, shelf) => sum + shelf.articles.length, 0);

  return (
    <div className="mx-auto w-full max-w-7xl px-4 py-12 sm:px-6 lg:px-8 lg:py-16">
      <JsonLd
        data={collectionPageJsonLd({
          name: "Learn on PipGlyph",
          description: DESCRIPTION,
          path: "/learn",
          items: [
            ...shelves.map(({ category }) => ({
              name: category.label,
              path: categoryPath(category.slug),
            })),
            ...USING_PIPGLYPH.map((link) => ({ name: link.label, path: link.href })),
          ],
        })}
      />
      <Breadcrumbs
        items={[
          { name: "Home", path: "/" },
          { name: "Learn", path: "/learn" },
        ]}
      />

      <PageHeader
        eyebrow="Learn"
        title="Learn the craft"
        description="Guides to designing every kind of card, the rules reference you reach for while you work, honest comparisons of the tools, and the stories behind the frames."
        actions={
          <Button asChild variant="outline">
            <Link href="/articles">
              All {guideCount} articles
              <ArrowRight className="h-4 w-4" aria-hidden />
            </Link>
          </Button>
        }
      />

      {/* The four shelves */}
      <section aria-labelledby="topics-heading" className="mt-10">
        <h2 id="topics-heading" className="sr-only">
          Guides by topic
        </h2>
        <ul className="grid gap-5 md:grid-cols-2">
          {shelves.map((shelf) => (
            <li key={shelf.category.slug} className="flex">
              <CategoryCard shelf={shelf} />
            </li>
          ))}
        </ul>
      </section>

      {/* What's new */}
      <section aria-labelledby="whats-new-heading" className="mt-16">
        <div className="mb-5 flex flex-wrap items-end justify-between gap-3">
          <div className="flex flex-col gap-1">
            <h2
              id="whats-new-heading"
              className="flex items-center gap-2 font-display text-2xl font-semibold text-foreground"
            >
              <Megaphone className="h-5 w-5 text-gold" aria-hidden />
              What&apos;s new
            </h2>
            <p className="text-sm text-muted">The latest changes to PipGlyph, newest first.</p>
          </div>
          <Link
            href="/news"
            className="inline-flex items-center gap-1 rounded-sm text-sm font-medium text-primary-bright hover:underline focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-primary-bright/60"
          >
            Every update
            <ArrowRight className="h-3.5 w-3.5" aria-hidden />
          </Link>
        </div>
        {latest.length === 0 ? (
          <SurfaceCard className="p-6 text-sm text-muted">
            Nothing posted yet — the next update lands here the moment it ships.
          </SurfaceCard>
        ) : (
          <ul className="grid gap-5 md:grid-cols-3">
            {latest.map((update) => (
              <li key={update.id} className="flex">
                <UpdateTeaser update={update} />
              </li>
            ))}
          </ul>
        )}
      </section>

      {/* Using PipGlyph — product help, kept apart from the design guides */}
      <section aria-labelledby="using-heading" className="mt-16">
        <h2
          id="using-heading"
          className="mb-5 font-display text-2xl font-semibold text-foreground"
        >
          Using PipGlyph
        </h2>
        <ul className="grid gap-4 md:grid-cols-3">
          {USING_PIPGLYPH.map((link) => (
            <li key={link.href} className="flex">
              <Link
                href={link.href}
                className="group flex w-full items-start gap-4 rounded-card border border-border/70 bg-surface/60 p-5 transition-colors hover:border-border-strong hover:bg-surface focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-primary-bright/60"
              >
                <IconTile tone="purple">
                  <link.icon aria-hidden />
                </IconTile>
                <span className="flex min-w-0 flex-col gap-1">
                  <span className="font-display text-base font-semibold text-foreground group-hover:text-primary-bright">
                    {link.label}
                  </span>
                  <span className="text-sm leading-6 text-muted">{link.description}</span>
                </span>
              </Link>
            </li>
          ))}
        </ul>
      </section>
    </div>
  );
}

/** One shelf: its label (the link to the category page), one line, its
 *  newest guides and the count. The guide titles are links of their own,
 *  so the card is not one big link (no link inside a link). */
function CategoryCard({ shelf }: { shelf: CategoryShelf }) {
  const { category, articles } = shelf;
  const Icon = CATEGORY_ICONS[category.slug];
  const href = categoryPath(category.slug);
  const newest = articles.slice(0, LATEST_PER_CATEGORY);
  return (
    <SurfaceCard className="flex w-full flex-col gap-5 p-6 transition-colors hover:border-border-strong">
      <div className="flex items-start gap-4">
        <IconTile size="lg">
          <Icon aria-hidden />
        </IconTile>
        <div className="flex min-w-0 flex-1 flex-col gap-1">
          <h3 className="font-display text-xl font-semibold tracking-tight text-foreground">
            <Link
              href={href}
              className="rounded-sm hover:text-primary-bright focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-primary-bright/60"
            >
              {category.label}
            </Link>
          </h3>
          <p className="text-sm leading-6 text-muted">{category.description}</p>
        </div>
      </div>

      {newest.length > 0 ? (
        <div className="flex flex-col gap-2 border-t border-border/50 pt-4">
          <p className="flex items-baseline justify-between gap-3 text-xs text-subtle">
            <span className="font-semibold uppercase tracking-[0.16em]">Newest</span>
            <span className="font-medium">
              {articles.length} guide{articles.length === 1 ? "" : "s"}
            </span>
          </p>
          <ul className="flex flex-col gap-2">
            {newest.map((article) => (
              <li key={article.slug}>
                <Link
                  href={`/articles/${article.slug}`}
                  className="group inline-flex items-start gap-2 rounded-sm text-sm focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-primary-bright/60"
                >
                  <ArrowRight
                    className="mt-1 h-3.5 w-3.5 shrink-0 text-primary-bright"
                    aria-hidden
                  />
                  <span className="text-foreground underline-offset-4 group-hover:underline">
                    {article.title}
                  </span>
                </Link>
              </li>
            ))}
          </ul>
        </div>
      ) : (
        <p className="border-t border-border/50 pt-4 text-sm text-muted">
          The first guide on this shelf is on the workbench.
        </p>
      )}

      {/* Only when the shelf holds more than the card names — the heading
          already links a shelf the card lists whole. */}
      {articles.length > newest.length ? (
        <Link
          href={href}
          className="mt-auto inline-flex items-center gap-1 self-start rounded-sm text-sm font-medium text-primary-bright hover:underline focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-primary-bright/60"
        >
          All {articles.length} guides
          <span className="sr-only"> in {category.label}</span>
          <ArrowRight className="h-3.5 w-3.5" aria-hidden />
        </Link>
      ) : null}
    </SurfaceCard>
  );
}

/** A "What's new" post, short: date, title, summary. It links to its own
 *  entry on /news (the page gives each one an id). */
function UpdateTeaser({ update }: { update: SiteUpdate }) {
  return (
    <SurfaceCard className="flex w-full flex-col gap-2 p-5">
      <time dateTime={update.publish_at} className="text-xs text-subtle">
        {formatReleaseDate(update.publish_at)}
      </time>
      <h3 className="font-display text-lg font-semibold leading-snug text-foreground">
        <Link
          href={`/news#${updateAnchorId(update.id)}`}
          className="rounded-sm hover:text-primary-bright focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-primary-bright/60"
        >
          {update.title}
        </Link>
      </h3>
      <p className="line-clamp-3 text-sm leading-6 text-muted">{update.summary}</p>
    </SurfaceCard>
  );
}

