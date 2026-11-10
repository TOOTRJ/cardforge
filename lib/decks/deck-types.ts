import { COLOR_LETTER_IDENTITY } from "@/types/card";

// ---------------------------------------------------------------------------
// Deck starting points for the AI builder (client-safe, no server imports).
//
//   DECK_TYPES          — creature tribes and archetypes a player can pick as
//                         the deck's identity; each carries the colour
//                         identity the AI should build in (Gorgon → B/G,
//                         Sliver → five colours, Aristocrats → W/B …).
//   COMMANDER_BRACKETS  — the five official Commander power brackets
//                         (Exhibition → cEDH) with the guidance the AI gets.
//   randomDeckSeed()    — a "surprise me" pick of type + theme + style.
// ---------------------------------------------------------------------------

export type ManaColor = "W" | "U" | "B" | "R" | "G";

export type DeckType = {
  key: string;
  label: string;
  kind: "tribe" | "archetype";
  colors: ManaColor[];
  /** One line the AI builds around. */
  hint: string;
};

export const DECK_TYPES: readonly DeckType[] = [
  // Tribes
  { key: "angels", label: "Angels", kind: "tribe", colors: ["W"], hint: "big flying Angels, lifegain and protection" },
  { key: "aristocrats", label: "Aristocrats", kind: "archetype", colors: ["W", "B"], hint: "sacrifice outlets, death triggers and token fodder" },
  { key: "beasts", label: "Beasts", kind: "tribe", colors: ["R", "G"], hint: "large Beasts that fight and trample through" },
  { key: "cats", label: "Cats", kind: "tribe", colors: ["G", "W"], hint: "go-wide Cats with equipment and +1/+1 counters" },
  { key: "clerics", label: "Clerics", kind: "tribe", colors: ["W", "B"], hint: "Clerics that drain and heal" },
  { key: "demons", label: "Demons", kind: "tribe", colors: ["B"], hint: "huge Demons with life-for-power bargains" },
  { key: "dinosaurs", label: "Dinosaurs", kind: "tribe", colors: ["R", "G", "W"], hint: "enrage Dinosaurs and ramp into stompers" },
  { key: "dragons", label: "Dragons", kind: "tribe", colors: ["R", "G"], hint: "ramp into flying Dragons with breath-fire payoffs" },
  { key: "druids", label: "Druids", kind: "tribe", colors: ["G"], hint: "mana Druids that untap and overrun" },
  { key: "elementals", label: "Elementals", kind: "tribe", colors: ["U", "R"], hint: "evoke and flicker Elementals for value" },
  { key: "eldrazi", label: "Eldrazi", kind: "tribe", colors: [], hint: "colourless Eldrazi titans, annihilator-style pressure" },
  { key: "elves", label: "Elves", kind: "tribe", colors: ["G"], hint: "Elf mana swarms and lords" },
  { key: "faeries", label: "Faeries", kind: "tribe", colors: ["U", "B"], hint: "flash Faeries, tempo and tricks" },
  { key: "giants", label: "Giants", kind: "tribe", colors: ["R", "G"], hint: "hulking Giants and boulder-throwing removal" },
  { key: "goblins", label: "Goblins", kind: "tribe", colors: ["R"], hint: "swarming Goblins, haste and sacrifice" },
  { key: "gorgons", label: "Gorgons", kind: "tribe", colors: ["B", "G"], hint: "deathtouch Gorgons, petrify effects and graveyard value" },
  { key: "horrors", label: "Horrors", kind: "tribe", colors: ["U", "B"], hint: "mill and Horrors that feed on the graveyard" },
  { key: "hydras", label: "Hydras", kind: "tribe", colors: ["G"], hint: "X-cost Hydras and +1/+1 counter growth" },
  { key: "knights", label: "Knights", kind: "tribe", colors: ["W", "B"], hint: "first-strike Knights with equipment and vigilance" },
  { key: "merfolk", label: "Merfolk", kind: "tribe", colors: ["G", "U"], hint: "islandwalk Merfolk lords and card draw" },
  { key: "phyrexians", label: "Phyrexians", kind: "tribe", colors: ["B"], hint: "poison, proliferate and Phyrexian machinery" },
  { key: "pirates", label: "Pirates", kind: "tribe", colors: ["U", "B", "R"], hint: "raid Pirates, treasure and theft" },
  { key: "rogues", label: "Rogues", kind: "tribe", colors: ["U", "B"], hint: "evasive Rogues, mill and prowl" },
  { key: "slivers", label: "Slivers", kind: "tribe", colors: ["W", "U", "B", "R", "G"], hint: "five-colour Slivers sharing every ability" },
  { key: "soldiers", label: "Soldiers", kind: "tribe", colors: ["W"], hint: "Soldier tokens, anthems and battalion" },
  { key: "spirits", label: "Spirits", kind: "tribe", colors: ["W", "U"], hint: "flash flying Spirits and tempo" },
  { key: "vampires", label: "Vampires", kind: "tribe", colors: ["B", "R"], hint: "lifelink Vampires, madness and blood" },
  { key: "warriors", label: "Warriors", kind: "tribe", colors: ["R", "W"], hint: "aggressive Warriors that attack in numbers" },
  { key: "werewolves", label: "Werewolves", kind: "tribe", colors: ["R", "G"], hint: "day/night Werewolves that transform" },
  { key: "wizards", label: "Wizards", kind: "tribe", colors: ["U", "R"], hint: "spell-slinging Wizards with prowess" },
  { key: "zombies", label: "Zombies", kind: "tribe", colors: ["U", "B"], hint: "recursive Zombies that never stay dead" },
  // Archetypes
  { key: "aggro", label: "Aggro", kind: "archetype", colors: ["R"], hint: "cheap attackers and burn to close fast" },
  // The Collection Deck Builder's deck types (lib/tools/collection/
  // archetypes.ts) are saved as these keys too — a test keeps every one of
  // them listed here.
  { key: "artifacts", label: "Artifacts", kind: "archetype", colors: ["U", "R"], hint: "artifact makers, cost reducers and artifact payoffs" },
  { key: "blink", label: "Blink", kind: "archetype", colors: ["W", "U"], hint: "enter-the-battlefield creatures and flicker effects" },
  { key: "combo", label: "Combo", kind: "archetype", colors: ["U", "B"], hint: "tutors, untappers and a few cards that win together" },
  { key: "control", label: "Control", kind: "archetype", colors: ["W", "U"], hint: "counters, sweepers and a few big finishers" },
  { key: "counters", label: "+1/+1 counters", kind: "archetype", colors: ["G", "W"], hint: "counter synergies, proliferate and growing threats" },
  { key: "enchantress", label: "Enchantress", kind: "archetype", colors: ["G", "W"], hint: "many enchantments and payoffs that draw or grow from them" },
  { key: "graveyard", label: "Graveyard", kind: "archetype", colors: ["B", "G"], hint: "self-mill, recursion and dredge-style value" },
  { key: "group-hug", label: "Group hug", kind: "archetype", colors: ["G", "U"], hint: "help every player, then break the symmetry to win" },
  { key: "landfall", label: "Landfall", kind: "archetype", colors: ["R", "G"], hint: "extra land drops and landfall payoffs" },
  { key: "lifegain", label: "Lifegain", kind: "archetype", colors: ["W", "B"], hint: "lifegain triggers and drain payoffs" },
  { key: "mill", label: "Mill", kind: "archetype", colors: ["U"], hint: "empty their library and punish the graveyard" },
  { key: "ramp", label: "Ramp", kind: "archetype", colors: ["G"], hint: "mana acceleration into giant threats" },
  { key: "reanimator", label: "Reanimator", kind: "archetype", colors: ["B"], hint: "discard fatties and cheat them back" },
  { key: "spellslinger", label: "Spellslinger", kind: "archetype", colors: ["U", "R"], hint: "instants and sorceries with prowess and copy payoffs" },
  { key: "stax", label: "Stax", kind: "archetype", colors: ["W", "U"], hint: "taxes and symmetrical locks your deck breaks first" },
  { key: "superfriends", label: "Superfriends", kind: "archetype", colors: ["W", "U", "B"], hint: "planeswalkers, proliferate and protection for them" },
  { key: "tokens", label: "Tokens", kind: "archetype", colors: ["G", "W"], hint: "go wide with tokens and anthems" },
  { key: "voltron", label: "Voltron", kind: "archetype", colors: ["W"], hint: "one creature loaded with auras and equipment" },
];

export function deckTypeByKey(key: string | null | undefined): DeckType | null {
  if (!key) return null;
  return DECK_TYPES.find((t) => t.key === key) ?? null;
}

/** "black-green (B/G)" for the AI prompt; "colourless" for Eldrazi. */
export function describeColors(colors: readonly ManaColor[]): string {
  if (colors.length === 0) return "colourless";
  if (colors.length === 5) return "all five colours (W/U/B/R/G)";
  return `${colors.map((c) => COLOR_LETTER_IDENTITY[c]).join("-")} (${colors.join("/")})`;
}

export type CommanderBracket = {
  level: 1 | 2 | 3 | 4 | 5;
  name: string;
  blurb: string;
  /** What the AI is told when designing at this level. */
  guidance: string;
};

/**
 * The five official Commander brackets (Wizards of the Coast; still a beta).
 * `guidance` is what the AI is told, so it states the brackets' own rules:
 *
 *   * the checklists — Game Changers (none in 1–2, up to three in 3, any in
 *     4–5), mass land denial (none in 1–3), extra turns (none in 1, few and
 *     never chained or looped in 2–3), two-card infinite combos (none in
 *     1–2, no early-game ones in 3): "Introducing Commander Brackets Beta",
 *     2025-02-11, magic.wizards.com/en/news/announcements/introducing-commander-brackets-beta;
 *   * the tutor limits REMOVED (the Game Changers list covers the strongest
 *     tutors), the turns a game should last (9 / 8 / 6 / 4 / any), and Core
 *     no longer tied to precons: "Commander Brackets Beta Update",
 *     2025-10-21, …/commander-brackets-beta-update-october-21-2025;
 *   * no bracket-level change on 2026-02-09 (Farewell and Biorhythm joined
 *     the Game Changers), …/commander-brackets-beta-update-february-9-2026.
 *
 * Which cards ARE Game Changers is never written here: it changes, and
 * Scryfall's `game_changer` flag / `is:gamechanger` is the live list.
 */
export const COMMANDER_BRACKETS: readonly CommanderBracket[] = [
  {
    level: 1,
    name: "Exhibition",
    blurb: "Creative, unoptimised, made to show off a theme. Long games.",
    guidance:
      "Power level: Bracket 1 (Exhibition). Prioritise theme and creativity over strength; the win conditions can be highly thematic or even substandard. Slow, splashy, fun cards. No Game Changers, no two-card infinite combos, no extra-turn cards and no mass land denial. Games should last nine or more turns.",
  },
  {
    level: 2,
    name: "Core",
    blurb: "Unoptimised and straightforward — everyone gets to play their deck.",
    guidance:
      "Power level: Bracket 2 (Core). Unoptimised and straightforward: solid synergy, and wins that are incremental, telegraphed on the board and disruptable. No Game Changers, no intentional two-card infinite combos and no mass land denial; extra-turn cards only in low numbers, never chained or looped. Games should last eight or more turns.",
  },
  {
    level: 3,
    name: "Upgraded",
    blurb: "Tuned and consistent, with a few standout cards.",
    guidance:
      "Power level: Bracket 3 (Upgraded). Strong synergy and high card quality with a clear game plan; it can win in one big turn. At most three Game Changers (the commander counts), no mass land denial and no intentional early-game two-card infinite combos (a late-game finish is fine); extra-turn cards only in low numbers, never chained or looped. Games should last six or more turns.",
  },
  {
    level: 4,
    name: "Optimized",
    blurb: "High power, efficient answers, nothing off the table but cEDH speed.",
    guidance:
      "Power level: Bracket 4 (Optimized). High power, limited only by the banned list: any Game Changers, efficient tutors, fast mana, cheap interaction, strong combos and synergies. Games can end from the fourth turn on. Cards should be pushed but still fair for a high-power table.",
  },
  {
    level: 5,
    name: "cEDH",
    blurb: "Fully competitive — win as fast and consistently as possible.",
    guidance:
      "Power level: Bracket 5 (cEDH). Maximal efficiency: one- and two-mana interaction, fast mana, compact combos, redundancy and tutors. Every slot must earn its place; a game can end on any turn.",
  },
];

export function commanderBracket(level: number | null | undefined): CommanderBracket | null {
  if (!level) return null;
  return COMMANDER_BRACKETS.find((b) => b.level === level) ?? null;
}

const RANDOM_THEMES = [
  "a drowned cathedral whose bells still ring",
  "sky pirates raiding storm-wracked cloud fortresses",
  "a fungal kingdom that grows on the dead",
  "clockwork knights guarding a dying sun",
  "a desert bazaar where spells are traded like spice",
  "wolves of a frozen forest that hunt by moonlight",
  "an archive of forbidden spells and its librarians",
  "volcanic forges run by fire giants",
  "a carnival that steals memories",
  "tide-priests who speak with leviathans",
  "an empire of glass and light on the brink of shattering",
  "gravebound nobles hosting an endless masquerade",
];

const RANDOM_STYLES = [
  "oil painting",
  "dark fantasy",
  "watercolor",
  "art nouveau",
  "comic book",
  "ukiyo-e woodblock",
  "stained glass",
  "pixel art",
];

function pick<T>(items: readonly T[], random: () => number): T {
  return items[Math.floor(random() * items.length) % items.length];
}

/** A "surprise me" seed: a deck type, a theme and an art style. */
export function randomDeckSeed(random: () => number = Math.random): {
  deckType: DeckType;
  theme: string;
  style: string;
  bracket: CommanderBracket;
} {
  return {
    deckType: pick(DECK_TYPES, random),
    theme: pick(RANDOM_THEMES, random),
    style: pick(RANDOM_STYLES, random),
    bracket: COMMANDER_BRACKETS[1 + Math.floor(random() * 2)], // Core or Upgraded
  };
}
