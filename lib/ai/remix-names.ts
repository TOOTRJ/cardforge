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

/** True when a new name is the old one again, or keeps a legendary's own
 *  name ("Dokai, Weaver of Life" → "Dokai, Lifebringer", seen in a live
 *  run 2026-09-28): the half wasn't renamed. */
export function reusesSourceName(newName: string, oldName: string): boolean {
  const next = newName.trim().toLowerCase();
  const old = oldName.trim().toLowerCase();
  if (!old) return false;
  if (next === old) return true;
  const comma = old.indexOf(",");
  const short = comma > 0 ? old.slice(0, comma).trim() : "";
  if (short.length < 3) return false;
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
 *  ("Dokai, Weaver of Life" is "Dokai" in modern rules text). */
function renamePairs(oldName: string, newName: string): [string, string][] {
  const from = oldName.trim();
  const to = newName.trim();
  if (!from || !to || from === to) return [];
  const pairs: [string, string][] = [[from, to]];
  const comma = from.indexOf(",");
  if (comma > 0) {
    const short = from.slice(0, comma).trim();
    const newComma = to.indexOf(",");
    const shortTo = newComma > 0 ? to.slice(0, newComma).trim() : to;
    if (short.length >= 3) pairs.push([short, shortTo]);
  }
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
 * (a half's text box is small). No second name, or the source's name kept
 * (reusesSourceName) → the step fails, before the art is paid for, and
 * the credit wrapper refunds it; it never ships the source's name on a
 * renamed card.
 */
export function applyRemixNames(
  source: { title: string; rules_text?: string; back_face?: CardBackFace },
  names: RemixNames,
): RemixNamedFaces {
  const back = source.back_face;
  const secondTitle = names.second_title?.trim();
  if (back && !secondTitle) {
    return { ok: false, error: REMIX_SECOND_NAME_MISSING };
  }
  if (back && secondTitle && reusesSourceName(secondTitle, back.title)) {
    return { ok: false, error: REMIX_SECOND_NAME_REUSED };
  }
  const pairs = [
    ...renamePairs(source.title, names.title),
    ...(back && secondTitle ? renamePairs(back.title, secondTitle) : []),
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
