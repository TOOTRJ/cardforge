import { cardTextFacesOf, type CardTextFace } from "@/lib/cards/card-text-faces";
import { dfcBodyOf } from "@/lib/cards/dfc";
import { manaValueOfCost } from "@/lib/cards/mana-value";
import { isStoredRenderUrl, toRenderCdnUrl } from "@/lib/cards/render-cdn";
import { buildCardUrl } from "@/lib/cards/utils";
import { entryPrintingImage } from "@/lib/decks/entry-image";
import { bringsCard, deckEntryStatus, type StatusCard } from "@/lib/decks/entry-status";
import { GONE_CARD_NAME, PRIVATE_CARD_NAME } from "@/lib/decks/private-card-name";
import type { Card, CardBackFace } from "@/types/card";
import type { DeckCardEntry } from "@/types/deck";
import {
  COLOR_LETTERS,
  PLAY_BOARDS,
  cleanCardName,
  costColors,
  exportNameFor,
  shortHash,
  type ColorLetter,
  type PlayBoard,
  type PlayCustomCard,
  type PlayExport,
  type PlayFace,
  type PlayLayout,
  type PlayLine,
  type PlayRarity,
} from "./model";

// ---------------------------------------------------------------------------
// The play export of a deck or a selection — PURE: it takes the rows the
// viewer's read already returned (lib/tools/play-exports/collect.ts reads
// them through listDeckCards + publicDeckItems, or the viewer's own card
// read) and decides, entry by entry, what the files hold. Unit-tested
// without a database.
//
// Pictures are the cards' STORED DISPLAY BAKES only (the watermarked bake
// every display surface shows, through this deployment's /render-cdn), and
// only for a card in view — public or unlisted. A private card has no
// shared picture (its render objects are removed when it goes private, and
// a print or live render is never routed here); an export names it without
// one, and a client that needs a URL (TTS) leaves it out and says so.
// ---------------------------------------------------------------------------

/** The columns of a card this module reads. */
export type PlayCardRow = StatusCard &
  Pick<
    Card,
    | "id"
    | "owner_id"
    | "slug"
    | "visibility"
    | "title"
    | "cost"
    | "card_type"
    | "supertype"
    | "subtypes"
    | "rarity"
    | "color_identity"
    | "power"
    | "toughness"
    | "loyalty"
    | "defense"
    | "artist_credit"
    | "rules_text"
    | "flavor_text"
    | "face_content"
    | "frame_style"
    | "back_face"
    | "rendered_image_url"
    | "rendered_thumb_url"
    | "rendered_back_image_url"
    | "rendered_back_thumb_url"
  > & { printed_types?: string | null; nickname?: string | null };

export type PlayDeckItem = {
  entry: Pick<
    DeckCardEntry,
    "id" | "board" | "quantity" | "name" | "card_id" | "scryfall_id" | "set_code" | "collector_number" | "image_url"
  > & { source?: string | null };
  card: PlayCardRow | null;
};

export type BuildContext = {
  /** The site's absolute base URL (getSiteBaseUrl). */
  baseUrl: string;
  /** card owner id → handle, for the card page links. */
  usernames: ReadonlyMap<string, string | null>;
};

const WORD_LETTER: Readonly<Record<string, ColorLetter>> = {
  white: "W",
  blue: "U",
  black: "B",
  red: "R",
  green: "G",
};

const RARITIES: ReadonlySet<string> = new Set(["common", "uncommon", "rare", "mythic"]);
const SPLIT_TEMPLATES: ReadonlySet<string> = new Set(["split", "aftermath"]);

function absolute(baseUrl: string, path: string): string {
  return /^https?:\/\//.test(path) ? path : `${baseUrl}${path}`;
}

/** A stored bake pointer as an absolute /render-cdn URL — only a bake in
 *  our card-renders bucket of THIS card (isStoredRenderUrl), only while the
 *  card is in view. */
function bakeUrl(card: PlayCardRow, url: string | null | undefined, ctx: BuildContext): string | null {
  if (card.visibility === "private") return null;
  if (!isStoredRenderUrl(url, { ownerId: card.owner_id, cardId: card.id })) return null;
  return absolute(ctx.baseUrl, toRenderCdnUrl(url) ?? url);
}

function frameLetters(colors: readonly string[] | null | undefined): ColorLetter[] {
  const found = new Set((colors ?? []).map((word) => WORD_LETTER[word]).filter(Boolean));
  return COLOR_LETTERS.filter((letter) => found.has(letter));
}

/** A face's colours: its cost's, else its frame's (a land's frame is its
 *  mana's; an artifact's grey frame names none). */
function faceColors(cost: string | null, frameColors: readonly string[] | null | undefined): ColorLetter[] {
  const fromCost = costColors(cost);
  return fromCost.length > 0 ? fromCost : frameLetters(frameColors);
}

function playFace(
  text: CardTextFace,
  raw: { power?: string | null; toughness?: string | null; loyalty?: string | null; defense?: string | null },
  colors: ColorLetter[],
  pictures: { image: string | null; thumb: string | null },
): PlayFace {
  const drawsPt = text.stats?.label === "Power and toughness";
  return {
    name: cleanCardName(text.name),
    cost: text.cost?.trim() ? text.cost.trim() : null,
    typeLine: text.typeLine,
    rulesText: text.rulesText?.trim() ? text.rulesText.trim() : null,
    flavorText: text.flavorText?.trim() ? text.flavorText.trim() : null,
    power: drawsPt ? (raw.power ?? "") || null : null,
    toughness: drawsPt ? (raw.toughness ?? "") || null : null,
    loyalty: text.stats?.value.startsWith("Loyalty ") ? (raw.loyalty ?? null) : null,
    defense: text.stats?.value.startsWith("Defense ") ? (raw.defense ?? null) : null,
    colors,
    image: pictures.image,
    // A thumb only beside its PNG: never a thumb of a bake the row no
    // longer points at.
    thumb: pictures.image ? pictures.thumb : null,
  };
}

function templateOf(card: PlayCardRow): string | null {
  const template = (card.frame_style as { template?: unknown } | null)?.template;
  return typeof template === "string" ? template : null;
}

/** One PipGlyph card as a custom card (its export name decided by the caller). */
export function customCardOf(card: PlayCardRow, name: string, ctx: BuildContext): PlayCustomCard {
  const faces = cardTextFacesOf(card);
  const backRow = (card.back_face as CardBackFace | null) ?? null;
  const front = playFace(faces.front, card, faceColors(faces.front.cost, card.color_identity), {
    image: bakeUrl(card, card.rendered_image_url, ctx),
    thumb: bakeUrl(card, card.rendered_thumb_url, ctx),
  });
  const back = faces.back
    ? playFace(faces.back, backRow ?? {}, faceColors(faces.back.cost, backRow?.color_identity ?? card.color_identity), {
        image: bakeUrl(card, card.rendered_back_image_url, ctx),
        thumb: bakeUrl(card, card.rendered_back_thumb_url, ctx),
      })
    : null;
  const secondPart = faces.secondPart
    ? playFace(faces.secondPart, backRow ?? {}, faceColors(faces.secondPart.cost, backRow?.color_identity ?? card.color_identity), {
        image: null,
        thumb: null,
      })
    : null;
  const template = templateOf(card);
  const layout: PlayLayout = back ? (dfcBodyOf(template)?.layout === "modal" ? "modal" : "transform") : secondPart ? "split" : "normal";
  const frontValue = manaValueOfCost(front.cost) ?? 0;
  const manaValue =
    secondPart && SPLIT_TEMPLATES.has(template ?? "") ? frontValue + (manaValueOfCost(secondPart.cost) ?? 0) : frontValue;
  const rarity: PlayRarity = card.rarity && RARITIES.has(card.rarity) ? (card.rarity as PlayRarity) : "common";
  const username = ctx.usernames.get(card.owner_id) ?? null;
  return {
    id: card.id,
    name,
    layout,
    // The files call the front by the export's name (exportNameFor).
    front: { ...front, name },
    back,
    secondPart,
    rarity,
    manaValue,
    isToken: card.card_type === "token" || card.card_type === "emblem",
    isPrivate: card.visibility === "private",
    pageUrl: card.visibility === "private" ? null : buildCardUrl({ slug: card.slug, owner: { username } }, ctx.baseUrl),
  };
}

/** A custom card under its export name, its BACK face's name made unique
 *  too (Cockatrice files each face as a card of its own): renamed as its
 *  front was, when the front had to give way to a real card's name. */
function namedCustomCard(card: PlayCardRow, taken: Set<string>, standsInFor: string | null, ctx: BuildContext): PlayCustomCard {
  const name = exportNameFor(card.title, taken, standsInFor);
  const custom = customCardOf(card, name, ctx);
  if (!custom.back) return custom;
  const frontRenamed = name !== cleanCardName(card.title);
  const backName = exportNameFor(custom.back.name, taken, frontRenamed ? custom.back.name : null);
  return { ...custom, back: { ...custom.back, name: backName } };
}

/** The real card a PipGlyph card may still be named after: a card with
 *  import provenance (imported, or customized from a printing) — its title,
 *  which an edit usually keeps ("Lightning Bolt"). Cockatrice merges a card
 *  into the real one of the same name and plays the real text, so such a
 *  card is kept apart (exportNameFor). Null for a card made from scratch. */
function realNameOf(card: PlayCardRow): string | null {
  return card.import_scryfall_id || card.source_scryfall_id ? card.title : null;
}

type Decided =
  | { kind: "custom"; card: PlayCardRow; standsInFor: string | null }
  | { kind: "real"; name: string }
  | { kind: "hidden" };

/** What one entry (as the viewer read it, publicDeckItems' masks applied)
 *  goes out as. */
export function decideEntry(item: PlayDeckItem): Decided {
  const { entry, card } = item;
  const hiddenName = entry.name === PRIVATE_CARD_NAME || entry.name === GONE_CARD_NAME;
  if (card) {
    // An unchanged import of the entry's own printing IS the real card.
    if (deckEntryStatus(entry, card) === "imported") return { kind: "real", name: entry.name };
    return { kind: "custom", card, standsInFor: entry.scryfall_id ? entry.name : realNameOf(card) };
  }
  // A linked card the viewer can't read (private, another creator's that
  // is no longer public, gone): the real card it stands in for, by name,
  // where the entry has a printing and the viewer may read its name.
  if (entry.card_id) return entry.scryfall_id && !hiddenName ? { kind: "real", name: entry.name } : { kind: "hidden" };
  if (entry.scryfall_id) return { kind: "real", name: entry.name };
  // A deleted card's entry (it came WITH its card): nothing to name.
  if (bringsCard(entry.source)) return { kind: "hidden" };
  // A pasted name that matched no card: by name, for the client to find.
  return entry.name.trim() ? { kind: "real", name: entry.name.trim() } : { kind: "hidden" };
}

function boardOf(board: string): PlayBoard | "maybe" {
  return (PLAY_BOARDS as readonly string[]).includes(board) ? (board as PlayBoard) : "maybe";
}

/** A deck's export, from its items as the viewer read them. */
export function buildDeckExport(
  deck: { id: string; title: string; fileStem: string },
  items: readonly PlayDeckItem[],
  ctx: BuildContext & { cardBackUrl: string },
): PlayExport {
  const decided = items.map((item) => ({ item, decided: decideEntry(item), board: boardOf(item.entry.board) }));
  const leftOut = { hidden: 0, maybeboard: 0 };
  // Real names first: a custom card never takes the name of a real card
  // the same export plays by name.
  const taken = new Set<string>();
  for (const { decided: d, board } of decided) {
    if (board !== "maybe" && d.kind === "real") taken.add(d.name.toLowerCase());
  }

  const cards: PlayCustomCard[] = [];
  const cardById = new Map<string, PlayCustomCard>();
  const lines: PlayLine[] = [];
  for (const { item, decided: d, board } of decided) {
    const quantity = Math.max(0, Math.floor(item.entry.quantity));
    if (quantity === 0) continue;
    if (board === "maybe") {
      leftOut.maybeboard += quantity;
      continue;
    }
    if (d.kind === "hidden") {
      leftOut.hidden += quantity;
      continue;
    }
    if (d.kind === "real") {
      lines.push({
        kind: "real",
        board,
        quantity,
        name: d.name,
        setCode: item.entry.set_code ?? null,
        collectorNumber: item.entry.collector_number ?? null,
        image: entryPrintingImage(item.entry.image_url, "normal"),
      });
      continue;
    }
    let custom = cardById.get(d.card.id);
    if (!custom) {
      custom = namedCustomCard(d.card, taken, d.standsInFor, ctx);
      cardById.set(d.card.id, custom);
      cards.push(custom);
    }
    lines.push({ kind: "custom", board, quantity, cardId: custom.id });
  }
  // Board order (commander, companion, main, side), list order within.
  const order = (board: PlayBoard) => PLAY_BOARDS.indexOf(board);
  const sorted = lines
    .map((line, i) => ({ line, i }))
    .sort((a, b) => order(a.line.board) - order(b.line.board) || a.i - b.i)
    .map(({ line }) => line);
  return {
    title: deck.title,
    fileStem: deck.fileStem,
    exportKey: deck.id,
    source: "deck",
    cards,
    lines: sorted,
    leftOut,
    cardBackUrl: ctx.cardBackUrl,
  };
}

/** A selection's export: each card once, as a custom card (an unchanged
 *  import too — the maker picked their card), in the order given. */
export function buildCardsExport(
  cardsInOrder: readonly PlayCardRow[],
  ctx: BuildContext & { cardBackUrl: string },
): PlayExport {
  const taken = new Set<string>();
  // A card imported or customized from a printing may still carry the real
  // card's name: it is kept apart from it as a deck's custom version is.
  const cards = cardsInOrder.map((card) => namedCustomCard(card, taken, realNameOf(card), ctx));
  return {
    title: "My cards",
    // Each selection its own file and set: a second export never replaces
    // the first in Cockatrice's custom sets.
    fileStem: `pipglyph-cards-${shortHash(cards.map((card) => card.id).join(","))}`,
    exportKey: cards.map((card) => card.id).join(","),
    source: "cards",
    cards,
    lines: cards.map((card) => ({ kind: "custom", board: "main", quantity: 1, cardId: card.id })),
    leftOut: { hidden: 0, maybeboard: 0 },
    cardBackUrl: ctx.cardBackUrl,
  };
}
