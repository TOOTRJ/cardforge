import type { MetadataRoute } from "next";
import { getSiteBaseUrl } from "@/lib/site-url";

// Static-page sitemap for crawlers. Dynamic entries (individual cards,
// sets, profiles) are deliberately not enumerated here — they're
// effectively unbounded and would require a DB query per build. Once we
// publish gallery search, search engines will discover them via crawl.

export default function sitemap(): MetadataRoute.Sitemap {
  const baseUrl = getSiteBaseUrl();
  const lastModified = new Date();

  return [
    {
      url: `${baseUrl}/`,
      lastModified,
      changeFrequency: "weekly",
      priority: 1,
    },
    {
      // Primary SEO landing page — targets "MTG card maker" search query
      url: `${baseUrl}/mtg-card-maker`,
      lastModified,
      changeFrequency: "monthly",
      priority: 0.95,
    },
    {
      // Guest card creator — no account required, high conversion page
      url: `${baseUrl}/preview`,
      lastModified,
      changeFrequency: "monthly",
      priority: 0.85,
    },
    {
      url: `${baseUrl}/gallery`,
      lastModified,
      changeFrequency: "daily",
      priority: 0.9,
    },
    {
      url: `${baseUrl}/about`,
      lastModified,
      changeFrequency: "monthly",
      priority: 0.5,
    },
    {
      url: `${baseUrl}/disclaimer`,
      lastModified,
      changeFrequency: "monthly",
      priority: 0.3,
    },
    {
      url: `${baseUrl}/terms`,
      lastModified,
      changeFrequency: "monthly",
      priority: 0.3,
    },
    {
      url: `${baseUrl}/privacy`,
      lastModified,
      changeFrequency: "monthly",
      priority: 0.3,
    },
    {
      url: `${baseUrl}/login`,
      lastModified,
      changeFrequency: "yearly",
      priority: 0.2,
    },
    {
      url: `${baseUrl}/signup`,
      lastModified,
      changeFrequency: "yearly",
      priority: 0.2,
    },
  ];
}
