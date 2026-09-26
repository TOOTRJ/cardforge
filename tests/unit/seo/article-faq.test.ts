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
    expect(article!.meta.tags).toEqual(["card makers", "card design"]);
  });
  it("renders every FAQ entry visibly as a heading, so the JSON-LD never lies", () => {
    const faq = article!.meta.faq ?? [];
    expect(faq.length).toBeGreaterThanOrEqual(4);
    for (const item of faq) {
      expect(article!.content).toContain(`### ${item.q}`);
    }
  });
  it("links the pages the brief asks for", () => {
    for (const href of ["/mtg-card-maker", "/best-mtg-card-makers", "/create", "/articles/how-to-print-proxy-mtg-cards"]) {
      expect(article!.content).toContain(`](${href})`);
    }
  });
  it("states Card Conjurer's features as the fork ships them (TODO 0.24)", () => {
    const body = article!.content;
    const row = (feature: string) => body.split("\n").find((line) => line.startsWith(`| ${feature} |`));
    // Card Conjurer imports from Scryfall by name, every printing, 12 languages
    // (creator/index.html's Import tab) — never "No".
    expect(row("Scryfall import to prefill a real card")).toMatch(/\| Yes: by name, every printing, 12 languages \|$/);
    // Its /print page tiles up to nine cards and downloads a PNG or a PDF.
    expect(body).not.toMatch(/PNG per card/);
    expect(row("Proxy print sheets")).toMatch(/Letter or A4 sheet, PNG or PDF/);
    // Its saves live in localStorage plus an exported .cardconjurer file.
    expect(row("Where your cards are saved")).toMatch(/local storage/);
    // Its text boxes take numeric bounds (the Textbox Editor's "Edit
    // Bounds"); only the art is dragged on the canvas.
    expect(body).not.toMatch(/drag(ged)? (text boxes|anywhere)/i);
    // PipGlyph's printings strip shows up to 30 representative printings.
    expect(body).not.toMatch(/pick any printing/i);
  });
  it("never claims one renderer: a browser preview and a separate bake, kept in step by parity tests", () => {
    const body = article!.content;
    expect(body).not.toMatch(/\bone renderer\b|same renderer|pixel for pixel/i);
    expect(body).toMatch(/separate renderer on the server/);
    expect(body).toMatch(/parity tests/);
  });
  it("carries a revision date no older than the 0.24 corrections", () => {
    expect((article!.meta.updated ?? "") >= "2026-09-26").toBe(true);
  });
});
