import type { Metadata } from "next";
import Link from "next/link";
import { notFound } from "next/navigation";
import { ArrowRight } from "lucide-react";
import { Breadcrumbs } from "@/components/layout/breadcrumbs";
import { PageHeader } from "@/components/layout/page-header";
import { Button } from "@/components/ui/button";
import { ArticleCard } from "@/components/content/article-card";
import { itemListJsonLd, JsonLd } from "@/components/seo/json-ld";
import { getPublishedArticlesByTag, listPublishedTags } from "@/lib/content/article-catalog";
import { categoryForTagSlug } from "@/lib/content/article-categories";
import { getCluster } from "@/lib/content/clusters";
import { siteOpenGraph } from "@/lib/seo/share-metadata";
import { PageContainer } from "@/components/layout/page-container";

// ---------------------------------------------------------------------------
// /articles/tag/[tag] — a cluster hub. Every tag across the articles becomes
// an indexable topic landing page: a pillar intro (from lib/content/clusters)
// plus the list of guides that carry the tag. Static (ISR): the tags of the
// MDX guides and the released composer articles; a tag a composer article
// brings later renders on first request, and an unknown tag is a real 404.
// ---------------------------------------------------------------------------

type Params = { tag: string };

// A tag whose hub became a /learn category (card design, reference, card
// makers, lore) has no page here: proxy.ts 308s /articles/tag/<slug> to
// /learn/<category> before it would be served.
export async function generateStaticParams(): Promise<Params[]> {
  return (await listPublishedTags())
    .filter((t) => !categoryForTagSlug(t.slug))
    .map((t) => ({ tag: t.slug }));
}

export const dynamic = "error";
export const revalidate = 300;
// A tag a composer article brings after the build is still a hub.
export const dynamicParams = true;

export async function generateMetadata({
  params,
}: {
  params: Promise<Params>;
}): Promise<Metadata> {
  const { tag } = await params;
  const found = categoryForTagSlug(tag) ? null : await getPublishedArticlesByTag(tag);
  if (!found) notFound();
  const cluster = getCluster(tag);
  // Index the substantive hubs (defined clusters, or any tag with 2+ guides);
  // keep one-off tag pages crawlable but out of the index so a pile of thin,
  // single-article tag pages doesn't dilute topical authority. Their badges
  // still resolve — those pages are just noindex.
  const indexable = Boolean(cluster) || found.articles.length >= 2;
  const title = `${cluster?.title ?? found.label} — Custom MTG Card Guides`;
  const description =
    cluster?.blurb ??
    `Guides tagged “${found.label}” — custom Magic: The Gathering card design articles from PipGlyph.`;
  return {
    title,
    description,
    // Self-canonical so the hub isn't treated as a duplicate of /articles.
    alternates: { canonical: `/articles/tag/${tag}` },
    robots: indexable ? undefined : { index: false, follow: true },
    openGraph: siteOpenGraph({
      title: `${title} · PipGlyph`,
      description,
      type: "website",
      url: `/articles/tag/${tag}`,
    }),
  };
}

export default async function ArticleTagPage({
  params,
}: {
  params: Promise<Params>;
}) {
  const { tag } = await params;
  const found = categoryForTagSlug(tag) ? null : await getPublishedArticlesByTag(tag);
  if (!found) notFound();
  const cluster = getCluster(tag);

  const title = cluster?.title ?? found.label;
  const description =
    cluster?.intro ??
    `Every PipGlyph guide tagged “${found.label}” — custom MTG card design, in one place.`;

  return (
    <PageContainer className="py-16">
      <Breadcrumbs
        items={[
          { name: "Home", path: "/" },
          { name: "Learn", path: "/learn" },
          { name: "All articles", path: "/articles" },
          { name: title, path: `/articles/tag/${tag}` },
        ]}
      />
      <JsonLd
        data={itemListJsonLd({
          name: `PipGlyph guides — ${title}`,
          items: found.articles.map((a) => ({
            name: a.title,
            path: `/articles/${a.slug}`,
          })),
        })}
      />

      <PageHeader
        eyebrow={`Topic · ${found.articles.length} guide${found.articles.length === 1 ? "" : "s"}`}
        title={title}
        description={description}
      />

      {cluster?.toolHref ? (
        <div className="mt-6">
          <Button asChild variant="ghost">
            <Link href={cluster.toolHref}>
              {cluster.toolLabel ?? "Open the tool"}
              <ArrowRight className="h-3.5 w-3.5" aria-hidden />
            </Link>
          </Button>
        </div>
      ) : null}

      <div className="mt-10 grid gap-5 lg:grid-cols-2">
        {found.articles.map((article) => (
          <ArticleCard
            key={article.slug}
            article={article}
            currentPath={`/articles/tag/${tag}`}
          />
        ))}
      </div>
    </PageContainer>
  );
}
