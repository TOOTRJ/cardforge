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

export type DeckTokenKind = "token" | "emblem";

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

/** The tokens and emblems among a card's related objects — never the card
 *  itself, a meld piece, a combo piece that is a card, or a dungeon. */
export function tokenPartsOf(card: { id: string; all_parts?: readonly ScryfallPart[] | null }): TokenPart[] {
  const out: TokenPart[] = [];
  for (const part of card.all_parts ?? []) {
    if (!part || part.id === card.id) continue;
    const typeLine = part.type_line?.trim() || null;
    const emblem = /^emblem\b/i.test(typeLine ?? "");
    if (!emblem && part.component !== "token") continue;
    if (out.some((p) => p.id === part.id)) continue;
    out.push({ id: part.id, name: part.name, typeLine, kind: emblem ? "emblem" : "token" });
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

/**
 * The tokens and emblems a PipGlyph card's words make, in the order they
 * are named — only inside a sentence that CREATES (or, for an emblem, that
 * "gets an emblem"). `cardName` names an emblem ("<name> Emblem"). Copies
 * and wording outside the templates give nothing.
 */
export function tokensFromRulesText(text: string | null | undefined, cardName: string): TextToken[] {
  if (!text?.trim()) return [];
  const out: TextToken[] = [];
  const add = (token: TextToken) => {
    if (!out.some((t) => t.name === token.name && t.typeLine === token.typeLine && t.details === token.details)) {
      out.push(token);
    }
  };
  // One sentence at a time (a quoted ability is its own text: an emblem's
  // words are its details, never a token of the card's).
  for (const line of normalized(text).split("\n")) {
    const emblem = /you get an emblem with "([^"]+)"/i.exec(line);
    if (emblem) {
      const name = cardName.trim() ? `${cardName.trim()} Emblem` : "Emblem";
      add({ kind: "emblem", name, typeLine: "Emblem", details: emblem[1].trim().replace(/\.$/, "") });
    }
    const outsideQuotes = line.replace(/"[^"]*"/g, " ");
    for (const sentence of outsideQuotes.split(/(?<=\.)\s+/)) {
      if (!/\bcreates?\b/i.test(sentence)) continue;
      // From the verb on: "When it dies, create …" — what comes before the
      // verb is the trigger, never a token.
      const clause = sentence.slice(sentence.search(/\bcreates?\b/i));
      if (/\btokens? that'?s? (?:is )?a copy\b|\bcopy of\b/i.test(clause)) continue;
      for (const match of clause.matchAll(CREATURE_TOKEN)) {
        const [, power, toughness, colours, subtypes, types, abilities] = match;
        const typeWords = types.split(" ").map(titleCase).join(" ");
        const details = [
          `${power}/${toughness} ${colours.toLowerCase()}`,
          abilities?.trim() ? abilities.trim().replace(/\s+/g, " ") : null,
        ]
          .filter(Boolean)
          .join(" · ");
        add({ kind: "token", name: subtypes, typeLine: `Token ${typeWords} — ${subtypes}`, details });
      }
      for (const match of clause.matchAll(PREDEFINED_TOKEN)) {
        add({ kind: "token", name: match[1], typeLine: `Token Artifact — ${match[1]}`, details: null });
      }
    }
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

function tokenKey(kind: DeckTokenKind, name: string, typeLine: string | null, details: string | null): string {
  return [kind, name, typeLine ?? "", details ?? ""].map((part) => part.toLowerCase()).join("|");
}

/**
 * The deck's tokens and emblems: every played entry's, a token made by two
 * cards (or two printings of one token) listed once with both makers —
 * tokens first, then emblems, each by name. `partsById` is the real cards'
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
    .sort((a, b) => (a.kind === b.kind ? a.name.localeCompare(b.name) : a.kind === "token" ? -1 : 1));
}
