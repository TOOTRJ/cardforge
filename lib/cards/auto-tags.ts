// ---------------------------------------------------------------------------
// A new card's discovery tags, suggested from what the card SAYS (owner
// 2026-10-30): its rules text and its subtypes — every face's and every
// part's (a double-faced card's back, a split card's second half). Never
// its NAME: a name is flavour ("Wrath of God", "Giant Growth", "Bat Out of
// Hell" name no tribe). Deterministic and
// fast — a few regular expressions over a few hundred characters, no AI call
// — so the creator can run it on every keystroke
// (lib/creator/auto-tags-follow.ts holds the follow: a NEW card's Tags field
// follows these until its maker edits it; an edit never rewrites a stored
// card's tags).
//
// Every tag comes from the VOCABULARY below, never from the card's own
// words: a tag is a hub (/gallery/tag/<tagSlug>) and a search term, so the
// list keeps the forms the gallery already uses — plural tribes ("dragons",
// "elves"), the keyword's own name ("flying", "first strike"), short
// themes ("tokens", "card draw", "removal") — and a word the maker typed
// (a name, a slur) can never become a tag here. Each tag is already in
// cardTagsSchema's shape (lowercase a–z, 0–9, spaces, hyphens; ≤ 30
// characters; tests/unit/cards/auto-tags.test.ts holds it).
//
// Reminder text — "(…)" — is read as nothing: Flying's reminder names
// reach, Ward's names "counter it".
//
// Pure and client-safe.
// ---------------------------------------------------------------------------

/** At most this many tags are suggested (the card holds 12; the rest is
 *  the maker's room). */
export const AUTO_TAG_LIMIT = 6;

export type AutoTagFace = {
  rules_text?: string | null;
  /** The face's subtypes, as a list or as the creator's comma-separated
   *  field. */
  subtypes?: readonly string[] | string | null;
};

export type AutoTagInput = AutoTagFace & {
  /** The card's name: never read for a tag (a name is flavour), kept in the
   *  shape so a caller can pass the form's values as they are. */
  title?: string | null;
  card_type?: string | null;
  /** The card's other faces and parts (a double-faced card's back, a
   *  split / adventure / flip card's second part): their rules text and
   *  subtypes are read as the front's are; their names never. */
  otherFaces?: readonly AutoTagFace[] | null;
};

// --- Tribes ----------------------------------------------------------------
// Creature types worth a hub, each with the plural its tag takes. A type
// counts from the card's SUBTYPES (any case), or from its rules text only in
// a TRIBAL phrase as print writes one — the type capitalised, as a whole
// word: "<Type> creature token(s)", "<Types> you control", "other <Types>",
// "<Type> spell(s)" (TRIBE_PATTERNS). A type merely named, or a name's word
// ("Wrath of God", "Cat Burglar"), never counts. Generic types (Human,
// Advisor) are left out: they would tag half the gallery.
const TRIBES: readonly (readonly [singular: string, tag: string])[] = [
  ["Dragon", "dragons"],
  ["Angel", "angels"],
  ["Demon", "demons"],
  ["Devil", "devils"],
  ["Vampire", "vampires"],
  ["Zombie", "zombies"],
  ["Skeleton", "skeletons"],
  ["Spirit", "spirits"],
  ["Goblin", "goblins"],
  ["Elf", "elves"],
  ["Merfolk", "merfolk"],
  ["Faerie", "faeries"],
  ["Giant", "giants"],
  ["Dwarf", "dwarves"],
  ["Gnome", "gnomes"],
  ["Orc", "orcs"],
  ["Ogre", "ogres"],
  ["Troll", "trolls"],
  ["Minotaur", "minotaurs"],
  ["Centaur", "centaurs"],
  ["Kithkin", "kithkin"],
  ["Elemental", "elementals"],
  ["Sliver", "slivers"],
  ["Eldrazi", "eldrazi"],
  ["Phyrexian", "phyrexians"],
  ["Horror", "horrors"],
  ["Hydra", "hydras"],
  ["Sphinx", "sphinxes"],
  ["Phoenix", "phoenixes"],
  ["Dinosaur", "dinosaurs"],
  ["Wurm", "wurms"],
  ["Ooze", "oozes"],
  ["Beast", "beasts"],
  ["Wolf", "wolves"],
  ["Werewolf", "werewolves"],
  ["Cat", "cats"],
  ["Dog", "dogs"],
  ["Bird", "birds"],
  ["Bat", "bats"],
  ["Rat", "rats"],
  ["Squirrel", "squirrels"],
  ["Rabbit", "rabbits"],
  ["Fox", "foxes"],
  ["Frog", "frogs"],
  ["Snake", "snakes"],
  ["Spider", "spiders"],
  ["Insect", "insects"],
  ["Serpent", "serpents"],
  ["Kraken", "krakens"],
  ["Leviathan", "leviathans"],
  ["Octopus", "octopuses"],
  ["Unicorn", "unicorns"],
  ["Pegasus", "pegasi"],
  ["Griffin", "griffins"],
  ["Treefolk", "treefolk"],
  ["Fungus", "fungi"],
  ["Saproling", "saprolings"],
  ["Golem", "golems"],
  ["Construct", "constructs"],
  ["Thopter", "thopters"],
  ["Myr", "myr"],
  ["Robot", "robots"],
  ["God", "gods"],
  ["Knight", "knights"],
  ["Soldier", "soldiers"],
  ["Warrior", "warriors"],
  ["Wizard", "wizards"],
  ["Cleric", "clerics"],
  ["Rogue", "rogues"],
  ["Pirate", "pirates"],
  ["Ninja", "ninjas"],
  ["Samurai", "samurai"],
  ["Assassin", "assassins"],
  ["Shaman", "shamans"],
  ["Druid", "druids"],
  ["Monk", "monks"],
  ["Warlock", "warlocks"],
  ["Artificer", "artificers"],
];

// --- Keywords --------------------------------------------------------------
// Keyword abilities (CR 702) worth a tag, each one of the Comprehensive
// Rules' (tests/unit/cards/auto-tags.test.ts reads CR_KEYWORD_ABILITY_NAMES).
// Left out: Enchant and Equip (every
// Aura and Equipment has one — the subtype tags them), Crew (the Vehicle
// subtype does), and the landwalks.
const KEYWORD_ABILITIES: readonly string[] = [
  "Flying", "First Strike", "Double Strike", "Deathtouch", "Lifelink", "Trample", "Vigilance", "Haste",
  "Reach", "Menace", "Defender", "Flash", "Hexproof", "Indestructible", "Ward", "Shroud", "Protection",
  "Prowess", "Toxic", "Infect", "Wither", "Undying", "Persist", "Cycling", "Kicker", "Flashback", "Convoke",
  "Delve", "Affinity", "Cascade", "Storm", "Madness", "Ninjutsu", "Evoke", "Morph", "Suspend", "Exalted",
  "Annihilator", "Rebound", "Unearth", "Dash", "Escape", "Mutate", "Foretell", "Disturb", "Training", "Blitz",
  "Casualty", "Bargain", "Offspring", "Changeling", "Split Second", "Bushido", "Modular", "Devour",
];

// Keyword actions (CR 701) worth a tag, matched anywhere in the rules text
// in any tense ("Scry 2", "surveils", "investigate"). The common verbs
// (Destroy, Exile, Create, Sacrifice…) are themes below, never keywords.
const KEYWORD_ACTIONS: readonly string[] = [
  "Scry", "Surveil", "Mill", "Proliferate", "Investigate", "Explore", "Connive", "Amass", "Populate", "Goad",
  "Incubate", "Discover", "Forage", "Adapt", "Bolster", "Venture into the Dungeon", "The Ring Tempts You",
  "Collect Evidence", "Time Travel", "Manifest Dread", "Earthbend", "Airbend", "Waterbend",
];

// --- Themes ----------------------------------------------------------------
// What the card DOES, read off its rules text (lower-cased, reminder text
// out, ’ read as '). Each pattern is anchored on print's own wording.
const THEMES: readonly (readonly [tag: string, pattern: RegExp])[] = [
  ["tokens", /\bcreates?\b[^.]*\btokens?\b|\bpopulate\b|\bamass\b/],
  // Two cards or more, or a number the card counts ("draws X", "that
  // many"): a lone "Draw a card" (a cantrip) is not a draw theme.
  ["card draw", /\bdraws? (?:two|three|four|five|six|seven|x|that many)\b[^.]*\bcards\b|\bdraws? (?:x|cards)\b/],
  ["counterspell", /\bcounter target\b[^.]*\bspell\b/],
  ["board wipe", /\b(?:destroy|exile) all (?:other )?(?:nonland )?(?:creatures|permanents|nonland permanents)\b|\b(?:all|each) (?:other )?creatures? gets? -\d+\/-\d+|\bdeals? (?:\d+|x) damage to each creature\b/],
  ["removal", /\b(?:destroy|exile) (?:up to (?:one|two|three) )?(?:another )?target (?:(?:non(?:white|blue|black|red|green|artifact|land|token|creature|legendary)|attacking|blocking|tapped|untapped|creature|artifact|enchantment)(?: or)?\s+)*(?:creature|permanent|planeswalker|artifact|enchantment)\b|\bdeals? (?:\d+|x) damage to (?:any target|target creature|target attacking|target blocking)|\btarget creature (?:an opponent controls )?gets -\d+\/-\d+|\btarget opponent sacrifices\b|\beach opponent sacrifices\b/],
  ["burn", /\bdeals? (?:\d+|x|that much) damage to (?:any target|target player|target opponent|each opponent|each player|that player)\b/],
  ["lifegain", /\byou gain (?:\d+|x|that much|life equal)\b|\bgains? (?:\d+|x) life\b|\bwhenever you gain life\b/],
  ["counters", /\+1\/\+1 counters?\b|\bproliferate\b/],
  ["ramp", /\bsearch your library for (?:a|an|up to (?:one|two|three)) (?:basic )?(?:land|forest|island|swamp|mountain|plains)\b|\bput (?:a|an|up to (?:one|two)) land cards? from your hand onto the battlefield\b|\byou may play (?:an|two) additional lands?\b/],
  ["tutor", /\bsearch your library for (?:a|an|up to (?:one|two|three)) (?!(?:basic )?(?:land|forest|island|swamp|mountain|plains)\b)[a-z]/],
  ["reanimator", /\breturn (?:up to one )?target (?:[a-z]+ )?creature card from (?:your|a|an opponent's) graveyard to the battlefield\b|\bput (?:target|a) creature card from (?:a|your) graveyard onto the battlefield\b/],
  ["graveyard", /\bfrom your graveyard\b|\bin your graveyard\b|\b(?:flashback|escape|unearth)(?:—|\s*\{)|\bdelve\b/],
  ["sacrifice", /\bsacrifices? (?:a|an|another|one|two|x|any number of)\b/],
  ["discard", /\b(?:target|each|that) (?:player|opponent) discards?\b|\bdiscards that card\b|\bwhenever (?:a player|an opponent|you) discards?\b/],
  ["bounce", /\breturn (?:up to (?:one|two) )?target (?:nonland )?(?:creature|permanent|artifact|enchantment|spell)[^.]* to its owner's hand\b/],
  ["flicker", /\bexile (?:up to one )?(?:another )?target (?:nontoken )?(?:creature|permanent)[^.]*\bthen return (?:it|that card|them)\b/],
  ["landfall", /\blandfall\b|\bwhenever a land (?:you control )?enters\b/],
  ["anthem", /\b(?:other )?creatures you control get \+\d+\/\+\d+/],
  ["copy", /\bcopy (?:target|that|it)\b[^.]*\b(?:spell|instant|sorcery)\b|\bbecomes? a copy of\b|\benters? (?:the battlefield )?as a copy of\b|\bcreate a token that's a copy\b/],
  ["energy", /\{e\}/],
  ["poison", /\bpoison counters?\b|\binfect\b|\btoxic\b/],
  ["artifacts", /\bwhenever (?:you cast )?an artifact\b|\bartifacts you control\b|\bfor each artifact you control\b/],
  ["enchantments", /\bwhenever (?:you cast )?an enchantment\b|\benchantments you control\b|\bconstellation\b/],
  ["spellslinger", /\bwhenever you cast (?:an instant or sorcery|a noncreature) spell\b|\binstant and sorcery spells you cast\b|\bmagecraft\b/],
];

// Subtypes that name a theme of their own.
const SUBTYPE_THEMES: readonly (readonly [subtype: string, tag: string])[] = [
  ["Equipment", "equipment"],
  ["Aura", "auras"],
  ["Vehicle", "vehicles"],
  ["Saga", "sagas"],
];

/** The keyword-ability tags (lower-case: "first strike"); the test holds
 *  each to the Comprehensive Rules' keyword abilities. */
export const KEYWORD_ABILITY_TAGS: readonly string[] = KEYWORD_ABILITIES.map((name) => name.toLowerCase());
/** The keyword-action tags; the test holds each to the keyword actions. */
export const KEYWORD_ACTION_TAGS: readonly string[] = KEYWORD_ACTIONS.map((name) => name.toLowerCase());
/** Every tag this module can suggest — the test holds each to the tags
 *  schema's shape. */
export const AUTO_TAG_VOCABULARY: readonly string[] = Array.from(
  new Set([
    ...TRIBES.map(([, tag]) => tag),
    ...SUBTYPE_THEMES.map(([, tag]) => tag),
    ...THEMES.map(([tag]) => tag),
    ...KEYWORD_ABILITY_TAGS,
    ...KEYWORD_ACTION_TAGS,
  ]),
);

const escapeRegExp = (text: string) => text.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");

/** A tribe in a TRIBAL phrase of rules text, the type as print capitalises
 *  it (case-sensitive; the singular and the plural from the tag): "Goblin
 *  creature token(s)" / "Goblin token(s)", "Goblins you control" / "Goblin
 *  creatures you control", "other Goblins" / "other Goblin creatures",
 *  "Goblin spell(s)". */
const TRIBE_PATTERNS: readonly (readonly [tag: string, singular: string, pattern: RegExp])[] = TRIBES.map(([singular, tag]) => {
  const s = escapeRegExp(singular);
  const p = escapeRegExp(tag.charAt(0).toUpperCase() + tag.slice(1));
  const group = `(?:${p}|${s} creatures)`;
  const phrase = [
    `(?:${s}|${p}) (?:creature )?tokens?(?![A-Za-z])`,
    `${group} you control(?![A-Za-z])`,
    `[Oo]ther ${group}(?![A-Za-z])`,
    `(?:${s}|${p}) spells?(?![A-Za-z])`,
  ].join("|");
  return [tag, singular, new RegExp(`(?<![A-Za-z])(?:${phrase})`)] as const;
});

const ACTION_PATTERNS: readonly (readonly [tag: string, pattern: RegExp])[] = KEYWORD_ACTION_TAGS.map((tag) => {
  // "scry" → scry / scries / scried; "explore" → explores / explored; a
  // multi-word action is matched as written.
  const stem = tag.endsWith("y") && !tag.includes(" ") ? `${escapeRegExp(tag.slice(0, -1))}(?:y|ies|ied|ying)` : `${escapeRegExp(tag.replace(/e$/, ""))}(?:e|es|ed|ing|s)?`;
  const body = tag.includes(" ") ? escapeRegExp(tag) : stem;
  return [tag, new RegExp(`(?<![a-z])${body}(?![a-z])`)] as const;
});

/** Rules text as the patterns read it: reminder text out, lower-case, the
 *  curly apostrophe and the print minus read as typed. */
function normalizedRules(text: string): string {
  return text
    .replace(/\([^()]*\)/g, " ")
    .replace(/[’‘]/g, "'")
    .replace(/[−–]/g, "-")
    .toLowerCase();
}

function subtypeList(subtypes: AutoTagInput["subtypes"]): string[] {
  const list = typeof subtypes === "string" ? subtypes.split(/[,\n]/) : (subtypes ?? []);
  return list.map((word) => word.trim().toLowerCase()).filter(Boolean);
}

/** The keyword abilities a rules text HAS: a line (or the start of one)
 *  that is a list of keywords — "Flying, vigilance", "Ward {2}",
 *  "Protection from red" — and those it GRANTS ("gains flying and haste",
 *  "have trample"). A keyword merely named ("can't be blocked except by
 *  creatures with flying") is not the card's. */
function keywordAbilitiesOf(rules: string): Set<string> {
  const found = new Set<string>();
  const startsWithKeyword = (segment: string): string | null => {
    const text = segment.trim();
    for (const tag of KEYWORD_ABILITY_TAGS) {
      if (text === tag || (text.startsWith(tag) && /^[\s{\d—x-]/.test(text.slice(tag.length)))) return tag;
    }
    return null;
  };
  for (const line of rules.split("\n")) {
    const segments = line.split(/[,;]/);
    const first = startsWithKeyword(segments[0] ?? "");
    if (first) {
      for (const segment of segments) {
        const tag = startsWithKeyword(segment.replace(/^\s*and\s+/, ""));
        if (tag) found.add(tag);
      }
    }
    for (const grant of line.matchAll(/\b(?:has|have|gains?|gain)\s+([^.;:]*?)(?=\s+until\b|\s+as long as\b|[.;:]|$)/g)) {
      for (const piece of grant[1].split(/,|\band\b/)) {
        const tag = startsWithKeyword(piece);
        if (tag) found.add(tag);
      }
    }
  }
  return found;
}

/**
 * The tags a card's words suggest, at most AUTO_TAG_LIMIT, in a fixed
 * order: tribes from the subtypes, themes from the subtypes, themes from
 * the rules text, the keyword abilities it has, the keyword actions it
 * names, then tribes its rules text names in a tribal phrase. Every face's
 * and part's rules text and subtypes are read (`otherFaces`), the name
 * never. The same input always gives the same list.
 */
export function autoTagsFor(input: AutoTagInput): string[] {
  const faces: AutoTagFace[] = [input, ...(input.otherFaces ?? [])];
  const rawRules = faces
    .map((face) => face.rules_text ?? "")
    .filter((text) => text.trim() !== "")
    .join("\n");
  const rules = normalizedRules(rawRules);
  const subtypes = faces.flatMap((face) => subtypeList(face.subtypes));
  const out: string[] = [];
  const add = (tag: string) => {
    if (!out.includes(tag)) out.push(tag);
  };

  for (const [tag, singular] of TRIBE_PATTERNS) {
    const lower = singular.toLowerCase();
    if (subtypes.includes(lower) || subtypes.includes(tag)) add(tag);
  }
  for (const [subtype, tag] of SUBTYPE_THEMES) {
    if (subtypes.includes(subtype.toLowerCase())) add(tag);
  }
  const isLand = (input.card_type ?? "").trim().toLowerCase() === "land";
  for (const [tag, pattern] of THEMES) {
    // A land that fetches a land is a land, not ramp.
    if (tag === "ramp" && isLand) continue;
    if (pattern.test(rules)) add(tag);
  }
  const abilities = keywordAbilitiesOf(rules);
  for (const tag of KEYWORD_ABILITY_TAGS) {
    if (abilities.has(tag)) add(tag);
  }
  for (const [tag, pattern] of ACTION_PATTERNS) {
    if (pattern.test(rules)) add(tag);
  }
  const prose = rawRules.replace(/\([^()]*\)/g, " ").replace(/[’‘]/g, "'");
  for (const [tag, , pattern] of TRIBE_PATTERNS) {
    if (pattern.test(prose)) add(tag);
  }
  return out.slice(0, AUTO_TAG_LIMIT);
}
