// The NAMES an AI deck remix writes onto the card (owner decision B3,
// 2026-09-29) — pure, so the step's naming is the tested path
// (tests/unit/ai/remix-names.test.ts).
//
// A remix is a re-skin: cost, type line, rules and stats stay the source's.
// The AI identity (lib/ai/remix.ts) supplies a new name — and, for a
// two-part layout card, a new name for the second half too, read together
// with the first as one card (Bonecrusher Giant // Stomp used to become
// "<new name> // Stomp"). The rules text keeps its mechanics but follows the
// new names: "Stomp deals 2 damage to any target." would otherwise print a
// real card's name on the remix.

import type { CardBackFace, FrameTemplate } from "@/types/card";
import { kindFromCard, templatePaintsSecondFace } from "@/lib/creator/card-kinds";

/** The layout kinds whose frame paints a second half the remix names. */
export const REMIX_SECOND_HALF_LAYOUTS = ["adventure", "split", "aftermath", "flip"] as const;
export type RemixSecondHalfLayout = (typeof REMIX_SECOND_HALF_LAYOUTS)[number];

/** The layout a landed template's second half belongs to, or null when the
 *  template paints no second half (a standard frame, the saga's rail). */
export function remixSecondHalfLayout(
  template: FrameTemplate | string | undefined,
): RemixSecondHalfLayout | null {
  if (!template || !templatePaintsSecondFace(template)) return null;
  const kind = kindFromCard(undefined, template);
  return (REMIX_SECOND_HALF_LAYOUTS as readonly string[]).includes(kind)
    ? (kind as RemixSecondHalfLayout)
    : null;
}

/** What the identity call returns that the naming reads. */
export type RemixNames = {
  title: string;
  second_title?: string | null;
  second_flavor_text?: string | null;
};

export const REMIX_SECOND_NAME_MISSING =
  "The AI didn't name the card's second half — retry this card.";
export const REMIX_SECOND_NAME_REUSED =
  "The AI kept the second half's original name — retry this card.";
export const REMIX_NAME_REUSED =
  "The AI kept one of the card's original names — retry this card.";

/**
 * The short name rules text calls a card by, or null: the part before the
 * comma ("Dokai, Weaver of Life" → "Dokai"), or — for a LEGENDARY face
 * without one — the ONE word before " the " ("Goka the Unjust" → "Goka":
 * Scryfall's oracle for the CHK flip reads "Goka deals 4 damage"). Never
 * shorter than 3 characters. A non-legendary "Curse of the Fire Penguin"
 * has no short name, nor does the legendary "Kodama of the North Tree"
 * (its rules text uses the full name).
 */
export function shortNameOf(
  name: string,
  supertype?: string | null,
): string | null {
  const title = name.trim();
  const comma = title.indexOf(",");
  let short = comma > 0 ? title.slice(0, comma).trim() : "";
  if (!short && /\blegendary\b/i.test(supertype ?? "")) {
    const the = title.indexOf(" the ");
    const head = the > 0 ? title.slice(0, the).trim() : "";
    if (head && !/\s/.test(head)) short = head;
  }
  return short.length >= 3 ? short : null;
}

/** True when a new name is the old one again, or keeps a legendary's own
 *  name ("Dokai, Weaver of Life" → "Dokai, Lifebringer", seen in a live
 *  run 2026-09-28; "Goka the Unjust" → "Goka the Merciful"): the half
 *  wasn't renamed. */
export function reusesSourceName(
  newName: string,
  oldName: string,
  oldSupertype?: string | null,
): boolean {
  const next = newName.trim().toLowerCase();
  const old = oldName.trim().toLowerCase();
  if (!old) return false;
  if (next === old) return true;
  const short = shortNameOf(oldName, oldSupertype)?.toLowerCase();
  if (!short) return false;
  return new RegExp(`(?<![\\p{L}\\p{N}])${escapeRegExp(short)}(?![\\p{L}\\p{N}])`, "u").test(next);
}

// A one-word name that is also a word rules text starts sentences with
// ("Exile" is a real card; "Exile target creature." is not about it) can't
// be told apart from the instruction, so its self-references are left as
// they are. Compared case-insensitively.
const RULES_WORDS: ReadonlySet<string> = new Set([
  "activate", "add", "all", "another", "any", "as", "at", "attach", "attack",
  "block", "cast", "choose", "copy", "counter", "create", "destroy", "discard",
  "double", "draw", "each", "exchange", "exile", "explore", "fight", "flip",
  "gain", "if", "investigate", "it", "look", "lose", "mill", "play", "prevent",
  "proliferate", "put", "regenerate", "remove", "return", "reveal",
  "sacrifice", "scry", "search", "shuffle", "surveil", "take", "tap", "target",
  "that", "then", "this", "transform", "turn", "until", "untap", "up", "vote",
  "when", "whenever", "you",
]);

function escapeRegExp(text: string): string {
  return text.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
}

/** old → new name pairs for one face, plus a legendary's short name
 *  ("Dokai, Weaver of Life" is "Dokai" and "Goka the Unjust" is "Goka" in
 *  modern rules text; shortNameOf). */
function renamePairs(
  oldName: string,
  newName: string,
  supertype?: string | null,
): [string, string][] {
  const from = oldName.trim();
  const to = newName.trim();
  if (!from || !to || from === to) return [];
  const pairs: [string, string][] = [[from, to]];
  const short = shortNameOf(from, supertype);
  if (short) pairs.push([short, shortNameOf(to, supertype) ?? to]);
  return pairs.filter(
    ([name]) => /\s/.test(name) || !RULES_WORDS.has(name.toLowerCase()),
  );
}

/**
 * Rules text with every whole-word, same-case mention of an old name
 * replaced by its new one, in one pass (a new name that contains the old
 * one is never re-scanned; the longest name wins an overlap). Possessives
 * follow ("Juggernaut's" → "Iron Colossus's"); "Firebolt" is not "Fire".
 */
export function renameSelfReferences(
  text: string | undefined,
  pairs: readonly [string, string][],
): string | undefined {
  if (!text || pairs.length === 0) return text;
  const map = new Map<string, string>();
  for (const [from, to] of pairs) if (!map.has(from)) map.set(from, to);
  const names = [...map.keys()].sort((a, b) => b.length - a.length);
  const pattern = new RegExp(
    `(?<![\\p{L}\\p{N}])(?:${names.map(escapeRegExp).join("|")})(?![\\p{L}\\p{N}])`,
    "gu",
  );
  return text.replace(pattern, (match) => map.get(match) ?? match);
}

export type RemixNamedFaces =
  | {
      ok: true;
      title: string;
      rules_text?: string;
      back_face?: CardBackFace;
    }
  | { ok: false; error: string };

/**
 * The remixed card's names: the identity's title on the front and — when
 * the remix carries a second half — its second_title on that half, with
 * both halves' rules text following both renames. The second half's
 * flavour is the identity's, and only where the source half had flavour
 * (a half's text box is small). No second name, or either new name keeping
 * EITHER original name or a legendary's own name (reusesSourceName — the
 * names the prompt reserves: "Erayo's Echo" after "Erayo, Soratami
 * Ascendant // Erayo's Essence", or a swapped "Ice // Fire") → the step
 * fails, before the art is paid for, and the credit wrapper refunds it; it
 * never ships the source's name on a renamed card. A one-faced card is not
 * guarded (its naming is what it was before B3).
 */
export function applyRemixNames(
  source: {
    title: string;
    supertype?: string | null;
    rules_text?: string;
    back_face?: CardBackFace;
  },
  names: RemixNames,
): RemixNamedFaces {
  const back = source.back_face;
  const secondTitle = names.second_title?.trim();
  if (back && !secondTitle) {
    return { ok: false, error: REMIX_SECOND_NAME_MISSING };
  }
  if (back && secondTitle) {
    const originals: [string, string | null | undefined][] = [
      [back.title, back.supertype],
      [source.title, source.supertype],
    ];
    if (originals.some(([name, supertype]) => reusesSourceName(secondTitle, name, supertype))) {
      return { ok: false, error: REMIX_SECOND_NAME_REUSED };
    }
    if (originals.some(([name, supertype]) => reusesSourceName(names.title, name, supertype))) {
      return { ok: false, error: REMIX_NAME_REUSED };
    }
  }
  const pairs = [
    ...renamePairs(source.title, names.title, source.supertype),
    ...(back && secondTitle
      ? renamePairs(back.title, secondTitle, back.supertype)
      : []),
  ];
  return {
    ok: true,
    title: names.title,
    rules_text: renameSelfReferences(source.rules_text, pairs),
    back_face:
      back && secondTitle
        ? {
            ...back,
            title: secondTitle,
            rules_text: renameSelfReferences(back.rules_text, pairs),
            flavor_text: back.flavor_text?.trim()
              ? names.second_flavor_text?.trim() || undefined
              : undefined,
          }
        : undefined,
  };
}
