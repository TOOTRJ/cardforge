import { listPublishedArticles } from "@/lib/content/article-catalog";
import { getSiteBaseUrl } from "@/lib/site-url";
import { escapeXml } from "@/lib/seo/rss";

// ---------------------------------------------------------------------------
// /articles/feed.xml — RSS for the guides: the MDX files and the released
// composer articles. Static and CDN-cached (ISR: a publish revalidates it,
// and it is read again within 5 minutes regardless). Autodiscovery <link>
// lives on /articles.
// ---------------------------------------------------------------------------

export const revalidate = 300;

export async function GET(): Promise<Response> {
  const base = getSiteBaseUrl();
  const articles = await listPublishedArticles();
  const lastBuild = articles[0]?.updated ?? articles[0]?.date ?? new Date(0).toISOString();

  const items = articles
    .map((a) => {
      const url = `${base}/articles/${a.slug}`;
      return [
        "    <item>",
        `      <title>${escapeXml(a.title)}</title>`,
        `      <link>${url}</link>`,
        `      <guid isPermaLink="true">${url}</guid>`,
        `      <pubDate>${new Date(a.date).toUTCString()}</pubDate>`,
        `      <description>${escapeXml(a.description)}</description>`,
        a.tags
          .map((t) => `      <category>${escapeXml(t)}</category>`)
          .join("\n"),
        "    </item>",
      ]
        .filter(Boolean)
        .join("\n");
    })
    .join("\n");

  const xml = `<?xml version="1.0" encoding="UTF-8"?>
<rss version="2.0" xmlns:atom="http://www.w3.org/2005/Atom">
  <channel>
    <title>PipGlyph Guides</title>
    <link>${base}/articles</link>
    <atom:link href="${base}/articles/feed.xml" rel="self" type="application/rss+xml" />
    <description>Guides on custom Magic: The Gathering card design — costing, oracle text, mana symbols, proxies, and more, from PipGlyph.</description>
    <language>en-us</language>
    <lastBuildDate>${new Date(lastBuild).toUTCString()}</lastBuildDate>
${items}
  </channel>
</rss>
`;

  return new Response(xml, {
    headers: {
      "content-type": "application/rss+xml; charset=utf-8",
      "cache-control": "public, max-age=0, s-maxage=3600",
    },
  });
}
