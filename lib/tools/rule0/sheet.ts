import { buildCardPath } from "@/lib/cards/utils";
import { deckRowsOf, ENTRY_BADGE_LABELS, type DeckRow, type EntryBadge, type ViewItem } from "@/lib/decks/deck-view";
import { deckEntryAnchor } from "@/lib/decks/return-to";
import type { DeckBoard } from "@/types/deck";
import { countsTowardDeckStats } from "@/lib/decks/analytics";
import { estimateBracket, type BracketEstimate } from "./bracket-estimate";
import { gameChangerName } from "./game-changers";

// ---------------------------------------------------------------------------
// What the Rule 0 table sheet says about a deck — derived, never stored:
// the commander(s), the card count, the custom cards and proxies, the lines
// that matched no card, and the Game Changers behind the light bracket
// estimate. Pure, client-safe.
//
// It reads the deck's rows AS THE VIEWER READS THEM — the page hands it the
// items through publicDeckItems (a visitor's private card is "Private card",
// never its title) — and every entry's status through deckRowsOf, i.e.
// deckEntryStatus + deckEntryUnavailable (lib/decks/entry-status.ts): the
// list's badges, never a second derivation. The maybeboard never counts,
// as deckStatusCountsOf and computeDeckAnalytics count.
//
//   custom    Edited, Remix, Original — and, for the owner, a linked card
//             that is "No longer available": the cards to discuss.
//   proxies   Imported WITH a PipGlyph card: a print of the real card,
//             unchanged.
//   real      Imported with no PipGlyph card: the real card itself.
//   notFound  a line that matched no card.
// ---------------------------------------------------------------------------

export type SheetItem = ViewItem & {
  card: (ViewItem["card"] & { slug?: string | null; visibility?: string | null }) | null;
  cardOwner?: { username: string | null } | null;
};

export type SheetCardLine = {
  id: string;
  name: string;
  quantity: number;
  board: DeckBoard;
  badge: EntryBadge;
  badgeLabel: string;
  /** The real card a custom card or proxy stands for, when its name
   *  differs from the name shown ("Solemn Simulacrum" under "Solemn
   *  Sentinel"; a visitor's "Private card" stands for it too). */
  basedOn: string | null;
  /** Where the viewer reads the card: its PipGlyph page when they can open
   *  it, else its row on the deck page. */
  href: string;
  /** Another creator's card (D3): their handle. */
  maker: string | null;
};

export type SheetGameChanger = {
  /** The list's own name. */
  name: string;
  /** The entry is a PipGlyph version of it (Edited, Remix): it may no longer
   *  do what the real card does — the sheet says so. */
  customVersion: boolean;
};

export type TableSheetFacts = {
  commanders: SheetCardLine[];
  /** Every card but the maybeboard's (the hero's count). */
  cardCount: number;
  custom: SheetCardLine[];
  customCount: number;
  proxies: SheetCardLine[];
  proxyCount: number;
  realCount: number;
  notFound: SheetCardLine[];
  notFoundCount: number;
  gameChangers: SheetGameChanger[];
  /** Commander decks only (brackets are Commander's). */
  estimate: BracketEstimate | null;
};

const CUSTOM_BADGES: ReadonlySet<EntryBadge> = new Set(["edited", "remix", "original", "unavailable"]);

const BOARD_ORDER: Readonly<Record<DeckBoard, number>> = { commander: 0, main: 1, companion: 2, side: 3, maybe: 4 };

function lineOf(row: DeckRow<SheetItem>, deck: SheetDeck): SheetCardLine {
  const { entry, card, cardOwner } = row.item;
  const printingName = entry.scryfall_id ? entry.name : null;
  const basedOn = row.privateName ?? (printingName && printingName !== row.name ? printingName : null);
  const canOpen = Boolean(card && card.slug && !row.isPrivate);
  const maker = cardOwner?.username ?? null;
  return {
    id: row.id,
    name: row.name,
    quantity: row.quantity,
    board: row.board,
    badge: row.badge,
    badgeLabel: ENTRY_BADGE_LABELS[row.badge],
    basedOn,
    href: canOpen
      ? buildCardPath({ slug: card!.slug!, owner: { username: maker ?? deck.ownerUsername } })
      : `/deck/${deck.slug}${deckEntryAnchor(row.id)}`,
    maker,
  };
}

function byBoardThenName(a: SheetCardLine, b: SheetCardLine): number {
  return BOARD_ORDER[a.board] - BOARD_ORDER[b.board] || a.name.localeCompare(b.name);
}

const sum = (lines: readonly SheetCardLine[]) => lines.reduce((total, line) => total + line.quantity, 0);

export type SheetDeck = {
  slug: string;
  format: string;
  bracket: number | null;
  ownerUsername: string | null;
};

export function buildTableSheetFacts(
  items: readonly SheetItem[],
  viewerIsOwner: boolean,
  deck: SheetDeck,
): TableSheetFacts {
  // The maybeboard is a scratchpad: never on the sheet.
  const rows = deckRowsOf(items, viewerIsOwner).filter((row) => row.board !== "maybe" && row.quantity > 0);
  const lines = rows.map((row) => ({ row, line: lineOf(row, deck) }));

  const commanders = lines.filter(({ row }) => row.board === "commander").map(({ line }) => line);
  const custom = lines.filter(({ row }) => CUSTOM_BADGES.has(row.badge)).map(({ line }) => line).sort(byBoardThenName);
  const proxies = lines
    .filter(({ row }) => row.badge === "imported" && row.item.card)
    .map(({ line }) => line)
    .sort(byBoardThenName);
  const notFound = lines.filter(({ row }) => row.badge === "not_found").map(({ line }) => line).sort(byBoardThenName);
  const realCount = rows.filter((row) => row.badge === "imported" && !row.item.card).reduce((n, row) => n + row.quantity, 0);

  // A Game Changer is a REAL card on the list: an entry with a printing
  // behind it (an Original that borrows a name is no Game Changer). Counted
  // once per card, as the brackets count.
  const changers = new Map<string, SheetGameChanger>();
  for (const row of rows) {
    // The deck's own cards: the main deck and the commander — never the
    // sideboard or a companion (countsTowardDeckStats, as the page's stats).
    if (!countsTowardDeckStats(row.board) || !row.item.entry.scryfall_id) continue;
    const name = gameChangerName(row.item.entry.name);
    if (!name) continue;
    const customVersion = row.status !== "imported";
    const seen = changers.get(name);
    changers.set(name, { name, customVersion: seen ? seen.customVersion && customVersion : customVersion });
  }
  const gameChangers = [...changers.values()].sort((a, b) => a.name.localeCompare(b.name));

  return {
    commanders,
    cardCount: rows.reduce((n, row) => n + row.quantity, 0),
    custom,
    customCount: sum(custom),
    proxies,
    proxyCount: sum(proxies),
    realCount,
    notFound,
    notFoundCount: sum(notFound),
    gameChangers,
    estimate: deck.format === "commander" ? estimateBracket(gameChangers.length, deck.bracket) : null,
  };
}

/** The sheet's one-line headline about custom cards. */
export function customHeadline(facts: Pick<TableSheetFacts, "customCount" | "proxyCount">): string {
  const { customCount, proxyCount } = facts;
  if (customCount === 0 && proxyCount === 0) return "No custom cards or proxies — every card is the real card.";
  const parts: string[] = [];
  if (customCount > 0) parts.push(`${customCount} custom card${customCount === 1 ? "" : "s"}`);
  if (proxyCount > 0) parts.push(`${proxyCount} prox${proxyCount === 1 ? "y" : "ies"}`);
  return `This deck has ${parts.join(" and ")}${customCount > 0 ? " — discuss before playing." : "."}`;
}
