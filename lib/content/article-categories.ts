// ---------------------------------------------------------------------------
// Article categories — the shelves of /learn (TODO NV3 / NV4).
//
// Every guide in content/articles/ names exactly ONE category in its
// frontmatter (`category: design`); tags stay as the finer, many-per-guide
// filters. A category is where a reader looks for a guide, so it is the
// breadcrumb an article shows (Home › Learn › Design guides › Title) — the
// URL never carries it: /articles/<slug> stays put when a guide changes
// shelf, and nothing has to redirect.
//
// This module is the ONE source of a category's words: the label the header
// menu and the footer print, the one-line description under it, the page's
// H1, intro and meta description, and the tool it sends readers to. The
// copy for the four topics that used to be tag hubs (/articles/tag/
// card-design, reference, card-makers, lore) moved here from
// lib/content/clusters.ts; those four URLs now 308 to /learn/<slug>
// (proxy.ts, held to `tagSlug` below by tests/unit/routing/proxy.test.ts).
//
// Pure data — no filesystem, no React — so any surface can import it.
// ---------------------------------------------------------------------------

export const ARTICLE_CATEGORY_SLUGS = ["design", "reference", "comparisons", "lore"] as const;

export type ArticleCategorySlug = (typeof ARTICLE_CATEGORY_SLUGS)[number];

export type ArticleCategory = {
  slug: ArticleCategorySlug;
  /** What a menu, a breadcrumb or a card calls it ("Design guides"). */
  label: string;
  /** One line under the label in a menu or on the /learn hub. */
  description: string;
  /** The category page's H1 and its <title> (the site appends " · PipGlyph"). */
  title: string;
  /** Pillar copy under the H1 — the substantive intro to the topic. */
  intro: string;
  /** Short (~120 characters) meta description for the page's <head>. */
  blurb: string;
  /** The tag hub this category replaced: /articles/tag/<tagSlug> 308s here. */
  tagSlug: string;
  /** A tool or landing page the category naturally sends readers to. */
  toolHref: string;
  toolLabel: string;
};

/** A category page is indexed (and sitemapped) once it holds this many
 *  guides — the deck format hubs' bar (FORMAT_HUB_MIN_DECKS). Below it the
 *  page still renders, `noindex, follow`, so its links count. */
export const CATEGORY_MIN_ARTICLES = 3;

/** In menu order. */
export const ARTICLE_CATEGORIES: readonly ArticleCategory[] = [
  {
    slug: "design",
    label: "Design guides",
    description: "Creatures, planeswalkers, sets, cubes and balance.",
    title: "Custom MTG card design guides",
    intro:
      "Designing a custom Magic: The Gathering card is part rules, part instinct. These guides cover the craft end to end — costing a card fairly against the color pie, writing oracle text that reads like the real thing, designing every card type from creatures to planeswalkers, building a set or a cube, and playtesting and printing what you make before your playgroup ever sleeves it up.",
    blurb:
      "Guides on designing custom MTG cards — costing, the color pie, oracle text, every card type, playtesting, and the mistakes to avoid.",
    tagSlug: "card-design",
    toolHref: "/create",
    toolLabel: "Open the card creator",
  },
  {
    slug: "reference",
    label: "Rules & reference",
    description: "Mana symbols, keywords, card types and frames.",
    title: "MTG rules and card reference",
    intro:
      "The building blocks of every Magic card, explained for the people who make their own. Mana symbols, keyword abilities and ability types, the color pie, card frames and layouts, rarity, and the anatomy of the card itself — the reference you reach for while you design, written to be accurate and quick to scan.",
    blurb:
      "A reference for custom-card makers: MTG mana symbols, keyword abilities, the color pie, frames, layouts, rarity, and card anatomy.",
    tagSlug: "reference",
    toolHref: "/mana-pip-editor",
    toolLabel: "See the mana pip editor",
  },
  {
    slug: "comparisons",
    label: "Reviews & comparisons",
    description: "PipGlyph, Card Conjurer and other card makers compared.",
    title: "MTG card makers compared",
    intro:
      "Which custom card maker should you use? These guides compare the tools people actually reach for — PipGlyph, Magic Set Editor, MTG Cardsmith, the Card Conjurer forks — on the things that matter when a card has to look printed: frame accuracy, live preview, export quality, sharing, and whether the tool will still be online next year.",
    blurb:
      "Honest comparisons of MTG card makers — PipGlyph, Magic Set Editor, MTG Cardsmith and Card Conjurer alternatives.",
    tagSlug: "card-makers",
    toolHref: "/best-mtg-card-makers",
    toolLabel: "See the full comparison",
  },
  {
    slug: "lore",
    label: "MTG lore",
    description: "The stories behind frames, mechanics and card types.",
    title: "MTG lore for card designers",
    intro:
      "Magic's worlds explain its cards. These guides follow a piece of the story — a plane, its gods, a turning point — to the place it shows up on cardboard: a frame, a mechanic, a card type. They are written from Wizards of the Coast's own published story and design articles, with the sources listed, for people who want their custom cards to belong to a world as well as to the rules.",
    blurb:
      "MTG lore explained for custom card makers — the stories behind frames, mechanics and card types, with sources.",
    tagSlug: "lore",
    toolHref: "/create",
    toolLabel: "Open the card creator",
  },
];

export function isArticleCategory(value: unknown): value is ArticleCategorySlug {
  return (
    typeof value === "string" &&
    (ARTICLE_CATEGORY_SLUGS as readonly string[]).includes(value)
  );
}

/** One category by slug; null for anything else, so a route can 404. */
export function getArticleCategory(slug: string): ArticleCategory | null {
  return ARTICLE_CATEGORIES.find((category) => category.slug === slug) ?? null;
}

/** The category page's path. */
export function categoryPath(slug: ArticleCategorySlug): string {
  return `/learn/${slug}`;
}

/** True when a category page with `count` guides is indexed and sitemapped. */
export function isIndexableCategory(count: number): boolean {
  return count >= CATEGORY_MIN_ARTICLES;
}

/** The category that replaced a tag hub, by the tag's slug — null for a tag
 *  whose /articles/tag/<slug> hub still stands. */
export function categoryForTagSlug(tagSlug: string): ArticleCategory | null {
  return ARTICLE_CATEGORIES.find((category) => category.tagSlug === tagSlug) ?? null;
}
