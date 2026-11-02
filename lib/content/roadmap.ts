// ---------------------------------------------------------------------------
// The public roadmap (TODO NV12, part 2): what PipGlyph is building now, what
// comes next, and what recently shipped. Plain DATA, read by /roadmap — the
// owner edits this file by PR; there is no table behind it.
//
// The words are a promise, so they stay honest (tests/unit/content/
// roadmap.test.ts holds them to it):
//   - no dates, no deadlines, no "soon" — a stage says the ORDER, never when;
//   - an item's status is one of three plain words: exploring (deciding
//     whether and how), building (work has started) or shipped (live);
//   - a "shipped" item lives in the shipped list only, and links what it
//     made where that page exists;
//   - no column is ever empty: a stage with nothing in it is dropped (the
//     "Later" column was, owner 2026-11-02).
// Every item names the TODO entry it comes from (`todo`), so the list can be
// checked against TODO.md — it never runs ahead of it.
// ---------------------------------------------------------------------------

export type RoadmapStatus = "exploring" | "building" | "shipped";

export type RoadmapStage = "now" | "next";

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
          "Undo and a change history on the deck page, and dragging cards between boards (with keyboard and menu alternatives).",
        status: "building",
        todo: "DK5.13–DK5.16",
      },
      {
        id: "article-scheduler",
        title: "Guides on a schedule",
        summary: "A steadier rhythm of new design guides and reference pages, written ahead and published in turn.",
        status: "building",
        todo: "Articles",
        href: "/articles",
      },
      {
        id: "deck-ai",
        title: "AI deck tools, back",
        summary:
          "Building, restyling and analysing a deck with AI, and the deck guides, are paused while the deck builder is rebuilt. They're returning with the new deck builder; the card creator's AI is unaffected.",
        status: "building",
        todo: "DK1 (deck AI paused)",
      },
    ],
  },
  {
    stage: "next",
    title: "Next",
    description: "What we expect to pick up after that.",
    items: [
      {
        id: "profile-links",
        title: "Links on your profile",
        summary:
          "Point people from your profile to the places you share your work — a store, a portfolio, your socials.",
        status: "exploring",
        todo: "Profile page",
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
    ],
  },
];

/** Recently shipped — newest first (by the PR that shipped it), a handful at most. */
export const ROADMAP_SHIPPED: readonly RoadmapItem[] = [
  {
    id: "deck-activity",
    title: "Deck activity (Pro)",
    summary: "Views and likes on your decks over time, for Pro members.",
    status: "shipped",
    todo: "DK7.4",
    href: "/decks",
  },
  {
    id: "lore-series",
    title: "The lore behind the cards",
    summary:
      "A “Behind the Cards” series on the stories behind Magic’s mechanics, and set spotlights for designers.",
    status: "shipped",
    todo: "NV13",
    href: "/learn/lore",
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
    id: "trending-decks",
    title: "Trending decks",
    summary: "The community decks people are liking this week.",
    status: "shipped",
    todo: "DK8",
    href: "/decks",
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
    id: "requested-frames",
    title: "Requested frames",
    summary: "The frames people asked for, most requested first, and where each one stands.",
    status: "shipped",
    todo: "NV12",
    href: "/frames/requested",
  },
];

/** Every item on the page, columns first. */
export function allRoadmapItems(): RoadmapItem[] {
  return [...ROADMAP_COLUMNS.flatMap((column) => [...column.items]), ...ROADMAP_SHIPPED];
}

export function roadmapAnchorId(item: Pick<RoadmapItem, "id">): string {
  return `roadmap-${item.id}`;
}
