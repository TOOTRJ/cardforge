import type { MetadataRoute } from "next";
import { getSiteBaseUrl } from "@/lib/site-url";

// ---------------------------------------------------------------------------
// robots.txt — one rule for every crawler, AI answer engines included.
//
// GPTBot / OAI-SearchBot / ClaudeBot / PerplexityBot / Google-Extended and
// friends all inherit the `*` rule on purpose: the public pages (tool landing
// pages, guides, gallery, public cards / decks / profiles) are exactly what we
// want cited. Nothing here is a privacy boundary — auth-gated routes redirect
// to /login regardless — this only keeps crawl budget off pages with no
// public content. Indexability itself is decided per page with
// `robots: { index: false }` (thin profiles, empty decks, unlisted things),
// which a crawler can only honour if the page is NOT disallowed here.
// ---------------------------------------------------------------------------

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
        // Auth-required routes and internal APIs only. NOT /create: signed-out
        // visitors get the ISR guest creator there (proxy.ts rewrite), which
        // is a self-canonical landing page listed in the sitemap.
        disallow: [
          "/api/",
          "/auth/",
          "/dashboard",
          "/settings",
          "/onboarding",
          "/feed",
          "/notifications",
          "/messages",
          "/feedback",
          "/admin",
          "/card/*/edit",
          "/deck/*/edit",
        ],
      },
    ],
    sitemap: `${baseUrl}/sitemap.xml`,
  };
}
