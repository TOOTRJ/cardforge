import type { CardType, ColorIdentity, FrameTemplate } from "@/types/card";
import { normalizeFrameTemplate } from "@/lib/cards/card-display";
import { pickFrameColorKey } from "@/lib/cards/frame-color-key";
import type { BasicLandFace } from "@/lib/cards/watermark";
import {
  BASIC_ONLY_FRAME_REASON,
  KIND_DEFS,
  colorlessFrameFits,
  colorlessFrameReason,
  enchantmentDressReason,
  enchantmentFrameFits,
  isSingleBasicLand,
  kindFromCard,
  layoutFrameRefusedCardType,
  type CardKind,
  sagaCreatureDressReason,
  sagaCreatureFrameFits,
  subtypeDressReason,
  subtypeFrameFits,
  templateIsBasicOnly,
  templateRefusesKind,
} from "@/lib/creator/card-kinds";
import { describeFrame } from "@/lib/creator/frame-resolve";

// ---------------------------------------------------------------------------
// The server's kind gate, next to frameGateError (verification). The picker
// never offers a frame for a card it can't draw: a showcase treatment's kind
// restriction takes it out of the kind's gallery, and a basic-only frame's
// chip is disabled on anything but a basic land, a subtype dress's (the
// Vehicle frame, TODO 4.5c) on anything but its subtype, and an enchantment
// dress (the Nyx frame, TODO 4.7) is offered to enchantments only, and the
// saga creature body (TODO 4.5d) to sagas that are creatures.
// createCardAction and
// updateCardAction repeat both checks so a stale client or a crafted payload
// can't save a planeswalker on the Zendikar Rising hedron frame or a
// shockland on the full-art basic frame (TODO 0.26).
//
// Border-era and layout frames are not checked here: legacy cards (an
// artifact on the plain m15 frame, a token on m15) predate the kind-first
// picker and must stay savable. The borderless M15 skins (4.32) are the one
// border-era exception: they are new, so no legacy card sits on them, and
// they carry a kind restriction like a showcase treatment — and so are the
// NEW frames no legacy card predates: the token frames past the 2014–19
// arch's own pair dress tokens alone, and the new layout frames (Prepare,
// the saga creature) the card types their kind draws. An emblem wears the
// emblem frame alone, on a layout template too.
// And a frame whose colourless `c` is an artifact frame only (TODO 4.25: the
// Universes Beyond extended-art frame) dresses a colourless card only when
// its words say Artifact (colorlessFrameFits) — read where the face names
// its colours (cardFieldsFace of a payload or a row: every save, the AI
// jobs, the remix landings, the bulk planner).
// ---------------------------------------------------------------------------

/** The card fields the kind gate reads, in the snake_case a payload or a
 *  stored row carries. */
export type CardKindFields = {
  card_type?: string | null;
  supertype?: string | null;
  subtypes?: readonly string[] | null;
  title?: string | null;
  rules_text?: string | null;
  /** The card's colours: the colourless-artifact frame rule reads them;
   *  absent, that rule is not checked. */
  color_identity?: readonly ColorIdentity[] | null;
};

/** The face the kind gate reads: the basic-land rule's, and the card's
 *  colours where the caller has them (undefined: the colourless-artifact
 *  frame rule is not checked). */
export type KindGateFace = BasicLandFace & { colorIdentity?: readonly ColorIdentity[] | null };

/** A payload or row as the face the kind gate reads. */
export function cardFieldsFace(fields: CardKindFields): KindGateFace {
  return {
    cardType: fields.card_type,
    supertype: fields.supertype,
    subtypes: fields.subtypes,
    title: fields.title,
    rulesText: fields.rules_text,
    ...(fields.color_identity !== undefined ? { colorIdentity: fields.color_identity } : {}),
  };
}

/** Null when the frame can draw this card, else the `frame_style` field
 *  error. Unknown or legacy template values resolve to the default frame,
 *  as in the renderers. */
export function frameKindGateError(
  template: FrameTemplate | string | null | undefined,
  face: KindGateFace,
): string | null {
  const resolved = normalizeFrameTemplate(template);
  const kind = kindFromCard(face.cardType as CardType | null | undefined, resolved);
  if (templateRefusesKind(resolved, kind)) {
    return `The ${describeFrame(resolved)} frame doesn't dress ${KIND_DEFS[kind].label} cards — pick another frame.`;
  }
  // A layout template names its kind whatever the card type (kindFromCard),
  // so the rule above never sees the type: an emblem is the emblem kind on
  // EVERY template (it wears the emblem frame alone, CR 114), and the new
  // layout frames take only the card types their kind's frame draws (the
  // Prepare frame a creature, the saga creature an enchantment —
  // layoutFrameRefusedCardType).
  if (face.cardType === "emblem" && kind !== "emblem" && templateRefusesKind(resolved, "emblem")) {
    return `The ${describeFrame(resolved)} frame doesn't dress ${KIND_DEFS.emblem.label} cards — pick another frame.`;
  }
  const refusedType = layoutFrameRefusedCardType(resolved, face.cardType as CardType | null | undefined);
  if (refusedType) {
    const label = KIND_DEFS[refusedType as CardKind]?.label ?? refusedType;
    return `The ${describeFrame(resolved)} frame doesn't dress ${label} cards — pick another frame.`;
  }
  if (templateIsBasicOnly(resolved) && !isSingleBasicLand(face)) {
    return `${BASIC_ONLY_FRAME_REASON} — pick another frame.`;
  }
  // A subtype dress (TODO 4.5c: the Vehicle frame) is for the cards of its
  // subtype only.
  if (!subtypeFrameFits(resolved, face.subtypes)) {
    return `${subtypeDressReason(resolved)} — pick another frame.`;
  }
  // An enchantment dress (TODO 4.7: the Nyx frame) is for the cards whose
  // type words say Enchantment — the card type or a supertype word.
  if (!enchantmentFrameFits(resolved, face)) {
    return `${enchantmentDressReason(resolved)} — pick another frame.`;
  }
  // The saga creature body (TODO 4.5d) is for the sagas whose type words say
  // Creature — the card type or a supertype word.
  if (!sagaCreatureFrameFits(resolved, face)) {
    return `${sagaCreatureDressReason(resolved)} — pick another frame.`;
  }
  // A frame whose colourless `c` is an artifact frame only (TODO 4.25)
  // dresses a colourless card only when its words say Artifact.
  if (face.colorIdentity !== undefined && !colorlessFrameFits(resolved, pickFrameColorKey(face.colorIdentity), face)) {
    return `${colorlessFrameReason(resolved)} — pick another frame or a colour.`;
  }
  return null;
}

/** The update form of the gate. It checks the card as it will be saved and
 *  refuses when the patch changes the frame, or when it turns a card the
 *  frame could draw into one it can't (a full-art Plains renamed to a
 *  shockland). A card that already broke the rule and keeps its frame stays
 *  editable, like the verification gate's legacy pin. */
export function frameKindUpdateGateError(input: {
  existingTemplate: FrameTemplate | string | null | undefined;
  /** Undefined when the patch leaves the frame alone. */
  nextTemplate: FrameTemplate | string | null | undefined;
  existing: KindGateFace;
  next: KindGateFace;
}): string | null {
  const { existingTemplate, nextTemplate } = input;
  const error = frameKindGateError(nextTemplate ?? existingTemplate, input.next);
  if (!error) return null;
  const templateChanged =
    nextTemplate !== undefined && nextTemplate !== existingTemplate;
  if (templateChanged) return error;
  return frameKindGateError(existingTemplate, input.existing) === null
    ? error
    : null;
}
