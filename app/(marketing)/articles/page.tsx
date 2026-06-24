import type { Metadata } from "next";
import { PageHeader } from "@/components/layout/page-header";
import { ArticleCard } from "@/components/content/article-card";
import {
  breadcrumbJsonLd,
  itemListJsonLd,
  JsonLd,
} from "@/components/seo/json-ld";
import { listArticles } from "@/lib/content/articles";

// ---------------------------------------------------------------------------
// /articles — the guides index. Fully static: the list is read from
// content/articles/ at build time.
// ---------------------------------------------------------------------------

export const dynamic = "error";

export const metadata: Metadata = {
  title: "Articles — Custom MTG Card Design Guides",
  description:
    "Long-form guides on custom Magic: The Gathering card design — writing oracle text, the complete mana symbol reference, balancing custom cards, card frame history, and running design challenges.",
  alternates: {
    canonical: "/articles",
    types: { "application/rss+xml": "/articles/feed.xml" },
  },
};

export default function ArticlesIndexPage() {
  const articles = listArticles();

  return (
    <div className="mx-auto w-full max-w-4xl px-4 py-16 sm:px-6 lg:px-8">
      <JsonLd
        data={breadcrumbJsonLd([
          { name: "Home", path: "/" },
          { name: "Articles", path: "/articles" },
        ])}
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
        eyebrow="Guides"
        title="Articles"
        description="Long-form guides on the craft of custom card design — templating rules text, mana symbols, balance, frame history, and community challenges."
      />

      <div className="mt-10 flex flex-col gap-5">
        {articles.map((article) => (
          <ArticleCard key={article.slug} article={article} />
        ))}
      </div>
    </div>
  );
}
