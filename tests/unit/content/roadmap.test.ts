import { describe, expect, it } from "vitest";
import { readFileSync } from "node:fs";
import path from "node:path";
import {
  ROADMAP_COLUMNS,
  ROADMAP_SHIPPED,
  ROADMAP_STATUS_LABELS,
  allRoadmapItems,
} from "@/lib/content/roadmap";
import { ARTICLE_CATEGORY_SLUGS } from "@/lib/content/article-categories";
import { siteConfig } from "@/lib/site-config";

// ---------------------------------------------------------------------------
// The public roadmap (TODO NV12, part 2) is a promise in plain words: Now
// then Next (a stage with nothing in it is dropped — "Later" was, owner
// 2026-11-02), three statuses, no dates, nothing "soon", and a shipped item
// only in the shipped list.
// ---------------------------------------------------------------------------

const MONTH =
  "(?:jan(?:uary)?|feb(?:ruary)?|mar(?:ch)?|apr(?:il)?|may|june?|july?|aug(?:ust)?|sep(?:t(?:ember)?)?|oct(?:ober)?|nov(?:ember)?|dec(?:ember)?)";

/**
 * A month named as a DATE — "May 3", "3rd of May", "in June", "by mid-March",
 * "end of April" — never a month-shaped word in plain prose ("it may change").
 */
const DATED_MONTH = new RegExp(
  [
    `\\b${MONTH}\\.?\\s+\\d{1,2}(?:st|nd|rd|th)?\\b`,
    `\\b\\d{1,2}(?:st|nd|rd|th)?\\s+(?:of\\s+)?${MONTH}\\b`,
    `\\b(?:in|by|until|till|before|after|from|during|early|late|mid|(?:end|start|beginning|middle) of)[\\s-]+${MONTH}\\b`,
  ].join("|"),
  "i",
);

describe("the month check", () => {
  it("catches a month named as a date", () => {
    for (const words of ["Out May 3", "on the 3rd of May", "in June", "by mid-March", "before the end of April", "Sept. 9"]) {
      expect(words, words).toMatch(DATED_MONTH);
    }
  });

  it("lets plain prose say may, march and the like", () => {
    for (const words of ["It may change shape.", "You may march your deck on.", "this may not happen", "a decent idea"]) {
      expect(words, words).not.toMatch(DATED_MONTH);
    }
  });
});

describe("the roadmap data", () => {
  it("is Now then Next, each with something on it", () => {
    expect(ROADMAP_COLUMNS.map((column) => [column.stage, column.title])).toEqual([
      ["now", "Now"],
      ["next", "Next"],
    ]);
    for (const column of ROADMAP_COLUMNS) expect(column.items.length, column.stage).toBeGreaterThan(0);
  });

  it("holds the owner's list of 2026-11-02", () => {
    expect(ROADMAP_COLUMNS.map((column) => column.items.map((item) => [item.id, item.status]))).toEqual([
      [
        ["deck-tools", "building"],
        ["article-scheduler", "building"],
        ["deck-ai", "building"],
      ],
      [["profile-links", "exploring"]],
    ]);
    // Newest first, by the PR that shipped each.
    expect(ROADMAP_SHIPPED.map((item) => item.id)).toEqual([
      "challenge-winners",
      "deck-activity",
      "lore-series",
      "frame-gallery",
      "trending-decks",
      "deck-builder",
      "requested-frames",
    ]);
    // Not announced: referrals, the Card Conjurer file import.
    const words = allRoadmapItems()
      .map((item) => `${item.id} ${item.title} ${item.summary}`)
      .join(" ");
    expect(words).not.toMatch(/referr|invite a friend|card conjurer/i);
  });

  it("uses three plain statuses: shipped only in the shipped list, never in a column", () => {
    expect(Object.keys(ROADMAP_STATUS_LABELS)).toEqual(["exploring", "building", "shipped"]);
    for (const column of ROADMAP_COLUMNS) {
      for (const item of column.items) expect(item.status, item.id).not.toBe("shipped");
    }
    for (const item of ROADMAP_SHIPPED) expect(item.status, item.id).toBe("shipped");
  });

  it("gives every item a unique id, a TODO source and words with no dates or promises", () => {
    const items = allRoadmapItems();
    expect(new Set(items.map((item) => item.id)).size).toBe(items.length);
    for (const item of items) {
      expect(item.id, item.id).toMatch(/^[a-z0-9-]+$/);
      expect(item.todo, item.id).toBeTruthy();
      const words = `${item.title} ${item.summary}`;
      expect(words, item.id).not.toMatch(/\b(19|20)\d\d\b/);
      expect(words, item.id).not.toMatch(/\bQ[1-4]\b/);
      expect(words, item.id).not.toMatch(DATED_MONTH);
      expect(words, item.id).not.toMatch(/\b(soon|coming|next (week|month|year)|by the end|guarantee|promise|will ship)\b/i);
    }
  });

  it("links only pages that exist", () => {
    const appDir = path.join(process.cwd(), "app", "(marketing)");
    for (const item of allRoadmapItems()) {
      if (!item.href) continue;
      expect(item.href, item.id).toMatch(/^\/[a-z0-9/-]*$/);
      const segments = item.href.split("/").filter(Boolean);
      // A guide shelf is the one dynamic page linked: /learn/<category>, a
      // category the static params build (anything else is a 404).
      if (segments[0] === "learn" && segments.length === 2) {
        expect(ARTICLE_CATEGORY_SLUGS as readonly string[], `${item.id} → ${item.href}`).toContain(segments[1]);
        continue;
      }
      const page = path.join(appDir, ...segments, "page.tsx");
      expect(() => readFileSync(page), `${item.id} → ${item.href}`).not.toThrow();
    }
  });
});

describe("the roadmap's place in the site", () => {
  it("sits in the header's Community panel and the footer's Community column, under one id", () => {
    const community = siteConfig.primaryNav.find((entry) => entry.kind === "group" && entry.id === "community");
    const header = community && community.kind === "group" ? community.sections.flatMap((s) => [...s.items]) : [];
    expect(header.find((link) => link.href === "/roadmap")?.id).toBe("community.roadmap");
    const footer = siteConfig.footerNav.find((column) => column.title === "Community")!;
    expect(footer.links.find((link) => link.href === "/roadmap")?.id).toBe("community.roadmap");
  });
});
