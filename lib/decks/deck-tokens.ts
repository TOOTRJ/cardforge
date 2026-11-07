// ---------------------------------------------------------------------------
// The tokens and emblems a deck's cards make (TODO DK5.16) — DISPLAY ONLY:
// the deck page lists them under "Tokens & emblems"; nothing here is ever
// written as a deck entry (the deck has no token zone).
//
// Two sources, one entry each:
//   * a REAL card (an entry with a printing and no PipGlyph card the viewer
//     reads): Scryfall's `all_parts` — every related object whose component
//     is "token", or whose type line says Emblem — read through the shared
//     client's batch lookup (lib/decks/deck-tokens-server.ts), never a scan;
//   * a PipGlyph card (the entry's card, as the viewer reads it): its own
//     words — rules text, walker rows, saga chapters, a second face — read
//     by `tokensFromRulesText` for the STANDARD templates only: a creature
//     token named with its power / toughness, colours and creature types
//     ("Create two 1/1 green Saproling creature tokens"), a predefined
//     artifact token ("Create a Treasure token") and a walker's emblem
//     ("You get an emblem with …"). A copy ("a token that's a copy of …")
//     and any wording outside those templates are left out — the section
//     says so (TOKEN_TEXT_NOTE).
// Nothing a viewer can't read feeds it: the page passes the rows as THIS
// viewer reads them (a "Private card" row has no card and no printing).
// Pure and client-safe.
// ---------------------------------------------------------------------------

/** A token, an emblem, or a HELPER card — the game pieces Scryfall lists
 *  as a "combo_piece" whose every face is a "Card" or a "Dungeon": the
 *  Monarch, the Initiative (Undercity), Day // Night, the venture
 *  dungeons, Energy Reserve, the Poison Counter… (TODO token kit). */
export type DeckTokenKind = "token" | "emblem" | "helper";

export type DeckToken = {
  /** Stable key: the same token from two cards (or two printings of one
   *  token) is listed once with both makers. */
  key: string;
  kind: DeckTokenKind;
  /** "Treasure", "Beast", "Veyra, Stormbound Emblem". */
  name: string;
  /** "Token Artifact — Treasure", "Token Creature — Beast", "Emblem — Veyra"
   *  (Scryfall's own for a real token). */
  typeLine: string | null;
  /** What the words say beyond the name: "4/4 green", "1/1 white · flying",
   *  an emblem's ability. Null for a Scryfall token (its picture says it). */
  details: string | null;
  /** Scryfall's token printing, when the token came from Scryfall. */
  scryfallId: string | null;
  /** Scryfall's "small" picture of that printing (the CDN's own path). */
  imageUrl: string | null;
  /** The deck's cards that make it, as the list names them, sorted. */
  makers: string[];
};

/** The section's one line about PipGlyph cards (shown under the list). */
export const TOKEN_TEXT_NOTE =
  "Tokens of PipGlyph cards are read from their rules text in the standard wording (a creature token with its power, toughness, colours and types, a Treasure, Food, Clue… or an emblem). A copy of a card, and any other wording, isn't listed.";

/** A Scryfall printing's picture at `size`, from its id alone — the CDN's
 *  path (`/<size>/front/<a>/<b>/<id>.jpg`), as lib/cards/frame-reference-
 *  registry.ts builds it. Null for anything that isn't an id. */
export function scryfallImageForId(id: string, size: "small" | "normal" = "small"): string | null {
  const clean = id.trim().toLowerCase();
  if (!/^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/.test(clean)) return null;
  return `https://cards.scryfall.io/${size}/front/${clean[0]}/${clean[1]}/${clean}.jpg`;
}

// ---------------------------------------------------------------------------
// Real cards: Scryfall's all_parts
// ---------------------------------------------------------------------------

export type ScryfallPart = {
  id: string;
  component?: string | null;
  name: string;
  type_line?: string | null;
};

/** One token / emblem a real card makes (its all_parts entry, kept small:
 *  what the cache stores per card). */
export type TokenPart = { id: string; name: string; typeLine: string | null; kind: DeckTokenKind };

/** True when a related object's type line is a helper card's: every face
 *  a bare "Card" (the Monarch, Day // Night, Energy Reserve, the Poison
 *  Counter) or a "Dungeon" (the venture dungeons, the Initiative's
 *  Undercity) — never a real card, whose faces carry card types. */
export function isHelperTypeLine(typeLine: string | null | undefined): boolean {
  const faces = (typeLine ?? "").split("//").map((face) => face.trim());
  return faces.length > 0 && faces.every((face) => /^(?:card|dungeon)\b/i.test(face) && !/^card\s*—/i.test(face));
}

/** The tokens, emblems and helper cards among a card's related objects —
 *  never the card itself, a meld piece, or a combo piece that is a real
 *  card. Scryfall files emblems and helper cards as "combo_piece"s (The
 *  Monarch: "Card"; Undercity // The Initiative: "Dungeon — Undercity //
 *  Card"), so those are read by their type line. */
export function tokenPartsOf(card: { id: string; all_parts?: readonly ScryfallPart[] | null }): TokenPart[] {
  const out: TokenPart[] = [];
  for (const part of card.all_parts ?? []) {
    if (!part || part.id === card.id) continue;
    const typeLine = part.type_line?.trim() || null;
    const emblem = /^emblem\b/i.test(typeLine ?? "");
    const helper = !emblem && part.component === "combo_piece" && isHelperTypeLine(typeLine);
    if (!emblem && !helper && part.component !== "token") continue;
    if (out.some((p) => p.id === part.id)) continue;
    out.push({ id: part.id, name: part.name, typeLine, kind: emblem ? "emblem" : helper ? "helper" : "token" });
  }
  return out;
}

// ---------------------------------------------------------------------------
// PipGlyph cards: the standard templates of their own text
// ---------------------------------------------------------------------------

/** A token one card's words make (before makers are joined in). */
export type TextToken = Omit<DeckToken, "key" | "makers" | "scryfallId" | "imageUrl">;

/** The predefined artifact tokens (CR 111.10), as printed. */
const PREDEFINED_TOKENS = [
  "Treasure",
  "Food",
  "Clue",
  "Blood",
  "Map",
  "Gold",
  "Powerstone",
  "Incubator",
  "Junk",
  "Shard",
  "Lander",
  "Mutagen",
] as const;

const COLOR_WORD = "(?:white|blue|black|red|green|colorless)";
const NUMBER_WORD = "(?:\\d+|X|\\*)";

/** "4/4 green Beast creature token(s) [with …]" — power / toughness, the
 *  colours ("red and white", "white, blue and black"), the creature types
 *  (each capitalised), the card types, and the abilities after "with". */
const CREATURE_TOKEN = new RegExp(
  `(${NUMBER_WORD})/(${NUMBER_WORD}) ` +
    `(${COLOR_WORD}(?:(?:, | and |, and )${COLOR_WORD})*) ` +
    `((?:[A-Z][A-Za-z'-]*)(?: [A-Z][A-Za-z'-]*)*) ` +
    `((?:legendary )?(?:snow )?(?:enchantment )?(?:artifact )?creature) tokens?` +
    `(?: with ((?:[a-z][a-z' -]*?)(?:(?:, | and |, and )[a-z][a-z' -]*?)*)(?=$|[.;,"]| and | that | where | for | until | if | then | attached ))?`,
  "g",
);

const PREDEFINED_TOKEN = new RegExp(`(?<![A-Za-z])(${PREDEFINED_TOKENS.join("|")}) tokens?(?![A-Za-z])`, "g");

/** Rules text as the templates read it: reminder text out, curly quotes and
 *  the print minus as typed, one space. */
function normalized(text: string): string {
  return text
    .replace(/\([^()]*\)/g, " ")
    .replace(/[’‘]/g, "'")
    .replace(/[“”]/g, '"')
    .replace(/[−–]/g, "-")
    .replace(/[ \t]+/g, " ");
}

function titleCase(word: string): string {
  return word ? word[0].toUpperCase() + word.slice(1) : word;
}

/** A token or emblem one card's words make, as STRUCTURED data (the token
 *  kit draws it; tokensFromRulesText words it for the deck page). */
export type TextTokenSpec = {
  kind: "token" | "emblem";
  /** "Saproling", "Soldier Warrior", "Treasure", "<card> Emblem". */
  name: string;
  /** The token's card-type words, printed order ("Creature",
   *  "Enchantment Artifact Creature", "Artifact"); null on an emblem. */
  typeWords: string | null;
  /** Its creature types / its predefined name, one word each. */
  subtypes: string[];
  /** Lower-case colour words ("green", "red", "colorless"). */
  colors: string[];
  power: string | null;
  toughness: string | null;
  /** The abilities after "with" as written ("flying", "vigilance and
   *  haste"); an emblem's ability. */
  abilities: string | null;
  /** How many one sentence makes: a number word, or null for "X" /
   *  "that many" (a variable count). */
  count: number | null;
  /** True when the sentence can make it again and again: a trigger
   *  ("Whenever", "At the beginning of", landfall) or an activated
   *  ability ("{2}, {T}: Create …"). */
  repeats: boolean;
};

const NUMBER_WORDS: Record<string, number> = {
  a: 1,
  an: 1,
  one: 1,
  two: 2,
  three: 3,
  four: 4,
  five: 5,
  six: 6,
  seven: 7,
  eight: 8,
  nine: 9,
  ten: 10,
};

/** How many tokens the words before a match name ("create two 1/1 …",
 *  "create a tapped Clue"): a number word or digits, else null (X, "that
 *  many", "a number of"). The adjectives between the count and the token
 *  are skipped. */
function countBefore(clause: string, index: number): number | null {
  const words = clause
    .slice(0, index)
    .trim()
    .split(/\s+/)
    .map((word) => word.toLowerCase().replace(/[^a-z0-9]/g, ""));
  while (words.length > 0 && /^(tapped|untapped|attacking|blocking|legendary|additional|more|and|token|tokens|another)$/.test(words[words.length - 1])) {
    words.pop();
  }
  const last = words[words.length - 1] ?? "";
  if (/^\d+$/.test(last)) return Math.max(1, Math.min(99, Number(last)));
  return NUMBER_WORDS[last] ?? (last === "create" || last === "creates" ? 1 : null);
}

/** True when a sentence can create again: its ability is a trigger
 *  ("Whenever", "At the beginning of", a landfall word — read on the
 *  ability's first sentence: Smothering Tithe's Treasure is made in the
 *  second) or an activated ability (a cost and a colon before the verb).
 *  "When … enters" creates once. */
function sentenceRepeats(ability: string, sentence: string, verbAt: number): boolean {
  if (/^\s*(?:whenever|at the beginning of|landfall)\b/i.test(ability)) return true;
  return sentence.slice(0, verbAt).includes(":");
}

/** Colour words as the rules wrote them: "green", "red and white",
 *  "white, blue and black". */
function colourPhrase(colors: readonly string[]): string {
  return colors.length <= 2 ? colors.join(" and ") : `${colors.slice(0, -1).join(", ")} and ${colors[colors.length - 1]}`;
}

/**
 * The tokens and emblems a PipGlyph card's words make, in the order they
 * are named, as structured specs — only inside a sentence that CREATES (or,
 * for an emblem, that "gets an emblem"). `cardName` names an emblem
 * ("<name> Emblem"). Copies and wording outside the templates give nothing.
 */
export function tokenSpecsFromRulesText(text: string | null | undefined, cardName: string): TextTokenSpec[] {
  if (!text?.trim()) return [];
  const out: TextTokenSpec[] = [];
  const add = (spec: TextTokenSpec) => {
    const same = out.find(
      (t) =>
        t.kind === spec.kind &&
        t.name === spec.name &&
        t.typeWords === spec.typeWords &&
        t.power === spec.power &&
        t.toughness === spec.toughness &&
        t.colors.join() === spec.colors.join() &&
        t.abilities === spec.abilities,
    );
    if (same) {
      same.repeats ||= spec.repeats;
      same.count = same.count === null || spec.count === null ? null : Math.max(same.count, spec.count);
      return;
    }
    out.push(spec);
  };
  // One sentence at a time (a quoted ability is its own text: an emblem's
  // words are its details, never a token of the card's).
  for (const line of normalized(text).split("\n")) {
    const emblem = /you get an emblem with "([^"]+)"/i.exec(line);
    if (emblem) {
      const name = cardName.trim() ? `${cardName.trim()} Emblem` : "Emblem";
      add({
        kind: "emblem",
        name,
        typeWords: null,
        subtypes: [],
        colors: [],
        power: null,
        toughness: null,
        abilities: emblem[1].trim().replace(/\.$/, ""),
        count: 1,
        repeats: false,
      });
    }
    const outsideQuotes = line.replace(/"[^"]*"/g, " ");
    for (const sentence of outsideQuotes.split(/(?<=\.)\s+/)) {
      const verbAt = sentence.search(/\bcreates?\b/i);
      if (verbAt < 0) continue;
      // From the verb on: "When it dies, create …" — what comes before the
      // verb is the trigger, never a token.
      const clause = sentence.slice(verbAt);
      if (/\btokens? that'?s? (?:is )?a copy\b|\bcopy of\b/i.test(clause)) continue;
      const repeats = sentenceRepeats(outsideQuotes, sentence, verbAt);
      for (const match of clause.matchAll(CREATURE_TOKEN)) {
        const [, power, toughness, colours, subtypes, types, abilities] = match;
        add({
          kind: "token",
          name: subtypes,
          typeWords: types.split(" ").map(titleCase).join(" "),
          subtypes: subtypes.split(" "),
          colors: colours
            .toLowerCase()
            .split(/, and |, | and /)
            .map((c) => c.trim())
            .filter(Boolean),
          power,
          toughness,
          abilities: abilities?.trim() ? abilities.trim().replace(/\s+/g, " ") : null,
          count: countBefore(clause, match.index ?? 0),
          repeats,
        });
      }
      for (const match of clause.matchAll(PREDEFINED_TOKEN)) {
        add({
          kind: "token",
          name: match[1],
          typeWords: "Artifact",
          subtypes: [match[1]],
          colors: ["colorless"],
          power: null,
          toughness: null,
          abilities: null,
          count: countBefore(clause, match.index ?? 0),
          repeats,
        });
      }
    }
  }
  return out;
}

/**
 * The tokens and emblems a PipGlyph card's words make, in the order they
 * are named, as the deck page words them (tokenSpecsFromRulesText).
 */
export function tokensFromRulesText(text: string | null | undefined, cardName: string): TextToken[] {
  const out: TextToken[] = [];
  for (const spec of tokenSpecsFromRulesText(text, cardName)) {
    const token: TextToken =
      spec.kind === "emblem"
        ? { kind: "emblem", name: spec.name, typeLine: "Emblem", details: spec.abilities }
        : spec.power !== null
          ? {
              kind: "token",
              name: spec.name,
              typeLine: `Token ${spec.typeWords} — ${spec.name}`,
              details: [`${spec.power}/${spec.toughness} ${colourPhrase(spec.colors)}`, spec.abilities].filter(Boolean).join(" · "),
            }
          : { kind: "token", name: spec.name, typeLine: `Token Artifact — ${spec.name}`, details: null };
    if (!out.some((t) => t.name === token.name && t.typeLine === token.typeLine && t.details === token.details)) out.push(token);
  }
  return out;
}

/** Every text of a PipGlyph card a token can be named in: its rules text,
 *  its walker rows and saga chapters (face_content, read before the text by
 *  the renderers — both are read here, a duplicate is listed once), and a
 *  second face's or part's rules text. Read defensively: a row stores JSON. */
export function cardTokenTexts(card: {
  rules_text?: string | null;
  face_content?: unknown;
  back_face?: unknown;
}): string[] {
  const texts: string[] = [];
  if (card.rules_text) texts.push(card.rules_text);
  const content = card.face_content as
    | { loyalty?: { abilities?: Array<{ text?: unknown }> }; saga?: { intro?: unknown; chapters?: Array<{ text?: unknown }> } }
    | null
    | undefined;
  for (const row of content?.loyalty?.abilities ?? []) if (typeof row?.text === "string") texts.push(row.text);
  if (typeof content?.saga?.intro === "string") texts.push(content.saga.intro);
  for (const row of content?.saga?.chapters ?? []) if (typeof row?.text === "string") texts.push(row.text);
  const back = card.back_face as { rules_text?: unknown } | null | undefined;
  if (typeof back?.rules_text === "string") texts.push(back.rules_text);
  return texts;
}

// ---------------------------------------------------------------------------
// The deck's list
// ---------------------------------------------------------------------------

/** What the list reads of an entry (a DeckItem as the viewer reads it). */
export type TokenSourceItem = {
  entry: { board: string; name: string; scryfall_id: string | null; quantity: number };
  card: {
    title: string;
    rules_text?: string | null;
    face_content?: unknown;
    back_face?: unknown;
  } | null;
};

/** Boards whose cards are played: the maybeboard never makes a token. */
function countsForTokens(item: TokenSourceItem): boolean {
  return item.entry.board !== "maybe" && item.entry.quantity > 0;
}

/** The printings whose all_parts the list needs: an entry with a printing
 *  and no PipGlyph card (a card's own words win: a proxy makes what ITS
 *  text says), once each, sorted (the cache key). */
export function realTokenSourceIds(items: readonly TokenSourceItem[]): string[] {
  const ids = new Set<string>();
  for (const item of items) {
    if (!countsForTokens(item) || item.card || !item.entry.scryfall_id) continue;
    ids.add(item.entry.scryfall_id);
  }
  return [...ids].sort();
}

/** The list's order: tokens, then emblems, then helper cards. */
const KIND_ORDER: Record<DeckTokenKind, number> = { token: 0, emblem: 1, helper: 2 };

function tokenKey(kind: DeckTokenKind, name: string, typeLine: string | null, details: string | null): string {
  return [kind, name, typeLine ?? "", details ?? ""].map((part) => part.toLowerCase()).join("|");
}

/**
 * The deck's tokens, emblems and helper cards: every played entry's, a
 * token made by two cards (or two printings of one token) listed once with
 * both makers — tokens first, then emblems, then helper cards, each by name. `partsById` is the real cards'
 * answer (realTokenSourceIds → Scryfall); a printing missing from it makes
 * nothing.
 */
export function collectDeckTokens(
  items: readonly TokenSourceItem[],
  partsById: ReadonlyMap<string, readonly TokenPart[]> | Readonly<Record<string, readonly TokenPart[]>>,
): DeckToken[] {
  const lookup = (id: string): readonly TokenPart[] =>
    partsById instanceof Map ? (partsById.get(id) ?? []) : ((partsById as Record<string, readonly TokenPart[]>)[id] ?? []);
  const byKey = new Map<string, DeckToken & { makerSet: Set<string> }>();
  const note = (token: Omit<DeckToken, "key" | "makers">, maker: string) => {
    const key = tokenKey(token.kind, token.name, token.typeLine, token.details);
    const found = byKey.get(key);
    if (found) {
      found.makerSet.add(maker);
      // A PipGlyph card's Treasure and a real card's: one token, drawn with
      // the real one's picture.
      if (!found.scryfallId && token.scryfallId) {
        found.scryfallId = token.scryfallId;
        found.imageUrl = token.imageUrl;
      }
      return;
    }
    byKey.set(key, { ...token, key, makers: [], makerSet: new Set([maker]) });
  };

  for (const item of items) {
    if (!countsForTokens(item)) continue;
    if (item.card) {
      const maker = item.card.title || item.entry.name;
      for (const text of cardTokenTexts(item.card)) {
        for (const token of tokensFromRulesText(text, item.card.title)) {
          note({ ...token, scryfallId: null, imageUrl: null }, maker);
        }
      }
      continue;
    }
    if (!item.entry.scryfall_id) continue;
    for (const part of lookup(item.entry.scryfall_id)) {
      note(
        {
          kind: part.kind,
          name: part.name,
          typeLine: part.typeLine,
          details: null,
          scryfallId: part.id,
          imageUrl: scryfallImageForId(part.id, "small"),
        },
        item.entry.name,
      );
    }
  }

  return [...byKey.values()]
    .map(({ makerSet, ...token }) => ({ ...token, makers: [...makerSet].sort((a, b) => a.localeCompare(b)) }))
    .sort((a, b) => (a.kind === b.kind ? a.name.localeCompare(b.name) : KIND_ORDER[a.kind] - KIND_ORDER[b.kind]));
}
