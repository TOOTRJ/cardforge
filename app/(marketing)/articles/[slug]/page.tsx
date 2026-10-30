import type { Metadata } from "next";
import { notFound } from "next/navigation";
import { ArticleView } from "@/components/content/article-view";
import { listArticles } from "@/lib/content/articles";
import {
  getPublishedArticle,
  getPublishedRelatedArticles,
  listPublishedArticles,
} from "@/lib/content/article-catalog";

// ---------------------------------------------------------------------------
// /articles/[slug] — one guide: an MDX file (content/articles/) or a released
// composer article (migration 0153), drawn by ArticleView. Static: the files
// and the composer articles live at build time are pre-rendered; one released
// later renders on its first request and is then cached (ISR), and the
// publish purges it (lib/content/article-publish.ts). An unknown slug — or a
// draft, or a scheduled article before its time — is a real 404: notFound()
// runs before any Suspense boundary.
// ---------------------------------------------------------------------------

type Params = { slug: string };

// The cached reads' window too (ARTICLES_REVALIDATE_SECONDS).
export const revalidate = 300;
// A composer article published after the build is still a page.
export const dynamicParams = true;

export async function generateStaticParams(): Promise<Params[]> {
  try {
    return (await listPublishedArticles()).map(({ slug }) => ({ slug }));
  } catch {
    return listArticles().map(({ slug }) => ({ slug }));
  }
}

export async function generateMetadata({
  params,
}: {
  params: Promise<Params>;
}): Promise<Metadata> {
  const { slug } = await params;
  const article = await getPublishedArticle(slug);
  if (!article) notFound();
  const { meta } = article;
  const shareTitle = `${meta.seoTitle ?? meta.title} · PipGlyph`;
  return {
    title: meta.seoTitle ?? meta.title,
    description: meta.description,
    alternates: { canonical: `/articles/${meta.slug}` },
    ...(meta.author ? { authors: [{ name: meta.author.name, url: meta.author.path }] } : {}),
    openGraph: {
      title: shareTitle,
      description: meta.description,
      type: "article",
      url: `/articles/${meta.slug}`,
      publishedTime: meta.date,
      modifiedTime: meta.updated ?? meta.date,
      tags: meta.tags,
      ...(meta.author ? { authors: [meta.author.path] } : {}),
    },
  };
}

export default async function ArticlePage({
  params,
}: {
  params: Promise<Params>;
}) {
  const { slug } = await params;
  const article = await getPublishedArticle(slug);
  if (!article) notFound();
  const related = await getPublishedRelatedArticles(article.meta.slug, 3);
  return <ArticleView article={article} related={related} />;
}
