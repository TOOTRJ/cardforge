import { ImageResponse } from "next/og";
import { getArticle, listArticles } from "@/lib/content/articles";
import {
  OG_SIZE,
  OgChip,
  OgEyebrow,
  OgShell,
  OgTitle,
} from "@/lib/og/shell";

// Social-preview card for guide pages. Articles carry no uploaded art, so
// without this they'd unfurl with the generic site-wide OG image and lose the
// title. Reads the MDX frontmatter via getArticle — filesystem only, so the
// image prerenders statically alongside the page (dynamicParams = false).

export const alt = "PipGlyph guide";
export const size = OG_SIZE;
export const contentType = "image/png";

export function generateStaticParams() {
  return listArticles().map(({ slug }) => ({ slug }));
}

export default async function Image({
  params,
}: {
  params: Promise<{ slug: string }>;
}) {
  const { slug } = await params;
  const article = getArticle(slug);

  if (!article) {
    return new ImageResponse(
      (
        <OgShell>
          <OgEyebrow>Guide</OgEyebrow>
          <OgTitle text="Custom MTG card design guides" />
          <p style={{ margin: 0, fontSize: 26, color: "#9aa3b5" }}>
            The craft of custom card design, one guide at a time.
          </p>
        </OgShell>
      ),
      size,
    );
  }

  const { meta } = article;

  return new ImageResponse(
    (
      <OgShell>
        <OgEyebrow>Guide</OgEyebrow>
        <OgTitle text={meta.title} />
        <p
          style={{
            margin: 0,
            fontSize: 26,
            lineHeight: 1.45,
            color: "#9aa3b5",
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
