import { CARD_TYPE_LABELS, type CardType } from "@/types/card";
import { buildTypeLine, describeManaCost } from "@/lib/cards/card-display";
import { stripFlavorMarkup } from "@/lib/cards/flavor-markup";
import { cardPageRulesText } from "@/lib/cards/page-rules-text";

// ---------------------------------------------------------------------------
// The card page's <title> and meta description (TODO CP2b). A search result
// for a custom card is read in a second: the title says WHAT it is and whose
// ("Archivist of Lost Hours: custom MTG creature by @dev_pro"), the
// description what the card DOES — its type line, cost and rules, the way a
// card database reads — and only then its flavour. Both stay inside what a
// results page shows (≈60 / 160 characters), cut at a word.
// ---------------------------------------------------------------------------

/** What a results page shows of a title before it cuts (the layout's
 *  " · PipGlyph" suffix included). */
export const TITLE_BUDGET = 60;
export const DESCRIPTION_BUDGET = 160;
const TITLE_SUFFIX = " · PipGlyph";

function typeWord(cardType: string | null | undefined): string {
  if (!cardType || cardType === "spell") return "card";
  const label = CARD_TYPE_LABELS[cardType as CardType];
  return label ? label.toLowerCase() : "card";
}

/** "<name>: custom MTG <type> by @<user>", shortened to what fits — the
 *  handle goes first, then the type; the name is never cut. */
export function cardPageTitle(name: string, cardType: string | null | undefined, username: string): string {
  const fits = (title: string) => title.length + TITLE_SUFFIX.length <= TITLE_BUDGET;
  const typed = `${name}: custom MTG ${typeWord(cardType)}`;
  const full = `${typed} by @${username}`;
  if (fits(full)) return full;
  if (fits(typed)) return typed;
  return name;
}

/** A text cut to `budget` characters at a word, with one "…". */
export function cutAtWord(text: string, budget: number): string {
  if (text.length <= budget) return text;
  const head = text.slice(0, budget - 1);
  const space = head.lastIndexOf(" ");
  return `${(space > budget * 0.6 ? head.slice(0, space) : head).replace(/[\s,;:.—–-]+$/, "")}…`;
}

/** The description: "<type line>, <cost in words>. <rules> <flavour>", the
 *  newlines as spaces, cut to the budget; a card with no words at all says
 *  what it is and whose. */
export function cardMetaDescription(
  card: {
    title: string;
    nickname?: string | null;
    card_type: string | null;
    supertype: string | null;
    subtypes: string[] | null;
    printed_types?: string | null;
    cost: string | null;
    rules_text: string | null;
    flavor_text: string | null;
    frame_style?: unknown;
    face_content?: unknown;
  },
  username: string,
): string {
  const typeLine = buildTypeLine({
    supertype: card.supertype,
    cardType: card.card_type as CardType | null,
    subtypes: card.subtypes ?? [],
    printedTypes: card.printed_types,
  }).trim();
  const cost = card.cost?.trim() ? describeManaCost(card.cost) : "";
  const head = [typeLine, cost].filter(Boolean).join(", ");
  const flat = (text: string | null | undefined) => (text ?? "").replace(/\s*\n+\s*/g, " ").trim();
  // Its text or its rows (lib/cards/page-rules-text.ts), CARDNAME / ~ as the
  // name the card prints (TODO 6.2); the flavour's upright `*…*` spans as
  // plain words (layout v71).
  const rules = flat(cardPageRulesText(card));
  const flavor = flat(stripFlavorMarkup(card.flavor_text ?? ""));
  const body = [head ? `${head}.` : "", rules, flavor]
    .filter(Boolean)
    .join(" ");
  const tail = `A custom Magic card by @${username} on PipGlyph.`;
  if (!rules && !flavor) return cutAtWord(`${body} ${tail}`.trim(), DESCRIPTION_BUDGET);
  return cutAtWord(body, DESCRIPTION_BUDGET);
}
