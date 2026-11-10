import type { CollectionCard } from "./card-row";
import { ROLE_TARGETS, roleOf, type DraftPlan } from "./builder";
import { DECK_TYPES } from "@/lib/decks/deck-types";

// ---------------------------------------------------------------------------
// The deck types a player can build their collection around (owner decision
// 2026-11-09, the collection refinements report: 17 mechanical types in 7
// groups, plus an optional creature type — Typal — on top of any of them,
// plus "Any" = follow the commander). Pure, client-safe, tested.
//
// Each type is what the drafter and the AI read: the card patterns that
// make a card ON the type (Oracle's current wording — "enters", never
// "enters the battlefield"; reminder text left out), the same patterns read
// on a commander's own text ("fits <commander>"), how the deck's shape
// shifts (lands, role targets), the FLOOR — how many on-type cards a deck
// wants before the type is really there (a warning below it; the AI build
// refuses, before any charge, below HALF of it) — and the lowest bracket
// the type belongs in (Stax and Combo: 3). Extra turns are never a type
// (owner decision 4).
//
// Sources for the groups, roles and counts: research_notes "Collection AI
// deck building/commander_archetypes.md" (EDHREC themes page read
// 2026-11-09; The Command Zone's 2025 template; EDHREC / Draftsim guides).
// The floors and shifts are starting numbers to tune.
// ---------------------------------------------------------------------------

export type DeckTypeGroup = "board" | "threat" | "engines" | "graveyard" | "spells" | "control" | "social" | "alt";

export const DECK_TYPE_GROUP_LABELS: Record<DeckTypeGroup, string> = {
  board: "Board",
  threat: "One big threat",
  engines: "Card-type engines",
  graveyard: "Graveyard",
  spells: "Spells",
  control: "Table control",
  social: "Social",
  alt: "Alternate wins",
};

/** The ids double as the saved deck's `decks.deck_type` key
 *  (lib/decks/deck-types.ts DECK_TYPES — a test keeps them listed there). */
export const COLLECTION_DECK_TYPE_IDS = [
  "tokens",
  "counters",
  "aristocrats",
  "voltron",
  "artifacts",
  "enchantress",
  "superfriends",
  "landfall",
  "blink",
  "lifegain",
  "reanimator",
  "spellslinger",
  "control",
  "stax",
  "group-hug",
  "mill",
  "combo",
] as const;

export type CollectionDeckTypeId = (typeof COLLECTION_DECK_TYPE_IDS)[number];

type Card = Pick<CollectionCard, "typeLine" | "oracleText" | "name">;

export type CollectionDeckType = {
  id: CollectionDeckTypeId;
  label: string;
  group: DeckTypeGroup;
  /** One line for the picker and the AI: what the deck does. */
  summary: string;
  /** What the AI is told to fill the plan slots with. */
  wants: string;
  /** A card on the type. */
  matches: (card: Card) => boolean;
  /** On-type cards the deck wants (warning below; AI refuses below half). */
  floor: number;
  /** About how many on-type cards the AI should aim for. */
  target: number;
  /** Lands in the deck (default 36). */
  lands?: number;
  /** Role targets that move for the type. */
  roles?: Partial<Record<keyof typeof ROLE_TARGETS, number>>;
  /** The lowest bracket the type belongs in. */
  minBracket?: 3;
};

function textOf(card: Pick<CollectionCard, "oracleText">): string {
  return (card.oracleText ?? "").replace(/\([^)]*\)/g, "");
}

function frontType(card: Pick<CollectionCard, "typeLine">): string {
  return (card.typeLine ?? "").split(" // ")[0];
}

const textHas = (...patterns: RegExp[]) => (card: Card) => {
  const text = textOf(card);
  return patterns.some((re) => re.test(text));
};
const typeHas = (re: RegExp) => (card: Card) => re.test(frontType(card));
const either =
  (...tests: Array<(card: Card) => boolean>) =>
  (card: Card) =>
    tests.some((t) => t(card));

const SELF = String.raw`(?:this \w+|~)`;

export const COLLECTION_DECK_TYPES: readonly CollectionDeckType[] = [
  {
    id: "tokens",
    label: "Tokens",
    group: "board",
    summary: "Fill the board with token creatures, then win wide.",
    wants: "repeatable token makers, token doublers, anthems that pump the team, and payoffs that count your creatures",
    matches: textHas(
      /\bcreates?\b[^.]*\btokens?\b/i,
      /\btokens? you control\b/i,
      /\bcreatures you control get \+\d+\/\+\d+/i,
      /\btwice that many\b[^.]*\btokens?\b|\bwould create one or more\b[^.]*\btokens?\b/i,
      /\bfor each (?:creature|token) you control\b/i,
    ),
    floor: 20,
    target: 30,
    lands: 35,
    roles: { wipe: 2 },
  },
  {
    id: "counters",
    label: "+1/+1 counters",
    group: "board",
    summary: "Grow your creatures with +1/+1 counters and proliferate.",
    wants: "cards that put +1/+1 counters on creatures, counter doublers, proliferate, and payoffs for creatures with counters",
    matches: textHas(/\+1\/\+1 counters?\b/i, /\bproliferate\b/i),
    floor: 20,
    target: 28,
    lands: 35,
  },
  {
    id: "aristocrats",
    label: "Aristocrats",
    group: "board",
    summary: "Sacrifice your own creatures for value and drain the table.",
    wants: "free sacrifice outlets, death triggers that drain or draw, fodder that makes extra bodies, and recursion",
    matches: textHas(
      /\bsacrifice (?:a|an|another) (?:creature|permanent|artifact|token)\b/i,
      /\bwhenever [^.]*\b(?:dies|die)\b/i,
      /\bwhenever you sacrifice\b/i,
      /\bloses? \d+ life and you gain \d+ life\b/i,
    ),
    floor: 15,
    target: 25,
  },
  {
    id: "voltron",
    label: "Voltron",
    group: "threat",
    summary: "Load one creature — usually the commander — with Equipment and Auras.",
    wants: "Equipment and Auras that make one creature huge or evasive, double strike, and protection (hexproof, indestructible) to keep it alive",
    matches: either(
      typeHas(/\b(?:Equipment|Aura)\b/),
      textHas(
        /\bequipped creature\b|\benchanted creature gets\b|\battach\b/i,
        /\b(?:gains?|has|have) (?:hexproof|indestructible|shroud|protection)\b/i,
        /\bdouble strike\b/i,
      ),
    ),
    floor: 12,
    target: 20,
    lands: 35,
    roles: { wipe: 2 },
  },
  {
    id: "artifacts",
    label: "Artifacts",
    group: "engines",
    summary: "Artifacts and the cards that reward casting, making or counting them.",
    wants: "artifact creatures and rocks, artifact makers (Treasure, Clues), cost reducers, and payoffs for artifacts entering or being counted",
    matches: either(
      typeHas(/\bArtifact\b/),
      textHas(/\bartifacts? you control\b|\bwhenever an artifact\b|\bfor each artifact\b|\bartifact spells?\b|\bTreasure\b/i),
    ),
    floor: 20,
    target: 30,
  },
  {
    id: "enchantress",
    label: "Enchantress",
    group: "engines",
    summary: "Many enchantments, and the cards that draw or grow from them.",
    wants: "enchantments of every kind (Auras, Sagas, pillow-fort pieces) and enchantress payoffs that draw a card or grow when one is cast or enters",
    matches: either(
      typeHas(/\bEnchantment\b/),
      textHas(/\bwhenever you cast an enchantment\b|\benchantments? you control\b|\bconstellation\b|\bwhenever an enchantment\b/i),
    ),
    floor: 25,
    target: 30,
    lands: 35,
  },
  {
    id: "superfriends",
    label: "Superfriends",
    group: "engines",
    summary: "A deck built around planeswalkers.",
    wants: "planeswalkers, proliferate to tick them up, and fogs or pillow-fort cards to keep them safe",
    matches: either(typeHas(/\bPlaneswalker\b/), textHas(/\bplaneswalkers? you control\b|\bloyalty (?:counter|abilit)/i, /\bproliferate\b/i)),
    floor: 12,
    target: 18,
  },
  {
    id: "landfall",
    label: "Landfall",
    group: "engines",
    summary: "Play extra lands and trigger every land that enters.",
    wants: "landfall payoffs, extra land drops, ramp that puts lands onto the battlefield, and land recursion",
    matches: textHas(
      /\blandfall\b|\bwhenever a land (?:you control )?enters\b/i,
      /\byou may play (?:an )?additional lands?\b/i,
      /\bsearch your library for [^.]*\blands?\b/i,
      /\breturn [^.]*\bland cards? from your graveyard\b/i,
    ),
    floor: 12,
    target: 22,
    lands: 38,
  },
  {
    id: "blink",
    label: "Blink",
    group: "engines",
    summary: "Exile your own creatures and bring them back to reuse their enter abilities.",
    wants: `creatures with strong "enters" abilities (ramp, card draw, removal) and flicker effects that exile and return them`,
    matches: either(
      (card) => typeHas(/\bCreature\b/)(card) && new RegExp(String.raw`\bwhen(?:ever)? ${SELF} enters\b`, "i").test(textOf(card)),
      textHas(/\bexile\b[^.]*\bthen return\b[^.]*\bto the battlefield\b/i, /\bexile another target\b[^.]*\byou control\b[^.]*\breturn\b/i),
    ),
    floor: 15,
    target: 25,
  },
  {
    id: "lifegain",
    label: "Lifegain",
    group: "engines",
    summary: "Gain life again and again, and turn it into damage or cards.",
    wants: "repeatable life gain, lifelink, and payoffs that trigger whenever you gain life",
    matches: textHas(/\bgains? (?:\d+|x|that much) life\b|\blifelink\b|\bwhenever you gain life\b/i),
    floor: 15,
    target: 25,
  },
  {
    id: "reanimator",
    label: "Reanimator",
    group: "graveyard",
    summary: "Fill your graveyard with big creatures and cheat them back.",
    wants: "self-mill and discard outlets to fill the graveyard, reanimation spells, and big creatures worth bringing back",
    matches: textHas(
      /\bfrom (?:your|a|any) graveyard (?:on)?to the battlefield\b/i,
      /\bmills?\b|\bsurveil\b/i,
      /\bdiscard (?:a|two|three) cards?\b/i,
      /\binto your graveyard\b/i,
    ),
    floor: 12,
    target: 22,
  },
  {
    id: "spellslinger",
    label: "Spellslinger",
    group: "spells",
    summary: "Cast instants and sorceries, and reward every one.",
    wants: "instants and sorceries (cantrips, removal, copy effects) and payoffs that trigger when you cast them",
    matches: either(
      typeHas(/\b(?:Instant|Sorcery)\b/),
      textHas(/\binstant or sorcery\b|\bnoncreature spell\b|\bwhenever you cast\b|\bmagecraft\b|\bprowess\b|\bcopy (?:target|that) (?:instant|sorcery|spell)\b/i),
    ),
    floor: 25,
    target: 30,
    lands: 34,
  },
  {
    id: "control",
    label: "Control",
    group: "control",
    summary: "Answer every threat, play the long game, win late with a few finishers.",
    wants: "counterspells, removal, board wipes and card draw, plus two or three finishers",
    matches: (card) => {
      const role = roleOf(card);
      return role === "removal" || role === "wipe" || /\bcounter target\b/i.test(textOf(card));
    },
    floor: 20,
    target: 28,
    roles: { removal: 12, wipe: 5 },
  },
  {
    id: "stax",
    label: "Stax",
    group: "control",
    summary: "Tax and lock the table's resources while your deck keeps going.",
    wants: "taxes on spells and attacks, cards that stop untapping or searching, and symmetrical locks your deck breaks first (never mass land denial below Bracket 4)",
    matches: textHas(
      /\bcosts? \{\d+\} more\b/i,
      /\bdon'?t untap\b|\bdoesn'?t untap\b/i,
      /\bcan'?t (?:cast|untap|search|attack you)\b/i,
      /\b(?:each player|players) can'?t\b/i,
    ),
    floor: 8,
    target: 14,
    minBracket: 3,
  },
  {
    id: "group-hug",
    label: "Group hug",
    group: "social",
    summary: "Help the whole table — and win while they're busy.",
    wants: "cards that give every player cards, mana or life, a few that break the symmetry for you, and a real way to win",
    matches: textHas(
      /\beach player (?:draws|may draw|may put|may search|gains|creates)\b/i,
      /\btarget (?:opponent|player) draws\b/i,
      /\bfor each player\b/i,
    ),
    floor: 8,
    target: 14,
  },
  {
    id: "mill",
    label: "Mill",
    group: "alt",
    summary: "Empty the opponents' libraries before they empty your life.",
    wants: "cards that mill opponents, mill doublers, and payoffs for cards in their graveyards",
    matches: textHas(/\b(?:target|each) (?:player|opponent) mills\b/i, /\bmills? (?:\w+|x) cards\b/i, /\bcards? in (?:each )?opponents?'? graveyards?\b/i),
    floor: 10,
    target: 18,
  },
  {
    id: "combo",
    label: "Combo",
    group: "alt",
    summary: "Assemble a few cards that win together, and find them fast.",
    wants: "tutors and card draw to find the combo pieces you own, untappers and copy effects, and protection for the turn it goes off (combos are judged by the AI, best effort)",
    matches: textHas(
      /\bsearch your library for (?:a|an|any) (?:card|creature|artifact|instant|sorcery|enchantment)\b/i,
      /\buntap (?:target|all|another|each)\b/i,
      /\bcopy target\b/i,
    ),
    floor: 8,
    target: 14,
    minBracket: 3,
  },
];

export function collectionDeckType(id: string | null | undefined): CollectionDeckType | null {
  if (!id) return null;
  return COLLECTION_DECK_TYPES.find((t) => t.id === id) ?? null;
}

/** Whether a type may be picked at a bracket (Stax / Combo: 3 and up). */
export function deckTypeFitsBracket(type: CollectionDeckType, bracket: number | null | undefined): boolean {
  return !type.minBracket || !bracket || bracket >= type.minBracket;
}

/** The types a commander's own text plays into ("fits Krenko"). */
export function commanderDeckTypes(commander: Card): CollectionDeckTypeId[] {
  return COLLECTION_DECK_TYPES.filter((t) => t.matches(commander)).map((t) => t.id);
}

// ---------------------------------------------------------------------------
// Typal — a creature type on top of any deck type
// ---------------------------------------------------------------------------

/** A creature type is offered from this many of its creatures in the
 *  commander's colours; below TYPAL_FLOOR it says "aim for 20+". */
export const TYPAL_OFFER_MIN = 10;
export const TYPAL_FLOOR = 20;

/** A card's creature types, lower-cased; a changeling is every type. */
export function cardCreatureTypes(card: Pick<CollectionCard, "typeLine">): string[] {
  const front = frontType(card);
  if (!/\bCreature\b/.test(front)) return [];
  const subtypes = front.split(/\s+[—-]\s+/)[1] ?? "";
  return subtypes
    .split(/\s+/)
    .map((w) => w.toLowerCase())
    .filter(Boolean);
}

export function isChangeling(card: Pick<CollectionCard, "oracleText">): boolean {
  return /\bchangeling\b/i.test(card.oracleText ?? "");
}

/** Whether a card is on a creature type: a creature of it, a changeling,
 *  or a card whose text names the type ("Goblin spells", "other Elves"). */
export function cardFitsTribe(card: Card, tribe: string): boolean {
  const key = tribe.toLowerCase();
  if (cardCreatureTypes(card).includes(key)) return true;
  if (/\bCreature\b/.test(frontType(card)) && isChangeling(card)) return true;
  const word = key.charAt(0).toUpperCase() + key.slice(1);
  return new RegExp(`\\b${word.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")}`).test(textOf(card));
}

/** "goblin" → "Goblin" (the label a picker shows). */
export function tribeLabel(tribe: string): string {
  return tribe.charAt(0).toUpperCase() + tribe.slice(1);
}

// ---------------------------------------------------------------------------
// The plan a draft is built around
// ---------------------------------------------------------------------------

/** The bracket lists as the server reads them (bracket-cards.ts). */
export type BracketCardLists = {
  gameChangers: ReadonlySet<string>;
  massLandDenial: ReadonlySet<string>;
  extraTurns: ReadonlySet<string>;
};

export type BuildChoice = {
  deckType?: CollectionDeckTypeId | null;
  tribe?: string | null;
  bracket?: number | null;
};

/** The drafter's plan for a choice: the type's patterns and shape, the
 *  creature type, and the bracket's lists (null lists = picked, unchecked).
 *  None of them = null, the plain draft. */
export function draftPlanFor(choice: BuildChoice, lists: BracketCardLists | null): DraftPlan | null {
  const type = collectionDeckType(choice.deckType);
  const tribe = choice.tribe?.trim().toLowerCase() || null;
  const level = choice.bracket && choice.bracket >= 1 && choice.bracket <= 5 ? (choice.bracket as 1 | 2 | 3 | 4 | 5) : null;
  if (!type && !tribe && level === null) return null;
  return {
    type: type ? { label: type.label, matches: type.matches, floor: type.floor } : null,
    tribe: tribe ? { label: tribeLabel(tribe), matches: (card) => cardFitsTribe(card, tribe), floor: TYPAL_FLOOR } : null,
    ...(type?.lands ? { lands: type.lands } : {}),
    ...(type?.roles ? { roles: type.roles } : {}),
    bracket:
      level === null
        ? null
        : {
            level,
            cards: lists
              ? {
                  isGameChanger: (key) => lists.gameChangers.has(key),
                  isMassLandDenial: (key) => lists.massLandDenial.has(key),
                  isExtraTurn: (key) => lists.extraTurns.has(key),
                }
              : null,
          },
  };
}

/** On-type cards below which the AI build refuses the type, before any
 *  charge: half the floor (below the floor it only warns). */
export function refusalFloor(floor: number): number {
  return Math.ceil(floor / 2);
}

/** Why a choice can't be built, or null: Stax and Combo belong in Bracket
 *  3 and up (owner decision 4). */
export function choiceError(choice: BuildChoice): string | null {
  const type = collectionDeckType(choice.deckType);
  if (type && !deckTypeFitsBracket(type, choice.bracket)) {
    return `${type.label} is a deck type for Bracket ${type.minBracket} and up — pick a higher bracket or another type.`;
  }
  return null;
}

/** The saved deck's `decks.deck_type` key (lib/decks/deck-types.ts): the
 *  deck type, else the creature type's tribe key ("goblin" → "goblins")
 *  when the list has one, else null. */
export function deckTypeKeyFor(choice: BuildChoice): string | null {
  if (choice.deckType && DECK_TYPES.some((t) => t.key === choice.deckType)) return choice.deckType;
  const tribe = choice.tribe?.trim().toLowerCase();
  if (!tribe) return null;
  const match = DECK_TYPES.find(
    (t) => t.kind === "tribe" && (t.label.toLowerCase() === tribe || t.label.toLowerCase().replace(/s$/, "") === tribe || t.key === `${tribe}s`),
  );
  if (match) return match.key;
  const irregular: Record<string, string> = { elf: "elves", dwarf: "dwarves", wolf: "wolves", werewolf: "werewolves", faerie: "faeries" };
  return DECK_TYPES.find((t) => t.key === irregular[tribe])?.key ?? null;
}

