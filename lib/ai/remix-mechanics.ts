// The mechanics an AI deck remix copies from a REAL printing (TODO 1.22) —
// pure, so the remix step's frame choice is the tested path
// (tests/unit/ai/remix-mechanics.test.ts). executeDeckRemixStep
// (lib/ai/generation-jobs.ts) maps the printing through the creator's import
// mapper and hands the result to createCardAction with a new name, flavour
// and art — on a two-part layout card, a new name for each half
// (lib/ai/remix-names.ts, owner decision B3 2026-09-29); on a double-faced
// card (TODO 5.4), a new name AND a second picture for the back face, at
// two credits (owner decision Q4, 2026-10-02).
//
// The frame is resolved like the creator import (remixFrameFor): the
// printing's own frame when it is published in the card's colour, else its
// card type's standard, and a layout kind lands on its layout template with
// the printed card type. It used to pass `patch.frame_template` straight to
// the save, so an old-border printing failed the frame gate (Juggernaut LEA
// → agclassic/c, Seat of the Synod MRD → modernland/u, Command Tower C13 →
// modernland/m) and a layout kind — which has no frame_template — saved on
// the default M15 frame.

import type { ScryfallImportPatch } from "@/lib/scryfall/import-mapper";
import { backFaceFromPatch, splitSubtypes } from "@/lib/scryfall/preview-from-patch";
import { DFC_REMIX_CREDITS } from "@/lib/scryfall/dfc-import";
import { remixFrameFor } from "@/lib/creator/frame-resolve";
import { templatePaintsSecondFace } from "@/lib/creator/card-kinds";
import { dfcBodyOf, templateHasBackFace, withTransformBackShape } from "@/lib/cards/dfc";
import {
  FRAME_TEMPLATE_VALUES,
  PREMIUM_FRAME_TEMPLATES,
  type Card,
  type CardBackFace,
  type CardType,
  type ColorIdentity,
  type FrameTemplate,
} from "@/types/card";
import { importedAnatomy, storedAnatomyOf, type FrameAnatomyStyle } from "@/lib/cards/anatomy";
import { frameGateError } from "@/lib/cards/frame-availability";
import { cardFieldsFace, frameKindGateError } from "@/lib/cards/frame-kind-gate";
import { dfcFrontColorError, dfcFrontTypeError, resolveDfcBackFace } from "@/lib/cards/dfc-gate";
import { serializeLoyalty, serializeSaga } from "@/lib/cards/face-content";

export type ScryfallRemixMechanics = {
  title: string;
  cost?: string;
  card_type?: CardType;
  supertype?: string;
  subtypes: string[];
  rarity?: string;
  color_identity?: ColorIdentity[];
  rules_text?: string;
  flavor_text?: string;
  power?: string;
  toughness?: string;
  loyalty?: string;
  defense?: string;
  source_scryfall_id?: string;
  frame_template: FrameTemplate;
  /** The printing's own anatomy switches (the crown, the two-colour frame —
   *  lib/cards/anatomy.ts importedAnatomy — and, on a double-faced body, the
   *  transform icon family), saved with the frame: the remix follows its
   *  printing, and only where the printing says something (owner round 17:
   *  printing-only) — createCardAction stamps the new-card default for the
   *  rest, as the creator's form holds it (importedFormAnatomy), and keeps
   *  only what the frame draws. */
  anatomy: FrameAnatomyStyle;
  /** The second half a layout frame paints (the adventure's storybook
   *  page, the split / aftermath / flip half) — set only when the landed
   *  template paints one — or, on a double-faced body (TODO 5.4), the BACK
   *  FACE with its own body and colour, which the step paints as a second
   *  picture. A card that fell back to a standard frame never becomes a
   *  double-faced card. */
  back_face?: CardBackFace;
};

/**
 * The remix mechanics of a mapped Scryfall printing, or the step error when
 * no frame is published for the card's colour. `fallbackTitle` is the deck
 * entry's name, for a printing the mapper couldn't title. `singleFace`
 * keeps a double-faced printing one-faced (the plan reserved one credit).
 */
export function scryfallRemixMechanics(
  patch: ScryfallImportPatch,
  fallbackTitle: string,
  verifiedKeys: ReadonlySet<string>,
  options: { singleFace?: boolean } = {},
): { ok: true; mechanics: ScryfallRemixMechanics } | { ok: false; error: string } {
  const frame = remixFrameFor(patch, verifiedKeys, options);
  if (!frame.ok) return frame;

  const doubleFaced = templateHasBackFace(frame.template);
  const back =
    doubleFaced || templatePaintsSecondFace(frame.template)
      ? backFaceFromPatch(patch.back_face)
      : null;
  // The printing's pair where the landed frame draws the two-colour frame —
  // and its icon family only on a transform front body (the save would drop
  // the key anywhere else; the payload says only what the frame draws).
  const anatomy = importedAnatomy(patch, frame.template);
  const { dfcIcon: _family, ...anatomyWithoutFamily } = anatomy.style;
  void _family;
  const style = doubleFaced ? anatomy.style : anatomyWithoutFamily;
  // The back's body and colour ride with it on a double-faced body — the
  // mapper's, which the save's gate derives again (lib/cards/dfc-gate.ts);
  // a transform back carries no cost (withTransformBackShape, the gate's
  // rule, applied here so the payload is what is stored).
  const backBody = doubleFaced ? patch.back_face?.frame_style : undefined;
  const backColour = doubleFaced ? patch.back_face?.color_identity : undefined;
  const layout = doubleFaced ? (dfcBodyOf(frame.template)?.layout ?? null) : null;

  return {
    ok: true,
    mechanics: {
      title: patch.title ?? fallbackTitle,
      cost: patch.cost,
      card_type: frame.card_type,
      supertype: patch.supertype,
      subtypes: splitSubtypes(patch.subtypes_text),
      rarity: patch.rarity,
      color_identity: anatomy.colorIdentity,
      rules_text: patch.rules_text,
      flavor_text: patch.flavor_text,
      power: patch.power,
      toughness: patch.toughness,
      loyalty: patch.loyalty,
      defense: patch.defense,
      source_scryfall_id: patch.source_scryfall_id,
      frame_template: frame.template,
      anatomy: style,
      // The half keeps the printing's rules, never its artist: the remix's
      // art is new (the front's credit is the remixer's). Its name and
      // flavour are the AI identity's (applyRemixNames, B3).
      back_face: back
        ? withTransformBackShape(
            {
              ...back,
              artist_credit: undefined,
              art_url: undefined,
              ...(backBody ? { frame_style: { template: backBody.template } } : {}),
              ...(backColour && backColour.length > 0 ? { color_identity: [...backColour] } : {}),
            },
            layout ?? "modal",
          )
        : undefined,
    },
  };
}

/** The credits a remix of these mechanics costs (owner decision Q4,
 *  2026-10-02): two for a double-faced card — one picture per face — else
 *  one. Decided at plan time (the deck's estimate, the jobs route's
 *  pre-check, the plan entry) and reserved by the step before it runs. */
export function remixCreditsOf(mechanics: {
  frame_template?: FrameTemplate | string;
  back_face?: CardBackFace;
}): number {
  return templateHasBackFace(mechanics.frame_template) && mechanics.back_face ? DFC_REMIX_CREDITS : 1;
}

// ---------------------------------------------------------------------------
// An OWN card as the remix's source (a deck entry with `card_id`).
//
// A remix is a re-skin: the mechanics, the colour and the type are the
// source's, so the frame is too (owner 2026-10-13) — the creator's
// single-card remix keeps its parent's whole frame_style (remixValuesFrom).
// The own-card deck remix used to carry no template: a card on the Vehicle
// frame, a borderless frame, the 2003 frame or a full-art token design came
// back on the default frame. It now keeps the source's template WHEN the
// save's own gates would pass it — the published-frame gate in the card's
// colour (frameGateError), the kind gate (frameKindGateError) and, on a
// double-faced body, the back face's gate (resolveDfcBackFace) — and lands
// as it did before otherwise (no template: the default frame, one face). A
// fallback, never a refused save after the art is paid for.
// ---------------------------------------------------------------------------

/** The fields of the source card the frame choice reads — a `cards` row as
 *  the caller's own (RLS) client read it; nothing the user couldn't read. */
export type OwnCardRemixSource = Pick<
  Card,
  "frame_style" | "color_identity" | "card_type" | "supertype" | "subtypes" | "title" | "rules_text"
> & { back_face?: Card["back_face"] };

export type OwnCardRemixFrame = {
  /** The source's template, kept; absent = the default landing, as before. */
  frame_template?: FrameTemplate;
  /** The second half the kept template paints (split, aftermath, adventure,
   *  flip), or the BACK FACE of a kept double-faced body with its derived
   *  body and colour — without the source's art or artist (the remix's art
   *  is new). Never set without `frame_template`: a body-less legacy back
   *  and a fallen-back card stay one-faced, as before. */
  back_face?: CardBackFace;
};

/** A stored back face as the remix carries it: its content, never its
 *  picture. The body is left for the save's gate to derive. */
function carriedBackFace(back: CardBackFace): CardBackFace {
  const {
    art_url: _art,
    art_position: _position,
    artist_credit: _artist,
    frame_style: _body,
    ...content
  } = back;
  void _art;
  void _position;
  void _artist;
  void _body;
  return content;
}

/**
 * The frame an AI deck remix of the user's own card saves on. `singleFace`
 * keeps a double-faced source one-faced (the plan reserved one credit: an
 * older plan, or bodies that were not verified when it was priced) — a
 * front body can't be kept without its back, so the card lands as before.
 * Pure: the estimate prices an entry and the step lands it through this one
 * function (remixCreditsOf of its result).
 */
export function ownCardRemixFrame(
  source: OwnCardRemixSource,
  verifiedKeys: ReadonlySet<string>,
  options: { singleFace?: boolean } = {},
): OwnCardRemixFrame {
  const stored = (source.frame_style ?? {}) as { template?: unknown };
  // A current template only: a row that names none, or a retired one
  // (TODO 4.54), lands as before.
  if (
    typeof stored.template !== "string" ||
    !(FRAME_TEMPLATE_VALUES as readonly string[]).includes(stored.template)
  ) {
    return {};
  }
  const template = stored.template as FrameTemplate;
  const colours = source.color_identity ?? [];
  // A premium frame needs a plan the save checks (none exists yet): never a
  // refusal after the art.
  if (PREMIUM_FRAME_TEMPLATES.has(template)) return {};
  if (frameGateError(template, colours, verifiedKeys) !== null) return {};
  if (frameKindGateError(template, cardFieldsFace(source)) !== null) return {};

  const back = (source.back_face ?? null) as CardBackFace | null;
  if (templateHasBackFace(template)) {
    // Both faces or neither (TODO 5.4's rule): the front body with the back
    // on its own body, each verified in its colour — exactly what the save
    // checks (dfcFrontTypeError, dfcFrontColorError, resolveDfcBackFace).
    if (options.singleFace || !back) return {};
    if (dfcFrontTypeError(template, source.card_type) !== null) return {};
    if (
      dfcFrontColorError(
        template,
        { cardType: source.card_type, supertype: source.supertype },
        colours,
      ) !== null
    ) {
      return {};
    }
    const gate = resolveDfcBackFace({
      frontTemplate: template,
      back: carriedBackFace(back),
      family: storedAnatomyOf(source.frame_style).dfcIcon,
      frontColorIdentity: colours,
      verifiedKeys,
    });
    if (!gate.ok || !gate.back) return {};
    return { frame_template: template, back_face: gate.back as CardBackFace };
  }
  if (templatePaintsSecondFace(template) && back) {
    return { frame_template: template, back_face: carriedBackFace(back) };
  }
  return { frame_template: template };
}

/** An own card's rules text as the remix copies it: the stored text, or —
 *  for a walker / saga stored with its rows alone (rules_text NULL, the
 *  rows in face_content) — the rows in the canonical text the renderers
 *  parse back. Without it such a card was remixed with no abilities. */
export function ownCardRulesText(
  source: Pick<Card, "rules_text" | "face_content">,
): string | undefined {
  if (source.rules_text?.trim()) return source.rules_text;
  const abilities = source.face_content?.loyalty?.abilities;
  if (abilities && abilities.length > 0) return serializeLoyalty(abilities);
  const saga = source.face_content?.saga;
  if (saga && saga.chapters.length > 0) return serializeSaga(saga.intro, saga.chapters);
  return source.rules_text ?? undefined;
}
