import { describe, expect, it, vi } from "vitest";

vi.mock("@/lib/site-url", () => ({ getSiteBaseUrl: () => "https://www.pipglyph.com" }));

import { GET } from "@/app/llms.txt/route";
import { listArticles } from "@/lib/content/articles";

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
});
