import { listArticles, listCategoryShelves, type ArticleMeta } from "@/lib/content/articles";
import { categoryPath } from "@/lib/content/article-categories";
import { HELP_SECTIONS, helpSectionPath } from "@/lib/content/help";
import { getSiteBaseUrl } from "@/lib/site-url";

// ---------------------------------------------------------------------------
// /llms.txt — a plain-text map of the site for AI answer engines, generated
// from the same sources as the pages so it can't drift (the hand-written
// public/llms.txt it replaces still advertised the removed sets feature and
// the old /preview URL). Google says it ignores the file; the cost is one
// static route, and engines that do read it get an accurate index.
// ---------------------------------------------------------------------------

export const dynamic = "force-static";

const KEY_PAGES: Array<[path: string, label: string, blurb: string]> = [
  ["/mtg-card-maker", "MTG Card Maker", "What the card creator does, how to make a custom card, FAQ with direct answers."],
  ["/ai-mtg-card-generator", "AI MTG Card Generator", "Concept-to-card AI generation, per-field AI fill and idea batches, with FAQ."],
  ["/mana-pip-editor", "Mana Pip Editor", "The full mana symbol vocabulary (hybrid, twobrid, Phyrexian, snow, energy) and custom pip uploads, with FAQ."],
  ["/best-mtg-card-makers", "Best MTG Card Makers", "Honest comparison of custom MTG card makers and a free Card Conjurer alternative, with FAQ."],
  ["/create", "Card Creator", "The creator itself. Signed out, it shows every step and the live preview read-only; designing and saving a card need a free account."],
  ["/gallery", "Community Gallery", "Public custom cards — trending, newest and a random discover feed; filter by color, type, rarity and tag."],
  ["/decks", "Community Decks", "Public decks built from custom and real cards: import a decklist, customize the real cards, print proxies."],
  ["/creators", "Creators", "Directory of everyone with a public card — most cards, newest cards or most liked — each linking to their profile."],
  ["/challenges", "Design Challenges", "Community design briefs; entries are public cards wearing the challenge tag."],
  ["/learn", "Learn", "The guides by category (design guides, rules & reference, card maker comparisons, MTG lore — list below), plus help, what's new and the tools."],
  ["/articles", "All articles", "Every long-form guide, newest first; finer topic hubs at /articles/tag/<topic>."],
  ["/tools", "Tools", "Directory of the card creator, AI card generator, mana pip editor, deck builder and print sheets."],
  ["/glossary", "Glossary", "Plain definitions of Magic card terms (pip, frame, type line, mana value, double-faced cards…) and PipGlyph's own words (proxy, import, remix, original), one anchor per term."],
  ["/help", "Help & FAQ", "How to use PipGlyph: direct answers and short how-tos, one page per topic (list below)."],
  ["/pricing", "Pricing", "Free forever for the creator; paid plans add AI credits, watermark-free HD downloads and deck exports."],
  ["/news", "What's new", "Release notes and upcoming changes (RSS at /news/feed.xml)."],
  ["/frames", "Frames", "Every card frame the creator offers — the 1993, 1997, 2003 and 2015 borders, variations such as borderless and snow, card layouts and showcases — with the colours each is verified in and an example card."],
  ["/frames/requested", "Requested frames", "The card frames people asked for, most requested first, and whether each is requested, being checked or built."],
  ["/press", "Press kit", "Logos, brand marks and boilerplate."],
  ["/about", "About", "What PipGlyph is and the principles behind it."],
];

export function GET() {
  const base = getSiteBaseUrl();
  const guideLine = (article: ArticleMeta) =>
    `- [${article.title}](${base}/articles/${article.slug}): ${article.description}`;
  const uncategorized = listArticles().filter((article) => !article.category);
  const lines: string[] = [
    "# PipGlyph",
    "",
    `> PipGlyph (${base}) is a free, browser-based custom Magic: The Gathering-style card creator and mana pip editor. Design cards with precise mana symbols (hybrid, twobrid, Phyrexian, snow, energy, plus uploaded custom pips), card frames spanning three decades of Magic design, AI-assisted text and art generation, deck building with decklist import and proxy printing, a community gallery with likes and remixing, and community design challenges. Fan-made tool; not affiliated with Wizards of the Coast.`,
    "",
    "## Key pages",
    "",
    ...KEY_PAGES.map(([path, label, blurb]) => `- [${label}](${base}${path}): ${blurb}`),
    "",
    "## Help",
    "",
    // One line per help section (lib/content/help.ts); answers keep stable
    // anchors (/help/<section>#<id>).
    ...HELP_SECTIONS.map(
      (section) => `- [${section.title}](${base}${helpSectionPath(section.slug)}): ${section.description}`,
    ),
    "",
    "## Guides",
    "",
    // One list per /learn category, in menu order (a guide has exactly one).
    ...listCategoryShelves()
      .filter((shelf) => shelf.articles.length > 0)
      .flatMap(({ category, articles }) => [
        `### [${category.label}](${base}${categoryPath(category.slug)})`,
        "",
        ...articles.map(guideLine),
        "",
      ]),
    // A guide without a valid category (the category test fails on one)
    // still belongs in the map.
    ...uncategorized.map(guideLine),
    ...(uncategorized.length > 0 ? [""] : []),
    "## Notes",
    "",
    `- Sitemap: ${base}/sitemap.xml · RSS: ${base}/articles/feed.xml (guides), ${base}/news/feed.xml (what's new)`,
    `- Public cards live at ${base}/card/<username>/<slug> (CreativeWork structured data, oEmbed at /api/oembed); public decks at ${base}/deck/<slug> (CollectionPage); creators at ${base}/profile/<username> (ProfilePage).`,
    "- Every displayed card image carries the pipglyph.com mark; clean high-resolution downloads are a paid-plan feature.",
    "",
  ];
  return new Response(lines.join("\n"), {
    headers: {
      "content-type": "text/plain; charset=utf-8",
      "cache-control": "public, max-age=3600",
    },
  });
}
