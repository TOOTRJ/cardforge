import type { Metadata } from "next";
import { PageHeader } from "@/components/layout/page-header";
import { ArticleCard } from "@/components/content/article-card";
import { Breadcrumbs } from "@/components/layout/breadcrumbs";
import { CategoryLinks } from "@/components/content/category-links";
import { itemListJsonLd, JsonLd } from "@/components/seo/json-ld";
import { listPublishedArticles } from "@/lib/content/article-catalog";
import { shelvesOf } from "@/lib/content/articles";
import { PageContainer } from "@/components/layout/page-container";

// ---------------------------------------------------------------------------
// /articles — the guides index, every guide newest first; the /learn
// category shelves sit above the list. Static (ISR): the MDX guides plus
// the released composer articles (lib/content/article-catalog.ts); a
// publish purges it, and it is read again within 5 minutes regardless.
// ---------------------------------------------------------------------------

export const dynamic = "error";
export const revalidate = 300;

export const metadata: Metadata = {
  title: "Articles — Custom MTG Card Design Guides",
  description:
    "Long-form guides on custom Magic: The Gathering card design — writing oracle text, the complete mana symbol reference, balancing custom cards, card frame history, and running design challenges.",
  alternates: {
    canonical: "/articles",
    types: { "application/rss+xml": "/articles/feed.xml" },
  },
};

export default async function ArticlesIndexPage() {
  const articles = await listPublishedArticles();

  return (
    <PageContainer className="py-16">
      <Breadcrumbs
        items={[
          { name: "Home", path: "/" },
          { name: "Learn", path: "/learn" },
          { name: "All articles", path: "/articles" },
        ]}
      />
      {articles.length > 0 ? (
        <JsonLd
          data={itemListJsonLd({
            name: "PipGlyph guides to custom MTG card design",
            items: articles.map((a) => ({
              name: a.title,
              path: `/articles/${a.slug}`,
            })),
          })}
        />
      ) : null}

      <PageHeader
        eyebrow={`Learn · ${articles.length} guides`}
        title="Articles"
        description="Long-form guides on the craft of custom card design — templating rules text, mana symbols, balance, frame history, and community challenges. Newest first."
      />

      <CategoryLinks
        shelves={shelvesOf(articles)}
        label="Browse by topic"
        className="mt-8"
      />

      <div className="mt-10 grid gap-5 lg:grid-cols-2">
        {articles.map((article) => (
          <ArticleCard key={article.slug} article={article} />
        ))}
      </div>
    </PageContainer>
  );
}
