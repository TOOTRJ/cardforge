import type { Metadata } from "next";
import Link from "next/link";
import { notFound } from "next/navigation";
import { ArrowLeft, ArrowRight } from "lucide-react";
import { PageHeader } from "@/components/layout/page-header";
import { Button } from "@/components/ui/button";
import { ArticleCard } from "@/components/content/article-card";
import {
  breadcrumbJsonLd,
  itemListJsonLd,
  JsonLd,
} from "@/components/seo/json-ld";
import { getArticlesByTag, listTags } from "@/lib/content/articles";
import { getCluster } from "@/lib/content/clusters";

// ---------------------------------------------------------------------------
// /articles/tag/[tag] — a cluster hub. Every tag across the articles becomes
// an indexable topic landing page: a pillar intro (from lib/content/clusters)
// plus the list of guides that carry the tag. Fully static — tags come from
// generateStaticParams, unknown tags 404 at the edge.
// ---------------------------------------------------------------------------

type Params = { tag: string };

export function generateStaticParams(): Params[] {
  return listTags().map((t) => ({ tag: t.slug }));
}

export const dynamic = "error";
export const dynamicParams = false;

export async function generateMetadata({
  params,
}: {
  params: Promise<Params>;
}): Promise<Metadata> {
  const { tag } = await params;
  const found = getArticlesByTag(tag);
  if (!found) return { title: "Topic not found" };
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
    openGraph: {
      title: `${title} · PipGlyph`,
      description,
      type: "website",
      url: `/articles/tag/${tag}`,
    },
  };
}

export default async function ArticleTagPage({
  params,
}: {
  params: Promise<Params>;
}) {
  const { tag } = await params;
  const found = getArticlesByTag(tag);
  if (!found) notFound();
  const cluster = getCluster(tag);

  const title = cluster?.title ?? found.label;
  const description =
    cluster?.intro ??
    `Every PipGlyph guide tagged “${found.label}” — custom MTG card design, in one place.`;

  return (
    <div className="mx-auto w-full max-w-4xl px-4 py-16 sm:px-6 lg:px-8">
      <JsonLd
        data={breadcrumbJsonLd([
          { name: "Home", path: "/" },
          { name: "Articles", path: "/articles" },
          { name: title, path: `/articles/tag/${tag}` },
        ])}
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

      <Link
        href="/articles"
        className="mb-8 inline-flex items-center gap-1 text-sm text-muted transition-colors hover:text-foreground"
      >
        <ArrowLeft className="h-4 w-4" aria-hidden />
        All articles
      </Link>

      <PageHeader eyebrow="Guides" title={title} description={description} />

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

      <div className="mt-10 flex flex-col gap-5">
        {found.articles.map((article) => (
          <ArticleCard key={article.slug} article={article} />
        ))}
      </div>
    </div>
  );
}
