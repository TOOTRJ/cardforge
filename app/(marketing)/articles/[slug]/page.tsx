import type { Metadata } from "next";
import Link from "next/link";
import { notFound } from "next/navigation";
import { MDXRemote } from "next-mdx-remote/rsc";
import { ArrowRight, Clock } from "lucide-react";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { GlyphDivider } from "@/components/ui/glyph-divider";
import { ArticleToc } from "@/components/content/article-toc";
import {
  articleMdxOptions,
  mdxComponents,
} from "@/components/content/mdx-components";
import { Breadcrumbs } from "@/components/layout/breadcrumbs";
import { faqJsonLd, JsonLd, type CrumbItem } from "@/components/seo/json-ld";
import {
  extractToc,
  getArticle,
  getRelatedArticles,
  listArticles,
  tagHubHref,
  type ArticleMeta,
} from "@/lib/content/articles";
import { categoryPath, getArticleCategory } from "@/lib/content/article-categories";
import { getSiteBaseUrl } from "@/lib/site-url";
import { formatCalendarDate } from "@/lib/format/dates";

// ---------------------------------------------------------------------------
// /articles/[slug] — one guide, rendered from its MDX file. Fully static:
// every slug comes from generateStaticParams; unknown slugs 404 at the
// edge without touching a server.
// ---------------------------------------------------------------------------

type Params = { slug: string };

export function generateStaticParams(): Params[] {
  return listArticles().map(({ slug }) => ({ slug }));
}

// Only the params from generateStaticParams exist — anything else 404s
// statically instead of attempting a render.
export const dynamicParams = false;

export async function generateMetadata({
  params,
}: {
  params: Promise<Params>;
}): Promise<Metadata> {
  const { slug } = await params;
  const article = getArticle(slug);
  if (!article) return { title: "Article not found" };
  const { meta } = article;
  return {
    title: meta.seoTitle ?? meta.title,
    description: meta.description,
    alternates: { canonical: `/articles/${meta.slug}` },
    openGraph: {
      title: `${meta.seoTitle ?? meta.title} · PipGlyph`,
      description: meta.description,
      type: "article",
      url: `/articles/${meta.slug}`,
      publishedTime: meta.date,
      modifiedTime: meta.updated ?? meta.date,
      tags: meta.tags,
    },
  };
}

export default async function ArticlePage({
  params,
}: {
  params: Promise<Params>;
}) {
  const { slug } = await params;
  const article = getArticle(slug);
  if (!article) notFound();

  const { meta, content } = article;
  const toc = extractToc(content).filter((item) => item.depth <= (meta.tocDepth ?? 3));
  const others = getRelatedArticles(meta.slug, 3);

  return (
    <div className="mx-auto w-full max-w-7xl px-4 py-12 sm:px-6 lg:px-8 lg:grid lg:grid-cols-[minmax(0,48rem)_minmax(0,1fr)] lg:gap-x-12">
      <div className="max-w-3xl">
      <JsonLd data={buildArticleJsonLd(meta)} />
      {meta.faq ? <JsonLd data={faqJsonLd(meta.faq)} /> : null}
      {/* The reader's path, not the URL: Home › Learn › <its category> ›
          Title (the guide's frontmatter `category`; /articles/<slug> never
          moves). A guide with no valid category — which the category test
          fails on — falls back to the plain articles index. */}
      <Breadcrumbs items={articleCrumbs(meta)} />

      {/* Header */}
      <header className="flex flex-col gap-4">
        <div className="flex flex-wrap items-center gap-2 text-xs text-subtle">
          <span className="text-muted">By the PipGlyph Team</span>
          <span aria-hidden>·</span>
          <time dateTime={meta.date}>{formatCalendarDate(meta.date)}</time>
          <span aria-hidden>·</span>
          <span className="inline-flex items-center gap-1">
            <Clock className="h-3 w-3" aria-hidden />
            {meta.readingMinutes} min read
          </span>
          {meta.updated ? (
            <>
              <span aria-hidden>·</span>
              <span>Updated {formatCalendarDate(meta.updated)}</span>
            </>
          ) : null}
        </div>
        <h1 className="font-display text-3xl font-semibold leading-tight tracking-tight text-foreground sm:text-4xl">
          {meta.title}
        </h1>
        <p className="text-base leading-7 text-muted">{meta.excerpt ?? meta.description}</p>
        {meta.tags.length > 0 ? (
          <div className="flex flex-wrap gap-1.5">
            {meta.tags.map((tag) => (
              <Link
                key={tag}
                href={tagHubHref(tag)}
                className="rounded-full focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-primary-bright/60"
              >
                <Badge
                  variant="outline"
                  className="transition-colors hover:border-primary-bright/60 hover:text-foreground"
                >
                  {tag}
                </Badge>
              </Link>
            ))}
          </div>
        ) : null}
      </header>

      <div className="lg:hidden">
        <ArticleToc items={toc} />
      </div>

      {/* Body — prose styling via arbitrary variants, same approach as
          LegalPageShell but tuned for long-form reading. */}
      <article className="mt-10 flex flex-col gap-5 text-[0.95rem] leading-7 text-muted [&_h2]:font-display [&_h2]:mt-8 [&_h2]:scroll-mt-24 [&_h2]:text-2xl [&_h2]:font-semibold [&_h2]:tracking-tight [&_h2]:text-foreground [&_h3]:font-display [&_h3]:mt-5 [&_h3]:scroll-mt-24 [&_h3]:text-lg [&_h3]:font-semibold [&_h3]:text-foreground [&_a]:text-primary-bright [&_a]:underline [&_a]:underline-offset-2 [&_a]:decoration-primary-bright/50 hover:[&_a]:decoration-primary-bright [&_strong]:font-semibold [&_strong]:text-foreground [&_em]:italic [&_ul]:list-disc [&_ul]:pl-5 [&_ul]:space-y-1.5 [&_ol]:list-decimal [&_ol]:pl-5 [&_ol]:space-y-1.5 [&_code]:rounded [&_code]:bg-elevated/80 [&_code]:px-1.5 [&_code]:py-0.5 [&_code]:font-mono [&_code]:text-[0.85em] [&_code]:text-foreground [&_blockquote]:border-l-2 [&_blockquote]:border-gold/50 [&_blockquote]:pl-4 [&_blockquote]:italic [&_table]:w-full [&_table]:border-collapse [&_table]:text-sm [&_th]:border-b [&_th]:border-border [&_th]:px-3 [&_th]:py-2 [&_th]:text-left [&_th]:font-semibold [&_th]:text-foreground [&_td]:border-b [&_td]:border-border/50 [&_td]:px-3 [&_td]:py-2 [&_td]:align-top [&_sup]:text-[0.7em] [&_sup_a]:no-underline [&_section.footnotes]:mt-6 [&_section.footnotes]:border-t [&_section.footnotes]:border-border [&_section.footnotes]:pt-2 [&_section.footnotes]:text-sm [&_section.footnotes]:leading-6 [&_section.footnotes_p]:inline">
        <MDXRemote
          source={content}
          components={mdxComponents}
          options={articleMdxOptions}
        />
      </article>

      {/* CTA */}
      <GlyphDivider className="my-12" />
      <section className="relative overflow-hidden rounded-frame border border-border bg-surface p-8">
        <div className="absolute inset-0 bg-radial-glow opacity-60" aria-hidden />
        <div className="relative flex flex-col gap-3">
          <h2 className="font-display text-xl font-semibold text-foreground">
            {meta.cta?.title ?? "Put it into practice"}
          </h2>
          <p className="max-w-lg text-sm leading-6 text-muted">
            {meta.cta?.body ?? "Sign up free and try what you just read on a real card."}
          </p>
          <div className="flex flex-wrap gap-3 pt-1">
            <Button asChild>
              <Link href="/create">{meta.cta?.label ?? "Open the card creator"}</Link>
            </Button>
            <Button asChild variant="ghost">
              <Link href="/help">Help &amp; FAQ</Link>
            </Button>
          </div>
        </div>
      </section>

      {/* More guides — ranked by shared tags, not random. */}
      {others.length > 0 ? (
        <section aria-labelledby="more-guides" className="mt-12">
          <h2
            id="more-guides"
            className="font-display mb-4 text-lg font-semibold text-foreground"
          >
            More guides
          </h2>
          <ul className="flex flex-col gap-3">
            {others.map((other) => (
              <li key={other.slug}>
                <Link
                  href={`/articles/${other.slug}`}
                  className="group inline-flex items-start gap-2 text-sm"
                >
                  <ArrowRight
                    className="mt-1 h-3.5 w-3.5 shrink-0 text-primary-bright"
                    aria-hidden
                  />
                  <span className="font-medium text-foreground underline-offset-4 group-hover:underline">
                    {other.title}
                  </span>
                </Link>
              </li>
            ))}
          </ul>
        </section>
      ) : null}
    </div>

      {/* Sticky "On this page" in the spare width right of the article
          (owner request 2026-09-17). Same anchor links as the inline card. */}
      <aside className="hidden lg:block">
        <div className="sticky top-24 max-h-[calc(100vh-7rem)] overflow-y-auto pt-16">
          <ArticleToc items={toc} variant="sidebar" />
        </div>
      </aside>
    </div>
  );
}

/** Home › Learn › <category> › Title — or Home › Learn › All articles ›
 *  Title for a guide without a category. */
function articleCrumbs(meta: ArticleMeta): CrumbItem[] {
  const category = meta.category ? getArticleCategory(meta.category) : null;
  return [
    { name: "Home", path: "/" },
    { name: "Learn", path: "/learn" },
    category
      ? { name: category.label, path: categoryPath(category.slug) }
      : { name: "All articles", path: "/articles" },
    { name: meta.title, path: `/articles/${meta.slug}` },
  ];
}

// ---------------------------------------------------------------------------
// Article JSON-LD — authored by the PipGlyph organization (guides are
// editorial content, not user submissions). dateModified follows the optional
// `updated` frontmatter so a revised guide signals freshness to search.
// ---------------------------------------------------------------------------

function buildArticleJsonLd(meta: ArticleMeta): Record<string, unknown> {
  const base = getSiteBaseUrl();
  const canonical = `${base}/articles/${meta.slug}`;
  return {
    "@context": "https://schema.org",
    "@type": "Article",
    headline: meta.title,
    description: meta.description,
    datePublished: meta.date,
    dateModified: meta.updated ?? meta.date,
    url: canonical,
    mainEntityOfPage: canonical,
    keywords: meta.tags.join(", "),
    // The /learn shelf the guide sits on (its breadcrumb names the same one).
    ...(meta.category
      ? { articleSection: getArticleCategory(meta.category)?.label }
      : {}),
    inLanguage: "en",
    isAccessibleForFree: true,
    author: {
      "@type": "Organization",
      name: "PipGlyph",
      url: base,
    },
    publisher: {
      "@type": "Organization",
      name: "PipGlyph",
      url: base,
    },
  };
}
