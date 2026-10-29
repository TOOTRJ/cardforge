import { getSiteBaseUrl } from "@/lib/site-url";
import { escapeXml } from "@/lib/seo/rss";
import { getNewsFeed } from "@/lib/updates/queries";
import { updateAnchorId } from "@/lib/updates/shared";

// ---------------------------------------------------------------------------
// /news/feed.xml — RSS for "What's new" (TODO NV5): every RELEASED update,
// newest first ("Coming soon" rows are not news yet). The same cached public
// feed the /news page reads (lib/updates/queries), on the same 5-minute ISR
// window; an admin save purges the feed's tag. An update has no page of its
// own yet, so an item links to its entry on /news (updateAnchorId) and its
// guid is the row's id, not a permalink. Autodiscovery <link> lives on /news.
// ---------------------------------------------------------------------------

export const revalidate = 300;

const MAX_ITEMS = 30;

export async function GET(): Promise<Response> {
  const base = getSiteBaseUrl();
  const { updates } = await getNewsFeed();
  const items = updates.slice(0, MAX_ITEMS);
  const lastBuild = items[0]?.publish_at ?? new Date(0).toISOString();

  const body = items
    .map((update) =>
      [
        "    <item>",
        `      <title>${escapeXml(update.title)}</title>`,
        `      <link>${base}/news#${updateAnchorId(update.id)}</link>`,
        `      <guid isPermaLink="false">${escapeXml(update.id)}</guid>`,
        `      <pubDate>${new Date(update.publish_at).toUTCString()}</pubDate>`,
        `      <description>${escapeXml(update.summary)}</description>`,
        "    </item>",
      ].join("\n"),
    )
    .join("\n");

  const xml = `<?xml version="1.0" encoding="UTF-8"?>
<rss version="2.0" xmlns:atom="http://www.w3.org/2005/Atom">
  <channel>
    <title>What's new on PipGlyph</title>
    <link>${base}/news</link>
    <atom:link href="${base}/news/feed.xml" rel="self" type="application/rss+xml" />
    <description>Every PipGlyph update as it ships — new tools, frames and fixes.</description>
    <language>en-us</language>
    <lastBuildDate>${new Date(lastBuild).toUTCString()}</lastBuildDate>
${body}
  </channel>
</rss>
`;

  return new Response(xml, {
    headers: {
      "content-type": "application/rss+xml; charset=utf-8",
      "cache-control": "public, max-age=0, s-maxage=300",
    },
  });
}
