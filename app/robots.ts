import type { MetadataRoute } from "next";
import { getSiteBaseUrl } from "@/lib/site-url";

export default function robots(): MetadataRoute.Robots {
  const baseUrl = getSiteBaseUrl();
  return {
    rules: [
      {
        userAgent: "*",
        // /api/ is blanket-disallowed below, but these two are consumed by
        // third parties on the public web: oEmbed discovery (Discourse
        // oneboxes check robots) and the og-image renderer social scrapers
        // fetch. Explicit allows outrank the shorter disallow prefix.
        allow: ["/", "/api/oembed", "/api/cards/*/og"],
        // Don't waste crawl budget on auth-required routes or internal APIs —
        // these all 401/redirect to /login anyway and have no public content.
        disallow: [
          "/api/",
          "/auth/callback",
          "/dashboard",
          "/settings",
          "/create",
          "/card/*/edit",
          "/set/*/edit",
        ],
      },
    ],
    sitemap: `${baseUrl}/sitemap.xml`,
  };
}
