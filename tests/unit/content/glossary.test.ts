import { readdirSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import {
  CARD_ORIGIN_TERM_IDS,
  CARD_ORIGIN_TERMS,
  filterGlossary,
  GLOSSARY_LETTERS,
  GLOSSARY_TERMS,
  glossaryHref,
  glossaryLetterOf,
  groupGlossaryByLetter,
} from "@/lib/content/glossary";
import { listArticles } from "@/lib/content/articles";
import { ARTICLE_CATEGORY_SLUGS } from "@/lib/content/article-categories";
import { FAQ_TOPICS } from "@/lib/content/faq";

// ---------------------------------------------------------------------------
// The glossary (TODO NV9, lib/content/glossary.ts): ONE list for /glossary
// and the creator's card-origin key. Every entry has a unique anchor and a
// short definition, links only to pages that exist, and the creator's four
// words stay exactly as the owner wrote them (2026-10-28, TODO DK2.1).
// ---------------------------------------------------------------------------

const root = process.cwd();
const articleSlugs = new Set(listArticles().map((a) => a.slug));
const faqSlugs = new Set(FAQ_TOPICS.map((t) => t.slug));
const ids = GLOSSARY_TERMS.map((t) => t.id);

/** The first path segment of every static route (as articles-integrity). */
const routeRoots = new Set(
  ["app/(marketing)", "app/(app)", "app/(auth)"].flatMap((group) =>
    readdirSync(join(root, group), { withFileTypes: true })
      .filter((d) => d.isDirectory() && !d.name.startsWith("[") && !d.name.startsWith("("))
      .map((d) => d.name),
  ),
);

/** Whether a site-relative link names a page (and anchor) that exists. */
function resolves(href: string): boolean {
  const [path, hash] = href.split("#");
  if (path.startsWith("/articles/")) return articleSlugs.has(path.slice("/articles/".length));
  if (path.startsWith("/learn/")) {
    return (ARTICLE_CATEGORY_SLUGS as readonly string[]).includes(path.slice("/learn/".length));
  }
  if (path === "/faq" && hash) return faqSlugs.has(hash);
  return routeRoots.has(path.split("/")[1]);
}

describe("the glossary's entries", () => {
  it("each have a unique, anchor-safe id and a unique name", () => {
    expect(new Set(ids).size).toBe(ids.length);
    for (const id of ids) expect(id).toMatch(/^[a-z0-9]+(-[a-z0-9]+)*$/);
    const names = GLOSSARY_TERMS.map((t) => t.term.toLowerCase());
    expect(new Set(names).size).toBe(names.length);
    expect(glossaryHref("proxy")).toBe("/glossary#proxy");
  });

  it("each have a short, finished definition", () => {
    for (const entry of GLOSSARY_TERMS) {
      expect(entry.term.trim(), entry.id).toBe(entry.term);
      expect(entry.definition.trim().length, entry.id).toBeGreaterThan(10);
      expect(entry.definition, entry.id).toMatch(/[.!?]"?$/);
      // Short: a definition, not a guide.
      expect(entry.definition.length, entry.id).toBeLessThanOrEqual(240);
    }
  });

  it("run A to Z, so the file reads like the page", () => {
    const sorted = [...GLOSSARY_TERMS].sort((a, b) =>
      a.term.localeCompare(b.term, "en", { sensitivity: "base" }),
    );
    expect(ids).toEqual(sorted.map((t) => t.id));
  });

  it("cover the terms the page was asked for", () => {
    for (const id of [
      "pip",
      "frame",
      "templating",
      "oracle-text",
      "type-line",
      "rarity",
      "set-symbol",
      "power-and-toughness",
      "loyalty",
      "saga",
      "double-faced-card",
      "transform",
      "modal-double-faced-card",
      "token",
      "emblem",
      "watermark",
      "bleed",
      "proxy-printing",
      "commander",
      "color-identity",
      "mana-value",
      // PipGlyph's own
      "proxy",
      "import",
      "remix",
      "original",
      "restyle-with-ai",
      "frame-verification",
    ]) {
      expect(ids, id).toContain(id);
    }
  });

  it("link only to pages that exist, and see-also only to other entries", () => {
    for (const entry of GLOSSARY_TERMS) {
      for (const link of [entry.guide, entry.tryIt].filter(Boolean)) {
        expect(link!.href, entry.id).toMatch(/^\//);
        expect(resolves(link!.href), `${entry.id} → ${link!.href}`).toBe(true);
        expect(link!.label.trim().length, entry.id).toBeGreaterThan(0);
      }
      for (const id of entry.related ?? []) {
        expect(ids, `${entry.id} → ${id}`).toContain(id);
        expect(id, entry.id).not.toBe(entry.id);
      }
    }
  });

  it("search in the characters a keyboard types, and never say “custom proxy”", () => {
    for (const entry of GLOSSARY_TERMS) {
      const text = [entry.term, ...(entry.aliases ?? []), entry.definition].join(" ");
      // A curly quote would hide an entry from a typed "don't" (no fold).
      expect(text, entry.id).not.toMatch(/[’‘“”]/);
      expect(text, entry.id).not.toMatch(/custom proxy/i);
    }
  });

  it("tell PipGlyph's own words from Magic's", () => {
    const own = GLOSSARY_TERMS.filter((t) => t.source === "pipglyph").map((t) => t.id);
    expect(own.sort()).toEqual(
      ["frame-verification", "import", "original", "pipglyph-mark", "proxy", "remix", "restyle-with-ai"],
    );
  });

  it("say deck AI is paused where they name it", () => {
    const restyle = GLOSSARY_TERMS.find((t) => t.id === "restyle-with-ai")!;
    expect(restyle.definition).toMatch(/paused/);
  });
});

describe("the creator's card-origin words", () => {
  it("are the four, in the creator's order, word for word (TODO DK2.1)", () => {
    expect(CARD_ORIGIN_TERM_IDS).toEqual(["proxy", "import", "remix", "original"]);
    expect(CARD_ORIGIN_TERMS.map(({ term, definition }) => ({ term, definition }))).toEqual([
      {
        term: "Proxy",
        definition:
          "Any card made on PipGlyph. A card you start from a real Magic card is a proxy too, and any proxy can be printed for your table.",
      },
      {
        term: "Import",
        definition:
          "A card started from a real card, pulled in from Scryfall. Change its art, words or frame and it becomes your version.",
      },
      {
        term: "Remix",
        definition:
          "A new card started from another card made on PipGlyph, whether someone else's or one of yours. The card it came from keeps its credit.",
      },
      {
        term: "Original",
        definition: "A card made from scratch.",
      },
    ]);
  });
});

describe("grouping and filtering", () => {
  it("groups every entry once, under its first letter, letters in order", () => {
    const groups = groupGlossaryByLetter(GLOSSARY_TERMS);
    expect(groups.flatMap((g) => g.terms.map((t) => t.id))).toEqual(ids);
    for (const group of groups) {
      expect(GLOSSARY_LETTERS).toContain(group.letter);
      for (const entry of group.terms) expect(glossaryLetterOf(entry)).toBe(group.letter);
    }
    const letters = groups.map((g) => g.letter);
    expect(letters).toEqual([...letters].sort());
    expect(GLOSSARY_LETTERS).toHaveLength(26);
  });

  it("keeps everything for a blank filter", () => {
    expect(filterGlossary(GLOSSARY_TERMS, "")).toHaveLength(GLOSSARY_TERMS.length);
    expect(filterGlossary(GLOSSARY_TERMS, "   ")).toHaveLength(GLOSSARY_TERMS.length);
  });

  it("finds an entry by its name, another name, or its words — in any case", () => {
    const found = (query: string) => filterGlossary(GLOSSARY_TERMS, query).map((t) => t.id);
    expect(found("cmc")).toEqual(["mana-value"]);
    expect(found("P/T")).toEqual(["power-and-toughness"]);
    expect(found("MDFC")).toEqual(["modal-double-faced-card"]);
    expect(found("dfc")).toEqual(expect.arrayContaining(["double-faced-card", "modal-double-faced-card", "transform"]));
    // Every word must match, in any order.
    expect(found("someone else's")).toEqual(["remix"]);
    expect(found("table proxy")).toEqual(expect.arrayContaining(["proxy", "proxy-printing"]));
    expect(found("zzz-no-such-word")).toEqual([]);
  });
});
