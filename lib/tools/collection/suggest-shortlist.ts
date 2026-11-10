import type { CollectionCard } from "./card-row";
import { cardKey, cardThemes, isBasicLand, isLand, roleOf, ROLE_TARGETS } from "./builder";
import {
  COLLECTION_DECK_TYPES,
  cardCreatureTypes,
  collectionDeckType,
  isChangeling,
  type CollectionDeckTypeId,
} from "./archetypes";
import { identityMask, rankCommanders, scoringPlan, type CommanderSupport, type ScoringCard } from "./commander-scores";

// ---------------------------------------------------------------------------
// "Suggest a commander" — the part the CODE does (pure, tested): which of
// the user's commanders the AI is shown, and which of their cards it may
// cite for each (owner decision 2026-11-09, the report's change 4).
//
//   1. Every owned, Commander-legal commander is scored by the free scores
//      (commander-scores.ts) — or, with a deck type preferred, by how many
//      of that type's cards sit in its colours first.
//   2. The best ~30 make the shortlist, at most SUGGEST_PER_IDENTITY from
//      one colour identity, so the answer can range across colours.
//   3. Each gets up to SUGGEST_SUPPORT_CARDS of the user's own cards that
//      play into its plan (its themes, the creature types its text names,
//      the preferred deck type), each under one id ("c12") shared across
//      the shortlist — the only cards the answer may cite.
//
// The model ranks and explains; every number the page shows is the code's.
// ---------------------------------------------------------------------------

export const SUGGEST_SHORTLIST = 30;
export const SUGGEST_PER_IDENTITY = 6;
export const SUGGEST_SUPPORT_CARDS = 12;
/** Fewer legal commanders than this and there is nothing to rank: the route
 *  refuses before any charge. */
export const SUGGEST_MIN_COMMANDERS = 3;

export type SuggestPreferences = {
  deckType?: CollectionDeckTypeId | null;
  bracket?: number | null;
  /** Colours the player would like (W U B R G, C = colourless): a commander
   *  is kept when its identity holds one of them. */
  colours?: readonly string[];
};

export type SupportCard = {
  /** The prompt's id ("c12"). */
  ref: string;
  /** The collection row. */
  id: string;
  name: string;
  line: string;
};

export type ShortlistEntry = {
  /** The prompt's id ("k3"). */
  ref: string;
  commander: Pick<CollectionCard, "id" | "name" | "manaCost" | "typeLine" | "oracleText" | "colorIdentity" | "imageUrl">;
  support: CommanderSupport;
  cards: SupportCard[];
};

type Prepared = {
  id: string;
  key: string;
  name: string;
  mask: number;
  themes: readonly string[];
  types: readonly string[];
  changeling: boolean;
  deckTypes: ReadonlySet<CollectionDeckTypeId>;
  line: string;
};

function oneLine(text: string | null | undefined, max: number): string {
  return (text ?? "").replace(/\s+/g, " ").trim().slice(0, max);
}

const identityKey = (identity: readonly string[]) => [...identity].sort().join("") || "C";

function colourMatch(identity: readonly string[], colours: readonly string[] | undefined): boolean {
  if (!colours || colours.length === 0) return true;
  if (colours.includes("C") && identity.length === 0) return true;
  return colours.some((c) => c !== "C" && identity.includes(c));
}

function prepare(cards: readonly ScoringCard[]): Prepared[] {
  const seen = new Set<string>();
  const out: Prepared[] = [];
  for (const card of cards) {
    if (!card.id || !card.commanderLegal || isBasicLand(card)) continue;
    const key = cardKey(card.name);
    if (seen.has(key)) continue;
    seen.add(key);
    const land = isLand(card);
    const role = roleOf(card);
    const themes = land ? [] : cardThemes(card);
    out.push({
      id: card.id,
      key,
      name: card.name,
      mask: identityMask(card.colorIdentity),
      themes,
      types: cardCreatureTypes(card),
      changeling: isChangeling(card),
      deckTypes: new Set(COLLECTION_DECK_TYPES.filter((t) => t.matches(card)).map((t) => t.id)),
      line: [
        oneLine(card.name, 60),
        oneLine(card.typeLine, 50),
        `role: ${role === "core" ? "—" : role}`,
        oneLine(card.oracleText, 120),
      ].join(" | "),
    });
  }
  return out;
}

/** The commanders the AI is shown, best first, each with its support. */
export function suggestShortlist(input: {
  commanders: readonly ShortlistEntry["commander"][];
  cards: readonly ScoringCard[];
  preferences?: SuggestPreferences;
}): ShortlistEntry[] {
  const prefs = input.preferences ?? {};
  const preferredType = collectionDeckType(prefs.deckType);
  const scores = rankCommanders(input.commanders, input.cards);
  const onType = (id: string) => (preferredType ? (scores[id]?.deckTypes[preferredType.id] ?? 0) : 0);
  const ranked = input.commanders
    .filter((c) => scores[c.id] && colourMatch(c.colorIdentity, prefs.colours))
    .sort(
      (a, b) =>
        onType(b.id) - onType(a.id) ||
        scores[b.id].score - scores[a.id].score ||
        scores[b.id].inColours - scores[a.id].inColours ||
        a.name.localeCompare(b.name),
    );

  const perIdentity = new Map<string, number>();
  const chosen: ShortlistEntry["commander"][] = [];
  for (const commander of ranked) {
    if (chosen.length >= SUGGEST_SHORTLIST) break;
    const key = identityKey(commander.colorIdentity);
    const held = perIdentity.get(key) ?? 0;
    if (held >= SUGGEST_PER_IDENTITY) continue;
    perIdentity.set(key, held + 1);
    chosen.push(commander);
  }

  const prepared = prepare(input.cards);
  const refs = new Map<string, string>();
  const refOf = (id: string) => {
    let ref = refs.get(id);
    if (!ref) {
      ref = `c${refs.size}`;
      refs.set(id, ref);
    }
    return ref;
  };

  return chosen.map((commander, i) => {
    const mask = identityMask(commander.colorIdentity);
    const own = cardKey(commander.name);
    const plan = scoringPlan(commander);
    const tribes = new Set(plan.tribes);
    const scored = prepared
      .filter((card) => (card.mask & ~mask) === 0 && card.key !== own)
      .map((card) => {
        let score = 0;
        if (card.themes.some((t) => plan.themes.has(t))) score += 2;
        if (tribes.size && (card.changeling || card.types.some((t) => tribes.has(t)))) score += 3;
        if (preferredType && card.deckTypes.has(preferredType.id)) score += 3;
        return { card, score };
      })
      .filter((entry) => entry.score > 0)
      .sort((a, b) => b.score - a.score || a.card.name.localeCompare(b.card.name))
      .slice(0, SUGGEST_SUPPORT_CARDS);
    return {
      ref: `k${i}`,
      commander,
      support: scores[commander.id],
      cards: scored.map(({ card }) => ({ ref: refOf(card.id), id: card.id, name: card.name, line: card.line })),
    };
  });
}

/** A short read of the whole collection for the prompt: cards by colour
 *  identity and by deck type (the five most held). */
export function collectionSummary(cards: readonly ScoringCard[]): string {
  const prepared = prepare(cards);
  const byColour = new Map<string, number>();
  const byType = new Map<CollectionDeckTypeId, number>();
  for (const card of prepared) {
    const colours = ["W", "U", "B", "R", "G"].filter((c, i) => card.mask & (1 << i));
    const key = colours.length === 0 ? "colourless" : colours.length > 1 ? "multicolour" : colours[0];
    byColour.set(key, (byColour.get(key) ?? 0) + 1);
    for (const t of card.deckTypes) byType.set(t, (byType.get(t) ?? 0) + 1);
  }
  const colours = [...byColour.entries()].sort((a, b) => b[1] - a[1]).map(([k, v]) => `${k} ${v}`);
  const types = [...byType.entries()]
    .sort((a, b) => b[1] - a[1])
    .slice(0, 5)
    .map(([k, v]) => `${collectionDeckType(k)?.label ?? k} ${v}`);
  return [
    `${prepared.length} different cards legal in Commander (basics aside).`,
    `By colour: ${colours.join(", ") || "none"}.`,
    `Most-held deck types: ${types.join(", ") || "none"}.`,
  ].join(" ");
}

/** The numbers a shortlisted commander carries in the prompt (the code's). */
export function supportLine(support: CommanderSupport): string {
  const types = (Object.entries(support.deckTypes) as Array<[CollectionDeckTypeId, number]>)
    .sort((a, b) => b[1] - a[1])
    .slice(0, 3)
    .map(([id, n]) => `${collectionDeckType(id)?.label ?? id} ${n}`);
  return [
    `your cards in its colours: ${support.inColours}`,
    `fit its plan: ${support.fit}`,
    `ramp ${support.roles.ramp}/${ROLE_TARGETS.ramp}`,
    `card draw ${support.roles.draw}/${ROLE_TARGETS.draw}`,
    `removal ${support.roles.removal}/${ROLE_TARGETS.removal}`,
    `sweepers ${support.roles.wipe}/${ROLE_TARGETS.wipe}`,
    types.length ? `deck types: ${types.join(", ")}` : null,
  ]
    .filter(Boolean)
    .join(" · ");
}
