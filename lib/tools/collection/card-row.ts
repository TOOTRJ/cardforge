import type { ScryfallCard } from "@/lib/scryfall/client";
import { clampManaValue } from "@/lib/decks/import-resolution";
import { isScryfallPrintingImage } from "@/lib/media/media-urls";
import type { CollectionFinish } from "./parse-import";
import { MAX_COLLECTION_QUANTITY } from "./limits";

// ---------------------------------------------------------------------------
// A collection row (migration 0185) — what a printing Scryfall answered is
// stored as, and what the app reads back. Pure, client-safe.
// ---------------------------------------------------------------------------

/** What `add_collection_cards` takes for one row (snake_case: the RPC's
 *  jsonb_to_recordset columns). */
export type CollectionRowInput = {
  scryfall_id: string;
  oracle_id: string | null;
  finish: CollectionFinish;
  lang: string;
  quantity: number;
  name: string;
  type_line: string | null;
  mana_cost: string | null;
  mana_value: number | null;
  color_identity: string[];
  oracle_text: string | null;
  rarity: string | null;
  set_code: string | null;
  set_name: string | null;
  collector_number: string | null;
  image_url: string | null;
  commander_legal: boolean;
  can_be_commander: boolean;
  source_line: string | null;
};

/** One row of the collection as the app draws and builds with it. */
export type CollectionCard = {
  id: string;
  scryfallId: string;
  name: string;
  typeLine: string | null;
  manaCost: string | null;
  manaValue: number | null;
  colorIdentity: string[];
  oracleText: string | null;
  rarity: string | null;
  setCode: string | null;
  setName: string | null;
  collectorNumber: string | null;
  imageUrl: string | null;
  quantity: number;
  finish: CollectionFinish;
  lang: string;
  commanderLegal: boolean;
  canBeCommander: boolean;
};

/** The columns every read selects (never `*`). */
export const COLLECTION_CARD_COLUMNS =
  "id, scryfall_id, name, type_line, mana_cost, mana_value, color_identity, oracle_text, rarity, set_code, set_name, collector_number, image_url, quantity, finish, lang, commander_legal, can_be_commander";

export type CollectionCardRow = {
  id: string;
  scryfall_id: string;
  name: string;
  type_line: string | null;
  mana_cost: string | null;
  mana_value: number | string | null;
  color_identity: string[] | null;
  oracle_text: string | null;
  rarity: string | null;
  set_code: string | null;
  set_name: string | null;
  collector_number: string | null;
  image_url: string | null;
  quantity: number;
  finish: string;
  lang: string;
  commander_legal: boolean;
  can_be_commander: boolean;
};

export function collectionCardOf(row: CollectionCardRow): CollectionCard {
  const mv = row.mana_value === null ? null : Number(row.mana_value);
  return {
    id: row.id,
    scryfallId: row.scryfall_id,
    name: row.name,
    typeLine: row.type_line,
    manaCost: row.mana_cost,
    manaValue: mv !== null && Number.isFinite(mv) ? mv : null,
    colorIdentity: row.color_identity ?? [],
    oracleText: row.oracle_text,
    rarity: row.rarity,
    setCode: row.set_code,
    setName: row.set_name,
    collectorNumber: row.collector_number,
    imageUrl: isScryfallPrintingImage(row.image_url) ? row.image_url : null,
    quantity: row.quantity,
    finish: row.finish === "foil" || row.finish === "etched" ? row.finish : "nonfoil",
    lang: row.lang,
    commanderLegal: row.commander_legal,
    canBeCommander: row.can_be_commander,
  };
}

const WUBRG = new Set(["W", "U", "B", "R", "G"]);

function frontTypeLine(card: ScryfallCard): string {
  return (card.type_line ?? card.card_faces?.[0]?.type_line ?? "").split(" // ")[0];
}

function oracleTextOf(card: ScryfallCard): string | null {
  if (card.oracle_text) return card.oracle_text;
  const faces = (card.card_faces ?? []).map((f) => f.oracle_text ?? "").filter(Boolean);
  return faces.length ? faces.join("\n//\n") : null;
}

/** May lead a Commander deck: a legendary creature (front face), or a card
 *  whose text says so (the walkers and backgrounds that can). */
export function canLeadCommanderDeck(card: Pick<ScryfallCard, "type_line" | "card_faces" | "oracle_text">): boolean {
  const front = frontTypeLine(card as ScryfallCard);
  if (/\bLegendary\b/.test(front) && /\bCreature\b/.test(front)) return true;
  return /can be your commander/i.test(oracleTextOf(card as ScryfallCard) ?? "");
}

function commanderLegalOf(card: ScryfallCard): boolean {
  const legalities = (card as { legalities?: unknown }).legalities;
  if (!legalities || typeof legalities !== "object") return false;
  return (legalities as Record<string, unknown>).commander === "legal";
}

function imageOf(card: ScryfallCard): string | null {
  const face = card.card_faces?.[0];
  const url = card.image_uris?.normal ?? face?.image_uris?.normal ?? card.image_uris?.large ?? face?.image_uris?.large ?? null;
  if (!url) return null;
  // The client schema already moved Scryfall's CDN mirror to its own host;
  // the query string (a cache-buster) is dropped.
  const clean = url.replace("://cards.bcdn.scryfall.io/", "://cards.scryfall.io/").split("?")[0];
  return isScryfallPrintingImage(clean) ? clean : null;
}

function cutText(text: string | null | undefined, max: number): string | null {
  if (!text) return null;
  return text.length > max ? text.slice(0, max) : text;
}

export function collectionRowFor(
  card: ScryfallCard,
  options: { finish: CollectionFinish; lang?: string | null; quantity: number; sourceLine?: string | null },
): CollectionRowInput {
  const face = card.card_faces?.[0];
  const lang = (options.lang && /^[a-z]{2,3}$/.test(options.lang) ? options.lang : null) ?? card.lang ?? "en";
  return {
    scryfall_id: card.id.toLowerCase(),
    oracle_id: card.oracle_id ?? null,
    finish: options.finish,
    lang: /^[a-z]{2,3}$/.test(lang) ? lang : "en",
    quantity: Math.max(1, Math.min(MAX_COLLECTION_QUANTITY, Math.trunc(options.quantity))),
    name: card.name.slice(0, 200),
    type_line: cutText(card.type_line ?? face?.type_line, 300),
    mana_cost: cutText(card.mana_cost ?? face?.mana_cost, 200),
    mana_value: clampManaValue(card.cmc),
    color_identity: (card.color_identity ?? []).filter((c) => WUBRG.has(c)),
    oracle_text: cutText(oracleTextOf(card), 3000),
    rarity: cutText(card.rarity, 20),
    set_code: cutText(card.set, 10),
    set_name: cutText(card.set_name, 120),
    collector_number: cutText(card.collector_number, 20),
    image_url: imageOf(card),
    commander_legal: commanderLegalOf(card),
    can_be_commander: canLeadCommanderDeck(card),
    source_line: cutText(options.sourceLine ?? null, 300),
  };
}

/** A row's key: one printing in one finish and language. */
export function collectionRowKey(row: { scryfall_id: string; finish: string; lang: string }): string {
  return `${row.scryfall_id.toLowerCase()}|${row.finish}|${row.lang}`;
}
