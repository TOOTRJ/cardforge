// ---------------------------------------------------------------------------
// The back face's gate (TODO 5.2; design 2026-10-02 §4.5, D2, D13) — the ONE
// rule createCardAction, updateCardAction and the Q3 move (dfc-adopt) run a
// back face through before it is stored, so the creator's form, a crafted
// payload, an import (5.4) and the AI deck remix all meet the same gate:
//
//   • a card whose front is NOT a double-faced front body carries no back
//     BODY (a legacy back — the 8 imported DFCs, every inline layout's
//     second panel — is untouched; lib/cards/dfc.ts backBodyError);
//   • a card on a DFC front body NEEDS its back face, typed one of the
//     wave-1 face types (DFC_FACE_TYPES; walker faces wait, owner Q2);
//   • its body is `bodyFor(layout, "back", back type, family)` — on a
//     create filled in when the payload names none and refused when it
//     names another; the stored template is always the derived one;
//   • on an UPDATE the STORED body wins (the body is structure, like the
//     front's template): a back whose type would derive another body is
//     refused, and only a change of the card's icon family (an edit's
//     `frame_anatomy.dfcIcon`) re-derives it — whatever body the patch
//     resent;
//   • its colour (the back's own, else the front's — stored explicitly) is
//     verified for that body (frameGateError — the front's gate, per
//     colour) and, on a spell body whose `c` is the artifact stand-in,
//     colourless only with "Artifact" on the type line (colorlessFaceAllowed,
//     design D2); an update re-checks only when the body or the colour
//     changed, as the front's legacy pin;
//   • a transform back saves with no mana cost (withTransformBackShape).
//
// Pure: no I/O. The caller fetches the verified keys and decides whether an
// admin's frame preview skips verification.
// ---------------------------------------------------------------------------

import { normalizeFrameTemplate } from "@/lib/cards/card-display";
import {
  DEFAULT_DFC_ICON,
  bodyFor,
  colorlessFaceAllowed,
  dfcBodyOf,
  isDfcBackBody,
  isDfcFaceType,
  isDfcIconFamily,
  withTransformBackShape,
  type DfcIconFamily,
  type DfcLayout,
} from "@/lib/cards/dfc";
import { frameGateError } from "@/lib/cards/frame-availability";
import { pickFrameColorKey } from "@/lib/cards/frame-color-key";
import type { ColorIdentity, FrameTemplate } from "@/types/card";

/** A back face as the actions see it: the 0015 content plus, since 5.0a,
 *  the back's body and colour (lib/validation/card.ts backFaceSchema). */
export type DfcBackFacePayload = {
  title?: string | null;
  cost?: string | null;
  card_type?: string | null;
  supertype?: string | null;
  art_url?: string | null;
  frame_style?: { template?: string } | null;
  color_identity?: readonly ColorIdentity[] | null;
} & Record<string, unknown>;

export type DfcBackGateField =
  | "back_face.frame_style"
  | "back_face.card_type"
  | "back_face.color_identity";

export type DfcBackGateResult =
  | {
      ok: true;
      /** The back face to store: the payload with its derived body, its
       *  explicit colour and its shape (a transform back with no cost); the
       *  payload itself when the card has no DFC front. */
      back: DfcBackFacePayload | null;
      /** The DFC layout the front is, or null for any other card. */
      layout: DfcLayout | null;
    }
  | {
      ok: false;
      field: DfcBackGateField;
      message: string;
      /** The one refusal an admin's frame preview may override. */
      code?: "unverified";
    };

export type DfcBackGateInput = {
  /** The card's template as it will be stored. */
  frontTemplate: FrameTemplate | string | null | undefined;
  /** The back face as it will be stored (the patch, or the stored one when
   *  an update leaves it alone). */
  back: DfcBackFacePayload | null | undefined;
  /** The card's icon family as it will be stored (frame_style.dfcIcon). */
  family: DfcIconFamily | string | null | undefined;
  /** The card's colour as it will be stored — a back with no colour of its
   *  own takes it. */
  frontColorIdentity: readonly ColorIdentity[] | null | undefined;
  verifiedKeys: ReadonlySet<string>;
  /** An admin's frame preview: the verification gate doesn't apply. */
  skipVerification?: boolean;
  /** An UPDATE: the stored back (its body wins) and whether the family
   *  changed in this patch (the one change that re-derives the body). */
  stored?: {
    back: DfcBackFacePayload | null | undefined;
    familyChanged: boolean;
  };
};

export const DFC_FRONT_HAS_NO_BACK = "This frame has no back face of its own.";
export const DFC_NOT_A_BACK_BODY = "Not a back-face frame.";
export const DFC_NEEDS_BACK_FACE = "A double-faced card needs its back face.";
export const DFC_BACK_TYPE_REFUSED =
  "A back face can be a creature, artifact, enchantment, land, instant or sorcery.";
export const DFC_BACK_BODY_MISMATCH =
  "The back face's frame doesn't match its type and the card's icon family.";
export const DFC_BACK_BODY_SET =
  "The back face's frame is set — its type can't move it onto another frame.";
export const DFC_NO_BACK_BODY_YET = "No back-face frame exists for this card yet.";
export const DFC_COLORLESS_NEEDS_ARTIFACT =
  "A colourless back face needs “Artifact” on its type line — pick a colour.";
export const DFC_COLORLESS_FRONT_NEEDS_ARTIFACT =
  "A colourless double-faced card needs “Artifact” on its type line — pick a colour.";
export const DFC_FRONT_TYPE_REFUSED =
  "A double-faced card's front can be a creature, artifact, enchantment, land, instant or sorcery.";
export const DFC_FRONT_BODY_MISMATCH =
  "This double-faced frame doesn't dress that card type — the land frame is for lands, the other for everything else.";

/**
 * The FRONT face's type rule (TODO 5.2; owner Q2: walker faces wait): a card
 * on a DFC front body is one of the wave-1 face types (DFC_FACE_TYPES — the
 * Card step's face-type chips offer nothing else), and on the body its type
 * derives (the land front dresses lands only, the spell front everything
 * else: dfcFrontDressesKind's rule). The kind gate can't judge this: a card
 * on a front body IS the double-faced kind whatever its card_type says
 * (kindFromCard — the template wins), so a crafted planeswalker, saga, token
 * or battle front, or a creature on the land front, would pass it. Null when
 * the card may wear the body, else the `frame_style` field error. Any other
 * template: null.
 */
export function dfcFrontTypeError(
  frontTemplate: FrameTemplate | string | null | undefined,
  cardType: string | null | undefined,
): string | null {
  const front = normalizeFrameTemplate(frontTemplate);
  const body = dfcBodyOf(front);
  if (body?.role !== "front") return null;
  if (!isDfcFaceType(cardType)) return DFC_FRONT_TYPE_REFUSED;
  if (Boolean(body.land) !== (cardType === "land")) return DFC_FRONT_BODY_MISMATCH;
  return null;
}

/**
 * The FRONT face's colourless rule (design D2, the same as the back's): a
 * card on a DFC front body may be colourless only with "Artifact" on its
 * type line, where the body's `c` is the artifact master standing in
 * (colorlessFaceAllowed; the land front has one master under every key and
 * takes any land). Null when the card may wear its colour, else the
 * `color_identity` field error. Any other template: null.
 */
export function dfcFrontColorError(
  frontTemplate: FrameTemplate | string | null | undefined,
  face: { cardType?: string | null; supertype?: string | null },
  colorIdentity: readonly ColorIdentity[] | null | undefined,
): string | null {
  const front = normalizeFrameTemplate(frontTemplate);
  if (dfcBodyOf(front)?.role !== "front") return null;
  if (pickFrameColorKey(colorIdentity) !== "c") return null;
  return colorlessFaceAllowed(front, face) ? null : DFC_COLORLESS_FRONT_NEEDS_ARTIFACT;
}

/** The family as stored: a named one, else the default (`arrows`). */
export function dfcFamilyOf(value: unknown): DfcIconFamily {
  return isDfcIconFamily(value) ? value : DEFAULT_DFC_ICON;
}

/** The back's own colour, or the front's when it names none. */
function backColourOf(
  back: DfcBackFacePayload | null | undefined,
  frontColorIdentity: readonly ColorIdentity[] | null | undefined,
): ColorIdentity[] {
  const own = back?.color_identity;
  return own && own.length > 0 ? [...own] : [...(frontColorIdentity ?? [])];
}

/** A back face with its body and colour taken off — what a card keeps of
 *  its back when its front leaves a DFC body (a crafted frame_style patch):
 *  the content, drawn as a legacy back on the new front. */
export function stripBackBody<T extends DfcBackFacePayload>(back: T): Omit<T, "frame_style" | "color_identity"> {
  const { frame_style: _body, color_identity: _colour, ...content } = back;
  void _body;
  void _colour;
  return content;
}

export function resolveDfcBackFace(input: DfcBackGateInput): DfcBackGateResult {
  const front = normalizeFrameTemplate(input.frontTemplate);
  const body = dfcBodyOf(front);
  const layout = body?.role === "front" ? body.layout : null;
  const back = input.back ?? null;

  if (!layout) {
    // No back face of its own: a legacy or inline back is untouched; a body
    // on it is refused, whatever it names (lib/cards/dfc.ts backBodyError's
    // rule: the front first).
    if (back?.frame_style?.template) {
      return { ok: false, field: "back_face.frame_style", message: DFC_FRONT_HAS_NO_BACK };
    }
    return { ok: true, back, layout: null };
  }

  if (!back) return { ok: false, field: "back_face.frame_style", message: DFC_NEEDS_BACK_FACE };
  const backType = back.card_type ?? null;
  if (!isDfcFaceType(backType)) {
    return { ok: false, field: "back_face.card_type", message: DFC_BACK_TYPE_REFUSED };
  }

  const family = dfcFamilyOf(input.family);
  const derived = bodyFor(layout, "back", backType, family);
  if (!derived) return { ok: false, field: "back_face.frame_style", message: DFC_NO_BACK_BODY_YET };

  const storedBody = input.stored?.back?.frame_style?.template;
  const storedWins = Boolean(input.stored && storedBody && isDfcBackBody(storedBody) && !input.stored.familyChanged);
  let template: FrameTemplate;
  if (storedWins) {
    // The stored body is structure: a type that would derive another body
    // is refused; the same type keeps the body as stored.
    const typeChanged = (input.stored?.back?.card_type ?? null) !== backType;
    if (typeChanged && derived !== storedBody) {
      return { ok: false, field: "back_face.card_type", message: DFC_BACK_BODY_SET };
    }
    template = storedBody as FrameTemplate;
  } else {
    // A create: the payload's body is the derived one or none (a crafted
    // other is refused). An update that re-derives (the family changed, or
    // the stored back had no body) takes the derived body whatever the
    // patch resent — the server decides, as it does for the stored one.
    const sent = back.frame_style?.template;
    if (!input.stored && sent && sent !== derived) {
      return {
        ok: false,
        field: "back_face.frame_style",
        message: isDfcBackBody(sent) ? DFC_BACK_BODY_MISMATCH : DFC_NOT_A_BACK_BODY,
      };
    }
    template = derived;
  }

  const colour = backColourOf(back, input.frontColorIdentity);
  if (
    pickFrameColorKey(colour) === "c" &&
    !colorlessFaceAllowed(template, { cardType: backType, supertype: back.supertype })
  ) {
    return { ok: false, field: "back_face.color_identity", message: DFC_COLORLESS_NEEDS_ARTIFACT };
  }
  if (!input.skipVerification) {
    // An update re-checks only a changed body or colour (the front's
    // legacy-pin rule: a card on a since-withdrawn combo stays editable).
    const storedColour = input.stored
      ? backColourOf(input.stored.back, input.frontColorIdentity)
      : null;
    const unchanged =
      input.stored !== undefined &&
      storedBody === template &&
      storedColour !== null &&
      pickFrameColorKey(storedColour) === pickFrameColorKey(colour);
    if (!unchanged) {
      const gateError = frameGateError(template, colour, input.verifiedKeys);
      if (gateError) {
        return { ok: false, field: "back_face.color_identity", message: gateError, code: "unverified" };
      }
    }
  }

  return {
    ok: true,
    layout,
    back: withTransformBackShape(
      { ...back, frame_style: { template }, color_identity: colour },
      layout,
    ),
  };
}

/** True when a public save of this card would have an empty back window —
 *  a DFC front whose back has no art (design D13: the front's "no artwork →
 *  no gallery" rule on both faces; a legacy back keeps today's rule). */
export function dfcBackArtMissing(
  frontTemplate: FrameTemplate | string | null | undefined,
  back: DfcBackFacePayload | null | undefined,
): boolean {
  if (dfcBodyOf(normalizeFrameTemplate(frontTemplate))?.role !== "front") return false;
  return !back?.art_url;
}
