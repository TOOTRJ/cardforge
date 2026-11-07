import "server-only";

import { AsyncLocalStorage } from "node:async_hooks";
import { createHash } from "node:crypto";
import { unstable_cache } from "next/cache";
import { getCardCollection, SCRYFALL_COLLECTION_MAX, type ScryfallCard, type ScryfallCollectionIdentifier } from "@/lib/scryfall/client";
import { chunkIds } from "@/lib/supabase/select-all-rows";
import { cardTokenTexts, tokenPartsOf, type TokenPart } from "@/lib/decks/deck-tokens";
import { frontFaceName, parseDecklist } from "@/lib/decks/parse-decklist";
import type { DeckItem } from "@/lib/decks/queries";
import { buildKitItems, kitFacesFromPrinting, type KitItem, type KitMaker } from "@/lib/tools/token-kit/collect";
import type { KitFace } from "@/lib/tools/token-kit/model";

// ---------------------------------------------------------------------------
// The Token Kit's lookups (lib/tools/token-kit/collect.ts), server side:
// Scryfall through the shared client's batch lookup (POST /cards/collection,
// 75 a call, the client's own spacing), each call held to
// KIT_CALL_TIMEOUT_MS. Two lookups, each held in Next's data cache like the
// deck page's tokens (lib/decks/deck-tokens-server.ts — a success a day, a
// failure a few minutes), so every kit of the same cards shares them:
//   1. the deck's REAL cards — by printing id, or by name (a pasted list, a
//      deck entry with no printing): their words and their related objects;
//   2. the TOKEN printings those name: what each token is (all_parts names
//      only a name and a type line).
// Every reach to Scryfall is counted (`calls`) so the action logs it on the
// maker (logScryfallCall `deck_tokens`, the deck page's label and limits).
// Never a scan or an image: kit pictures are the maker's own.
// ---------------------------------------------------------------------------

export const KIT_CACHE_SECONDS = 86_400;
export const KIT_FAILURE_CACHE_SECONDS = 300;
export const KIT_CALL_TIMEOUT_MS = 8_000;
export const KIT_CACHE_TAG = "token-kit-lookups";

/** At most this many distinct cards are read from one source. */
export const KIT_MAX_CARDS = 300;

/** What the kit keeps of a real card. */
type RealCard = { id: string; name: string; texts: string[]; parts: TokenPart[] };

type CardsLookup = { ok: true; cards: Record<string, RealCard> } | { ok: false };
type PrintingsLookup = { ok: true; faces: Record<string, KitFace[]> } | { ok: false };

/** Counts the Scryfall calls THIS request's lookups made (a cache hit makes
 *  none). */
const requestCalls = new AsyncLocalStorage<{ calls: number }>();

function realCardOf(card: ScryfallCard): RealCard {
  const texts = [card.oracle_text ?? "", ...(card.card_faces ?? []).map((face) => face.oracle_text ?? "")].filter(Boolean);
  return { id: card.id, name: card.name, texts, parts: tokenPartsOf(card) };
}

async function collection(identifiers: ScryfallCollectionIdentifier[]): Promise<ScryfallCard[] | null> {
  const out: ScryfallCard[] = [];
  for (let i = 0; i < identifiers.length; i += SCRYFALL_COLLECTION_MAX) {
    const counter = requestCalls.getStore();
    if (counter) counter.calls += 1;
    let result: Awaited<ReturnType<typeof getCardCollection>>;
    try {
      result = await getCardCollection(identifiers.slice(i, i + SCRYFALL_COLLECTION_MAX), { timeoutMs: KIT_CALL_TIMEOUT_MS });
    } catch {
      return null;
    }
    if (!result) return null;
    out.push(...result.cards);
  }
  return out;
}

/** The real cards for `keys` (`i:<id>` / `n:<name>`), each under every key
 *  it answers (its id, its name, its front face's name). */
async function lookUpCards(keys: readonly string[]): Promise<CardsLookup> {
  const identifiers: ScryfallCollectionIdentifier[] = keys.map((key) =>
    key.startsWith("i:") ? { id: key.slice(2) } : { name: key.slice(2) },
  );
  const cards = await collection(identifiers);
  if (!cards) return { ok: false };
  const out: Record<string, RealCard> = {};
  for (const card of cards) {
    const real = realCardOf(card);
    const answers = [`i:${card.id.toLowerCase()}`, `n:${card.name.toLowerCase()}`];
    const front = frontFaceName(card.name);
    if (front) answers.push(`n:${front.toLowerCase()}`);
    for (const key of answers) if (keys.includes(key) && !out[key]) out[key] = real;
  }
  return { ok: true, cards: out };
}

async function lookUpPrintings(ids: readonly string[]): Promise<PrintingsLookup> {
  const out: Record<string, KitFace[]> = {};
  for (const chunk of chunkIds([...ids], SCRYFALL_COLLECTION_MAX)) {
    const cards = await collection(chunk.map((id) => ({ id })));
    if (!cards) return { ok: false };
    for (const card of cards) out[card.id] = kitFacesFromPrinting(card);
  }
  return { ok: true, faces: out };
}

/** A success a day; a failure a few minutes (the deck page's two entries). */
function cachedPair<T extends { ok: boolean }, A extends readonly string[]>(
  run: (keys: A) => Promise<T>,
  name: string,
): (keys: A) => Promise<Exclude<T, { ok: false }>> {
  let built: ((keys: A) => Promise<Exclude<T, { ok: false }>>) | null = null;
  return (keys: A) => {
    if (!built) {
      const recent = unstable_cache(run, [`${name}-recent-v1`], { revalidate: KIT_FAILURE_CACHE_SECONDS, tags: [KIT_CACHE_TAG] });
      built = unstable_cache(
        async (inner: A) => {
          const answer = await recent(inner);
          if (!answer.ok) throw new Error("scryfall_collection_failed");
          return answer as Exclude<T, { ok: false }>;
        },
        [`${name}-daily-v1`],
        { revalidate: KIT_CACHE_SECONDS, tags: [KIT_CACHE_TAG] },
      );
    }
    return built(keys);
  };
}

const cachedCards = cachedPair(lookUpCards, "token-kit-cards");
const cachedPrintings = cachedPair(lookUpPrintings, "token-kit-printings");

// ---------------------------------------------------------------------------
// Sources
// ---------------------------------------------------------------------------

/** One line of a source, before it is read. */
export type KitSourceLine = {
  name: string;
  quantity: number;
  board: string;
  scryfallId: string | null;
  /** A PipGlyph card's words (a deck entry's own card), else null: the line
   *  is a real card, read from Scryfall. */
  card: { title: string; rules_text?: string | null; face_content?: unknown; back_face?: unknown } | null;
};

/** A deck's entries as kit lines: the played boards (never the
 *  maybeboard); a PipGlyph card's own words win over its printing (a proxy
 *  makes what ITS text says). */
export function kitLinesOfDeck(items: readonly DeckItem[]): KitSourceLine[] {
  return items
    .filter((item) => item.entry.board !== "maybe" && item.entry.quantity > 0)
    .map((item) => ({
      name: item.card?.title ?? item.entry.name,
      quantity: item.entry.quantity,
      board: item.entry.board,
      scryfallId: item.card ? null : item.entry.scryfall_id,
      card: item.card
        ? { title: item.card.title, rules_text: item.card.rules_text, face_content: item.card.face_content, back_face: item.card.back_face }
        : null,
    }));
}

/** A pasted list's lines (parseDecklist: every format the deck import
 *  reads), the maybeboard left out. */
export function kitLinesOfList(text: string): { lines: KitSourceLine[]; warnings: number } {
  const parsed = parseDecklist(text);
  return {
    lines: parsed.entries
      .filter((entry) => entry.board !== "maybe")
      .map((entry) => ({ name: entry.name, quantity: entry.quantity, board: entry.board, scryfallId: null, card: null })),
    warnings: parsed.warnings.length,
  };
}

/** The ONE key a pasted list's kit is saved under: its lines' names and
 *  counts, folded (a re-paste of the same list reopens the same kit). */
export function listSourceKey(lines: readonly KitSourceLine[]): string {
  const canonical = lines
    .map((line) => `${line.quantity} ${line.name.trim().toLowerCase()}`)
    .sort()
    .join("\n");
  return `list:${createHash("sha256").update(canonical).digest("hex").slice(0, 32)}`;
}

export type BuiltKit = {
  items: KitItem[];
  /** Lines whose card Scryfall didn't find. */
  notFound: string[];
  /** Token printings that didn't come back. */
  missing: number;
  doublers: string[];
  /** The source's cards that make anything. */
  makerCount: number;
  /** The real cards' lookup failed (an outage): only PipGlyph cards read. */
  realCardsFailed: boolean;
  /** Scryfall calls this build made (0 = every answer was cached). */
  calls: number;
};

/**
 * The kit's items for a source's lines: the real cards through Scryfall (a
 * line with a printing by id, else by name), their token printings, and the
 * PipGlyph cards' own words — then one list (buildKitItems).
 */
export async function buildKitFromLines(lines: readonly KitSourceLine[]): Promise<BuiltKit> {
  const counter = { calls: 0 };
  return requestCalls.run(counter, async () => {
    const realLines = lines.filter((line) => !line.card).slice(0, KIT_MAX_CARDS);
    const keys = [
      ...new Set(realLines.map((line) => (line.scryfallId ? `i:${line.scryfallId.toLowerCase()}` : `n:${line.name.trim().toLowerCase()}`))),
    ].sort();
    let cards: Record<string, RealCard> = {};
    let realCardsFailed = false;
    if (keys.length > 0) {
      try {
        cards = (await cachedCards(keys)).cards;
      } catch {
        realCardsFailed = true;
      }
    }
    const notFound: string[] = [];
    const makers: KitMaker[] = [];
    for (const line of lines) {
      const commander = line.board === "commander" || line.board === "companion";
      if (line.card) {
        makers.push({ name: line.card.title, quantity: line.quantity, commander, texts: cardTokenTexts(line.card), parts: null });
        continue;
      }
      const key = line.scryfallId ? `i:${line.scryfallId.toLowerCase()}` : `n:${line.name.trim().toLowerCase()}`;
      const real = cards[key];
      if (!real) {
        if (!realCardsFailed) notFound.push(line.name);
        continue;
      }
      makers.push({ name: real.name, quantity: line.quantity, commander, texts: real.texts, parts: real.parts });
    }
    const partIds = [...new Set(makers.flatMap((maker) => maker.parts?.map((part) => part.id.toLowerCase()) ?? []))].sort();
    let faces: Record<string, KitFace[]> = {};
    if (partIds.length > 0) {
      try {
        faces = (await cachedPrintings(partIds)).faces;
      } catch {
        realCardsFailed = true;
      }
    }
    const { items, missing, doublers } = buildKitItems(makers, faces);
    return {
      items,
      notFound: [...new Set(notFound)].slice(0, 50),
      missing,
      doublers,
      makerCount: new Set(items.flatMap((item) => item.makers)).size,
      realCardsFailed,
      calls: counter.calls,
    };
  });
}
