import { describe, expect, it, vi } from "vitest";

vi.mock("@/lib/site-url", () => ({ getSiteBaseUrl: () => "https://www.pipglyph.com" }));

import { GET } from "@/app/llms.txt/route";
import { listArticles, listCategoryShelves } from "@/lib/content/articles";
import { HELP_SECTIONS } from "@/lib/content/help";

// /llms.txt is generated from the article index + a curated page list, so it
// can never again describe a feature the site no longer has.
describe("/llms.txt", () => {
  it("maps every guide and key page, and none of the removed features", async () => {
    const text = await GET().text();
    for (const article of listArticles()) {
      expect(text).toContain(`https://www.pipglyph.com/articles/${article.slug}`);
    }
    for (const path of ["/create", "/gallery", "/decks", "/challenges", "/pricing", "/help", "/sitemap.xml"]) {
      expect(text).toContain(`https://www.pipglyph.com${path}`);
    }
    expect(text).not.toMatch(/expansion[- ]set|set builder|\/preview\b|\/sets\b/i);
  });

  it("lists every help section under Help, and no longer advertises /faq (a 308)", async () => {
    const text = await GET().text();
    const start = text.indexOf("\n## Help\n");
    expect(start).toBeGreaterThan(-1);
    const help = text.slice(start).split("\n## ")[1];
    for (const section of HELP_SECTIONS) {
      expect(help, section.slug).toContain(
        `- [${section.title}](https://www.pipglyph.com/help/${section.slug}): ${section.description}`,
      );
    }
    expect(text).not.toContain("https://www.pipglyph.com/faq");
  });

  it("says what the guest creator is: every step read-only, an account to design (the FAQ's words)", async () => {
    const text = await GET().text();
    const line = text.split("\n").find((l) => l.includes("https://www.pipglyph.com/create)"));
    expect(line).toMatch(/read-only; designing and saving a card need a free account/);
    expect(line).not.toMatch(/anyone can design/i);
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
