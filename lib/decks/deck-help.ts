import type { DeckBoard } from "@/types/deck";

// ---------------------------------------------------------------------------
// The deck page's help (TODO DK11 (b), (c), (e)) as words — what every board
// is and what it counts toward, what each part of the breakdown reads, and
// how the total mana value is counted. Pure data: the page draws it through
// <InfoTip> (components/ui/info-tip.tsx), and a unit test holds each claim
// to the code that counts (countsTowardDeckStats, deckLibraryOf,
// validateDeck) — change a rule there and the words here together.
// ---------------------------------------------------------------------------

/** The guide the total mana value's box links to (content/articles). */
export const TOTAL_MANA_VALUE_ARTICLE_SLUG = "total-mana-value-mtg-decks";
export const TOTAL_MANA_VALUE_ARTICLE_HREF = `/articles/${TOTAL_MANA_VALUE_ARTICLE_SLUG}`;

export const TOTAL_MANA_VALUE_HELP = {
  title: "Total mana value",
  body: "Every card's mana value times its copies, added up over the main deck and the commander. Lands count as 0; the sideboard, a companion and the maybeboard aren't counted.",
  use: "Two decks of the same size compare well by it: a lower total is usually a faster, cheaper deck.",
  linkLabel: "How to judge and compare decks by total mana value",
} as const;

export type BoardHelp = { title: string; body: string; counts: string };

/** What each board is, and what it counts toward on this page. */
export const BOARD_HELP: Record<DeckBoard, BoardHelp> = {
  commander: {
    title: "Commander",
    body: "The legendary card that leads the deck from the command zone — two with Partner.",
    counts:
      "Counts toward the deck's size, the format check and the breakdown's curve, types and lands. It starts in the command zone, so the draw odds and the sample hand leave it out.",
  },
  main: {
    title: "Mainboard",
    body: "The deck you shuffle and draw from.",
    counts: "Counts toward everything: the deck's size, the format check, the curve and every other chart of the breakdown, the draw odds and the sample hand.",
  },
  side: {
    title: "Sideboard",
    body: "Cards you swap in between games of a match — at most 15 in a 60-card format.",
    counts:
      "Counts toward the format's copy limit and the sideboard cap, and toward the colours, rarity and keywords. Never the deck's size, the curve, types, lands or the playtest.",
  },
  maybe: {
    title: "Maybeboard",
    body: "A scratchpad for cards you're still deciding on.",
    counts: "Counts toward nothing: not the deck's size, the format check, the breakdown or the playtest.",
  },
  companion: {
    title: "Companion",
    body: "A card that starts the game outside the deck and can join it if the deck meets its condition. One at most.",
    counts:
      "Counts toward the format's copy limit, the colours, rarity and keywords. Never the deck's size, the curve, types, lands or the playtest.",
  },
};

export type BreakdownHelpKey =
  | "curve"
  | "types"
  | "colors"
  | "rarity"
  | "composition"
  | "keywords"
  | "drawOdds"
  | "sampleHand"
  | "activity"
  | "views"
  | "likes";

/** What each part of the breakdown, the playtest and the activity reads. */
export const BREAKDOWN_HELP: Record<BreakdownHelpKey, { title: string; body: string }> = {
  curve: {
    title: "Mana curve",
    body: "How many cards cost 0, 1, 2… mana, from 7 up in one column. It reads the main deck and the commander; lands and cards with no mana value are left off. A low, smooth curve plays out fast; a tall right side is slow. Click a bar to see those cards in the list.",
  },
  types: {
    title: "Card types",
    body: "Each card of the main deck and the commander under its main type. A card with two types counts once: a creature first (an artifact creature is a creature), and a land before an artifact or an enchantment.",
  },
  colors: {
    title: "Color symbols and sources",
    body: "For each color, its share of the coloured symbols in the costs beside its share of the mana sources. A source is a land, or a card made on PipGlyph whose text adds mana. When a color's symbols outweigh its sources, the deck will often be short of that color.",
  },
  rarity: {
    title: "Rarity",
    body: "Every card but the maybeboard by its rarity — an edited card by the rarity it now shows.",
  },
  composition: {
    title: "Composition",
    body: "Every card but the maybeboard by where it came from: imported (a real card, unchanged), edited, remixed or original. The same counts as the list's filter chips.",
  },
  keywords: {
    title: "Keywords",
    body: "Keyword abilities and mechanics read from the rules text of the cards made on PipGlyph, counted in cards. A real card's text isn't stored with the deck, so its keywords aren't counted.",
  },
  drawOdds: {
    title: "Draw odds",
    body: "The chance of having at least so many lands, or a card you pick, by each turn — worked out from the mainboard's size and counts (a hypergeometric draw), for a kept seven-card hand. On the play you skip your first draw; in multiplayer nobody does.",
  },
  sampleHand: {
    title: "Sample hand",
    body: "Seven random cards from the shuffled mainboard, then one card a draw. Deal as many hands as you like to get a feel for the deck's openings; the draw odds give the long-run numbers.",
  },
  activity: {
    title: "Deck activity",
    body: "Views and likes of this deck over the period you pick, against the period before. A view is counted once per person a day; your own visits, search crawlers and page prefetches aren't counted.",
  },
  views: {
    title: "Views",
    body: "People who opened the deck, once per person a day — never you, a search crawler or a page prefetch.",
  },
  likes: {
    title: "Likes",
    body: "Likes the deck holds, on the day each was given. A like taken back is gone from the count.",
  },
};
