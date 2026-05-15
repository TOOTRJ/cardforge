import type { MetadataRoute } from "next";
import { getSiteBaseUrl } from "@/lib/site-url";

export default function robots(): MetadataRoute.Robots {
  const baseUrl = getSiteBaseUrl();
  return {
    rules: [
      {
        userAgent: "*",
        allow: "/",
        // Don't waste crawl budget on auth-required routes or internal APIs —
        // these all 401/redirect to /login anyway and have no public content.
        disallow: [
          "/api/",
          "/auth/callback",
          "/dashboard",
          "/settings",
          "/create",
          "/sets/new",
          "/sets",
          "/card/*/edit",
          "/set/*/edit",
        ],
      },
    ],
    sitemap: `${baseUrl}/sitemap.xml`,
  };
}
