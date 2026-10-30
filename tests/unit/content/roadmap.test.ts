import { describe, expect, it } from "vitest";
import { readFileSync } from "node:fs";
import path from "node:path";
import {
  ROADMAP_COLUMNS,
  ROADMAP_SHIPPED,
  ROADMAP_STATUS_LABELS,
  allRoadmapItems,
} from "@/lib/content/roadmap";
import { siteConfig } from "@/lib/site-config";

// ---------------------------------------------------------------------------
// The public roadmap (TODO NV12, part 2) is a promise in plain words: Now /
// Next / Later in that order, three statuses, no dates, nothing "soon", and a
// shipped item only in the shipped list.
// ---------------------------------------------------------------------------

const MONTHS =
  /\b(jan(uary)?|feb(ruary)?|mar(ch)?|apr(il)?|may|june?|july?|aug(ust)?|sep(t(ember)?)?|oct(ober)?|nov(ember)?|dec(ember)?)\b/i;

describe("the roadmap data", () => {
  it("is Now, Next and Later, in that order, each with something on it", () => {
    expect(ROADMAP_COLUMNS.map((column) => [column.stage, column.title])).toEqual([
      ["now", "Now"],
      ["next", "Next"],
      ["later", "Later"],
    ]);
    for (const column of ROADMAP_COLUMNS) expect(column.items.length, column.stage).toBeGreaterThan(0);
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
      expect(words, item.id).not.toMatch(MONTHS);
      expect(words, item.id).not.toMatch(/\b(soon|coming|next (week|month|year)|by the end|guarantee|promise|will ship)\b/i);
    }
  });

  it("links only pages that exist", () => {
    const appDir = path.join(process.cwd(), "app", "(marketing)");
    for (const item of allRoadmapItems()) {
      if (!item.href) continue;
      expect(item.href, item.id).toMatch(/^\/[a-z0-9/-]*$/);
      const page = path.join(appDir, ...item.href.split("/").filter(Boolean), "page.tsx");
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
