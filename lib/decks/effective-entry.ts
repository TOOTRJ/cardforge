import { buildTypeLine } from "@/lib/cards/card-display";
import { importEditStateOf } from "@/lib/cards/import-fingerprint";
import { manaValueOfCost } from "@/lib/cards/mana-value";
import { deckEntryStatus, type StatusCard, type StatusEntry } from "@/lib/decks/entry-status";
import type { CardType, ColorIdentity } from "@/types/card";
import type { DeckEntryStatus } from "@/types/deck";

// ---------------------------------------------------------------------------
// An entry's EFFECTIVE fields (TODO DK2.7) — its type line, cost, colour
// letters and mana value as the deck should count it. A deck entry carries
// the Scryfall printing's values (copied at import, 0055) and may link a
// PipGlyph card with values of its own; the two disagree as soon as the
// card is edited (a creature turned instant, a new cost).
//
// ONE rule, read by the deck list's grouping and rows, the pop-up, the
// deck's breakdown (lib/decks/analytics.ts) and the report:
//
//   * The ENTRY's printing is the authority — each of its values falling
//     back to the card's only when it has none — for an unchanged import of
//     that printing (status "imported"), and for any card with NO import
//     provenance linked onto a printing: every link saved before 0144 (and a
//     card from scratch linked onto a real card since) counts as the deck
//     always counted it.
//   * Otherwise the CARD's own values win (an edited import, a remix, an
//     original), read the way the deck needs them:
//       - its type line built by buildTypeLine from the front face, as it
//         prints (never by hand);
//       - its mana value from its cost — and, on a split or aftermath card,
//         its second half's too (CR 709.4: Fire // Ice is 4, Commit //
//         Memory 10); the cost shown is then "front // back". A split card
//         is one on the split / aftermath frame, or one imported from the
//         entry's own split printing (the split frame is unverified today,
//         so such an import lands on m15 with a second face);
//       - its colours are the card's FRAME colour (`cards.color_identity`),
//         not the game's colour identity: where the entry knows the real
//         letters, they win whenever the frame names no colour, names gold
//         or colourless, or the card is a land (whose frame is its mana's,
//         or grey) — Kessig Wolf Run's colourless frame, Rootbound Crag's
//         gold one, Fire // Ice's gold one still count R/G, R/G and R/U.
// Pure and client-safe.
// ---------------------------------------------------------------------------

export type EntryColorLetter = "W" | "U" | "B" | "R" | "G";

export type EffectiveEntryFields = {
  typeLine: string | null;
  cost: string | null;
  manaValue: number | null;
  /** WUBRG letters; empty = colourless (or a gold card that names none —
   *  `multicolorOnly`). */
  colors: EntryColorLetter[];
  /** A PipGlyph card saved as "multicolor" without naming its colours (and
   *  no real letters to read instead): gold, never colourless. */
  multicolorOnly: boolean;
};

type EffectiveEntry = StatusEntry & {
  type_line?: string | null;
  mana_cost?: string | null;
  mana_value?: number | null;
  color_identity?: readonly string[] | null;
  rarity?: string | null;
};

type EffectiveCard = StatusCard & {
  supertype?: string | null;
  card_type?: CardType | string | null;
  subtypes?: readonly string[] | null;
  printed_types?: string | null;
  cost?: string | null;
  color_identity?: readonly (ColorIdentity | string)[] | null;
  rarity?: string | null;
  frame_style?: unknown;
};

/** The card fields the effective fields read — a `Card` has them all, and
 *  so does the deck page's narrow read (DeckPageCard, lib/decks/queries.ts). */
export type EffectiveEntryCard = EffectiveCard;

const WORD_LETTER: Readonly<Record<string, EntryColorLetter>> = {
  white: "W",
  blue: "U",
  black: "B",
  red: "R",
  green: "G",
};

const LETTERS: ReadonlySet<string> = new Set(["W", "U", "B", "R", "G"]);

/** The frames whose two halves are ONE split card, mana values summed
 *  (CR 709.4; aftermath is a split card). Adventure, flip and prepare are
 *  not: their mana value is the main part's. */
const SPLIT_TEMPLATES: ReadonlySet<string> = new Set(["split", "aftermath"]);

function templateOf(card: EffectiveCard): string | null {
  const style = card.frame_style;
  if (!style || typeof style !== "object") return null;
  const template = (style as { template?: unknown }).template;
  return typeof template === "string" ? template : null;
}

function backCostOf(card: EffectiveCard): string | null {
  const back = card.back_face;
  if (!back || typeof back !== "object") return null;
  const cost = (back as { cost?: unknown }).cost;
  return typeof cost === "string" && cost.trim() ? cost : null;
}

function cardTypeLine(card: EffectiveCard): string | null {
  if (!card.card_type && !card.supertype && !(card.subtypes ?? []).some(Boolean) && typeof card.printed_types !== "string") {
    return null;
  }
  return (
    buildTypeLine({
      supertype: card.supertype,
      cardType: (card.card_type || null) as CardType | null,
      subtypes: card.subtypes,
      printedTypes: card.printed_types,
    }) || null
  );
}

/** The entry's printing is a SPLIT card: Scryfall's mana value is both
 *  halves of its " // " cost, not the first alone (an adventure's or a
 *  modal card's is the first half's). How a split import that did not land
 *  on the split frame (it lands on m15 with a second face while the split
 *  frame is unverified) is still known for one. */
function printingSumsHalves(entry: EffectiveEntry): boolean {
  const cost = entry.mana_cost ?? "";
  if (!cost.includes("//") || entry.mana_value === null || entry.mana_value === undefined) return false;
  const whole = manaValueOfCost(cost);
  const first = manaValueOfCost(cost.split("//")[0]);
  return whole !== null && first !== null && whole !== first && Number(entry.mana_value) === whole;
}

/** The card's cost and mana value — both halves of a split card (its frame
 *  says so, or it was imported from the entry's split printing). */
function cardCost(card: EffectiveCard, splitPrinting: boolean): { cost: string | null; manaValue: number | null } {
  const front = card.cost?.trim() ? card.cost : null;
  const back = SPLIT_TEMPLATES.has(templateOf(card) ?? "") || splitPrinting ? backCostOf(card) : null;
  if (!back) return { cost: front, manaValue: manaValueOfCost(front) };
  const frontValue = manaValueOfCost(front);
  const backValue = manaValueOfCost(back);
  return {
    cost: front ? `${front} // ${back}` : back,
    manaValue: frontValue === null && backValue === null ? null : (frontValue ?? 0) + (backValue ?? 0),
  };
}

function cardLetters(card: EffectiveCard): EntryColorLetter[] {
  return (card.color_identity ?? []).map((word) => WORD_LETTER[word]).filter((letter): letter is EntryColorLetter => Boolean(letter));
}

function entryLetters(entry: EffectiveEntry): EntryColorLetter[] {
  return (entry.color_identity ?? []).filter((letter): letter is EntryColorLetter => LETTERS.has(letter));
}

function isLand(card: EffectiveCard): boolean {
  return card.card_type === "land";
}

/** The header's first rule: the ENTRY's printing speaks for the entry — an
 *  unchanged import of it, or a card with no import provenance linked onto
 *  a printing. Otherwise the card's own values win. */
export function printingIsAuthority(
  entry: EffectiveEntry,
  card: EffectiveCard,
  status: DeckEntryStatus = deckEntryStatus(entry, card),
): boolean {
  return status === "imported" || (Boolean(entry.scryfall_id) && importEditStateOf(card) === "untracked");
}

/** The entry's rarity by the same rule (the deck list's "Group by rarity",
 *  TODO DK5.3): the printing's while it speaks for the entry, else the
 *  card's own — each falling back to the other when it names none. Kept
 *  out of EffectiveEntryFields, whose shape the breakdown and the report
 *  read whole. Lower case, as stored ("mythic", Scryfall's "special"). */
export function effectiveEntryRarity(
  entry: EffectiveEntry,
  card: EffectiveCard | null | undefined,
  status: DeckEntryStatus = deckEntryStatus(entry, card),
): string | null {
  const fromEntry = entry.rarity?.trim() ? entry.rarity.trim().toLowerCase() : null;
  if (!card) return fromEntry;
  const fromCard = card.rarity?.trim() ? card.rarity.trim().toLowerCase() : null;
  return printingIsAuthority(entry, card, status) ? (fromEntry ?? fromCard) : (fromCard ?? fromEntry);
}

export function effectiveEntryFields(
  entry: EffectiveEntry,
  card: EffectiveCard | null | undefined,
  status: DeckEntryStatus = deckEntryStatus(entry, card),
): EffectiveEntryFields {
  const fromEntry = {
    typeLine: entry.type_line?.trim() ? entry.type_line : null,
    cost: entry.mana_cost?.trim() ? entry.mana_cost : null,
    manaValue:
      entry.mana_value !== null && entry.mana_value !== undefined ? Number(entry.mana_value) : manaValueOfCost(entry.mana_cost),
    colors: entryLetters(entry),
  };
  if (!card) {
    return { ...fromEntry, multicolorOnly: false };
  }

  // A card imported from the entry's own split printing is a split card,
  // whatever frame it landed on.
  const fromThisPrinting =
    Boolean(entry.scryfall_id) &&
    Boolean(card.import_scryfall_id) &&
    entry.scryfall_id!.toLowerCase() === card.import_scryfall_id!.toLowerCase();
  const priced = cardCost(card, fromThisPrinting && printingSumsHalves(entry));
  const fromCard = {
    typeLine: cardTypeLine(card),
    cost: priced.cost,
    manaValue: priced.manaValue,
    colors: cardLetters(card),
    multicolorOnly: (card.color_identity ?? []).includes("multicolor"),
  };

  if (printingIsAuthority(entry, card, status)) {
    const colors = fromEntry.colors.length > 0 ? fromEntry.colors : fromCard.colors;
    return {
      typeLine: fromEntry.typeLine ?? fromCard.typeLine,
      cost: fromEntry.cost ?? fromCard.cost,
      manaValue: fromEntry.manaValue ?? fromCard.manaValue,
      colors,
      multicolorOnly: colors.length === 0 && fromCard.multicolorOnly,
    };
  }

  // The card's own values. Its colours are its frame's: the entry's real
  // letters win where the frame can't say them.
  const frameSaysNoColour =
    fromCard.colors.length === 0 ||
    isLand(card) ||
    (card.color_identity ?? []).some((word) => word === "multicolor" || word === "colorless");
  const colors = fromEntry.colors.length > 0 && frameSaysNoColour ? fromEntry.colors : fromCard.colors;
  return {
    // A card with no type of its own (an empty draft) borrows the entry's
    // line, cost and value; a typed card with no cost has none (a land).
    typeLine: fromCard.typeLine ?? fromEntry.typeLine,
    cost: fromCard.cost ?? (fromCard.typeLine ? null : fromEntry.cost),
    manaValue: fromCard.manaValue ?? (fromCard.typeLine ? null : fromEntry.manaValue),
    colors,
    multicolorOnly: colors.length === 0 && fromCard.multicolorOnly,
  };
}
