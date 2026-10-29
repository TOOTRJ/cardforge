// ---------------------------------------------------------------------------
// The tools directory (/tools, TODO NV7) — what PipGlyph lets you DO, one
// entry per tool, each with the page that is its real home today:
//
//   * the card creator IS a route (/create, guest or signed in);
//   * the AI generator and the pip editor live INSIDE the creator, so their
//     home is their landing page (/ai-mtg-card-generator, /mana-pip-editor),
//     which explains them and opens /create;
//   * the deck builder is /decks (community decks; a new deck starts at
//     /dashboard/decks/new);
//   * print sheets are a Pro option of My Cards' "Print / download" and the
//     card download dialog — the public page that explains them is the
//     printing guide.
//
// Together with the comparison page, every SEO landing page is linked from
// here (/mtg-card-maker as the creator's "more"). Pure data, so the header
// menu or the footer can list the same tools in the same words later.
// ---------------------------------------------------------------------------

export type ToolEntry = {
  /** Stable key (React key, anchors). */
  slug: string;
  name: string;
  /** One sentence: what the tool does for you. */
  summary: string;
  /** Where the tool lives. */
  href: string;
  /** The link's words — exactly what happens on click. */
  cta: string;
  /** An optional second page about the tool. */
  more?: { href: string; label: string };
  /** A short plan note ("Pro") when the tool is not on every plan. */
  plan?: string;
};

export const TOOLS: readonly ToolEntry[] = [
  {
    slug: "card-creator",
    name: "Card creator",
    summary:
      "Design a card on a live preview, with frames from three decades of card design, every mana symbol and your own art.",
    href: "/create",
    cta: "Open the creator",
    more: { href: "/mtg-card-maker", label: "What the card maker does" },
  },
  {
    slug: "ai-generator",
    name: "AI card generator",
    summary:
      "Describe an idea and get a complete card — name, rules text and art — to edit before you save it.",
    href: "/ai-mtg-card-generator",
    cta: "See how it works",
  },
  {
    slug: "pip-editor",
    name: "Mana pip editor",
    summary:
      "Build any mana cost by clicking — hybrid, twobrid, Phyrexian, snow and energy — or upload your own pip icons.",
    href: "/mana-pip-editor",
    cta: "See the pip editor",
  },
  {
    slug: "deck-builder",
    name: "Deck builder",
    summary:
      "Paste a decklist, swap in cards you designed, and keep the whole deck in one place to share.",
    href: "/decks",
    cta: "Browse community decks",
    more: { href: "/dashboard/decks/new", label: "Start a deck" },
  },
  {
    slug: "print-sheets",
    name: "Print sheets",
    summary:
      "Lay your cards out on Letter or A4 pages with cut guides and an optional bleed, ready to print at home.",
    href: "/articles/how-to-print-proxy-mtg-cards",
    cta: "Read the printing guide",
    more: { href: "/dashboard/cards", label: "Print from My cards" },
    plan: "Pro",
  },
];

/** The comparison page — a page about choosing a tool, not a tool. */
export const TOOL_COMPARISON: ToolEntry = {
  slug: "compare",
  name: "Which card maker?",
  summary:
    "PipGlyph, Magic Set Editor, MTG Cardsmith and Card Conjurer, side by side on frames, exports and sharing.",
  href: "/best-mtg-card-makers",
  cta: "Compare card makers",
};
