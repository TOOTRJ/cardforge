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
  /** The AI's one-line reason for its pick. */
  aiWhy?: string;
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
  /** What the draft was built around (a deck type, a creature type), with
   *  how many of the deck's cards are on it. Absent on a plain draft. */
  focus?: { label: string; inDeck: number; inPool: number; floor: number }[];
  /** The bracket asked for, when one was. */
  bracket?: number | null;
  /** The deck's Game Changers (commander included) — null when Scryfall's
   *  lists couldn't be read. */
  gameChangers?: number | null;
  /** The lowest bracket the deck's cards allow: 2 with no Game Changers, 3
   *  with one to three, 4 with more or with mass land denial. */
  bracketFloor?: 2 | 3 | 4 | null;
};

/**
 * What a draft is built around beyond its commander — a deck type, a
 * creature type, a bracket — made by `draftPlanFor`
 * (lib/tools/collection/archetypes.ts) so this file stays free of the type
 * list. Every part is optional; none = the plain draft.
 */
export type DraftPlan = {
  /** The deck type: its label, a card on it, its floor. */
  type?: { label: string; matches: (card: CollectionCard) => boolean; floor: number } | null;
  /** The creature type: its label, a card on it, its floor. */
  tribe?: { label: string; matches: (card: CollectionCard) => boolean; floor: number } | null;
  /** Lands in the deck (default LAND_TARGET). */
  lands?: number;
  /** Role targets that move for the type. */
  roles?: Partial<Record<keyof typeof ROLE_TARGETS, number>>;
  /** The bracket asked for, and its card lists (null: not readable). */
  bracket?: {
    level: 1 | 2 | 3 | 4 | 5;
    cards: { isGameChanger: (name: string) => boolean; isMassLandDenial: (name: string) => boolean; isExtraTurn: (name: string) => boolean } | null;
  } | null;
};

/** Game Changers a bracket allows (the commander counts). */
export function gameChangerCap(level: number): number {
  return level <= 2 ? 0 : level === 3 ? 3 : Number.POSITIVE_INFINITY;
}

/** Extra-turn cards a bracket allows: none in 1, one in 2–3 (they may be
 *  in "low numbers, never chained" — one keeps that honest). */
export function extraTurnCap(level: number): number {
  return level <= 1 ? 0 : level <= 3 ? 1 : Number.POSITIVE_INFINITY;
}

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

function toPick(card: CollectionCard, role: DeckRole, fromAi = false, aiWhy?: string): DraftPick {
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
    ...(fromAi && aiWhy ? { aiWhy } : {}),
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
export function eligiblePool(
  commander: CollectionCard,
  collection: readonly CollectionCard[],
  plan: DraftPlan | null = null,
): CollectionCard[] {
  const tribes = commanderTribes(commander);
  const themes = commanderThemes(commander);
  const level = plan?.bracket?.cards ? plan.bracket.level : null;
  const lists = plan?.bracket?.cards ?? null;
  return uniqueByCard(collection)
    .filter((card) => !isBasicLand(card) && ineligibleReason(card, commander) === null)
    // The bracket's outright bans; its caps are kept while drafting.
    .filter((card) => {
      if (!lists || level === null) return true;
      const key = cardKey(card.name);
      if (level <= 3 && lists.isMassLandDenial(key)) return false;
      if (gameChangerCap(level) === 0 && lists.isGameChanger(key)) return false;
      if (extraTurnCap(level) === 0 && lists.isExtraTurn(key)) return false;
      return true;
    })
    .map((card) => ({
      card,
      score:
        synergyScore(card, { tribes, themes }) +
        (plan?.type?.matches(card) ? 3 : 0) +
        (plan?.tribe?.matches(card) ? 4 : 0),
    }))
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
  /** The AI's one-line reason per preferred id. */
  reasons?: ReadonlyMap<string, string>;
  /** What the AI said the collection is thin on (shown with the warnings). */
  shortfalls?: readonly string[];
  strategy?: string | null;
  /** A deck type, a creature type, a bracket (none = the plain draft). */
  plan?: DraftPlan | null;
}): CommanderDraft {
  const { commander } = input;
  const plan = input.plan ?? null;
  const identity = commander.colorIdentity;
  const pool = eligiblePool(commander, input.collection, plan);
  const landTarget = plan?.lands ?? LAND_TARGET;
  const roleTargets = { ...ROLE_TARGETS, ...(plan?.roles ?? {}) };
  const level = plan?.bracket?.level ?? null;
  const lists = plan?.bracket?.cards ?? null;
  const isGameChanger = (card: { name: string }) => !!lists && lists.isGameChanger(cardKey(card.name));
  const isExtraTurn = (card: { name: string }) => !!lists && lists.isExtraTurn(cardKey(card.name));
  // The commander counts toward a bracket's Game Changers and extra turns.
  let gameChangersIn = isGameChanger(commander) ? 1 : 0;
  let extraTurnsIn = isExtraTurn(commander) ? 1 : 0;
  const byId = new Map(pool.map((c) => [c.id, c]));
  // Any printing of a card the pool holds answers for it (the AI may name a
  // second printing's row).
  const poolByKey = new Map(pool.map((c) => [cardKey(c.name), c]));
  const rowById = new Map(input.collection.map((c) => [c.id, c]));

  const chosen: DraftPick[] = [];
  const taken = new Set<string>();
  const take = (card: CollectionCard, fromAi = false, aiWhy?: string) => {
    const key = cardKey(card.name);
    if (taken.has(key)) return false;
    // A bracket's caps: Game Changers (the commander counts), extra turns.
    if (level !== null && lists) {
      if (isGameChanger(card) && gameChangersIn >= gameChangerCap(level)) return false;
      if (isExtraTurn(card) && extraTurnsIn >= extraTurnCap(level)) return false;
    }
    taken.add(key);
    if (isGameChanger(card)) gameChangersIn += 1;
    if (isExtraTurn(card)) extraTurnsIn += 1;
    chosen.push(toPick(card, roleOf(card), fromAi, aiWhy));
    return true;
  };

  const nonlandTarget = COMMANDER_DECK_SIZE - 1 - landTarget;
  const nonlands = () => chosen.filter((p) => p.role !== "land").length;
  const lands = () => chosen.filter((p) => p.role === "land").length;

  // 1. The AI's picks, in its order (each held to the same rules).
  for (const id of input.preferred ?? []) {
    const row = rowById.get(id);
    const card = byId.get(id) ?? (row ? poolByKey.get(cardKey(row.name)) : undefined);
    if (!card) continue;
    const land = isLand(card);
    if (land ? lands() >= landTarget : nonlands() >= nonlandTarget) continue;
    take(card, true, input.reasons?.get(id));
  }

  // 2. The role quotas, then the plan, from the rules' ranking.
  const spells = pool.filter((c) => !isLand(c));
  for (const role of ["ramp", "draw", "removal", "wipe"] as const) {
    const have = () => chosen.filter((p) => p.role === role).length;
    const ranked = spells
      .filter((c) => roleOf(c) === role)
      .sort((a, b) => (role === "ramp" ? (a.manaValue ?? 0) - (b.manaValue ?? 0) : 0));
    for (const card of ranked) {
      if (have() >= roleTargets[role] || nonlands() >= nonlandTarget) break;
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
    if (lands() >= landTarget) break;
    take(card);
  }

  const spellsShort = Math.max(0, nonlandTarget - nonlands());
  const basicsWanted = Math.max(0, landTarget - lands()) + Math.min(MAX_EXTRA_BASICS, spellsShort);
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
  for (const note of input.shortfalls ?? []) {
    const text = `The AI: ${note.trim()}`;
    if (note.trim() && !warnings.includes(text)) warnings.push(text);
  }
  const short = Math.max(0, COMMANDER_DECK_SIZE - total);
  if (short > 0) {
    warnings.push(
      `Your collection has ${pool.length} card${pool.length === 1 ? "" : "s"} (besides basics) that fit ${commander.name}'s colours, so the deck is ${short} card${short === 1 ? "" : "s"} short of ${COMMANDER_DECK_SIZE}. Add more to your collection, or fill the gaps in the deck later.`,
    );
  }
  for (const role of ["ramp", "draw", "removal"] as const) {
    if (counts[role] < Math.ceil(roleTargets[role] / 2)) {
      warnings.push(`Only ${counts[role]} ${ROLE_LABELS[role].toLowerCase()} card${counts[role] === 1 ? "" : "s"} — most decks want about ${roleTargets[role]}.`);
    }
  }

  // What the deck was built around, and how much of it the collection holds.
  const focus: NonNullable<CommanderDraft["focus"]> = [];
  for (const part of [plan?.type, plan?.tribe]) {
    if (!part) continue;
    const inPool = pool.filter((c) => part.matches(c)).length;
    const inDeck = chosen.filter((p) => {
      const row = rowById.get(p.cardId);
      return row ? part.matches(row) : false;
    }).length;
    focus.push({ label: part.label, inDeck, inPool, floor: part.floor });
    if (inPool < part.floor) {
      warnings.push(
        `Only ${inPool} of your cards in ${commander.name}'s colours are ${part.label} cards — a ${part.label} deck wants about ${part.floor}.`,
      );
    }
  }

  // The bracket: what the cards allow, and whether it was checked at all.
  let gameChangers: number | null = null;
  let bracketFloor: 2 | 3 | 4 | null = null;
  if (lists) {
    gameChangers = gameChangersIn;
    // The commander is in the deck too: its own land denial counts.
    const landDenial = [commander, ...chosen].some((p) => lists.isMassLandDenial(cardKey(p.name)));
    bracketFloor = landDenial || gameChangers > 3 || extraTurnsIn > 1 ? 4 : gameChangers > 0 ? 3 : 2;
    if (level !== null && level <= 2 && isGameChanger(commander)) {
      warnings.push(`${commander.name} is a Game Changer, so this deck can't be Bracket ${level} — it starts at Bracket 3.`);
    }
    if (level !== null && level <= 3 && lists.isMassLandDenial(cardKey(commander.name))) {
      warnings.push(`${commander.name} denies lands to the whole table, so this deck can't be Bracket ${level} — it starts at Bracket 4.`);
    }
    if (level !== null && level <= 1 && isExtraTurn(commander)) {
      warnings.push(`${commander.name} takes extra turns, so this deck can't be Bracket 1.`);
    }
  } else if (level !== null) {
    warnings.push("The bracket's card lists couldn't be read just now, so the deck wasn't checked against the bracket.");
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
    ...(focus.length ? { focus } : {}),
    ...(level !== null ? { bracket: level } : {}),
    ...(lists ? { gameChangers, bracketFloor } : {}),
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
