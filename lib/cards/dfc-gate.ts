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
//   • on an UPDATE of a card whose back HAS a body the STORED colour wins
//     too (owner 2026-10-05: the back's colour is locked like the front's —
//     a colour change moves the back onto another master, which is what the
//     lock exists for): a patch naming another is refused, verified or not
//     and under an admin's preview skip (structure, not verification); one
//     naming none keeps it; the family (frame_anatomy.dfcIcon) stays the ONE
//     look change an edit may make. A back with no stored body — a legacy
//     back, a half-moved row — and a create take the colour as sent;
//   • a transform back saves with no mana cost (withTransformBackShape);
//   • a BATTLE front (TODO 5.5, DfcProfile.battle) is a transform front
//     whose back is OPTIONAL: a battle with no back saves as one; a back
//     that names NO body — and none is stored — is a LEGACY back, kept as
//     sent (its content drawn on the battle frame, as every battle import
//     before 5.5 stored it); a back that names a body (or whose stored back
//     has one) is a back of its own and meets every rule above, on the
//     ▼ back (the battle wears no family: always the default);
//   • the double-faced SAGA front (TODO 5.5 (b), DfcProfile.saga) is a
//     transform front like any other — its back required, on the body the
//     card's family derives — that dresses a saga (an enchantment) only;
//   • a Saga BACK (TODO 5.5 (b), PR 2: an enchantment back whose subtypes
//     say Saga, on the ▼ family and the bordered look) derives the saga
//     back (`backBodyFor` → `sagadfcback`) where it is published in the
//     colour the back wears, else its type's body as before; on an update
//     the stored body wins as for every back.
//
// Pure: no I/O. The caller fetches the verified keys and decides whether an
// admin's frame preview skips verification.
// ---------------------------------------------------------------------------

import { normalizeFrameTemplate } from "@/lib/cards/card-display";
import {
  DEFAULT_DFC_ICON,
  backBodyFor,
  bodyFor,
  colorlessFaceAllowed,
  dfcBodyOf,
  dfcLookOf,
  isDfcBackBody,
  isDfcFaceType,
  isDfcIconFamily,
  withTransformBackShape,
  type DfcIconFamily,
  type DfcLayout,
} from "@/lib/cards/dfc";
import { frameGateError, isFrameComboAvailable } from "@/lib/cards/frame-availability";
import { isTokenPairBack, isTokenPairFront, tokenDesignOf } from "@/lib/cards/token-faces";
import { tokenBackBodyFor } from "@/lib/creator/token-back";
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
      /** A double-sided token's back of its own (TODO 5.5 (c)). */
      tokenPair?: true;
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
export const DFC_BACK_COLOR_SET =
  "The back face's colour is set when the card is created, like the front's — to change it, forge a new card.";
export const DFC_NO_BACK_BODY_YET = "No back-face frame exists for this card yet.";
/** An edit that moves a double-faced card's front onto the other look
 *  (borderless / bordered) while its back keeps its stored body (TODO 5.7). */
export const DFC_LOOK_MISMATCH =
  "This card's back face is on the other look's frame — a borderless front needs a borderless back, and a bordered front a bordered one. Keep the front's look, or make a new card.";
export const DFC_COLORLESS_NEEDS_ARTIFACT =
  "A colourless back face needs “Artifact” on its type line — pick a colour.";
export const DFC_COLORLESS_FRONT_NEEDS_ARTIFACT =
  "A colourless double-faced card needs “Artifact” on its type line — pick a colour.";
export const DFC_FRONT_TYPE_REFUSED =
  "A double-faced card's front can be a creature, artifact, enchantment, land, instant or sorcery.";
export const DFC_BATTLE_FRONT_TYPE_REFUSED = "The battle frame dresses battles only.";
export const DFC_SAGA_FRONT_TYPE_REFUSED = "The double-faced saga frame dresses sagas only.";
/** A double-sided token's back face is a token too (TODO 5.5 (c)). */
export const TOKEN_BACK_TYPE_REFUSED = "A token's back face is a token too.";
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
  // The battle front (TODO 5.5) dresses a battle and nothing else — what
  // the kind gate says of it already (KIND_REQUIRES: the defense shield on
  // the landscape card), said here too so the two never disagree.
  if (body.battle) return cardType === "battle" ? null : DFC_BATTLE_FRONT_TYPE_REFUSED;
  // …and the double-faced saga front (TODO 5.5 (b)) a saga — the Saga
  // kind's card type (LAYOUT_KIND_CARD_TYPES.saga: an enchantment).
  if (body.saga) return cardType === "enchantment" ? null : DFC_SAGA_FRONT_TYPE_REFUSED;
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

/** The same colour identity as a SET — a pair resent in another order is
 *  the same colour (updateCardAction's reading of the front's). */
function sameColorIdentity(a: readonly ColorIdentity[], b: readonly ColorIdentity[]): boolean {
  return JSON.stringify([...a].sort()) === JSON.stringify([...b].sort());
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
  if (isTokenPairFront(front)) return resolveTokenBackFace(input, front);
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

  // The battle's back is optional (TODO 5.5): none, or a legacy back (no
  // body sent and none stored), is kept as it is — the card stays what it
  // was, one face or a legacy back on the battle frame.
  if (body?.battle) {
    if (!back) return { ok: true, back: null, layout };
    const storedBattleBody = input.stored?.back?.frame_style?.template;
    if (!back.frame_style?.template && !(storedBattleBody && isDfcBackBody(storedBattleBody))) {
      // (Its colour is never drawn — a legacy back draws on the battle's
      // frame and colour — and never stored: as every battle before 5.5.)
      return { ok: true, back: stripBackBody(back) as DfcBackFacePayload, layout: null };
    }
  }
  if (!back) return { ok: false, field: "back_face.frame_style", message: DFC_NEEDS_BACK_FACE };
  const backType = back.card_type ?? null;
  if (!isDfcFaceType(backType)) {
    return { ok: false, field: "back_face.card_type", message: DFC_BACK_TYPE_REFUSED };
  }

  // A battle wears no family (every battle printed is the plain ▲ / ▼): its
  // back is the default's whatever the key says.
  const family = body?.battle ? DEFAULT_DFC_ICON : dfcFamilyOf(input.family);
  // The back follows the front's look (TODO 5.7): a borderless front's back
  // is borderless — none yet for a land back or a 2016–22 family.
  const storedBody = input.stored?.back?.frame_style?.template;
  const storedHasBody = Boolean(input.stored && storedBody && isDfcBackBody(storedBody));
  // A Saga back (TODO 5.5 (b), PR 2) derives the saga back where it is
  // published in the colour the back will wear (the stored one on an edit
  // of a back with a body, else its own, else the front's) — or, under an
  // admin's frame preview, wherever it exists; short of that, the body every
  // other back of its type derives (today's), so nothing is refused that was
  // saved before.
  const wornColour = storedHasBody ? backColourOf(input.stored?.back, input.frontColorIdentity) : backColourOf(back, input.frontColorIdentity);
  const derived = backBodyFor(
    layout,
    { cardType: backType, subtypes: back.subtypes as readonly string[] | string | null | undefined },
    family,
    dfcLookOf(front),
    (template) => Boolean(input.skipVerification) || isFrameComboAvailable(template, pickFrameColorKey(wornColour), input.verifiedKeys),
  );
  if (!derived) return { ok: false, field: "back_face.frame_style", message: DFC_NO_BACK_BODY_YET };

  const storedWins = storedHasBody && !input.stored?.familyChanged;
  let template: FrameTemplate;
  if (storedWins && dfcLookOf(storedBody) !== dfcLookOf(front)) {
    // A front moved onto a body of the OTHER look (TODO 5.7: the borderless
    // front over a stored bordered back, or back) would draw two looks on one
    // card: refused — the back's body is structure and stays.
    return { ok: false, field: "back_face.frame_style", message: DFC_LOOK_MISMATCH };
  }
  if (storedWins) {
    // The stored body is structure: a type that would derive another body
    // is refused; the same type keeps the body as stored.
    // (A type its plain body would keep on the stored body — a creature
    // back retyped as a Saga on the ▼ back — is not a move, whether or not
    // the saga back is published: the stored body stays, as the creator
    // draws it.)
    const typeChanged = (input.stored?.back?.card_type ?? null) !== backType;
    if (typeChanged && derived !== storedBody && bodyFor(layout, "back", backType, family, dfcLookOf(front)) !== storedBody) {
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

  // The colour: on an UPDATE of a card whose back HAS a body the STORED one
  // wins, as the body does (owner 2026-10-05: locked like the front's) — a
  // patch naming another is refused whatever the verified set says, one
  // naming none keeps it. Else the back's own, or the front's.
  let colour: ColorIdentity[];
  if (storedHasBody) {
    const storedColour = backColourOf(input.stored?.back, input.frontColorIdentity);
    const sent = back.color_identity;
    if (sent && sent.length > 0 && !sameColorIdentity(sent, storedColour)) {
      return { ok: false, field: "back_face.color_identity", message: DFC_BACK_COLOR_SET };
    }
    colour = storedColour;
  } else {
    colour = backColourOf(back, input.frontColorIdentity);
  }
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

/** A double-sided token's back (TODO 5.5 (c)): see the header. */
function resolveTokenBackFace(input: DfcBackGateInput, front: FrameTemplate): DfcBackGateResult {
  const back = input.back ?? null;
  if (!back) return { ok: true, back: null, layout: null };
  const storedBody = input.stored?.back?.frame_style?.template;
  const storedHasBody = Boolean(input.stored && storedBody && isTokenPairBack(front, storedBody));
  const sent = back.frame_style?.template;
  // No body sent and none stored: a body-less back, kept as it came — what
  // the `!layout` path keeps on any other front.
  if (!sent && !storedHasBody) return { ok: true, back, layout: null };
  // (A body sent for the OTHER design is no refusal: the front moved there
  // — a remix's textless guard puts a full-art token onto the arch — and
  // the body below is derived for the front as it is stored.)
  if (sent && !storedHasBody && tokenDesignOf(sent) === null) {
    return { ok: false, field: "back_face.frame_style", message: DFC_NOT_A_BACK_BODY };
  }
  if ((back.card_type ?? null) !== "token") {
    return { ok: false, field: "back_face.card_type", message: TOKEN_BACK_TYPE_REFUSED };
  }
  // The colour: on an update of a back with a body the STORED one wins (the
  // lock, as every back's); else its own, or the front's.
  let colour: ColorIdentity[];
  if (storedHasBody) {
    const storedColour = backColourOf(input.stored?.back, input.frontColorIdentity);
    const sentColour = back.color_identity;
    if (sentColour && sentColour.length > 0 && !sameColorIdentity(sentColour, storedColour)) {
      return { ok: false, field: "back_face.color_identity", message: DFC_BACK_COLOR_SET };
    }
    colour = storedColour;
  } else {
    colour = backColourOf(back, input.frontColorIdentity);
  }
  // The body: the stored one on an update (structure, like the front's
  // template, which an edit never sends); else the one the back's words and
  // text derive in the front's design — whatever was sent.
  const template = storedHasBody
    ? (storedBody as FrameTemplate)
    : tokenBackBodyFor(front, {
        supertype: back.supertype as string | null | undefined,
        subtypes: back.subtypes as readonly string[] | string | null | undefined,
        rulesText: back.rules_text as string | null | undefined,
        flavorText: back.flavor_text as string | null | undefined,
        power: back.power as string | null | undefined,
        toughness: back.toughness as string | null | undefined,
        colorIdentity: colour,
      });
  if (!template) return { ok: false, field: "back_face.frame_style", message: DFC_NO_BACK_BODY_YET };
  if (!input.skipVerification) {
    // An update re-checks only a changed body or colour (the legacy pin).
    const unchanged =
      storedHasBody &&
      storedBody === template &&
      pickFrameColorKey(backColourOf(input.stored?.back, input.frontColorIdentity)) === pickFrameColorKey(colour);
    if (!unchanged) {
      const gateError = frameGateError(template, colour, input.verifiedKeys);
      if (gateError) {
        return { ok: false, field: "back_face.color_identity", message: gateError, code: "unverified" };
      }
    }
  }
  // A token prints no mana cost: the back saves with none.
  const { cost: _cost, ...content } = back;
  void _cost;
  return {
    ok: true,
    layout: null,
    tokenPair: true,
    back: { ...content, frame_style: { template }, color_identity: colour },
  };
}

/** True when a public save of this card would have an empty back window —
 *  a DFC front whose back has no art (design D13: the front's "no artwork →
 *  no gallery" rule on both faces; a legacy back keeps today's rule). */
export function dfcBackArtMissing(
  frontTemplate: FrameTemplate | string | null | undefined,
  back: DfcBackFacePayload | null | undefined,
): boolean {
  const front = normalizeFrameTemplate(frontTemplate);
  // A double-sided token (TODO 5.5 (c)): a back of its own needs its picture.
  if (isTokenPairFront(front)) return isTokenPairBack(front, back?.frame_style?.template) && !back?.art_url;
  const body = dfcBodyOf(front);
  if (body?.role !== "front") return false;
  // A battle's back is optional (TODO 5.5): only a back of its own — one
  // with a body — must have its picture; none, or a legacy back, keeps
  // today's rule (the front's art alone).
  if (body.battle && !(back?.frame_style?.template && isDfcBackBody(back.frame_style.template))) return false;
  return !back?.art_url;
}
