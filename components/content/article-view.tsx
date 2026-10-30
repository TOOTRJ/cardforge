import Link from "next/link";
import { MDXRemote } from "next-mdx-remote/rsc";
import { ArrowRight, Clock } from "lucide-react";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { GlyphDivider } from "@/components/ui/glyph-divider";
import { ArticleToc } from "@/components/content/article-toc";
import { articleMdxOptions, mdxComponents } from "@/components/content/mdx-components";
import { Breadcrumbs } from "@/components/layout/breadcrumbs";
import { faqJsonLd, JsonLd, type CrumbItem } from "@/components/seo/json-ld";
import { PageContainer } from "@/components/layout/page-container";
import { extractToc, slugifyTag, tagHubHref, type Article, type ArticleMeta } from "@/lib/content/articles";
import { categoryPath, getArticleCategory } from "@/lib/content/article-categories";
import { getSiteBaseUrl } from "@/lib/site-url";
import { formatCalendarDate } from "@/lib/format/dates";

// ---------------------------------------------------------------------------
// One guide, as /articles/[slug] draws it — an MDX file or a composer article
// (migration 0153) alike, and the composer's preview (/admin/articles/[id]/
// preview) through the very same component, so what an admin checks is what
// goes out.
//
// What every guide carries by default (docs/research/article-seo-2026-10.md):
// Article JSON-LD (headline, description, image, dates, author, publisher,
// wordCount, section), BreadcrumbList (the visible trail), FAQPage for its
// questions — a composer article PRINTS its FAQ under the body, so the
// questions the data names are on the page — the byline (a profile link when
// the guide has an author), honest published / updated dates, and a cover
// with its alt text drawn at its size (eager: it is the LCP picture).
// ---------------------------------------------------------------------------

export const FAQ_HEADING = "Frequently asked questions";

export function ArticleView({
  article,
  related,
}: {
  article: Article;
  related: ArticleMeta[];
}) {
  const { meta, content } = article;
  const printsFaq = meta.source === "composer" && Boolean(meta.faq?.length);
  const toc = [
    ...extractToc(content),
    ...(printsFaq ? [{ depth: 2 as const, text: FAQ_HEADING, id: slugifyTag(FAQ_HEADING) }] : []),
  ].filter((item) => item.depth <= (meta.tocDepth ?? 3));

  return (
    <PageContainer className="py-12 lg:grid lg:grid-cols-[minmax(0,48rem)_minmax(0,1fr)] lg:gap-x-12">
      <div className="max-w-3xl">
        <JsonLd data={buildArticleJsonLd(meta)} />
        {meta.faq ? <JsonLd data={faqJsonLd(meta.faq)} /> : null}
        {/* The reader's path, not the URL: Home › Learn › <its category> ›
            Title (the guide's `category`; /articles/<slug> never moves). A
            guide with no valid category falls back to the articles index. */}
        <Breadcrumbs items={articleCrumbs(meta)} />

        <header className="flex flex-col gap-4">
          <div className="flex flex-wrap items-center gap-2 text-xs text-subtle">
            {meta.author ? (
              <span className="text-muted">
                By{" "}
                <Link href={meta.author.path} rel="author" className="font-medium text-foreground hover:underline">
                  {meta.author.name}
                </Link>
              </span>
            ) : (
              <span className="text-muted">By the PipGlyph Team</span>
            )}
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
                <span>
                  Updated <time dateTime={meta.updated}>{formatCalendarDate(meta.updated)}</time>
                </span>
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

        {meta.cover ? (
          <figure className="mt-8">
            {/* Our own upload or diagram (isAllowedMediaUrl'd by the reader):
                the probable LCP image, so eager with a high fetch priority. */}
            {/* eslint-disable-next-line @next/next/no-img-element */}
            <img
              src={meta.cover.src}
              alt={meta.cover.alt}
              width={meta.cover.width ?? undefined}
              height={meta.cover.height ?? undefined}
              fetchPriority="high"
              decoding="async"
              className="m-0 block h-auto w-full rounded-frame border border-border bg-surface"
            />
          </figure>
        ) : null}

        <div className="lg:hidden">
          <ArticleToc items={toc} />
        </div>

        {/* Body — prose styling via arbitrary variants, same approach as
            LegalPageShell but tuned for long-form reading. */}
        <article className="mt-10 flex flex-col gap-5 text-[0.95rem] leading-7 text-muted [&_h2]:font-display [&_h2]:mt-8 [&_h2]:scroll-mt-24 [&_h2]:text-2xl [&_h2]:font-semibold [&_h2]:tracking-tight [&_h2]:text-foreground [&_h3]:font-display [&_h3]:mt-5 [&_h3]:scroll-mt-24 [&_h3]:text-lg [&_h3]:font-semibold [&_h3]:text-foreground [&_a]:text-primary-bright [&_a]:underline [&_a]:underline-offset-2 [&_a]:decoration-primary-bright/50 hover:[&_a]:decoration-primary-bright [&_strong]:font-semibold [&_strong]:text-foreground [&_em]:italic [&_ul]:list-disc [&_ul]:pl-5 [&_ul]:space-y-1.5 [&_ol]:list-decimal [&_ol]:pl-5 [&_ol]:space-y-1.5 [&_code]:rounded [&_code]:bg-elevated/80 [&_code]:px-1.5 [&_code]:py-0.5 [&_code]:font-mono [&_code]:text-[0.85em] [&_code]:text-foreground [&_blockquote]:border-l-2 [&_blockquote]:border-gold/50 [&_blockquote]:pl-4 [&_blockquote]:italic [&_table]:w-full [&_table]:border-collapse [&_table]:text-sm [&_th]:border-b [&_th]:border-border [&_th]:px-3 [&_th]:py-2 [&_th]:text-left [&_th]:font-semibold [&_th]:text-foreground [&_td]:border-b [&_td]:border-border/50 [&_td]:px-3 [&_td]:py-2 [&_td]:align-top [&_sup]:text-[0.7em] [&_sup_a]:no-underline [&_section.footnotes]:mt-6 [&_section.footnotes]:border-t [&_section.footnotes]:border-border [&_section.footnotes]:pt-2 [&_section.footnotes]:text-sm [&_section.footnotes]:leading-6 [&_section.footnotes_p]:inline">
          <MDXRemote source={content} components={mdxComponents} options={articleMdxOptions} />
          {printsFaq ? (
            <section aria-labelledby={slugifyTag(FAQ_HEADING)} className="flex flex-col gap-4">
              <h2 id={slugifyTag(FAQ_HEADING)}>{FAQ_HEADING}</h2>
              {meta.faq!.map((item) => (
                <div key={item.q} className="flex flex-col gap-1">
                  <h3 id={slugifyTag(item.q)}>{item.q}</h3>
                  <p className="m-0">{item.a}</p>
                </div>
              ))}
            </section>
          ) : null}
        </article>

        {meta.author?.bio ? (
          <aside className="mt-10 rounded-frame border border-border bg-surface p-5 text-sm leading-6 text-muted">
            <p className="m-0">
              <span className="font-semibold text-foreground">About the author.</span>{" "}
              <Link href={meta.author.path} className="font-medium text-foreground hover:underline">
                {meta.author.name}
              </Link>{" "}
              — {meta.author.bio}
            </p>
          </aside>
        ) : null}

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
        {related.length > 0 ? (
          <section aria-labelledby="more-guides" className="mt-12">
            <h2 id="more-guides" className="font-display mb-4 text-lg font-semibold text-foreground">
              More guides
            </h2>
            <ul className="flex flex-col gap-3">
              {related.map((other) => (
                <li key={other.slug}>
                  <Link href={`/articles/${other.slug}`} className="group inline-flex items-start gap-2 text-sm">
                    <ArrowRight className="mt-1 h-3.5 w-3.5 shrink-0 text-primary-bright" aria-hidden />
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
    </PageContainer>
  );
}

/** Home › Learn › <category> › Title — or Home › Learn › All articles ›
 *  Title for a guide without a category. */
export function articleCrumbs(meta: ArticleMeta): CrumbItem[] {
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

/** An absolute URL for a site path or an absolute https URL. */
function absolute(base: string, src: string): string {
  return src.startsWith("/") ? `${base}${src}` : src;
}

// ---------------------------------------------------------------------------
// Article JSON-LD. A guide with an author is credited to that Person (its
// profile page as the author page, its public links as sameAs); the rest to
// the PipGlyph organization. dateModified follows the honest "updated" date
// (frontmatter `updated`, a composer revision), never a save.
// ---------------------------------------------------------------------------

export function buildArticleJsonLd(meta: ArticleMeta): Record<string, unknown> {
  const base = getSiteBaseUrl();
  const canonical = `${base}/articles/${meta.slug}`;
  const organization = { "@type": "Organization", name: "PipGlyph", url: base };
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
    ...(meta.category ? { articleSection: getArticleCategory(meta.category)?.label } : {}),
    // The cover when there is one, plus the guide's generated share card
    // (1200 × 630) — Google asks for more than one aspect ratio.
    image: [
      ...(meta.cover
        ? [
            {
              "@type": "ImageObject",
              url: absolute(base, meta.cover.src),
              caption: meta.cover.alt,
              ...(meta.cover.width && meta.cover.height
                ? { width: meta.cover.width, height: meta.cover.height }
                : {}),
            },
          ]
        : []),
      `${canonical}/opengraph-image`,
    ],
    ...(meta.wordCount ? { wordCount: meta.wordCount } : {}),
    inLanguage: "en",
    isAccessibleForFree: true,
    author: meta.author
      ? {
          "@type": "Person",
          name: meta.author.name,
          url: `${base}${meta.author.path}`,
          ...(meta.author.sameAs.length > 0 ? { sameAs: meta.author.sameAs } : {}),
        }
      : organization,
    publisher: organization,
  };
}
