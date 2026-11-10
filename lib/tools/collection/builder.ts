import type { CollectionCard } from "./card-row";
import { COMMANDER_DECK_SIZE } from "./limits";

// ---------------------------------------------------------------------------
// The Commander builder (Collection Deck Builder, migration 0185) — pure, so
// its choices are tested card for card. It drafts a deck around ONE
// commander from cards the user owns:
//
//   * Eligible: legal in Commander (Scryfall's legality — the banlist), a
//     colour identity inside the commander's, never the commander itself,
//     ONE copy of each card (any printing; basics apart).
//   * Shape: 36 lands (the user's non-basic lands that make the deck's
//     colours, then basics split by the spells' pips), and about 10 ramp,
//     10 card draw, 8 removal and 3 sweepers before the rest — the cards
//     that fit the commander's plan best (shared creature types, the same
//     themes in the text), on a curve that leans low.
//   * The AI build (lib/tools/collection/ai-build.ts) hands its PICKS here as
//     `preferred`: they go in first, in its order, and the same rules fill
//     or trim the rest — so an AI answer can never put in a card the user
//     doesn't own, a second copy, an off-colour or banned card, or more than
//     99 cards.
//
// A collection too thin to fill 99 is not padded with dozens of basics: the
// lands stop at LAND_TARGET + MAX_EXTRA_BASICS and the draft says how many
// cards it is short.
// ---------------------------------------------------------------------------

export type DeckRole = "land" | "ramp" | "draw" | "removal" | "wipe" | "core";

export const ROLE_ORDER: readonly DeckRole[] = ["core", "ramp", "draw", "removal", "wipe", "land"];

export const ROLE_LABELS: Record<DeckRole, string> = {
  core: "Game plan",
  ramp: "Ramp",
  draw: "Card draw",
  removal: "Removal",
  wipe: "Sweepers",
  land: "Lands",
};

export const ROLE_TARGETS = { ramp: 10, draw: 10, removal: 8, wipe: 3 } as const;
export const LAND_TARGET = 36;
/** Basics past the land target a thin collection may take before the draft
 *  stays short. */
export const MAX_EXTRA_BASICS = 4;

export type BasicLandName = "Plains" | "Island" | "Swamp" | "Mountain" | "Forest" | "Wastes";

/** A default printing of each basic (Dominaria United; Wastes: Oath of the
 *  Gatewatch) — a basic the user does not log is still in their box. */
export const DEFAULT_BASIC_PRINTINGS: Record<BasicLandName, { scryfallId: string; imageUrl: string }> = {
  Plains: {
    scryfallId: "5822b027-369d-46da-b6dd-c31207e2f449",
    imageUrl: "https://cards.scryfall.io/normal/front/5/8/5822b027-369d-46da-b6dd-c31207e2f449.jpg",
  },
  Island: {
    scryfallId: "8bafc217-3d83-4551-b2e3-3494ec14b2f9",
    imageUrl: "https://cards.scryfall.io/normal/front/8/b/8bafc217-3d83-4551-b2e3-3494ec14b2f9.jpg",
  },
  Swamp: {
    scryfallId: "5a846f00-ccb9-4ee2-8358-7c7722258601",
    imageUrl: "https://cards.scryfall.io/normal/front/5/a/5a846f00-ccb9-4ee2-8358-7c7722258601.jpg",
  },
  Mountain: {
    scryfallId: "a82f782e-abc8-4b92-a193-17b2c383f765",
    imageUrl: "https://cards.scryfall.io/normal/front/a/8/a82f782e-abc8-4b92-a193-17b2c383f765.jpg",
  },
  Forest: {
    scryfallId: "52097f6a-58d3-4176-b3bf-dc94f44adf30",
    imageUrl: "https://cards.scryfall.io/normal/front/5/2/52097f6a-58d3-4176-b3bf-dc94f44adf30.jpg",
  },
  Wastes: {
    scryfallId: "9cc070d3-4b83-4684-9caf-063e5c473a77",
    imageUrl: "https://cards.scryfall.io/normal/front/9/c/9cc070d3-4b83-4684-9caf-063e5c473a77.jpg",
  },
};

export const BASIC_FOR_COLOR: Record<string, BasicLandName> = {
  W: "Plains",
  U: "Island",
  B: "Swamp",
  R: "Mountain",
  G: "Forest",
};

const BASIC_NAMES = new Set(Object.keys(DEFAULT_BASIC_PRINTINGS).map((n) => n.toLowerCase()));

export type DraftPick = {
  cardId: string;
  scryfallId: string;
  name: string;
  role: DeckRole;
  manaValue: number | null;
  typeLine: string | null;
  manaCost: string | null;
  imageUrl: string | null;
  /** The AI's pick (vs the rules' fill). */
  fromAi?: boolean;
};

export type DraftBasic = { name: BasicLandName; count: number; scryfallId: string; imageUrl: string };

export type CommanderDraft = {
  commander: DraftPick;
  picks: DraftPick[];
  basics: DraftBasic[];
  /** The commander + picks + basics. */
  total: number;
  short: number;
  counts: Record<DeckRole, number>;
  /** Nonland mana values 0…7+ (index 7 = seven or more). */
  curve: number[];
  /** Eligible cards the draft had to choose from. */
  poolSize: number;
  warnings: string[];
  strategy: string | null;
};

// ---------------------------------------------------------------------------
// Reading a card
// ---------------------------------------------------------------------------

export function cardKey(name: string): string {
  return name.split(" // ")[0].trim().toLowerCase();
}

function frontType(card: Pick<CollectionCard, "typeLine">): string {
  return (card.typeLine ?? "").split(" // ")[0];
}

export function isLand(card: Pick<CollectionCard, "typeLine">): boolean {
  return /\bLand\b/.test(frontType(card));
}

export function isBasicLand(card: Pick<CollectionCard, "typeLine" | "name">): boolean {
  return /\bBasic\b/.test(frontType(card)) || BASIC_NAMES.has(cardKey(card.name));
}

const TEXT = (card: Pick<CollectionCard, "oracleText">) => (card.oracleText ?? "").replace(/\([^)]*\)/g, "");

const WIPE = /\b(destroy|exile) all\b|\beach (other )?creature\b[^.]*\b(gets? -|destroy|deals? \d)|\bdeals? (\d+|x) damage to each creature\b|\ball creatures get -/i;
const REMOVAL =
  /\b(destroy|exile) (another )?target\b|\bdeals? (\d+|x|that much) damage to (any target|target (creature|planeswalker|player or planeswalker))|\breturn target (nonland )?(creature|permanent)[^.]* to its owner'?s hand|\bcounter target\b|\bfights? (target|another)|\btarget (creature|player) (gets -|sacrifices)|\beach opponent sacrifices\b/i;
const RAMP =
  /\{T\}[^.]*: add\b|\badd (\{[WUBRGC]\}|one mana|two mana|three mana|\w+ mana of any)|\bsearch your library for (a|up to \w+|two) (basic )?lands?\b|\bput (a|up to \w+) lands? cards? [^.]*onto the battlefield|\byou may play an additional land\b/i;
const DRAW =
  /\bdraws? (a|an additional|two|three|four|x|that many|cards equal)\b|\bdraw (two|three|\w+) cards\b|\binvestigate\b|\blook at the top [^.]* put [^.]* into your hand|\bexile the top [^.]* you may play\b/i;

export function roleOf(card: Pick<CollectionCard, "typeLine" | "oracleText" | "name">): DeckRole {
  if (isLand(card)) return "land";
  const text = TEXT(card);
  if (WIPE.test(text)) return "wipe";
  if (REMOVAL.test(text)) return "removal";
  if (RAMP.test(text)) return "ramp";
  if (DRAW.test(text)) return "draw";
  return "core";
}

export function identityFits(card: Pick<CollectionCard, "colorIdentity">, commander: Pick<CollectionCard, "colorIdentity">): boolean {
  const allowed = new Set(commander.colorIdentity);
  return card.colorIdentity.every((c) => allowed.has(c));
}

/** Why a card can't be in this commander's deck, or null when it can. */
export function ineligibleReason(card: CollectionCard, commander: CollectionCard): string | null {
  if (!card.commanderLegal) return "isn't legal in Commander";
  if (!identityFits(card, commander)) return "is outside the commander's colours";
  if (cardKey(card.name) === cardKey(commander.name)) return "is the commander";
  return null;
}

export function commanderReason(card: CollectionCard): string | null {
  if (!card.canBeCommander) return "can't be a commander";
  if (!card.commanderLegal) return "isn't legal as a commander";
  return null;
}

// ---------------------------------------------------------------------------
// Fitting the commander's plan
// ---------------------------------------------------------------------------

const THEMES: Array<[string, RegExp]> = [
  ["tokens", /\bcreate[^.]*\btokens?\b|\btokens? you control\b/i],
  ["counters", /\+1\/\+1 counters?\b|\bproliferate\b/i],
  ["sacrifice", /\bsacrifices? (a|another|an)\b|\bwhenever [^.]* dies\b/i],
  ["graveyard", /\bfrom (your|a) graveyard\b|\bmill\b|\binto your graveyard\b|\bcards? in your graveyard\b/i],
  ["artifacts", /\bartifacts?\b/i],
  ["enchantments", /\benchantments?\b|\bauras?\b/i],
  ["spells", /\binstant or sorcery\b|\bnoncreature spell\b|\bwhenever you cast\b/i],
  ["lifegain", /\bgain(s)? (\d+ |x )?life\b|\blifelink\b/i],
  ["combat", /\bwhenever [^.]* attacks\b|\bcombat damage to a player\b|\bdouble strike\b|\bhaste\b/i],
  ["flying", /\bflying\b/i],
  ["landfall", /\bwhenever a land (you control )?enters\b|\blandfall\b/i],
  ["damage", /\bdeals? \d+ damage to each opponent\b|\beach opponent loses\b/i],
  ["draw", /\bwhenever you draw\b/i],
];

const CREATURE_TYPE_STOP = new Set(["legendary", "creature", "artifact", "enchantment", "god", "token"]);

export function commanderTribes(commander: Pick<CollectionCard, "typeLine" | "oracleText">): string[] {
  const subtypes = frontType(commander).split(/\s+[—-]\s+/)[1] ?? "";
  const words = subtypes.split(/\s+/).filter((w) => w && !CREATURE_TYPE_STOP.has(w.toLowerCase()));
  // A tribe the text names too ("other Goblins", "Elf spells").
  const text = TEXT(commander);
  return words.filter((w) => w.length > 2).concat(
    [...text.matchAll(/\b(?:other|each|target|another)\s+([A-Z][a-z]+)s?\b/g)]
      .map((m) => m[1])
      .filter((w) => !["Creature", "Player", "Opponent", "Permanent", "Spell", "Land", "Card"].includes(w)),
  );
}

export function commanderThemes(commander: Pick<CollectionCard, "oracleText">): string[] {
  const text = TEXT(commander);
  return THEMES.filter(([, re]) => re.test(text)).map(([name]) => name);
}

/** The plan themes a card's own text plays into — the same test the
 *  commander's themes use, read from the other side (the commander scores,
 *  lib/tools/collection/commander-scores.ts). */
export const cardThemes = commanderThemes;

/** A card's creature types, lower-cased ("Goblin Warrior" → goblin,
 *  warrior); none for a card that isn't a creature. */
export function creatureTypesOf(card: Pick<CollectionCard, "typeLine">): string[] {
  const front = frontType(card);
  if (!/\bCreature\b/.test(front)) return [];
  const subtypes = front.split(/\s+[—-]\s+/)[1] ?? "";
  return subtypes
    .split(/\s+/)
    .map((w) => w.toLowerCase())
    .filter((w) => w && !CREATURE_TYPE_STOP.has(w));
}

export function synergyScore(
  card: Pick<CollectionCard, "typeLine" | "oracleText" | "manaValue">,
  plan: { tribes: readonly string[]; themes: readonly string[] },
): number {
  const type = frontType(card);
  const text = TEXT(card);
  let score = 0;
  for (const tribe of plan.tribes) {
    const re = new RegExp(`\\b${tribe}s?\\b`, "i");
    if (re.test(type)) score += 4;
    else if (re.test(text)) score += 2;
  }
  for (const [name, re] of THEMES) {
    if (plan.themes.includes(name) && re.test(text)) score += 2;
  }
  if (/\bCreature\b/.test(type)) score += 1;
  const mv = card.manaValue ?? 0;
  if (mv >= 2 && mv <= 4) score += 1;
  if (mv >= 7) score -= 2;
  return score;
}

// ---------------------------------------------------------------------------
// The draft
// ---------------------------------------------------------------------------

const MANA_SYMBOL = /\{([WUBRG])(?:\/[WUBRGP])?\}/g;

function pipsOf(manaCost: string | null): Record<string, number> {
  const out: Record<string, number> = {};
  for (const m of (manaCost ?? "").matchAll(MANA_SYMBOL)) out[m[1]] = (out[m[1]] ?? 0) + 1;
  return out;
}

/** Whether a non-basic land makes one of the deck's colours (or any). */
function landHelps(card: CollectionCard, identity: readonly string[]): boolean {
  const text = TEXT(card);
  if (/\bany colou?r\b|\bany type\b|\bbasic land card\b/i.test(text)) return true;
  if (identity.some((c) => new RegExp(`\\{${c}\\}`).test(text))) return true;
  // A colourless deck takes every land it may.
  return identity.length === 0;
}

function toPick(card: CollectionCard, role: DeckRole, fromAi = false): DraftPick {
  return {
    cardId: card.id,
    scryfallId: card.scryfallId,
    name: card.name,
    role,
    manaValue: card.manaValue,
    typeLine: card.typeLine,
    manaCost: card.manaCost,
    imageUrl: card.imageUrl,
    ...(fromAi ? { fromAi: true } : {}),
  };
}

/** One row per card name (any printing): the one with the most copies, then
 *  the lowest id, so the draft is the same every time. */
export function uniqueByCard(cards: readonly CollectionCard[]): CollectionCard[] {
  const best = new Map<string, CollectionCard>();
  for (const card of cards) {
    const key = cardKey(card.name);
    const held = best.get(key);
    if (!held || card.quantity > held.quantity || (card.quantity === held.quantity && card.id < held.id)) {
      best.set(key, card);
    }
  }
  return [...best.values()];
}

/** The cards this commander's deck may hold, best first for the rules' fill. */
export function eligiblePool(commander: CollectionCard, collection: readonly CollectionCard[]): CollectionCard[] {
  const tribes = commanderTribes(commander);
  const themes = commanderThemes(commander);
  return uniqueByCard(collection)
    .filter((card) => !isBasicLand(card) && ineligibleReason(card, commander) === null)
    .map((card) => ({ card, score: synergyScore(card, { tribes, themes }) }))
    .sort(
      (a, b) =>
        b.score - a.score ||
        (a.card.manaValue ?? 0) - (b.card.manaValue ?? 0) ||
        a.card.name.localeCompare(b.card.name),
    )
    .map(({ card }) => card);
}

export function draftCommanderDeck(input: {
  commander: CollectionCard;
  collection: readonly CollectionCard[];
  /** Collection row ids the AI chose, best first. Unknown or ineligible ids
   *  are dropped. */
  preferred?: readonly string[];
  strategy?: string | null;
}): CommanderDraft {
  const { commander } = input;
  const identity = commander.colorIdentity;
  const pool = eligiblePool(commander, input.collection);
  const byId = new Map(pool.map((c) => [c.id, c]));
  // Any printing of a card the pool holds answers for it (the AI may name a
  // second printing's row).
  const poolByKey = new Map(pool.map((c) => [cardKey(c.name), c]));
  const rowById = new Map(input.collection.map((c) => [c.id, c]));

  const chosen: DraftPick[] = [];
  const taken = new Set<string>();
  const take = (card: CollectionCard, fromAi = false) => {
    const key = cardKey(card.name);
    if (taken.has(key)) return false;
    taken.add(key);
    chosen.push(toPick(card, roleOf(card), fromAi));
    return true;
  };

  const nonlandTarget = COMMANDER_DECK_SIZE - 1 - LAND_TARGET;
  const nonlands = () => chosen.filter((p) => p.role !== "land").length;
  const lands = () => chosen.filter((p) => p.role === "land").length;

  // 1. The AI's picks, in its order (each held to the same rules).
  for (const id of input.preferred ?? []) {
    const row = rowById.get(id);
    const card = byId.get(id) ?? (row ? poolByKey.get(cardKey(row.name)) : undefined);
    if (!card) continue;
    const land = isLand(card);
    if (land ? lands() >= LAND_TARGET : nonlands() >= nonlandTarget) continue;
    take(card, true);
  }

  // 2. The role quotas, then the plan, from the rules' ranking.
  const spells = pool.filter((c) => !isLand(c));
  for (const role of ["ramp", "draw", "removal", "wipe"] as const) {
    const have = () => chosen.filter((p) => p.role === role).length;
    const ranked = spells
      .filter((c) => roleOf(c) === role)
      .sort((a, b) => (role === "ramp" ? (a.manaValue ?? 0) - (b.manaValue ?? 0) : 0));
    for (const card of ranked) {
      if (have() >= ROLE_TARGETS[role] || nonlands() >= nonlandTarget) break;
      take(card);
    }
  }
  for (const card of spells) {
    if (nonlands() >= nonlandTarget) break;
    take(card);
  }

  // 3. Lands: the user's non-basics that help, then basics by pips.
  const helpful = pool.filter((c) => isLand(c) && landHelps(c, identity));
  const utility = pool.filter((c) => isLand(c) && !landHelps(c, identity));
  for (const card of [...helpful, ...utility]) {
    if (lands() >= LAND_TARGET) break;
    take(card);
  }

  const spellsShort = Math.max(0, nonlandTarget - nonlands());
  const basicsWanted = Math.max(0, LAND_TARGET - lands()) + Math.min(MAX_EXTRA_BASICS, spellsShort);
  const basics = splitBasics(basicsWanted, identity, chosen);

  const basicCount = basics.reduce((sum, b) => sum + b.count, 0);
  const total = 1 + chosen.length + basicCount;
  const counts = Object.fromEntries(ROLE_ORDER.map((r) => [r, 0])) as Record<DeckRole, number>;
  for (const pick of chosen) counts[pick.role] += 1;
  counts.land += basicCount;
  const curve = Array.from({ length: 8 }, () => 0);
  for (const pick of chosen) {
    if (pick.role === "land") continue;
    curve[Math.min(7, Math.max(0, Math.floor(pick.manaValue ?? 0)))] += 1;
  }

  const warnings: string[] = [];
  const short = Math.max(0, COMMANDER_DECK_SIZE - total);
  if (short > 0) {
    warnings.push(
      `Your collection has ${pool.length} card${pool.length === 1 ? "" : "s"} (besides basics) that fit ${commander.name}'s colours, so the deck is ${short} card${short === 1 ? "" : "s"} short of ${COMMANDER_DECK_SIZE}. Add more to your collection, or fill the gaps in the deck later.`,
    );
  }
  for (const role of ["ramp", "draw", "removal"] as const) {
    if (counts[role] < Math.ceil(ROLE_TARGETS[role] / 2)) {
      warnings.push(`Only ${counts[role]} ${ROLE_LABELS[role].toLowerCase()} card${counts[role] === 1 ? "" : "s"} — most decks want about ${ROLE_TARGETS[role]}.`);
    }
  }

  return {
    commander: toPick(commander, "core"),
    picks: chosen,
    basics,
    total,
    short,
    counts,
    curve,
    poolSize: pool.length,
    warnings,
    strategy: input.strategy?.trim() || null,
  };
}

/** `count` basics split by the colour pips of the chosen spells (at least
 *  one of each colour the deck plays); a colourless deck plays Wastes. */
export function splitBasics(count: number, identity: readonly string[], picks: readonly DraftPick[]): DraftBasic[] {
  if (count <= 0) return [];
  const colours = identity.filter((c) => BASIC_FOR_COLOR[c]);
  if (colours.length === 0) {
    return [{ name: "Wastes", count, ...DEFAULT_BASIC_PRINTINGS.Wastes }];
  }
  const pips: Record<string, number> = Object.fromEntries(colours.map((c) => [c, 1]));
  for (const pick of picks) {
    for (const [c, n] of Object.entries(pipsOf(pick.manaCost))) if (c in pips) pips[c] += n;
  }
  const totalPips = Object.values(pips).reduce((a, b) => a + b, 0);
  const shares = colours.map((c) => ({ c, exact: (count * pips[c]) / totalPips }));
  const out = shares.map((s) => ({ c: s.c, n: Math.floor(s.exact) }));
  let left = count - out.reduce((a, b) => a + b.n, 0);
  for (const s of [...shares].sort((a, b) => (b.exact % 1) - (a.exact % 1) || a.c.localeCompare(b.c))) {
    if (left <= 0) break;
    out.find((o) => o.c === s.c)!.n += 1;
    left -= 1;
  }
  return out
    .filter((o) => o.n > 0)
    .map((o) => {
      const name = BASIC_FOR_COLOR[o.c];
      return { name, count: o.n, ...DEFAULT_BASIC_PRINTINGS[name] };
    });
}
