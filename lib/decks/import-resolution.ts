import type {
  ScryfallCard,
  ScryfallCollectionIdentifier,
} from "@/lib/scryfall/client";
import type { ParsedEntry } from "@/lib/decks/parse-decklist";
import { frontFaceName } from "@/lib/decks/parse-decklist";

// ---------------------------------------------------------------------------
// Pure reconciliation logic for the decklist importer — separated from the
// server action so the batching/matching rules are unit-testable without
// network. Scryfall's /cards/collection returns hits in request order but
// SILENTLY DROPS misses from `data`, so everything here keys off identifier
// content, never array position.
// ---------------------------------------------------------------------------

/** The subset of Scryfall card data a deck entry denormalizes. */
export type ResolvedCardData = {
  scryfall_id: string;
  name: string;
  set_code: string | null;
  collector_number: string | null;
  type_line: string | null;
  mana_cost: string | null;
  mana_value: number | null;
  color_identity: string[];
  rarity: string | null;
  image_url: string | null;
};

const WUBRG = new Set(["W", "U", "B", "R", "G"]);

export function toResolvedCardData(card: ScryfallCard): ResolvedCardData {
  const face = card.card_faces?.[0] ?? null;
  const image =
    card.image_uris?.normal ??
    card.image_uris?.large ??
    face?.image_uris?.normal ??
    face?.image_uris?.large ??
    null;
  return {
    scryfall_id: card.id,
    name: card.name,
    set_code: card.set ?? null,
    collector_number: card.collector_number ?? null,
    type_line: card.type_line ?? face?.type_line ?? null,
    mana_cost: card.mana_cost ?? face?.mana_cost ?? null,
    mana_value: typeof card.cmc === "number" ? card.cmc : null,
    color_identity: (card.color_identity ?? []).filter((c) => WUBRG.has(c)),
    rarity: card.rarity ?? null,
    image_url: image,
  };
}

/** Preferred identifier for a parsed entry: exact printing when the line
 *  carried set + collector number, otherwise name (newest printing). */
export function identifierFor(
  entry: Pick<ParsedEntry, "name" | "setCode" | "collectorNumber">,
): ScryfallCollectionIdentifier {
  if (entry.setCode && entry.collectorNumber) {
    return { set: entry.setCode, collector_number: entry.collectorNumber };
  }
  if (entry.setCode) {
    return { name: entry.name, set: entry.setCode };
  }
  return { name: entry.name };
}

export function chunkIdentifiers<T>(items: T[], size: number): T[][] {
  const chunks: T[][] = [];
  for (let i = 0; i < items.length; i += size) {
    chunks.push(items.slice(i, i + size));
  }
  return chunks;
}

/** Canonical match keys a returned card answers to: full name, front-face
 *  name, and (set, collector_number). */
function cardMatchKeys(card: ScryfallCard): string[] {
  const keys: string[] = [`n:${card.name.toLowerCase()}`];
  const front = frontFaceName(card.name);
  if (front) keys.push(`n:${front.toLowerCase()}`);
  if (card.set && card.collector_number) {
    keys.push(`p:${card.set.toLowerCase()}/${card.collector_number.toLowerCase()}`);
  }
  return keys;
}

function identifierMatchKey(id: ScryfallCollectionIdentifier): string {
  if ("collector_number" in id) {
    return `p:${id.set.toLowerCase()}/${id.collector_number.toLowerCase()}`;
  }
  if ("name" in id) {
    return `n:${id.name.toLowerCase()}`;
  }
  return `i:${id.id.toLowerCase()}`;
}

/**
 * Match collection results back to the identifiers that requested them.
 * Returns a lookup keyed by identifierMatchKey plus the identifiers that
 * remain unresolved.
 */
export function reconcileCollection(
  requested: ScryfallCollectionIdentifier[],
  cards: ScryfallCard[],
): {
  byKey: Map<string, ScryfallCard>;
  unresolved: ScryfallCollectionIdentifier[];
} {
  const byKey = new Map<string, ScryfallCard>();
  for (const card of cards) {
    for (const key of cardMatchKeys(card)) {
      if (!byKey.has(key)) byKey.set(key, card);
    }
  }
  const unresolved = requested.filter(
    (id) => !byKey.has(identifierMatchKey(id)),
  );
  return { byKey, unresolved };
}

/** Find the resolved card for one entry (tries exact key, then the
 *  front-face name for "Fire // Ice"-style lines). */
export function lookupEntry(
  byKey: Map<string, ScryfallCard>,
  entry: Pick<ParsedEntry, "name" | "setCode" | "collectorNumber">,
): ScryfallCard | null {
  const direct = byKey.get(identifierMatchKey(identifierFor(entry)));
  if (direct) return direct;
  const byName = byKey.get(`n:${entry.name.toLowerCase()}`);
  if (byName) return byName;
  const front = frontFaceName(entry.name);
  if (front) {
    const byFront = byKey.get(`n:${front.toLowerCase()}`);
    if (byFront) return byFront;
  }
  return null;
}

/** Name-only fallback identifiers for entries whose first request missed:
 *  printings with bad/renamed set codes (Arena's DAR vs Scryfall's DOM)
 *  retry as a bare name; name-only "Fire/Ice"-style misses retry as the
 *  front-face name. */
export function nameFallbackIdentifiers(
  entries: Array<Pick<ParsedEntry, "name" | "setCode" | "collectorNumber">>,
  byKey: Map<string, ScryfallCard>,
): ScryfallCollectionIdentifier[] {
  const seen = new Set<string>();
  const fallbacks: ScryfallCollectionIdentifier[] = [];
  for (const entry of entries) {
    if (lookupEntry(byKey, entry)) continue;
    const front = frontFaceName(entry.name);
    const hadPrinting = Boolean(entry.setCode);
    // Name-only requests already went out once — only retry those when a
    // front-face variant gives us a genuinely different name to try.
    if (!hadPrinting && !front) continue;
    const name = hadPrinting ? (front ?? entry.name) : front!;
    const key = name.toLowerCase();
    if (seen.has(key)) continue;
    seen.add(key);
    fallbacks.push({ name });
  }
  return fallbacks;
}
