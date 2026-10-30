import type { Metadata } from "next";
import Link from "next/link";
import { notFound } from "next/navigation";
import { ArrowRight } from "lucide-react";
import { Breadcrumbs } from "@/components/layout/breadcrumbs";
import { PageHeader } from "@/components/layout/page-header";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { SurfaceCard } from "@/components/ui/surface-card";
import { ArticleCard } from "@/components/content/article-card";
import { CategoryLinks } from "@/components/content/category-links";
import { collectionPageJsonLd, JsonLd } from "@/components/seo/json-ld";
import {
  ARTICLE_CATEGORY_SLUGS,
  categoryForTagSlug,
  categoryPath,
  getArticleCategory,
  isIndexableCategory,
} from "@/lib/content/article-categories";
import {
  listArticlesInCategory,
  listCategoryShelves,
  slugifyTag,
  tagHubHref,
  type ArticleMeta,
} from "@/lib/content/articles";
import { siteOpenGraph, siteTwitter } from "@/lib/seo/share-metadata";
import { PageContainer } from "@/components/layout/page-container";

// ---------------------------------------------------------------------------
// /learn/[category] — one shelf of guides (TODO NV4): the category's intro
// (lib/content/article-categories.ts), its guides newest first, the topics
// (tags) they touch, and the other shelves.
//
// Fully static: the four categories are the only params (anything else is a
// real 404 — dynamicParams = false, and notFound() in both the metadata and
// the page, ahead of any boundary). A category renders whatever it holds,
// but it is indexed and sitemapped only from CATEGORY_MIN_ARTICLES guides
// (the deck format hubs' rule); below that it is `noindex, follow`.
// ---------------------------------------------------------------------------

type Params = { category: string };

export function generateStaticParams(): Params[] {
  return ARTICLE_CATEGORY_SLUGS.map((category) => ({ category }));
}

export const dynamic = "error";
export const dynamicParams = false;

export async function generateMetadata({
  params,
}: {
  params: Promise<Params>;
}): Promise<Metadata> {
  const { category: slug } = await params;
  const category = getArticleCategory(slug);
  if (!category) notFound();
  const count = listArticlesInCategory(category.slug).length;
  const path = categoryPath(category.slug);
  const title = category.title;
  return {
    title,
    description: category.blurb,
    alternates: { canonical: path },
    robots: isIndexableCategory(count) ? undefined : { index: false, follow: true },
    openGraph: siteOpenGraph({
      title: `${title} · PipGlyph`,
      description: category.blurb,
      type: "website",
      siteName: "PipGlyph",
      url: path,
    }),
    twitter: siteTwitter({
      title: `${title} · PipGlyph`,
      description: category.blurb,
    }),
  };
}

export default async function LearnCategoryPage({
  params,
}: {
  params: Promise<Params>;
}) {
  const { category: slug } = await params;
  const category = getArticleCategory(slug);
  if (!category) notFound();

  const articles = listArticlesInCategory(category.slug);
  const path = categoryPath(category.slug);
  const topics = relatedTopics(articles);

  return (
    <PageContainer className="py-12 lg:py-16">
      <JsonLd
        data={collectionPageJsonLd({
          name: category.title,
          description: category.blurb,
          path,
          items: articles.map((article) => ({
            name: article.title,
            path: `/articles/${article.slug}`,
          })),
        })}
      />
      <Breadcrumbs
        items={[
          { name: "Home", path: "/" },
          { name: "Learn", path: "/learn" },
          { name: category.label, path },
        ]}
      />

      <PageHeader
        eyebrow={`${category.label} · ${articles.length} guide${articles.length === 1 ? "" : "s"}`}
        title={category.title}
        description={category.intro}
        actions={
          <Button asChild variant="outline">
            <Link href={category.toolHref}>
              {category.toolLabel}
              <ArrowRight className="h-4 w-4" aria-hidden />
            </Link>
          </Button>
        }
      />

      {topics.length > 0 ? (
        <nav aria-labelledby="topics-heading" className="mt-6 flex flex-wrap items-center gap-2">
          <h2 id="topics-heading" className="mr-1 text-sm text-subtle">
            Related topics
          </h2>
          <ul className="flex flex-wrap gap-1.5">
            {topics.map((topic) => (
              <li key={topic.slug}>
                <Link
                  href={tagHubHref(topic.tag)}
                  className="rounded-full focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-primary-bright/60"
                >
                  <Badge
                    variant="outline"
                    className="transition-colors hover:border-primary-bright/60 hover:text-foreground"
                  >
                    {topic.tag}
                  </Badge>
                </Link>
              </li>
            ))}
          </ul>
        </nav>
      ) : null}

      <div className="mt-10">
        {articles.length === 0 ? (
          <SurfaceCard className="p-6 text-sm leading-6 text-muted">
            The first guide on this shelf is on the workbench. Until it lands, the{" "}
            <Link href="/articles" className="text-primary-bright underline underline-offset-2">
              other guides
            </Link>{" "}
            are a good place to start.
          </SurfaceCard>
        ) : (
          <div className="grid gap-5 lg:grid-cols-2">
            {articles.map((article) => (
              <ArticleCard key={article.slug} article={article} currentPath={path} />
            ))}
          </div>
        )}
      </div>

      <CategoryLinks
        shelves={listCategoryShelves()}
        current={category.slug}
        label="Other topics"
        className="mt-14 border-t border-border/40 pt-8"
      />
    </PageContainer>
  );
}

/** The tags this shelf's guides carry whose hubs still stand (a tag that
 *  became a category is the shelf itself or another shelf — the "Other
 *  topics" row covers those), most-used first. */
function relatedTopics(articles: ArticleMeta[]): Array<{ tag: string; slug: string }> {
  const counts = new Map<string, { tag: string; slug: string; count: number }>();
  for (const article of articles) {
    for (const tag of article.tags) {
      const slug = slugifyTag(tag);
      if (!slug || categoryForTagSlug(slug)) continue;
      const entry = counts.get(slug);
      if (entry) entry.count += 1;
      else counts.set(slug, { tag, slug, count: 1 });
    }
  }
  return [...counts.values()]
    .sort((a, b) => b.count - a.count || a.tag.localeCompare(b.tag))
    .map(({ tag, slug }) => ({ tag, slug }));
}
