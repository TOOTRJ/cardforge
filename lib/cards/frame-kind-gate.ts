import type { CardType, FrameTemplate } from "@/types/card";
import { normalizeFrameTemplate } from "@/lib/cards/card-display";
import type { BasicLandFace } from "@/lib/cards/watermark";
import {
  BASIC_ONLY_FRAME_REASON,
  KIND_DEFS,
  isSingleBasicLand,
  kindFromCard,
  templateIsBasicOnly,
  templateRefusesKind,
} from "@/lib/creator/card-kinds";
import { describeFrame } from "@/lib/creator/frame-resolve";

// ---------------------------------------------------------------------------
// The server's kind gate, next to frameGateError (verification). The picker
// never offers a frame for a card it can't draw: a showcase treatment's kind
// restriction takes it out of the kind's gallery, and a basic-only frame's
// chip is disabled on anything but a basic land. createCardAction and
// updateCardAction repeat both checks so a stale client or a crafted payload
// can't save a planeswalker on the Zendikar Rising hedron frame or a
// shockland on the full-art basic frame (TODO 0.26).
//
// Border-era and layout frames are not checked here: legacy cards (an
// artifact on the plain m15 frame, a token on m15) predate the kind-first
// picker and must stay savable. The borderless M15 skins (4.32) are the one
// border-era exception: they are new, so no legacy card sits on them, and
// they carry a kind restriction like a showcase treatment.
// ---------------------------------------------------------------------------

/** The card fields the kind gate reads, in the snake_case a payload or a
 *  stored row carries. */
export type CardKindFields = {
  card_type?: string | null;
  supertype?: string | null;
  subtypes?: readonly string[] | null;
  title?: string | null;
  rules_text?: string | null;
};

/** A payload or row as the face the basic-land rule reads. */
export function cardFieldsFace(fields: CardKindFields): BasicLandFace {
  return {
    cardType: fields.card_type,
    supertype: fields.supertype,
    subtypes: fields.subtypes,
    title: fields.title,
    rulesText: fields.rules_text,
  };
}

/** Null when the frame can draw this card, else the `frame_style` field
 *  error. Unknown or legacy template values resolve to the default frame,
 *  as in the renderers. */
export function frameKindGateError(
  template: FrameTemplate | string | null | undefined,
  face: BasicLandFace,
): string | null {
  const resolved = normalizeFrameTemplate(template);
  const kind = kindFromCard(face.cardType as CardType | null | undefined, resolved);
  if (templateRefusesKind(resolved, kind)) {
    return `The ${describeFrame(resolved)} frame doesn't dress ${KIND_DEFS[kind].label} cards — pick another frame.`;
  }
  if (templateIsBasicOnly(resolved) && !isSingleBasicLand(face)) {
    return `${BASIC_ONLY_FRAME_REASON} — pick another frame.`;
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
  existing: BasicLandFace;
  next: BasicLandFace;
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
