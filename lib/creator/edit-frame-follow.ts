// ---------------------------------------------------------------------------
// The frame that follows the text on an EDIT (owner decision 2026-11-22).
//
// Two frames follow a card's text rather than a pick: the token's box and
// height (TODO 4.49 (b), 4.48, 4.55 — the 2014–19 arch's textless frame,
// text box and tall box, the full-art design's three heights) and the
// borderless planeswalker's tall box, which four printed rows or more wear
// (frames plan 4.33). A NEW card follows them in the creator as the maker
// types (components/creator/card-creator-form.tsx). An EDIT never sends its
// template (lib/creator/revise.ts), so the edit's follow is the SERVER's:
// updateCardAction asks this function on the card as it will be stored, and
// the creator's edit preview asks the SAME function on the same text — so
// the preview shows exactly what the save stores. Before it, the edit's
// preview moved and the row stayed: a stored textless token given a flavour
// line baked its text on the textless frame (the state migration 0129
// cleaned up), a borderless walker given a fourth row kept the regular box.
//
// The rule, judged from the STORED row to the row as the edit leaves it:
//
//   * the frame follows only while the stored frame is the one the stored
//     text picks — a stored frame that disagrees with its stored text (a
//     variation picked by hand, an import pinned to its printing's box, an
//     Artifact dress over words that don't say Artifact) is a pick, and it
//     stays (round 11's rule, followTokenTextBox / followTokenHeight: the
//     arch's box also comes and goes with the text while its box-or-none
//     agreed with the stored text);
//   * it moves only between the heights of the design and dress the card
//     wears — never the design, the Artifact or Nyx dress (the type words
//     are locked on an edit);
//   * only onto a frame VERIFIED in the card's colour (the arch's regular
//     box standing in, silently, for an unverified tall box —
//     archTallStandIn); anything else keeps the stored frame, and
//     `unverified` names the frame the text asked for (the creator says so);
//   * only onto a frame the kind gate passes (frameKindGateError) — the
//     server's gates then see a move they pass;
//   * never an admin's saved frame preview (TODO 2.3): it previews its frame.
//
// A stored RETIRED template (TODO 4.54, alphatoken) is the frame the row
// reads as, judged by the text it will hold — retiredFrameStyleRewrite's
// answer, which the action stores itself (ungated, as before).
//
// Pure and client-safe.
// ---------------------------------------------------------------------------

import { isFrameComboAvailable } from "@/lib/cards/frame-availability";
import { pickFrameColorKey } from "@/lib/cards/frame-color-key";
import { cardFieldsFace, frameKindGateError } from "@/lib/cards/frame-kind-gate";
import { normalizeFrameTemplate, retiredFrameTemplate, supertypeHasWord } from "@/lib/cards/card-display";
import { archTallStandIn, tokenHeightOf } from "@/lib/cards/token-height";
import { kindFromCard, walkerRowCount, walkerRowsFrameFits, walkerRowsFrameFor } from "@/lib/creator/card-kinds";
import { followTokenHeight, tokenFrameText, type TokenFrameText } from "@/lib/creator/token-frame-auto";
import type { CardType, ColorIdentity, FaceContent, FrameTemplate } from "@/types/card";

/** The fields of a row the follow reads, in the snake_case a stored row and
 *  an update payload carry — the row as it is stored, or as the edit will
 *  leave it (the patch over the stored row). */
export type EditFollowFace = {
  card_type?: string | null;
  supertype?: string | null;
  subtypes?: readonly string[] | null;
  /** (The kind gate's basic-land rule reads it.) */
  title?: string | null;
  rules_text?: string | null;
  flavor_text?: string | null;
  power?: string | null;
  toughness?: string | null;
  /** Walker rows (the renderers read them before the rules text). */
  face_content?: FaceContent | null;
};

export type EditFrameFollow = {
  /** The template the edit stores the card on: the stored one (as the row
   *  reads it) unless the text moved it. */
  template: FrameTemplate;
  /** The template the edit MOVES the card onto, or null when it stays —
   *  what updateCardAction writes (a retired row is left to its own
   *  rewrite, retiredFrameStyleRewrite). */
  moved: FrameTemplate | null;
  /** The frame the text asked for that isn't verified in the card's colour
   *  (the card keeps its frame): the creator says so. */
  unverified?: FrameTemplate;
};

const tokenTextOf = (face: EditFollowFace): TokenFrameText =>
  tokenFrameText({
    cardType: (face.card_type || null) as CardType | null,
    supertype: face.supertype ?? null,
    subtypes: face.subtypes ?? [],
    rulesText: face.rules_text ?? null,
    flavorText: face.flavor_text ?? null,
    power: face.power ?? null,
    toughness: face.toughness ?? null,
  });

const walkerRowsOf = (face: EditFollowFace): number =>
  walkerRowCount({ faceContent: face.face_content ?? null, rulesText: face.rules_text ?? null });

/** The frame the edited text asks for on `template`, ignoring verification
 *  — `template` itself when nothing follows (another kind or frame, or a
 *  stored frame that disagrees with its stored text: a pick). */
function askedFor(template: FrameTemplate, stored: EditFollowFace, next: EditFollowFace): FrameTemplate {
  const kind = kindFromCard((stored.card_type || null) as CardType | null, template);
  if (kind === "token") {
    const of = tokenHeightOf(template);
    if (!of) return template;
    // The Artifact dress the type words pick: a frame that disagrees with
    // the stored words is a pick (the words are locked on an edit, and the
    // follow never changes a dress).
    if (of.artifact !== supertypeHasWord(stored.supertype, "Artifact")) return template;
    return followTokenHeight({
      ...tokenTextOf(next),
      // (…in the dress the card wears.)
      supertype: stored.supertype ?? null,
      template,
      previous: tokenTextOf(stored),
      heightPinned: false,
    });
  }
  if (kind === "planeswalker") {
    if (!walkerRowsFrameFits(kind, template, walkerRowsOf(stored))) return template;
    return walkerRowsFrameFor(kind, template, walkerRowsOf(next));
  }
  return template;
}

/**
 * The frame an EDIT stores the card on (see the header): `storedTemplate` is
 * the row's template as stored, `stored` the row, `next` the row as the edit
 * will leave it. Without `verifiedKeys` the answer is the frame the text
 * asks for, unverified — the server's first look, which reads the verified
 * set only when the text asks for a move.
 */
export function editFrameFollow(input: {
  storedTemplate: string | null | undefined;
  stored: EditFollowFace;
  next: EditFollowFace;
  /** The card's colour (locked on an edit). */
  colorIdentity: readonly ColorIdentity[] | null | undefined;
  verifiedKeys?: ReadonlySet<string>;
  /** An admin's saved frame preview (TODO 2.3): it keeps its frame. */
  framePreview?: boolean;
}): EditFrameFollow {
  const retired = retiredFrameTemplate(input.storedTemplate, input.next);
  if (retired) return { template: retired, moved: null };
  const template = normalizeFrameTemplate(input.storedTemplate);
  const stay: EditFrameFollow = { template, moved: null };
  if (input.framePreview) return stay;
  let target = askedFor(template, input.stored, input.next);
  if (target === template) return stay;
  if (!input.verifiedKeys) return { template: target, moved: target };
  const colorKey = pickFrameColorKey(input.colorIdentity ? [...input.colorIdentity] : undefined);
  if (!isFrameComboAvailable(target, colorKey, input.verifiedKeys)) {
    // The arch's tall box not verified in the colour: its regular box
    // stands in, silently (the text shrinks to fit, as before 4.55).
    const standIn = archTallStandIn(target);
    if (standIn === template) return stay;
    if (!standIn || !isFrameComboAvailable(standIn, colorKey, input.verifiedKeys)) {
      return { ...stay, unverified: standIn ?? target };
    }
    target = standIn;
  }
  if (frameKindGateError(target, cardFieldsFace(input.next)) !== null) return stay;
  return { template: target, moved: target };
}
