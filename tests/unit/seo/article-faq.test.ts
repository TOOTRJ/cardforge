import { describe, expect, it } from "vitest";
import { faqJsonLd } from "@/components/seo/json-ld";
import { getArticle } from "@/lib/content/articles";

// ---------------------------------------------------------------------------
// The Card Conjurer alternative guide's SEO contract (TODO L14) and the FAQ
// frontmatter → FAQPage JSON-LD path it introduced.
// ---------------------------------------------------------------------------

describe("faqJsonLd", () => {
  it("builds a FAQPage with one Question per item", () => {
    const data = faqJsonLd([{ q: "Is it free?", a: "Yes." }]);
    expect(data["@type"]).toBe("FAQPage");
    expect(data.mainEntity).toEqual([
      { "@type": "Question", name: "Is it free?", acceptedAnswer: { "@type": "Answer", text: "Yes." } },
    ]);
  });
});

describe("card-conjurer-alternative guide", () => {
  const article = getArticle("card-conjurer-alternative");
  it("exists with the keyword in the title and a ≤155-char description", () => {
    expect(article).not.toBeNull();
    expect(article!.meta.title).toMatch(/Card Conjurer Alternative/);
    expect(article!.meta.description.length).toBeLessThanOrEqual(155);
    expect(article!.meta.description).toMatch(/Card Conjurer alternative/);
    expect(article!.meta.tags).toEqual(["card makers", "comparison", "card design"]);
  });
  it("renders every FAQ entry visibly as a heading, so the JSON-LD never lies", () => {
    const faq = article!.meta.faq ?? [];
    expect(faq.length).toBeGreaterThanOrEqual(4);
    for (const item of faq) {
      expect(article!.content).toContain(`### ${item.q}`);
      expect(article!.content).toContain(item.a);
    }
  });
  it("links the pages the brief asks for", () => {
    for (const href of ["/mtg-card-maker", "/best-mtg-card-makers", "/create", "/articles/how-to-print-proxy-mtg-cards"]) {
      expect(article!.content).toContain(`](${href})`);
    }
  });
});
