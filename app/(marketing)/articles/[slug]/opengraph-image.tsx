import { ogImageResponse } from "@/lib/og/image-response";
import { listArticles } from "@/lib/content/articles";
import { getPublishedArticle, listPublishedArticles } from "@/lib/content/article-catalog";
import {
  OG_SIZE,
  OgChip,
  OgEyebrow,
  OgShell,
  OgTitle,
} from "@/lib/og/shell";
import { BRAND } from "@/lib/brand/constants";

// Social-preview card for guide pages (1200 × 630): without it they'd unfurl
// with the generic site-wide OG image and lose the title. Reads the guide
// through the catalog (an MDX file or a released composer article), so it
// prerenders with the page and ISR's a composer article released later.

export const alt = "PipGlyph guide";
export const size = OG_SIZE;
export const contentType = "image/png";

export async function generateStaticParams() {
  try {
    return (await listPublishedArticles()).map(({ slug }) => ({ slug }));
  } catch {
    return listArticles().map(({ slug }) => ({ slug }));
  }
}

// A composer article released after the build gets its card on first ask.
export const revalidate = 300;

export default async function Image({
  params,
}: {
  params: Promise<{ slug: string }>;
}) {
  const { slug } = await params;
  const article = await getPublishedArticle(slug);

  if (!article) {
    return ogImageResponse(
      (
        <OgShell>
          <OgEyebrow>Guide</OgEyebrow>
          <OgTitle text="Custom MTG card design guides" />
          <p style={{ margin: 0, fontSize: 26, color: BRAND.muted }}>
            The craft of custom card design, one guide at a time.
          </p>
        </OgShell>
      ),
      size,
    );
  }

  const { meta } = article;

  return ogImageResponse(
    (
      <OgShell>
        <OgEyebrow>Guide</OgEyebrow>
        <OgTitle text={meta.title} />
        <p
          style={{
            margin: 0,
            fontSize: 26,
            lineHeight: 1.45,
            color: BRAND.muted,
            maxWidth: 900,
          }}
        >
          {meta.description.length > 120
            ? `${meta.description.slice(0, 117)}…`
            : meta.description}
        </p>
        {meta.tags.length > 0 ? (
          <div style={{ display: "flex", gap: 14, marginTop: 6 }}>
            <OgChip tone="gold">{meta.tags[0]}</OgChip>
            {meta.tags[1] ? <OgChip tone="muted">{meta.tags[1]}</OgChip> : null}
          </div>
        ) : null}
      </OgShell>
    ),
    size,
  );
}
