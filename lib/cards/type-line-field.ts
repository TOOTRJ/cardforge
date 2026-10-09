// ---------------------------------------------------------------------------
// The Types field (TODO 3b.16, owner 2026-10-09) — the words LEFT of a type
// line's dash as ONE editable text, pre-filled with the card type's word.
//
//   * the field starts as the line the card prints today (derivedTypesText:
//     "Creature", "Legendary Artifact Creature", a token's words without its
//     fixed "Token");
//   * the maker may type before and after the card type's word, reorder the
//     words, or remove the word — THEIR order prints (cards.printed_types,
//     migration 0137; lib/cards/card-display.ts typeLineWords);
//   * what the card IS never follows the printed line alone: the Identity
//     step's choice (`card_type`) keeps the frame, the P/T inputs, the hubs,
//     the deck statistics and the AI lint, and the OTHER words of the field
//     are kept in `supertype` (supertypeFromTypes), which is where every
//     behaviour reader already looks — "Creature" typed on a land shows a
//     P/T (Dryad Arbor), "Artifact" on a token picks the artifact frame,
//     "Legendary" offers the crown. Removing "Creature" from a creature's
//     line leaves it a creature.
//
// STORAGE: `printed_types` is null unless the typed line DIFFERS from the
// line the card would build by itself (resolvePrintedTypes) — so a maker who
// types "Legendary Creature" stores exactly what an import or the AI stores,
// and every row from before the field (null) prints as it always did.
//
// Pure; shared by the creator, both card actions and the import.
// ---------------------------------------------------------------------------

import { supertypeWords, typeLineWords } from "@/lib/cards/card-display";
import type { CardType } from "@/types/card";

/** The longest Types text a card stores: a full supertype (64) and the
 *  longest card type's word after it ("Planeswalker"). Mirrors the DB CHECK
 *  `cards_printed_types_length` (migration 0137). */
export const PRINTED_TYPES_MAX = 80;

type TypeFacts = { cardType?: CardType | "" | null; supertype?: string | null };

/** The card type's own word as the line prints it ("Creature"), or null for
 *  a token (its "Token" is a fixed prefix outside the field), an emblem (its
 *  line is fixed) and a face with no type yet. */
export function baseTypeWord(cardType: CardType | "" | null | undefined): string | null {
  if (!cardType || cardType === "token" || cardType === "emblem") return null;
  return cardType.charAt(0).toUpperCase() + cardType.slice(1);
}

/** The Types text a card prints when nobody typed one — typeLineWords'
 *  built line (printed order, TODO 1.20), a token's without its "Token". An
 *  emblem has no field: "". */
export function derivedTypesText({ cardType, supertype }: TypeFacts): string {
  if (cardType === "emblem") return "";
  const words = typeLineWords({ cardType: cardType || null, supertype });
  return (cardType === "token" ? words.slice(1) : words).join(" ");
}

/** What the Types field shows: the maker's text, else the built line. */
export function typesFieldText(facts: TypeFacts & { printedTypes?: string | null }): string {
  return typeof facts.printedTypes === "string" ? facts.printedTypes : derivedTypesText(facts);
}

/**
 * The `supertype` a typed Types text stands for: every word but the card
 * type's own (its FIRST occurrence, any case) — the importer's rule (TODO
 * 1.3), so every reader of `supertype` sees the words the maker typed:
 * "Legendary Goblin Creature" on a creature → "Legendary Goblin"; "Goblin"
 * (the word removed) → "Goblin"; "Land Creature" on a land → "Creature"; a
 * token's field IS its supertype.
 */
export function supertypeFromTypes(typed: string, cardType: CardType | "" | null | undefined): string {
  const words = supertypeWords(typed);
  const base = baseTypeWord(cardType)?.toLowerCase();
  const at = base ? words.findIndex((word) => word.toLowerCase() === base) : -1;
  return (at < 0 ? words : [...words.slice(0, at), ...words.slice(at + 1)]).join(" ");
}

/**
 * The `printed_types` a save STORES for a typed Types text: its words
 * single-spaced — or null when nobody typed one, on an emblem, and when the
 * typed line is exactly the line the card builds from its `supertype` and
 * card type (then there is nothing to remember: the built line is it).
 */
export function resolvePrintedTypes(
  facts: TypeFacts & { printedTypes?: string | null },
): string | null {
  if (typeof facts.printedTypes !== "string" || facts.cardType === "emblem") return null;
  const typed = supertypeWords(facts.printedTypes).join(" ");
  return typed === derivedTypesText(facts) ? null : typed;
}

/**
 * A typed Types text after ANOTHER control changed the card's `supertype`
 * (a token's type toggles, the artifact word of a borrowed frame, a basic
 * land's "Basic"): each word that control added is put into the text where
 * the printed order sets it among the words already there, each word it
 * removed is taken out; every other word stays where the maker typed it.
 */
export function typesAfterSupertypeChange(
  typed: string,
  before: string | null | undefined,
  after: string | null | undefined,
  insert: (text: string, word: string) => string,
): string {
  const has = (list: string[], word: string) => list.some((w) => w.toLowerCase() === word.toLowerCase());
  const was = supertypeWords(before);
  const now = supertypeWords(after);
  let words = supertypeWords(typed).filter((word) => !has(was, word) || has(now, word));
  for (const word of now) {
    if (!has(was, word) && !has(words, word)) words = supertypeWords(insert(words.join(" "), word));
  }
  return words.join(" ");
}

// ---------------------------------------------------------------------------
// Capitals (owner 2026-10-09, answer 3): each word of a type line is
// capitalised as prints set it, whatever case was typed.
// ---------------------------------------------------------------------------

// A word: a run of letters, digits and apostrophes. A hyphen, a comma, a
// space or a dash ends one, so "power-plant" is two ("Power-Plant", as
// "Assembly-Worker" prints) and "urza's" is one.
const WORD = /[\p{L}\p{M}\p{N}'’]+/gu;

/** `ch` in the other case when that is ONE character (never "ß" → "SS":
 *  the conversion may not change a text's length). */
function recase(ch: string, to: "upper" | "lower"): string {
  const other = to === "upper" ? ch.toUpperCase() : ch.toLowerCase();
  return other.length === ch.length ? other : ch;
}

/**
 * A type-line text with each word's FIRST letter a capital: "goblin
 * creature" → "Goblin Creature", "urza's power-plant" → "Urza's
 * Power-Plant". A word that starts with a digit is left alone ("90s"). The
 * rest of a word stays as typed — "McDonald", "B.O.B." — unless that leaves
 * the whole text in capitals (caps lock): "GOBLIN CREATURE" → "Goblin
 * Creature". Idempotent; never changes a text's length.
 */
export function capitalizeTypeWords(text: string): string {
  const firsts = text.replace(WORD, (word) => (/^\p{L}/u.test(word) ? recase(word[0], "upper") + word.slice(1) : word));
  const letters = firsts.replace(/[^\p{L}]/gu, "");
  const words = firsts.match(WORD) ?? [];
  const shouting =
    letters !== letters.toLowerCase() &&
    letters === letters.toUpperCase() &&
    words.some((word) => word.replace(/[^\p{L}]/gu, "").length >= 2);
  if (!shouting) return firsts;
  return firsts.replace(WORD, (word) =>
    /^\p{L}/u.test(word) ? word[0] + Array.from(word.slice(1), (ch) => recase(ch, "lower")).join("") : word,
  );
}

// ---------------------------------------------------------------------------
// The card actions — what a save stores
// ---------------------------------------------------------------------------

type SavedFace = {
  card_type?: CardType | null;
  supertype?: string | null;
  printed_types?: string | null;
};

/** A back face with its Types text as it is stored: the key only when the
 *  typed line differs from the built one (resolvePrintedTypes). */
function backFaceResolved<B extends SavedFace>(back: B): B {
  const { printed_types: typed, ...rest } = back;
  const stored = resolvePrintedTypes({ cardType: back.card_type, supertype: back.supertype, printedTypes: typed });
  return (stored === null ? rest : { ...rest, printed_types: stored }) as B;
}

/**
 * A NEW card's payload with its Types text as it is stored, on the front
 * and on a second face: null (the front) / no key (a back face) unless the
 * typed line differs from the line the face builds. `supertype` is the
 * payload's — the creator derives it from the typed text (supertypeFromTypes)
 * — and is never rewritten here: a remix carries its parent's supertype
 * beside a line re-worded on an edit.
 */
export function withPrintedTypes<T extends SavedFace & { back_face?: SavedFace | null }>(data: T): T {
  const out = {
    ...data,
    printed_types: resolvePrintedTypes({
      cardType: data.card_type,
      supertype: data.supertype,
      printedTypes: data.printed_types,
    }),
  };
  if (out.back_face) out.back_face = backFaceResolved(out.back_face);
  return out;
}

/**
 * An EDIT's patch with its Types text as it will be stored, judged on the
 * card as it will be saved (the patch over the stored row). A patch that
 * does not name the field leaves it alone (undefined stays undefined).
 */
export function withPrintedTypesUpdate<T extends SavedFace & { back_face?: SavedFace | null }>(
  data: T,
  stored: { card_type?: string | null; supertype?: string | null },
): T {
  const out = { ...data };
  if (data.printed_types !== undefined) {
    out.printed_types = resolvePrintedTypes({
      cardType: (data.card_type !== undefined ? data.card_type : stored.card_type) as CardType | null,
      supertype: data.supertype !== undefined ? data.supertype : stored.supertype,
      printedTypes: data.printed_types,
    });
  }
  if (out.back_face) out.back_face = backFaceResolved(out.back_face);
  return out;
}
