import { CR_KEYWORD_ABILITY_NAMES, CR_KEYWORD_ACTION_NAMES } from "@/lib/cards/keyword-reminders";

// ---------------------------------------------------------------------------
// Keyword frequency (TODO DK7.3) — which keywords and mechanics a deck's
// cards print, counted in CARDS (quantity-weighted: 4× a flier is 4 cards
// with flying), never in mentions. Pure and client-safe.
//
// What is read: the RULES TEXT a card carries (a PipGlyph card's
// `rules_text`, its second face's too). A deck entry that is only a
// printing has no text on the page (deck_cards stores no Oracle text), so
// the count covers the cards made on PipGlyph — an unchanged import's text
// is its Oracle text — and the breakdown says how many that is.
//
// Four kinds, each found where print puts it:
//   * keyword ABILITIES (CR 702, lib/cards/keyword-reminders.ts) only on a
//     keyword line — every comma-separated item of the line opens with one
//     ("Flying, vigilance", "Ward {2}", "Equip—Pay 3 life.", "Protection
//     from red") — so "destroy target creature with flying" is no flier.
//     The evergreen ones are their own list (EVERGREEN_KEYWORDS); a
//     "<land type>walk" is Landwalk and a "<type>cycling" Cycling (702.14,
//     702.29);
//   * keyword ACTIONS (CR 701) that are a mechanic (scry, surveil, mill,
//     investigate…) anywhere in the text, any inflection ("mills",
//     "explores"); the actions that are plain rules English (cast, destroy,
//     exile, sacrifice…, EVERYDAY_ACTIONS) are not counted;
//   * ABILITY WORDS (CR 207.2c: "Landfall — Whenever…") — a capitalised
//     head of one to three words before a dash at a line's start, chapter
//     numerals and "Choose one —" aside: a custom card's own ability words
//     come out too;
//   * a NEW keyword a custom card defines: a line that is only a
//     capitalised word or two (and a number or cost) followed by its
//     reminder in brackets — "Glimmer 2 (When this…)".
// Reminder text never counts as text (a Treasure reminder is no sacrifice).
// ---------------------------------------------------------------------------

/** Wizards' evergreen keyword abilities (the Foundations list, 2024-11 —
 *  the CR names no "evergreen"), as the rules editor's toolbar writes them. */
export const EVERGREEN_KEYWORDS: readonly string[] = [
  "Deathtouch",
  "Defender",
  "Double strike",
  "Enchant",
  "Equip",
  "First strike",
  "Flash",
  "Flying",
  "Haste",
  "Hexproof",
  "Indestructible",
  "Lifelink",
  "Menace",
  "Protection",
  "Reach",
  "Trample",
  "Vigilance",
  "Ward",
];

/** CR 701 actions that are everyday rules English, not a mechanic. */
const EVERYDAY_ACTIONS: ReadonlySet<string> = new Set(
  [
    "Activate",
    "Attach",
    "Cast",
    "Counter",
    "Create",
    "Destroy",
    "Discard",
    "Double",
    "Triple",
    "Exchange",
    "Exile",
    "Play",
    "Reveal",
    "Sacrifice",
    "Search",
    "Shuffle",
    "Tap",
    "Untap",
    "Tap and Untap",
    "Planeswalk",
    "Abandon",
    "Heal",
  ].map((name) => name.toLowerCase()),
);

/** Names whose capitals are part of the name ("For Mirrodin!"). */
const KEEP_CASE = /!|\b(?:Mirrodin|Ring|Jace|Meets|Attractions?|Dungeon|Engines)\b/;

/** A name as the breakdown shows it: sentence case ("First strike",
 *  "Cumulative upkeep"), proper names as printed. */
function displayName(name: string): string {
  if (KEEP_CASE.test(name)) return name;
  return name.charAt(0).toUpperCase() + name.slice(1).toLowerCase();
}

const escape = (text: string) => text.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
const byLength = (a: string, b: string) => b.length - a.length;

const EVERGREEN_SET: ReadonlySet<string> = new Set(EVERGREEN_KEYWORDS.map((name) => name.toLowerCase()));

// Longest first, so "Double strike" wins over a shorter name and "Manifest
// dread" over "Manifest".
const ABILITY_NAMES = [...CR_KEYWORD_ABILITY_NAMES].sort(byLength);
const ABILITY_AT_START = new RegExp(`^(${ABILITY_NAMES.map(escape).join("|")})(?=$|[\\s—–\\-:{0-9X])`, "i");
const ACTION_NAMES = CR_KEYWORD_ACTION_NAMES.filter((name) => !EVERYDAY_ACTIONS.has(name.toLowerCase())).sort(byLength);
const ACTION_ANYWHERE = new RegExp(`\\b(${ACTION_NAMES.map(escape).join("|")})(?:s|es|ed|d)?\\b`, "gi");

const KNOWN: ReadonlyMap<string, string> = new Map(
  [...CR_KEYWORD_ABILITY_NAMES, ...CR_KEYWORD_ACTION_NAMES, ...EVERGREEN_KEYWORDS].map((name) => [name.toLowerCase(), name]),
);

/** What a keyword is, for the breakdown's list. */
export type KeywordKind = "evergreen" | "keyword" | "action" | "ability-word" | "new";

export type FoundKeyword = { key: string; name: string; kind: KeywordKind };

const REMINDER = /\([^()]*\)/g;
const ABILITY_WORD = /^([A-Z][\p{L}'’-]*(?: [\p{L}'’-]+){0,2}) ?[—–] ?\S/u;
const CHAPTER = /^[IVX]+(?:, ?[IVX]+)*$/;
const NEW_KEYWORD = /^([A-Z][\p{L}'’-]+(?: [\p{L}'’-]+)?)(?: (?:\d+|X|(?:\{[^}]+\})+))?\s*\([^()]+\)\.?$/u;
/** Words that start rules sentences, never a keyword's name. */
const SENTENCE_STARTS = new Set(["choose", "when", "whenever", "at", "if", "as", "you", "each", "target", "this", "that", "it", "draw", "add", "return", "put", "create", "destroy", "exile", "sacrifice", "counter", "search", "until", "for", "then", "spells", "creatures", "other", "all"]);

/** The keywords whose parameter is a word ("Enchant creature", "Champion a
 *  Faerie", "Equip legendary creature {3}"). */
const NOUN_PARAMETER: ReadonlySet<string> = new Set(["enchant", "champion", "equip", "craft"]);
/** The words that may follow any keyword ("Protection from red", "Partner
 *  with …", "Affinity for artifacts", "Trample over planeswalkers"). */
const LINK_WORDS: ReadonlySet<string> = new Set(["from", "with", "for", "onto", "over", "a", "an"]);

/** A known ability's canonical entry for one keyword-line item — never for a
 *  sentence that opens with one ("Flying creatures you control get…"). */
function abilityOf(item: string): FoundKeyword | null {
  const match = ABILITY_AT_START.exec(item);
  if (match) {
    const next = /^\s+([a-z]+)/.exec(item.slice(match[1].length))?.[1];
    if (next && !LINK_WORDS.has(next) && !NOUN_PARAMETER.has(match[1].toLowerCase())) return null;
  }
  let name: string | null = match ? (KNOWN.get(match[1].toLowerCase()) ?? match[1]) : null;
  if (!name) {
    // The landwalk and typecycling families (CR 702.14, 702.29).
    const head = /^([\p{L}-]+)(?=$|[\s{0-9X—–])/u.exec(item)?.[1]?.toLowerCase() ?? "";
    if (head.length > 4 && head.endsWith("walk")) name = "Landwalk";
    else if (head.length > 7 && head.endsWith("cycling")) name = "Cycling";
  }
  if (!name) return null;
  // The listed variants count as their family.
  if (/walk$/i.test(name)) name = "Landwalk";
  else if (/cycling$/i.test(name)) name = "Cycling";
  const key = name.toLowerCase();
  return { key, name: displayName(name), kind: EVERGREEN_SET.has(key) ? "evergreen" : "keyword" };
}

/** The keywords one card's rules text prints — each once. */
export function keywordsInRulesText(text: string | null | undefined): FoundKeyword[] {
  if (!text) return [];
  const found = new Map<string, FoundKeyword>();
  const add = (keyword: FoundKeyword) => {
    if (!found.has(keyword.key)) found.set(keyword.key, keyword);
  };

  for (const raw of text.split(/\r?\n/)) {
    const line = raw.trim();
    if (!line) continue;
    const plain = line.replace(REMINDER, " ").replace(/\s+/g, " ").trim().replace(/[.]$/, "");

    // A keyword line: every item opens with a keyword ability ("from …"
    // continues a protection item).
    const items = plain
      .split(/[,;]\s*/)
      .map((item) => item.trim())
      .filter((item) => item && !/^(?:and )?from\b/i.test(item));
    const abilities = items.map(abilityOf);
    const keywordLine = items.length > 0 && abilities.every(Boolean);
    if (keywordLine) {
      for (const ability of abilities) add(ability!);
    }

    if (!keywordLine) {
      // A custom keyword: the line is its name (and a number or cost) and
      // its reminder.
      const fresh = NEW_KEYWORD.exec(line);
      const freshName = fresh?.[1] ?? "";
      if (fresh && !KNOWN.has(freshName.toLowerCase()) && !SENTENCE_STARTS.has(freshName.split(" ")[0].toLowerCase())) {
        add({ key: freshName.toLowerCase(), name: displayName(freshName), kind: "new" });
      }
      // An ability word: "Landfall — Whenever…".
      const word = ABILITY_WORD.exec(plain);
      const head = word?.[1] ?? "";
      if (
        word &&
        !CHAPTER.test(head) &&
        !SENTENCE_STARTS.has(head.split(" ")[0].toLowerCase()) &&
        !abilityOf(head)
      ) {
        add({ key: head.toLowerCase(), name: displayName(head), kind: "ability-word" });
      }
    }

    // Keyword actions that are mechanics, anywhere in the line.
    for (const match of plain.matchAll(ACTION_ANYWHERE)) {
      const name = KNOWN.get(match[1].toLowerCase()) ?? match[1];
      add({ key: name.toLowerCase(), name: displayName(name), kind: "action" });
    }
  }
  return [...found.values()];
}

export type KeywordCount = FoundKeyword & { cards: number };

export type KeywordFrequency = {
  /** The evergreen keyword abilities, most cards first. */
  evergreen: KeywordCount[];
  /** Every other keyword, keyword action, ability word and new keyword. */
  mechanics: KeywordCount[];
  /** Cards (quantity-weighted) whose text was read. */
  cardsRead: number;
};

/** The deck's keyword counts over the cards whose text it has. Most cards
 *  first, then by name — two renders always agree. */
export function keywordFrequency(cards: ReadonlyArray<{ texts: ReadonlyArray<string | null | undefined>; quantity: number }>): KeywordFrequency {
  const counts = new Map<string, KeywordCount>();
  let cardsRead = 0;
  for (const card of cards) {
    const texts = card.texts.filter((text): text is string => typeof text === "string" && text.trim().length > 0);
    if (texts.length === 0) continue;
    cardsRead += card.quantity;
    const seen = new Map<string, FoundKeyword>();
    for (const text of texts) for (const keyword of keywordsInRulesText(text)) if (!seen.has(keyword.key)) seen.set(keyword.key, keyword);
    for (const keyword of seen.values()) {
      const count = counts.get(keyword.key) ?? { ...keyword, cards: 0 };
      count.cards += card.quantity;
      counts.set(keyword.key, count);
    }
  }
  const sorted = [...counts.values()].sort((a, b) => b.cards - a.cards || a.name.localeCompare(b.name));
  return {
    evergreen: sorted.filter((keyword) => keyword.kind === "evergreen"),
    mechanics: sorted.filter((keyword) => keyword.kind !== "evergreen"),
    cardsRead,
  };
}
