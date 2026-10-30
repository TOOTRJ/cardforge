// ---------------------------------------------------------------------------
// The public roadmap (TODO NV12, part 2): what PipGlyph is building now, what
// comes next, what it is thinking about for later, and what recently
// shipped. Plain DATA, read by /roadmap — the owner edits this file by PR;
// there is no table behind it.
//
// The words are a promise, so they stay honest (tests/unit/content/
// roadmap.test.ts holds them to it):
//   - no dates, no deadlines, no "soon" — a stage says the ORDER, never when;
//   - an item's status is one of three plain words: exploring (deciding
//     whether and how), building (work has started) or shipped (live);
//   - a "shipped" item lives in the shipped list only, and links what it
//     made where that page exists.
// Every item names the TODO entry it comes from (`todo`), so the list can be
// checked against TODO.md — it never runs ahead of it.
// ---------------------------------------------------------------------------

export type RoadmapStatus = "exploring" | "building" | "shipped";

export type RoadmapStage = "now" | "next" | "later";

export type RoadmapItem = {
  /** Stable, unique — the item's anchor on the page (`#roadmap-<id>`). */
  id: string;
  title: string;
  /** One or two plain sentences: what it is for a maker, never how. */
  summary: string;
  status: RoadmapStatus;
  /** The TODO.md item (or section) this comes from. */
  todo: string;
  /** A page that shows it, where one exists. */
  href?: string;
};

export type RoadmapColumn = {
  stage: RoadmapStage;
  title: string;
  /** The one line under the column's title. */
  description: string;
  items: readonly RoadmapItem[];
};

export const ROADMAP_STATUS_LABELS: Record<RoadmapStatus, string> = {
  exploring: "Exploring",
  building: "Building",
  shipped: "Shipped",
};

export const ROADMAP_STATUS_HINTS: Record<RoadmapStatus, string> = {
  exploring: "We're deciding whether and how to do it. It may change shape, or not happen.",
  building: "Work has started. It ships when it's ready, and it may change on the way.",
  shipped: "Live on PipGlyph now.",
};

export const ROADMAP_COLUMNS: readonly RoadmapColumn[] = [
  {
    stage: "now",
    title: "Now",
    description: "What we're working on at the moment.",
    items: [
      {
        id: "deck-tools",
        title: "More deck builder tools",
        summary:
          "Undo and a change history on the deck page, dragging cards between boards (with keyboard and menu alternatives), and editing a deck's type and bracket.",
        status: "building",
        todo: "DK5.13–DK5.16",
      },
      {
        id: "profile-links",
        title: "Links on your profile",
        summary:
          "Point people from your profile to the places you share your work — a store, a portfolio, your socials.",
        status: "building",
        todo: "Profile page",
      },
      {
        id: "referrals",
        title: "Invite a friend",
        summary: "A simple way to bring friends to PipGlyph, with something in it for both of you.",
        status: "building",
        todo: "Referrals",
      },
    ],
  },
  {
    stage: "next",
    title: "Next",
    description: "What we expect to pick up after that.",
    items: [
      {
        id: "deck-ai",
        title: "AI deck tools, back",
        summary:
          "Building, restyling and analysing a deck with AI are paused while the deck builder is rebuilt. We want them back on the new builder; the card creator's AI is unaffected.",
        status: "exploring",
        todo: "DK1 (deck AI paused)",
      },
      {
        id: "challenge-winners",
        title: "Challenge winners",
        summary:
          "A showcase of each design challenge's winning cards and their makers, once a challenge can name its winners.",
        status: "exploring",
        todo: "NV12",
        href: "/challenges",
      },
      {
        id: "article-scheduler",
        title: "Guides on a schedule",
        summary: "A steadier rhythm of new design guides and reference pages, written ahead and published in turn.",
        status: "exploring",
        todo: "Articles",
        href: "/articles",
      },
    ],
  },
  {
    stage: "later",
    title: "Later",
    description: "Ideas we like and haven't started.",
    items: [
      {
        id: "deck-activity",
        title: "Deck activity",
        summary: "Views, likes and clones of your deck over time.",
        status: "exploring",
        todo: "DK7.4",
      },
      {
        id: "card-conjurer-import",
        title: "Bring your Card Conjurer files",
        summary: "Open a saved Card Conjurer file in the PipGlyph creator.",
        status: "exploring",
        todo: "6.14",
      },
      {
        id: "lore-series",
        title: "The lore behind the cards",
        summary: "A series on the stories behind Magic's cards, and set spotlights for designers.",
        status: "exploring",
        todo: "NV13",
      },
    ],
  },
];

/** Recently shipped — newest first, a handful at most. */
export const ROADMAP_SHIPPED: readonly RoadmapItem[] = [
  {
    id: "requested-frames",
    title: "Requested frames",
    summary: "The frames people asked for, most requested first, and where each one stands.",
    status: "shipped",
    todo: "NV12",
    href: "/frames/requested",
  },
  {
    id: "frame-gallery",
    title: "The frame gallery",
    summary: "Every frame in the creator, by era, with the colours each is checked in and an example card.",
    status: "shipped",
    todo: "NV8",
    href: "/frames",
  },
  {
    id: "deck-builder",
    title: "The new deck builder",
    summary:
      "A one-screen deck page: add cards as you type, stacks, grid, list and table views, cover picks, and free charts for every deck.",
    status: "shipped",
    todo: "DK4–DK7",
    href: "/decks",
  },
  {
    id: "trending-decks",
    title: "Trending decks",
    summary: "The community decks people are liking this week.",
    status: "shipped",
    todo: "DK8",
    href: "/decks",
  },
];

/** Every item on the page, columns first. */
export function allRoadmapItems(): RoadmapItem[] {
  return [...ROADMAP_COLUMNS.flatMap((column) => [...column.items]), ...ROADMAP_SHIPPED];
}

export function roadmapAnchorId(item: Pick<RoadmapItem, "id">): string {
  return `roadmap-${item.id}`;
}
