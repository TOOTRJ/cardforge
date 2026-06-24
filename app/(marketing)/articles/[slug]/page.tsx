import type { Metadata } from "next";
import Link from "next/link";
import { notFound } from "next/navigation";
import { MDXRemote } from "next-mdx-remote/rsc";
import { ArrowLeft, ArrowRight, Clock } from "lucide-react";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { GlyphDivider } from "@/components/ui/glyph-divider";
import { ArticleToc } from "@/components/content/article-toc";
import { mdxComponents } from "@/components/content/mdx-components";
import { breadcrumbJsonLd, JsonLd } from "@/components/seo/json-ld";
import {
  extractToc,
  getArticle,
  getRelatedArticles,
  listArticles,
  slugifyTag,
  type ArticleMeta,
} from "@/lib/content/articles";
import { getSiteBaseUrl } from "@/lib/site-url";

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
    title: meta.title,
    description: meta.description,
    alternates: { canonical: `/articles/${meta.slug}` },
    openGraph: {
      title: `${meta.title} · PipGlyph`,
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
  const toc = extractToc(content);
  const others = getRelatedArticles(meta.slug, 3);

  return (
    <div className="mx-auto w-full max-w-3xl px-4 py-12 sm:px-6 lg:px-8">
      <JsonLd data={buildArticleJsonLd(meta)} />
      <JsonLd
        data={breadcrumbJsonLd([
          { name: "Home", path: "/" },
          { name: "Articles", path: "/articles" },
          { name: meta.title, path: `/articles/${meta.slug}` },
        ])}
      />

      <Link
        href="/articles"
        className="mb-8 inline-flex items-center gap-1 text-sm text-muted transition-colors hover:text-foreground"
      >
        <ArrowLeft className="h-4 w-4" aria-hidden />
        All articles
      </Link>

      {/* Header */}
      <header className="flex flex-col gap-4">
        <div className="flex flex-wrap items-center gap-2 text-xs text-subtle">
          <span className="text-muted">By the PipGlyph Team</span>
          <span aria-hidden>·</span>
          <time dateTime={meta.date}>{formatDate(meta.date)}</time>
          <span aria-hidden>·</span>
          <span className="inline-flex items-center gap-1">
            <Clock className="h-3 w-3" aria-hidden />
            {meta.readingMinutes} min read
          </span>
          {meta.updated ? (
            <>
              <span aria-hidden>·</span>
              <span>Updated {formatDate(meta.updated)}</span>
            </>
          ) : null}
        </div>
        <h1 className="font-display text-3xl font-semibold leading-tight tracking-tight text-foreground sm:text-4xl">
          {meta.title}
        </h1>
        <p className="text-base leading-7 text-muted">{meta.description}</p>
        {meta.tags.length > 0 ? (
          <div className="flex flex-wrap gap-1.5">
            {meta.tags.map((tag) => (
              <Link
                key={tag}
                href={`/articles/tag/${slugifyTag(tag)}`}
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

      <ArticleToc items={toc} />

      {/* Body — prose styling via arbitrary variants, same approach as
          LegalPageShell but tuned for long-form reading. */}
      <article className="mt-10 flex flex-col gap-5 text-[0.95rem] leading-7 text-muted [&_h2]:font-display [&_h2]:mt-8 [&_h2]:scroll-mt-24 [&_h2]:text-2xl [&_h2]:font-semibold [&_h2]:tracking-tight [&_h2]:text-foreground [&_h3]:font-display [&_h3]:mt-5 [&_h3]:scroll-mt-24 [&_h3]:text-lg [&_h3]:font-semibold [&_h3]:text-foreground [&_a]:text-primary-bright [&_a]:underline [&_a]:underline-offset-2 [&_a]:decoration-primary-bright/50 hover:[&_a]:decoration-primary-bright [&_strong]:font-semibold [&_strong]:text-foreground [&_em]:italic [&_ul]:list-disc [&_ul]:pl-5 [&_ul]:space-y-1.5 [&_ol]:list-decimal [&_ol]:pl-5 [&_ol]:space-y-1.5 [&_code]:rounded [&_code]:bg-elevated/80 [&_code]:px-1.5 [&_code]:py-0.5 [&_code]:font-mono [&_code]:text-[0.85em] [&_code]:text-foreground [&_blockquote]:border-l-2 [&_blockquote]:border-gold/50 [&_blockquote]:pl-4 [&_blockquote]:italic [&_table]:w-full [&_table]:border-collapse [&_table]:text-sm [&_th]:border-b [&_th]:border-border [&_th]:px-3 [&_th]:py-2 [&_th]:text-left [&_th]:font-semibold [&_th]:text-foreground [&_td]:border-b [&_td]:border-border/50 [&_td]:px-3 [&_td]:py-2 [&_td]:align-top">
        <MDXRemote source={content} components={mdxComponents} />
      </article>

      {/* CTA */}
      <GlyphDivider className="my-12" />
      <section className="relative overflow-hidden rounded-frame border border-border bg-surface p-8">
        <div className="absolute inset-0 bg-radial-glow opacity-60" aria-hidden />
        <div className="relative flex flex-col gap-3">
          <h2 className="font-display text-xl font-semibold text-foreground">
            Put it into practice
          </h2>
          <p className="max-w-lg text-sm leading-6 text-muted">
            The card creator is open without an account — try what you just
            read on a real card.
          </p>
          <div className="flex flex-wrap gap-3 pt-1">
            <Button asChild>
              <Link href="/preview">Open the card creator</Link>
            </Button>
            <Button asChild variant="ghost">
              <Link href="/faq">Read the FAQ</Link>
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
  );
}

function formatDate(iso: string): string {
  return new Intl.DateTimeFormat("en-US", {
    month: "long",
    day: "numeric",
    year: "numeric",
    // Frontmatter dates are calendar dates stored at UTC midnight; format in
    // UTC so they don't shift a day back in negative-offset timezones.
    timeZone: "UTC",
  }).format(new Date(iso));
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
