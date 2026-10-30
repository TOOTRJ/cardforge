import { describe, expect, it } from "vitest";
import {
  articleSeoChecklist,
  blockingItems,
  type ChecklistInput,
} from "@/lib/content/article-seo-checklist";

// ---------------------------------------------------------------------------
// The pre-publish SEO checklist (docs/research/article-seo-2026-10.md): the
// composer shows it, the server refuses a schedule / publish on its ERRORS.
// A complete article passes everything; each error is the one the doc ranks.
// ---------------------------------------------------------------------------

const para = (words: number, word = "design") => Array.from({ length: words }, () => word).join(" ");

const GOOD_BODY = [
  `A custom card earns its slot when it is costed against real cards. ${para(30)}.`,
  "",
  "## How do you cost a custom card?",
  "",
  `${para(90)}. See [the balance guide](/articles/designing-balanced-custom-mtg-cards).`,
  "",
  "## What makes a card fun?",
  "",
  `${para(90)}. Try it in [the card creator](/create).`,
  "",
  "## Where to share it",
  "",
  `${para(90)}. Post it to [the community gallery](/gallery).`,
  "",
  "![A cost curve drawn as bars](/article-media/cost-curves/curve.svg \"The curve of a 60-card deck\")",
  "",
  `${para(90)}.`,
  "",
  `${para(90)}.`,
  "",
  `${para(90)}.`,
  "",
  `${para(90)}.`,
  "",
  `${para(90)}.`,
  "",
  `${para(90)}.`,
].join("\n");

const GOOD: ChecklistInput = {
  slug: "costing-custom-cards",
  title: "How to cost a custom card",
  seoTitle: "How to Cost a Custom MTG Card",
  description:
    "Cost a custom Magic card the way designers do: compare it with real cards, price each ability, and test it at the table.",
  body: GOOD_BODY,
  tags: ["card design", "balance"],
  category: "design",
  faq: [
    { q: "What is mana value?", a: "Mana value is the total amount of mana in a card's cost, counting each symbol once." },
    { q: "Is a vanilla 2/2 for two fair?", a: "A vanilla two-mana 2/2 is a fair common in most modern sets, a useful baseline." },
    { q: "How many tests does a card need?", a: "A custom card needs a few real games in a deck before its cost can be trusted." },
  ],
  coverUrl: "/article-media/cost-curves/cover.svg",
  coverAlt: "A custom card beside a cost curve",
  authorId: "d0000000-0000-4000-a000-000000000001",
};

const CONTEXT = {
  fileSlugs: ["designing-balanced-custom-mtg-cards"],
  knownSlugs: ["designing-balanced-custom-mtg-cards"],
};

const failing = (input: ChecklistInput, context = CONTEXT) =>
  articleSeoChecklist(input, context)
    .filter((i) => !i.ok)
    .map((i) => i.id);

describe("the article SEO checklist", () => {
  it("passes a complete article", () => {
    expect(failing(GOOD)).toEqual([]);
  });

  it("every check names a recommendation of the research doc", () => {
    for (const item of articleSeoChecklist(GOOD, CONTEXT)) {
      expect(item.rec, item.id).toBeGreaterThanOrEqual(1);
      expect(item.rec, item.id).toBeLessThanOrEqual(10);
    }
  });

  it("blocks an image without alt text", () => {
    const body = GOOD.body.replace("![A cost curve drawn as bars]", "![]");
    const items = articleSeoChecklist({ ...GOOD, body }, CONTEXT);
    expect(blockingItems(items).map((i) => i.id)).toEqual(["image-alt"]);
  });

  it("blocks a <Figure> without alt text and an image from another host", () => {
    const body = `${GOOD.body}\n\n<Figure src="https://example.com/x.png" caption="x" />`;
    expect(blockingItems(articleSeoChecklist({ ...GOOD, body }, CONTEXT)).map((i) => i.id)).toEqual([
      "image-alt",
      "image-source",
    ]);
  });

  it("blocks a cover without alt text", () => {
    expect(blockingItems(articleSeoChecklist({ ...GOOD, coverAlt: "" }, CONTEXT)).map((i) => i.id)).toEqual([
      "image-alt",
    ]);
  });

  it("blocks an MDX guide's slug, a missing category, a thin body and an unsafe link", () => {
    expect(blockingItems(articleSeoChecklist({ ...GOOD, slug: "designing-balanced-custom-mtg-cards" }, CONTEXT))[0]?.id).toBe(
      "slug-free",
    );
    expect(blockingItems(articleSeoChecklist({ ...GOOD, category: null }, CONTEXT))[0]?.id).toBe("category");
    expect(blockingItems(articleSeoChecklist({ ...GOOD, body: "Too short." }, CONTEXT)).map((i) => i.id)).toContain(
      "length-min",
    );
    const body = `${GOOD.body}\n\n[bad](javascript:alert(1))`;
    expect(blockingItems(articleSeoChecklist({ ...GOOD, body }, CONTEXT)).map((i) => i.id)).toEqual(["links-safe"]);
  });

  it("blocks a draft that still holds an image placeholder", () => {
    const body = `${GOOD.body}\n\n<Callout tone="warning" title="IMAGE PLACEHOLDER">A render of the card.</Callout>`;
    expect(blockingItems(articleSeoChecklist({ ...GOOD, body }, CONTEXT)).map((i) => i.id)).toEqual(["no-placeholder"]);
  });

  it("advises (never blocks) on answer-first, titles, FAQ, links and authorship", () => {
    const weak: ChecklistInput = {
      ...GOOD,
      seoTitle: null,
      title: "A very long headline that will certainly be cut in the search results page",
      description: "Short.",
      body: `## Intro\n\n${GOOD.body}`,
      faq: [],
      authorId: null,
      tags: ["one"],
    };
    const items = articleSeoChecklist(weak, CONTEXT);
    expect(blockingItems(items)).toEqual([]);
    expect(items.filter((i) => !i.ok).map((i) => i.id)).toEqual(
      expect.arrayContaining(["title-length", "description-length", "answer-first", "faq", "author", "tags"]),
    );
  });

  it("flags vague anchors, skipped heading levels and an unknown guide link", () => {
    const body = `${GOOD.body}\n\n#### Deep\n\nRead [here](/articles/not-a-guide).`;
    expect(failing({ ...GOOD, body })).toEqual(
      expect.arrayContaining(["anchor-text", "heading-order", "links-resolve"]),
    );
  });

  it("spaces the backlog", () => {
    const publishAt = "2026-11-03T15:00:00.000Z";
    expect(failing({ ...GOOD, publishAt }, { ...CONTEXT, otherPublishTimes: ["2026-11-04T09:00:00.000Z"] } as never)).toEqual([
      "spacing",
    ]);
    expect(failing({ ...GOOD, publishAt }, { ...CONTEXT, otherPublishTimes: ["2026-11-06T15:00:00.000Z"] } as never)).toEqual([]);
  });
});
