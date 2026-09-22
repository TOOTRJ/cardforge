import { listArticles } from "@/lib/content/articles";
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
  ["/ai-mtg-card-generator", "AI MTG Card Generator", "Concept-to-card AI generation, per-field AI fill, idea batches and AI deck generation, with FAQ."],
  ["/mana-pip-editor", "Mana Pip Editor", "The full mana symbol vocabulary (hybrid, twobrid, Phyrexian, snow, energy) and custom pip uploads, with FAQ."],
  ["/best-mtg-card-makers", "Best MTG Card Makers", "Honest comparison of custom MTG card makers and a free Card Conjurer alternative, with FAQ."],
  ["/create", "Card Creator", "The creator itself. Anyone can design a card without an account; saving, sharing and downloads need a free account."],
  ["/gallery", "Community Gallery", "Public custom cards — trending, newest and a random discover feed; filter by color, type, rarity and tag."],
  ["/decks", "Community Decks", "Public decks built from custom and real cards: import a decklist, remix cards into custom versions, print proxies."],
  ["/challenges", "Design Challenges", "Community design briefs; entries are public cards wearing the challenge tag."],
  ["/articles", "Guides", "Long-form guides on custom MTG card design (list below), grouped into topic hubs at /articles/tag/<topic>."],
  ["/faq", "FAQ", "Every common question answered directly — card making, pips, AI, sharing, printing, remixing, challenges, plans."],
  ["/pricing", "Pricing", "Free forever for the creator; paid plans add AI credits, watermark-free HD downloads and deck exports."],
  ["/news", "What's new", "Release notes and upcoming changes."],
  ["/press", "Press kit", "Logos, brand marks and boilerplate."],
  ["/about", "About", "What PipGlyph is and the principles behind it."],
];

export function GET() {
  const base = getSiteBaseUrl();
  const lines: string[] = [
    "# PipGlyph",
    "",
    `> PipGlyph (${base}) is a free, browser-based custom Magic: The Gathering-style card creator and mana pip editor. Design cards with precise mana symbols (hybrid, twobrid, Phyrexian, snow, energy, plus uploaded custom pips), card frames spanning three decades of Magic design, AI-assisted text and art generation, deck building with decklist import and proxy printing, a community gallery with likes and remixing, and community design challenges. Fan-made tool; not affiliated with Wizards of the Coast.`,
    "",
    "## Key pages",
    "",
    ...KEY_PAGES.map(([path, label, blurb]) => `- [${label}](${base}${path}): ${blurb}`),
    "",
    "## Guides",
    "",
    ...listArticles().map(
      (article) => `- [${article.title}](${base}/articles/${article.slug}): ${article.description}`,
    ),
    "",
    "## Notes",
    "",
    `- Sitemap: ${base}/sitemap.xml · RSS: ${base}/articles/feed.xml`,
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
