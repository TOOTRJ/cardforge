import type { ScryfallCard, ScryfallCollectionIdentifier } from "@/lib/scryfall/client";
import { frontFaceName } from "@/lib/decks/parse-decklist";
import { typedForMatching } from "@/lib/validation/typed-forms";
import type { ImportLine } from "./parse-import";

// ---------------------------------------------------------------------------
// Matching an import's lines to Scryfall printings — pure, so the rules are
// tested without the network (Collection Deck Builder, migration 0185).
// The server sends the identifiers through the shared client's
// /cards/collection (75 a request, its throttle) and hands the answer back
// here. Scryfall answers in request order but DROPS misses, so everything
// is matched by content, never by position.
//
// Pass 1, the best identifier a line carries: its Scryfall id, else set +
// collector number, else name + set, else the name. A printing hit counts
// only when its NAME agrees with the line (a wrong collector number must
// never put a different card in someone's collection).
// Pass 2, for what pass 1 left: the name alone (a set code Scryfall doesn't
// know — MTGA's DAR for DOM — or a stale id), or the front face of a split
// name ("Fire/Ice").
// ---------------------------------------------------------------------------

type LineKeys = Pick<ImportLine, "name" | "setCode" | "collectorNumber" | "scryfallId">;

/** Names compared folded: case, curly quotes, accents and spacing. */
export function foldName(name: string): string {
  return typedForMatching(name)
    .normalize("NFD")
    .replace(/[̀-ͯ]/g, "")
    .toLowerCase()
    .replace(/\s+/g, " ")
    .trim();
}

export function firstPassIdentifier(line: LineKeys): ScryfallCollectionIdentifier {
  if (line.scryfallId) return { id: line.scryfallId };
  if (line.setCode && line.collectorNumber) return { set: line.setCode, collector_number: line.collectorNumber };
  if (line.setCode) return { name: line.name, set: line.setCode };
  return { name: line.name };
}

/** Pass 2's identifier for a line pass 1 missed, or null when it would ask
 *  the same thing again. */
export function fallbackIdentifier(line: LineKeys): ScryfallCollectionIdentifier | null {
  const front = frontFaceName(line.name);
  const first = firstPassIdentifier(line);
  if ("name" in first && !("set" in first)) {
    return front ? { name: front } : null;
  }
  return { name: front ?? line.name };
}

export function identifierKey(id: ScryfallCollectionIdentifier): string {
  if ("id" in id) return `i:${id.id.toLowerCase()}`;
  if ("collector_number" in id) return `p:${id.set.toLowerCase()}/${id.collector_number.toLowerCase()}`;
  if ("set" in id) return `s:${foldName(id.name)}|${id.set.toLowerCase()}`;
  return `n:${foldName(id.name)}`;
}

/** Identifiers with duplicates removed, in first-seen order. */
export function uniqueIdentifiers(ids: Array<ScryfallCollectionIdentifier | null>): ScryfallCollectionIdentifier[] {
  const seen = new Set<string>();
  const out: ScryfallCollectionIdentifier[] = [];
  for (const id of ids) {
    if (!id) continue;
    const key = identifierKey(id);
    if (seen.has(key)) continue;
    seen.add(key);
    out.push(id);
  }
  return out;
}

function namesOf(card: ScryfallCard): string[] {
  const names = new Set([foldName(card.name)]);
  const front = frontFaceName(card.name);
  if (front) names.add(foldName(front));
  for (const face of card.card_faces ?? []) if (face.name) names.add(foldName(face.name));
  if (card.flavor_name) names.add(foldName(card.flavor_name));
  return [...names];
}

export function cardAnswersToName(card: ScryfallCard, name: string): boolean {
  const names = namesOf(card);
  if (names.includes(foldName(name))) return true;
  const front = frontFaceName(name);
  return front ? names.includes(foldName(front)) : false;
}

export type CardIndex = {
  byId: Map<string, ScryfallCard>;
  byPrinting: Map<string, ScryfallCard>;
  byNameSet: Map<string, ScryfallCard>;
  byName: Map<string, ScryfallCard>;
};

export function indexCards(cards: readonly ScryfallCard[]): CardIndex {
  const index: CardIndex = { byId: new Map(), byPrinting: new Map(), byNameSet: new Map(), byName: new Map() };
  const put = (map: Map<string, ScryfallCard>, key: string, card: ScryfallCard) => {
    if (!map.has(key)) map.set(key, card);
  };
  for (const card of cards) {
    put(index.byId, card.id.toLowerCase(), card);
    const set = card.set?.toLowerCase();
    if (set && card.collector_number) put(index.byPrinting, `${set}/${card.collector_number.toLowerCase()}`, card);
    for (const name of namesOf(card)) {
      if (set) put(index.byNameSet, `${name}|${set}`, card);
      put(index.byName, name, card);
    }
  }
  return index;
}

export type LineMatch =
  | { ok: true; card: ScryfallCard }
  | { ok: false; reason: string };

/** The printing a line is, from what Scryfall answered — or why not. */
export function matchLine(line: LineKeys, index: CardIndex): LineMatch {
  if (line.scryfallId) {
    const byId = index.byId.get(line.scryfallId.toLowerCase());
    if (byId) return { ok: true, card: byId };
  }
  let wrongPrinting: ScryfallCard | null = null;
  if (line.setCode && line.collectorNumber) {
    const hit = index.byPrinting.get(`${line.setCode.toLowerCase()}/${line.collectorNumber.toLowerCase()}`);
    if (hit && cardAnswersToName(hit, line.name)) return { ok: true, card: hit };
    if (hit) wrongPrinting = hit;
  }
  const name = foldName(line.name);
  const front = frontFaceName(line.name);
  const frontKey = front ? foldName(front) : null;
  if (line.setCode) {
    const set = line.setCode.toLowerCase();
    const hit = index.byNameSet.get(`${name}|${set}`) ?? (frontKey ? index.byNameSet.get(`${frontKey}|${set}`) : undefined);
    if (hit) return { ok: true, card: hit };
  }
  const byName = index.byName.get(name) ?? (frontKey ? index.byName.get(frontKey) : undefined);
  if (byName) return { ok: true, card: byName };
  if (wrongPrinting) {
    return {
      ok: false,
      reason: `${line.setCode!.toUpperCase()} ${line.collectorNumber} is ${wrongPrinting.name}, not ${line.name}, and Scryfall has no card named ${line.name}.`,
    };
  }
  return { ok: false, reason: `Scryfall has no card named “${line.name}”.` };
}

/** Pick the finish a printing really comes in: the line's when it exists,
 *  else non-foil, else the printing's first. */
export function finishFor(card: ScryfallCard, wanted: ImportLine["finish"]): ImportLine["finish"] {
  const finishes = (card.finishes ?? []).filter(
    (f): f is ImportLine["finish"] => f === "nonfoil" || f === "foil" || f === "etched",
  );
  if (finishes.length === 0 || finishes.includes(wanted)) return wanted;
  return finishes.includes("nonfoil") ? "nonfoil" : finishes[0];
}
