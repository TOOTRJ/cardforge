import { listArticles } from "@/lib/content/articles";
import { getSiteBaseUrl } from "@/lib/site-url";

// ---------------------------------------------------------------------------
// /articles/feed.xml — RSS for the guides. force-static so it's built once and
// CDN-cached, consistent with the rest of the marketing surface (filesystem
// read only, no per-request data). Autodiscovery <link> lives on /articles.
// ---------------------------------------------------------------------------

export const dynamic = "force-static";

function escapeXml(value: string): string {
  return value
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;")
    .replace(/'/g, "&apos;");
}

export function GET(): Response {
  const base = getSiteBaseUrl();
  const articles = listArticles();
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
