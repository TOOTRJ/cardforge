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
import { isBattleFront, isSagaFront, templateHasBackFace } from "@/lib/cards/dfc";
import { isTokenPairFront } from "@/lib/cards/token-faces";
import { escapeRegExp, isRulesWord, shortNameOf } from "@/lib/cards/card-names";

// The naming helpers moved to lib/cards/card-names.ts (TODO 6.2: the import
// reads them too); re-exported for the remix's own callers.
export { shortNameOf };

/** The layout kinds whose frame paints a second half the remix names — and
 *  the double-faced kinds (TODO 5.4), whose BACK FACE the remix names and
 *  paints as a second picture. */
export const REMIX_SECOND_HALF_LAYOUTS = ["adventure", "prepare", "split", "aftermath", "flip", "transform", "mdfc", "token"] as const;
export type RemixSecondHalfLayout = (typeof REMIX_SECOND_HALF_LAYOUTS)[number];

/** The double-faced layouts: the second half is a back face with its own
 *  art, not a panel the front's master paints. */
export const REMIX_DOUBLE_FACED_LAYOUTS: ReadonlySet<RemixSecondHalfLayout> = new Set(["transform", "mdfc", "token"]);

/** The layout a landed template's second half belongs to, or null when the
 *  template paints no second half (a standard frame, the saga's rail): a
 *  two-part layout's kind, the double-faced kind of a DFC front body, or
 *  `token` for a token template (a double-sided token's back — the caller
 *  asks only with a back face in hand). */
export function remixSecondHalfLayout(
  template: FrameTemplate | string | undefined,
): RemixSecondHalfLayout | null {
  // A double-sided token (TODO 5.5 (c)): its back is another token with a
  // picture of its own.
  if (isTokenPairFront(template)) return "token";
  if (!template || !(templatePaintsSecondFace(template) || templateHasBackFace(template))) return null;
  // A battle's back of its own (TODO 5.5) is a TRANSFORM back: its own
  // picture, named and painted as a transform card's is.
  // …and so is a double-faced saga's (TODO 5.5 (b)).
  if (isBattleFront(template) || isSagaFront(template)) return "transform";
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
  return pairs.filter(([name]) => !isRulesWord(name));
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
