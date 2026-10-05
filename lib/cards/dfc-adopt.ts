// ---------------------------------------------------------------------------
// The 8 imported double-faced cards onto the real frames (TODO 5.2; owner
// 2026-10-02, Q3: IN PLACE, ONE CLICK) — the pure half of
// adoptDfcBodiesAction (lib/cards/dfc-adopt-actions.ts).
//
// A card imported before Phase 5 keeps its back as a LEGACY back: a
// `back_face` with content only, drawn on the front's m15 template and
// colour. Its owner's editor offers ONE hint — "Move onto the transform
// frames" — and nothing happens until they click it (the one switch that
// changes a saved card's frame: the owner's explicit yes). The move puts
// the front on its DFC twin (bodyFor's front body for the card's type),
// gives the back its body (bodyFor's back body for the back's type and the
// default family — `arrows`, owner Q5) and a colour (the front's — the
// import never carried the back's — or colourless on the land back, the one
// key its body is verified in: adoptedBackColorIdentity; locked afterwards
// like the front's, owner 2026-10-05), stamps the family, drops the
// switches the bodies can't draw (normalizeAnatomy, design D17), strips a
// transform back's cost, and re-bakes.
//
// The layout is the one the back's SHAPE derives, never a choice (owner
// 2026-10-05): a back WITH a mana cost is a modal card (KHM / STX / MSH
// backs carry one), a back without one a transform card — so a costed back
// is never moved onto Transform, which would drop its cost and change the
// card's rules. A layout whose bodies don't exist yet (the modal pair until
// 5.1b) is offered NOTHING: dfcAdoptionShape still names it (the action's
// message), dfcAdoptionOffer answers null (no hint), the action refuses
// every layout by name.
//
// Who qualifies in wave 1 (4 of the 8 today: Titânia, Erza Scarlet, Avatar
// Aang, Tobirama; Darth Vader's costed back the day the modal bodies
// exist): a row on the M15 standard or one of its skins with no
// double-faced twin of its own — m15 (or no template, drawn as m15),
// m15devoid, m15snow, m15artifact (DFC_ADOPTABLE_FRONTS; the devoid or snow
// dress is lost on the move and the hint says so) — with a legacy back
// whose faces are both wave-1 face types (DFC_FACE_TYPES) and whose back is
// no walker (no loyalty). The two on `m15borderless` wait for the
// borderless DFC bodies (5.7), a walker back for the walker bodies (5.13,
// ask first); a row on an inline layout — the adventure on m15's storybook
// page is a second PANEL, not a face — is on another template and never
// offered.
//
// Pure: no I/O.
// ---------------------------------------------------------------------------

import { normalizeFrameTemplate } from "@/lib/cards/card-display";
import {
  DEFAULT_DFC_ICON,
  bodyFor,
  dfcBodyOf,
  isDfcFaceType,
  withTransformBackShape,
  type DfcLayout,
} from "@/lib/cards/dfc";
import { normalizeAnatomy, type FrameAnatomyStyle } from "@/lib/cards/anatomy";
import type { CardBackFace, ColorIdentity, FrameTemplate } from "@/types/card";

/** The card facts the offer and the plan read (a stored row, or the
 *  editor's `card` prop). */
export type DfcAdoptionCard = {
  card_type?: string | null;
  color_identity?: readonly ColorIdentity[] | null;
  frame_style?: unknown;
  back_face?: unknown;
};

export type DfcAdoptionOffer = {
  /** The layout the back's shape derives — modal for a back with a mana
   *  cost, transform otherwise — the ONE the move offers. */
  layout: DfcLayout;
  label: string;
  frontBody: FrameTemplate;
  backBody: FrameTemplate;
  /** The M15 dress the front leaves behind (no DFC twin of it exists):
   *  "devoid" / "snow", or null for the plain or artifact frame. */
  losesDress: "devoid" | "snow" | null;
};

/** The fronts the move takes a legacy back from: the M15 standard and the
 *  skins with no double-faced twin yet. The borderless skins wait for 5.7. */
export const DFC_ADOPTABLE_FRONTS: readonly FrameTemplate[] = ["m15", "m15devoid", "m15snow", "m15artifact"];

export const DFC_LAYOUT_LABELS: Record<DfcLayout, string> = {
  transform: "Transform",
  modal: "Modal double-faced",
};

/** The DfcLayout a layout name on the wire means (the action's argument):
 *  bodyFor's vocabulary, or the kind's name (`mdfc` = modal). */
export function parseDfcAdoptionLayout(value: unknown): DfcLayout | null {
  if (value === "transform" || value === "modal") return value;
  return value === "mdfc" ? "modal" : null;
}

/** The colour the move gives the back: the front's (the import never
 *  carried the back's; editable afterwards in the back-face panel) — except
 *  on a LAND back body, which is colourless: the land pair has one master
 *  under every key and is verified on `c` alone (design §7, the registry's
 *  note), so a land back in the front's white or green could never pass the
 *  gate, and a land has no colour of its own in any case. The hint judges
 *  the back's verification with the same colour. */
export function adoptedBackColorIdentity(
  backBody: FrameTemplate | null,
  frontColorIdentity: readonly ColorIdentity[] | null | undefined,
): ColorIdentity[] {
  if (backBody && dfcBodyOf(backBody)?.land) return ["colorless"];
  return [...(frontColorIdentity ?? [])];
}

function legacyBackOf(card: DfcAdoptionCard): CardBackFace | null {
  const back = card.back_face;
  if (!back || typeof back !== "object" || Array.isArray(back)) return null;
  const face = back as CardBackFace;
  if (face.frame_style?.template) return null;
  return face;
}

/**
 * The candidate rule, the bodies aside: a legacy back (content only) on
 * m15 — stored as "m15", with no template, or a legacy value the renderers
 * draw as m15 — or an M15 skin with no DFC twin, whose two faces are wave-1
 * face types, no walker back, not the adventure shape — and the layout the
 * back's SHAPE derives. Null for a row that is no candidate at all.
 */
function candidateOf(
  card: DfcAdoptionCard,
): { back: CardBackFace; template: FrameTemplate; layout: DfcLayout } | null {
  const back = legacyBackOf(card);
  if (!back) return null;
  const template = normalizeFrameTemplate((card.frame_style as { template?: string } | null | undefined)?.template);
  if (!DFC_ADOPTABLE_FRONTS.includes(template)) return null;
  if (!isDfcFaceType(card.card_type) || !isDfcFaceType(back.card_type)) return null;
  // A walker back (Chrollo's Tibalt) waits for the walker bodies.
  if (back.loyalty) return null;
  // An ADVENTURE stored as a back face (production's ninth row: a creature
  // on m15 whose "back" is a costed instant or sorcery — the storybook
  // page, not a face) is never offered: the Adventure kind is a remix away.
  // The same shape as a creature // sorcery modal card (STX's Augmenter
  // Pugilist // Echoing Equation), which no imported row has; the modal
  // pair is 5.1b's, where the rule can tell them apart by the printing.
  if ((back.card_type === "instant" || back.card_type === "sorcery") && back.cost?.trim()) return null;
  // A back WITH a mana cost is a modal card, one without a transform card
  // (owner 2026-10-05): the shape decides, never a chip.
  return { back, template, layout: back.cost?.trim() ? "modal" : "transform" };
}

/** The layout a stored card's legacy back would move onto — the one its
 *  shape derives — or null when the card is no candidate at all. Named
 *  whether or not that layout's bodies exist yet (the action's message);
 *  the hint reads dfcAdoptionOffer, which needs them. */
export function dfcAdoptionShape(card: DfcAdoptionCard): DfcLayout | null {
  return candidateOf(card)?.layout ?? null;
}

/**
 * The hint's offer for a stored card — the ONE layout its back's shape
 * derives, with both bodies — or null when the card doesn't qualify, or
 * when that layout's bodies don't exist yet (the modal pair until 5.1b:
 * a costed back is offered nothing, never Transform).
 */
export function dfcAdoptionOffer(card: DfcAdoptionCard): DfcAdoptionOffer | null {
  const candidate = candidateOf(card);
  if (!candidate) return null;
  const { back, template, layout } = candidate;
  const frontBody = bodyFor(layout, "front", card.card_type);
  const backBody = bodyFor(layout, "back", back.card_type, DEFAULT_DFC_ICON);
  if (!frontBody || !backBody) return null;
  return {
    layout,
    label: DFC_LAYOUT_LABELS[layout],
    frontBody,
    backBody,
    losesDress: template === "m15devoid" ? "devoid" : template === "m15snow" ? "snow" : null,
  };
}

export type DfcAdoptionPlan = {
  layout: DfcLayout;
  frontBody: FrameTemplate;
  backBody: FrameTemplate;
  /** The card's frame_style to store: the stored one on the front body,
   *  the default family stamped, the switches the body can't draw dropped. */
  frame_style: Record<string, unknown>;
  /** The back face to store: the legacy content with its body and colour
   *  (adoptedBackColorIdentity: the front's, colourless on the land back), a
   *  transform back's cost stripped. */
  back_face: CardBackFace;
};

/** What the move writes, or null when the card doesn't qualify for that
 *  layout: not offered, its bodies don't exist yet, or `layout` is not the
 *  one the back's shape derives (a costed back is never moved onto
 *  Transform, a cost-less one never onto Modal). */
export function adoptDfcBodiesPlan(card: DfcAdoptionCard, layout: DfcLayout): DfcAdoptionPlan | null {
  const offer = dfcAdoptionOffer(card);
  if (!offer || offer.layout !== layout) return null;
  const back = legacyBackOf(card)!;
  const stored = ((card.frame_style ?? {}) as Record<string, unknown>) ?? {};
  const frameStyle = normalizeAnatomy(
    {
      ...stored,
      template: offer.frontBody,
      ...(layout === "transform" ? { dfcIcon: DEFAULT_DFC_ICON } : {}),
    } as FrameAnatomyStyle & Record<string, unknown>,
    offer.frontBody,
    card.card_type,
  );
  const backFace = withTransformBackShape(
    {
      ...back,
      frame_style: { template: offer.backBody },
      color_identity: adoptedBackColorIdentity(offer.backBody, card.color_identity),
    },
    layout,
  );
  return {
    layout,
    frontBody: offer.frontBody,
    backBody: offer.backBody,
    frame_style: frameStyle as Record<string, unknown>,
    back_face: backFace,
  };
}
