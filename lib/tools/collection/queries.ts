import "server-only";

import { createClient } from "@/lib/supabase/server";
import {
  COLLECTION_CARD_COLUMNS,
  collectionCardOf,
  type CollectionCard,
  type CollectionCardRow,
} from "./card-row";
import { COLLECTION_CARD_CAP, COLLECTION_PAGE_SIZE } from "./limits";
import { isScryfallPrintingImage } from "@/lib/media/media-urls";

// ---------------------------------------------------------------------------
// The Collection Deck Builder's reads (migration 0185). Every read is the
// caller's own rows through RLS — which also hands back nothing unless the
// tool is open to them (has_tool_access) — so a page calls these only after
// `openTool`, and an action after `checkToolAccess`.
// ---------------------------------------------------------------------------

export type CollectionStats = { cards: number; copies: number; commanders: number; cap: number };

export async function getCollectionStats(): Promise<CollectionStats> {
  const supabase = await createClient();
  const { data, error } = await supabase.rpc("collection_stats");
  const row = Array.isArray(data) ? data[0] : null;
  if (error || !row) {
    if (error) console.error("[collection] stats read failed:", error.message);
    return { cards: 0, copies: 0, commanders: 0, cap: COLLECTION_CARD_CAP };
  }
  return {
    cards: Number(row.cards) || 0,
    copies: Number(row.copies) || 0,
    commanders: Number(row.commanders) || 0,
    cap: Number(row.cap) || COLLECTION_CARD_CAP,
  };
}

export const COLLECTION_SORTS = ["name", "recent", "mana", "copies"] as const;
export type CollectionSort = (typeof COLLECTION_SORTS)[number];

export const COLLECTION_TYPES = [
  "creature",
  "instant",
  "sorcery",
  "artifact",
  "enchantment",
  "planeswalker",
  "land",
  "battle",
] as const;
export type CollectionType = (typeof COLLECTION_TYPES)[number];

export const COLLECTION_COLOURS = ["W", "U", "B", "R", "G", "C"] as const;
export type CollectionColour = (typeof COLLECTION_COLOURS)[number];

export type CollectionQuery = {
  q?: string;
  colours?: CollectionColour[];
  type?: CollectionType | null;
  sort?: CollectionSort;
  commandersOnly?: boolean;
  page?: number;
};

export type CollectionPage = { cards: CollectionCard[]; total: number; page: number; pages: number };

/** Characters PostgREST's filter grammar gives a meaning to. */
function likeSafe(text: string): string {
  return text.replace(/[%_\\,()*]/g, " ").replace(/\s+/g, " ").trim();
}

export async function listCollectionPage(query: CollectionQuery): Promise<CollectionPage> {
  const supabase = await createClient();
  const page = Math.max(1, Math.floor(query.page ?? 1));
  const from = (page - 1) * COLLECTION_PAGE_SIZE;
  let request = supabase.from("collection_cards").select(COLLECTION_CARD_COLUMNS, { count: "exact" });

  const q = likeSafe(query.q ?? "").slice(0, 80);
  if (q) request = request.ilike("name", `%${q}%`);
  const colours = (query.colours ?? []).filter((c) => c !== "C");
  const colourless = (query.colours ?? []).includes("C");
  if (colours.length && colourless) {
    request = request.or(`color_identity.ov.{${colours.join(",")}},color_identity.eq.{}`);
  } else if (colours.length) {
    request = request.overlaps("color_identity", colours);
  } else if (colourless) {
    request = request.filter("color_identity", "eq", "{}");
  }
  if (query.type) request = request.ilike("type_line", `%${query.type}%`);
  if (query.commandersOnly) request = request.eq("can_be_commander", true).eq("commander_legal", true);

  switch (query.sort ?? "name") {
    case "recent":
      request = request.order("updated_at", { ascending: false }).order("name");
      break;
    case "mana":
      request = request.order("mana_value", { ascending: true, nullsFirst: true }).order("name");
      break;
    case "copies":
      request = request.order("quantity", { ascending: false }).order("name");
      break;
    default:
      request = request.order("name").order("set_code");
  }

  const { data, error, count } = await request.range(from, from + COLLECTION_PAGE_SIZE - 1);
  if (error) {
    console.error("[collection] page read failed:", error.message);
    return { cards: [], total: 0, page, pages: 1 };
  }
  const total = count ?? 0;
  return {
    cards: ((data ?? []) as CollectionCardRow[]).map(collectionCardOf),
    total,
    page,
    pages: Math.max(1, Math.ceil(total / COLLECTION_PAGE_SIZE)),
  };
}

/** Every commander the user owns (legal ones first), for the builder. */
export async function listOwnedCommanders(): Promise<CollectionCard[]> {
  const supabase = await createClient();
  const { data, error } = await supabase
    .from("collection_cards")
    .select(COLLECTION_CARD_COLUMNS)
    .eq("can_be_commander", true)
    .order("commander_legal", { ascending: false })
    .order("name")
    .limit(1000);
  if (error) {
    console.error("[collection] commanders read failed:", error.message);
    return [];
  }
  return ((data ?? []) as CollectionCardRow[]).map(collectionCardOf);
}

/** One of the caller's rows by id. */
export async function getCollectionCard(id: string): Promise<CollectionCard | null> {
  const supabase = await createClient();
  const { data } = await supabase.from("collection_cards").select(COLLECTION_CARD_COLUMNS).eq("id", id).maybeSingle();
  return data ? collectionCardOf(data as CollectionCardRow) : null;
}

/** Most rows the builder reads for one commander (a five-colour commander
 *  over a full collection could otherwise read all 25,000). */
export const BUILDER_POOL_MAX = 12_000;
const READ_PAGE = 1000;

/** The rows a commander's deck may draw from: legal in Commander and inside
 *  its colour identity — read in pages (PostgREST hands back 1000 a read). */
export async function listBuilderPool(commander: CollectionCard): Promise<{ cards: CollectionCard[]; truncated: boolean }> {
  const supabase = await createClient();
  const cards: CollectionCard[] = [];
  for (let from = 0; from < BUILDER_POOL_MAX; from += READ_PAGE) {
    const { data, error } = await supabase
      .from("collection_cards")
      .select(COLLECTION_CARD_COLUMNS)
      .eq("commander_legal", true)
      .containedBy("color_identity", commander.colorIdentity)
      .order("id")
      .range(from, from + READ_PAGE - 1);
    if (error) {
      console.error("[collection] builder pool read failed:", error.message);
      break;
    }
    const rows = (data ?? []) as CollectionCardRow[];
    cards.push(...rows.map(collectionCardOf));
    if (rows.length < READ_PAGE) return { cards, truncated: false };
  }
  return { cards, truncated: cards.length >= BUILDER_POOL_MAX };
}

/** Rows by id (the caller's own only — RLS). */
export async function listCollectionCardsById(ids: readonly string[]): Promise<CollectionCard[]> {
  if (ids.length === 0) return [];
  const supabase = await createClient();
  const { data, error } = await supabase.from("collection_cards").select(COLLECTION_CARD_COLUMNS).in("id", [...ids]);
  if (error) {
    console.error("[collection] rows read failed:", error.message);
    return [];
  }
  return ((data ?? []) as CollectionCardRow[]).map(collectionCardOf);
}

// ---------------------------------------------------------------------------
// Decks you can build
// ---------------------------------------------------------------------------

export type MissingCard = {
  name: string;
  quantity: number;
  imageUrl: string | null;
  scryfallId: string | null;
  commander: boolean;
};

export type BuildableDeck = {
  deckId: string;
  slug: string;
  title: string;
  ownerUsername: string | null;
  colorIdentity: string[];
  commanders: string[];
  ownsCommander: boolean;
  total: number;
  owned: number;
  missing: number;
  proxies: number;
  missingCards: MissingCard[];
  /** 0–100, rounded down (100 only when nothing is missing). */
  percent: number;
};

type BuildableRow = {
  deck_id: string;
  slug: string;
  title: string;
  owner_username: string | null;
  color_identity: string[] | null;
  commanders: string[] | null;
  owns_commander: boolean;
  total: number;
  owned: number;
  missing: number;
  proxies: number;
  missing_cards: unknown;
};

function missingCardsOf(value: unknown): MissingCard[] {
  if (!Array.isArray(value)) return [];
  return value.flatMap((item) => {
    if (!item || typeof item !== "object") return [];
    const row = item as Record<string, unknown>;
    if (typeof row.name !== "string") return [];
    const image = typeof row.image_url === "string" && isScryfallPrintingImage(row.image_url) ? row.image_url : null;
    return [
      {
        name: row.name,
        quantity: typeof row.quantity === "number" ? row.quantity : 1,
        imageUrl: image,
        scryfallId: typeof row.scryfall_id === "string" ? row.scryfall_id : null,
        commander: row.commander === true,
      },
    ];
  });
}

export function percentOwned(owned: number, total: number): number {
  if (total <= 0) return 0;
  if (owned >= total) return 100;
  return Math.min(99, Math.floor((owned / total) * 100));
}

export async function listBuildableDecks(limit = 60): Promise<BuildableDeck[]> {
  const supabase = await createClient();
  const { data, error } = await supabase.rpc("collection_buildable_decks", { p_limit: limit });
  if (error) {
    console.error("[collection] buildable decks read failed:", error.message);
    return [];
  }
  return ((data ?? []) as BuildableRow[]).map((row) => ({
    deckId: row.deck_id,
    slug: row.slug,
    title: row.title,
    ownerUsername: row.owner_username,
    colorIdentity: row.color_identity ?? [],
    commanders: row.commanders ?? [],
    ownsCommander: row.owns_commander,
    total: row.total,
    owned: row.owned,
    missing: row.missing,
    proxies: row.proxies,
    missingCards: missingCardsOf(row.missing_cards),
    percent: percentOwned(row.owned, row.total),
  }));
}
