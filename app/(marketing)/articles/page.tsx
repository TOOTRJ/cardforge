import type { Metadata } from "next";
import Link from "next/link";
import { ArrowRight, Clock } from "lucide-react";
import { PageHeader } from "@/components/layout/page-header";
import { SurfaceCard } from "@/components/ui/surface-card";
import { Badge } from "@/components/ui/badge";
import { breadcrumbJsonLd, itemListJsonLd, JsonLd } from "@/components/seo/json-ld";
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
  alternates: { canonical: "/articles" },
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
          <SurfaceCard
            key={article.slug}
            className="p-0 transition-colors hover:border-border-strong"
          >
            <Link
              href={`/articles/${article.slug}`}
              className="group flex flex-col gap-3 rounded-frame p-6 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-primary-bright/60"
            >
              <div className="flex flex-wrap items-center gap-2 text-xs text-subtle">
                <time dateTime={article.date}>
                  {formatDate(article.date)}
                </time>
                <span aria-hidden>·</span>
                <span className="inline-flex items-center gap-1">
                  <Clock className="h-3 w-3" aria-hidden />
                  {article.readingMinutes} min read
                </span>
              </div>
              <h2 className="font-display text-xl font-semibold tracking-tight text-foreground group-hover:text-primary-bright sm:text-2xl">
                {article.title}
              </h2>
              <p className="max-w-2xl text-sm leading-7 text-muted">
                {article.description}
              </p>
              <div className="flex flex-wrap items-center justify-between gap-3 pt-1">
                <div className="flex flex-wrap gap-1.5">
                  {article.tags.map((tag) => (
                    <Badge key={tag} variant="outline">
                      {tag}
                    </Badge>
                  ))}
                </div>
                <span className="inline-flex items-center gap-1 text-sm font-medium text-primary-bright">
                  Read the guide
                  <ArrowRight className="h-3.5 w-3.5" aria-hidden />
                </span>
              </div>
            </Link>
          </SurfaceCard>
        ))}
      </div>
    </div>
  );
}

function formatDate(iso: string): string {
  return new Intl.DateTimeFormat("en-US", {
    month: "long",
    day: "numeric",
    year: "numeric",
  }).format(new Date(iso));
}
