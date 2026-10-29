import { describe, expect, it, vi } from "vitest";

vi.mock("@/lib/site-url", () => ({ getSiteBaseUrl: () => "https://www.pipglyph.com" }));

import { GET } from "@/app/llms.txt/route";
import { listArticles, listCategoryShelves } from "@/lib/content/articles";

// /llms.txt is generated from the article index + a curated page list, so it
// can never again describe a feature the site no longer has.
describe("/llms.txt", () => {
  it("maps every guide and key page, and none of the removed features", async () => {
    const text = await GET().text();
    for (const article of listArticles()) {
      expect(text).toContain(`https://www.pipglyph.com/articles/${article.slug}`);
    }
    for (const path of ["/create", "/gallery", "/decks", "/challenges", "/pricing", "/faq", "/sitemap.xml"]) {
      expect(text).toContain(`https://www.pipglyph.com${path}`);
    }
    expect(text).not.toMatch(/expansion[- ]set|set builder|\/preview\b|\/sets\b/i);
  });

  it("names /learn, /tools, /glossary and the What's new feed, and lists the guides under their categories", async () => {
    const text = await GET().text();
    for (const path of ["/learn", "/tools", "/glossary", "/news", "/news/feed.xml"]) {
      expect(text).toContain(`https://www.pipglyph.com${path}`);
    }
    for (const { category, articles } of listCategoryShelves()) {
      if (articles.length === 0) continue;
      const heading = `### [${category.label}](https://www.pipglyph.com/learn/${category.slug})`;
      const start = text.indexOf(heading);
      expect(start, category.slug).toBeGreaterThan(-1);
      const section = text.slice(start + heading.length).split("\n### ")[0].split("\n## ")[0];
      for (const article of articles) {
        expect(section, `${article.slug} under ${category.label}`).toContain(
          `https://www.pipglyph.com/articles/${article.slug})`,
        );
      }
    }
    // The four tag hubs that 308 to /learn are no longer advertised.
    expect(text).not.toMatch(/\/articles\/tag\/(card-design|reference|card-makers|lore)\b/);
  });
});
