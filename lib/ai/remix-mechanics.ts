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
import { DFC_REMIX_CREDITS, dfcImportLanding } from "@/lib/scryfall/dfc-import";
import { finalizeImportMatch, remixFrameFor, remixSavedFrame, withoutTextlessFrames } from "@/lib/creator/frame-resolve";
import { getFrameProfile } from "@/lib/cards/template-layout";
import { extendedArtDressFor, kindFromCard, templatePaintsSecondFace, typeWordFrameFor } from "@/lib/creator/card-kinds";
import { bodyFor, dfcBodyOf, hasBackOfItsOwn, isBattleFront, templateHasBackFace, withTransformBackShape } from "@/lib/cards/dfc";
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
import { frameGateColors, partColourVerdict } from "@/lib/cards/part-color";
import { frameGateError, isFrameComboAvailable } from "@/lib/cards/frame-availability";
import { pickFrameColorKey } from "@/lib/cards/frame-color-key";
import { isTokenPairBack, isTokenPairFront } from "@/lib/cards/token-faces";
import { tokenBackBodyFor } from "@/lib/creator/token-back";
import { cardFieldsFace, frameKindGateError } from "@/lib/cards/frame-kind-gate";
import { dfcFrontColorError, dfcFrontTypeError, resolveDfcBackFace } from "@/lib/cards/dfc-gate";
import { serializeLoyalty, serializeSaga } from "@/lib/cards/face-content";
import { isStationFrame } from "@/lib/cards/station-frame";
import { isArchTallTokenTemplate } from "@/lib/cards/token-height";
import { stationOpenText } from "@/lib/creator/station-rows";

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
  /** Set only when the printing landed on the arch's TALL box (TODO 4.55,
   *  owner Round 77): a PINNED tall-box printing (TALL_BOX_TOKEN_PINS) once
   *  the tall box is verified in its colour. The remix saves on it as the
   *  import lands it — it follows the printing, never re-deciding the height
   *  from its new text (remixSavedFrame). Absent on every other landing, so
   *  every other remix payload is unchanged. */
  printed_height?: true;
  /** Set only when `frame_template` draws no rules box (a `textless`
   *  profile, TODO 1.24): the frame the card saves on INSTEAD when it saves
   *  with rules or flavour text — this printing's landing with the textless
   *  frames read as unverified, i.e. the stand-in the registry / the import
   *  uses until that frame is ticked. The step decides once the final text
   *  is known (remixSavedFrame); absent on a textless landing = nothing
   *  else is published in the card's colour. One-faced, like the landing. */
  text_stand_in?: FrameTemplate;
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

  // A landing that draws no rules box names its stand-in (TODO 1.24): the
  // same resolution against the list without the textless frames. Only a
  // one-faced stand-in for a one-faced landing — the second half and the
  // credits below are decided on `frame.template`.
  const standIn = getFrameProfile(frame.template).textless
    ? remixFrameFor(patch, withoutTextlessFrames(verifiedKeys), options)
    : null;
  const textStandIn =
    standIn?.ok &&
    !getFrameProfile(standIn.template).textless &&
    !templateHasBackFace(standIn.template) &&
    !templatePaintsSecondFace(standIn.template)
      ? standIn.template
      : undefined;

  // (A battle — TODO 5.5 — is two-faced only with a back of its own: a
  // legacy back is left out, as every battle remix did before. The battle
  // keeps its frame either way, so remixFrameFor's template can't say
  // whether the back landed: the import's own landing does — both bodies
  // verified, each in its colour — and a one-credit plan stays one-faced,
  // as a transform printing's does.)
  // (A double-sided token — TODO 5.5 (c) — the same: two faces only where
  // the import keeps its back — both faces' tokens verified, each in its
  // colour — and its back's body is derived for the front it lands on.)
  const tokenBack = isTokenPairFront(frame.template) && !options.singleFace ? tokenPairRemixBack(patch, frame.template, verifiedKeys) : null;
  const doubleFaced = isBattleFront(frame.template)
    ? !options.singleFace && dfcImportLanding(finalizeImportMatch(patch, verifiedKeys), verifiedKeys).ok
    : isTokenPairFront(frame.template)
      ? tokenBack !== null
      : hasBackOfItsOwn(frame.template, patch.back_face);
  const back =
    doubleFaced || templatePaintsSecondFace(frame.template)
      ? backFaceFromPatch(patch.back_face)
      : null;
  // The printing's pair where the landed frame draws the two-colour frame —
  // and its icon family only on a transform front body (the save would drop
  // the key anywhere else; the payload says only what the frame draws).
  // Each part in its own colour (TODO 4.26, M1): ON only where both
  // parts' colours are verified on the landed frame (partColourVerdict, the
  // import's rule) — else OFF, the card's whole colour: never a save the
  // gate refuses after the art.
  const partVerdict = partColourVerdict(
    frame.template,
    patch.color_identity,
    patch.printed_first_part_color,
    patch.back_face?.color_identity,
    verifiedKeys,
  );
  const anatomy = importedAnatomy(
    partVerdict.drawn && !partVerdict.ok ? { ...patch, printed_part_color: false } : patch,
    frame.template,
  );
  const { dfcIcon: _family, ...anatomyWithoutFamily } = anatomy.style;
  void _family;
  const style = doubleFaced ? anatomy.style : anatomyWithoutFamily;
  // The back's body and colour ride with it on a double-faced body — the
  // mapper's, which the save's gate derives again (lib/cards/dfc-gate.ts);
  // a transform back carries no cost (withTransformBackShape, the gate's
  // rule, applied here so the payload is what is stored).
  const backBody = doubleFaced ? (tokenBack ?? patch.back_face?.frame_style) : undefined;
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
      ...(textStandIn ? { text_stand_in: textStandIn } : {}),
      ...(isArchTallTokenTemplate(frame.template) ? { printed_height: true as const } : {}),
    },
  };
}

/** A double-sided token printing's back body for a remix landing on
 *  `front` (TODO 5.5 (c)), or null when the import leaves it one-faced (the
 *  pair's combos not verified: finalizeImportMatch drops the back) or the
 *  back's token isn't published in its colour under this front's design. */
function tokenPairRemixBack(
  patch: ScryfallImportPatch,
  front: FrameTemplate,
  verifiedKeys: ReadonlySet<string>,
): { template: FrameTemplate } | null {
  const kept = finalizeImportMatch(patch, verifiedKeys).back_face;
  if (!kept?.frame_style?.template) return null;
  const colour = kept.color_identity && kept.color_identity.length > 0 ? kept.color_identity : (patch.color_identity ?? []);
  const body = tokenBackBodyFor(front, {
    supertype: kept.supertype,
    subtypes: kept.subtypes_text,
    rulesText: kept.rules_text,
    flavorText: kept.flavor_text,
    power: kept.power,
    toughness: kept.toughness,
    colorIdentity: colour,
  }, verifiedKeys);
  if (!body || !isFrameComboAvailable(body, pickFrameColorKey([...colour]), verifiedKeys)) return null;
  return { template: body };
}

/** The credits a remix of these mechanics costs (owner decision Q4,
 *  2026-10-02): two for a double-faced card — one picture per face — else
 *  one. Decided at plan time (the deck's estimate, the jobs route's
 *  pre-check, the plan entry) and reserved by the step before it runs. */
export function remixCreditsOf(mechanics: {
  frame_template?: FrameTemplate | string;
  back_face?: CardBackFace;
}): number {
  return hasBackOfItsOwn(mechanics.frame_template, mechanics.back_face) ? DFC_REMIX_CREDITS : 1;
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
  /** The kept frame draws each part in its own colour but a part's colour
   *  is not verified there (TODO 4.26, M1): the remix saves with the look
   *  OFF — the card's whole colour — never a save refused after the art. */
  part_color_off?: true;
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
  // Each part in its own colour (TODO 4.26, M1): a kept split / aftermath /
  // Prepare frame with the look on (the source's switch, else the new-card
  // default) is kept in its first part's own colour where BOTH parts'
  // colours are verified on it; else the look goes OFF and the frame is
  // judged in the card's whole colour, as before 4.26.
  const style = storedAnatomyOf(source.frame_style);
  const storedTemplate = (source.frame_style as { template?: unknown } | null)?.template;
  const part =
    typeof storedTemplate === "string" && style.partColor !== false
      ? partColourVerdict(
          storedTemplate,
          source.color_identity ?? [],
          style.firstPartColor,
          ((source.back_face ?? null) as CardBackFace | null)?.color_identity,
          verifiedKeys,
        )
      : null;
  const kept = keptOwnFrame(source, verifiedKeys, options, part?.drawn && part.ok ? part.frameColors : null);
  return part?.drawn && !part.ok && kept.frame_template ? { ...kept, part_color_off: true } : kept;
}

function keptOwnFrame(
  source: OwnCardRemixSource,
  verifiedKeys: ReadonlySet<string>,
  options: { singleFace?: boolean },
  /** The colours the frame is gated in where the parts keep their own. */
  partFrameColors: readonly ColorIdentity[] | null,
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
  // A land stored on the extended-art frame before its land dress existed
  // keeps the look on that dress (TODO 4.7, owner Round 63).
  const template = extendedArtDressFor(
    kindFromCard(source.card_type ?? undefined, stored.template as FrameTemplate),
    stored.template as FrameTemplate,
  );
  const colours = source.color_identity ?? [];
  // A premium frame needs a plan the save checks (none exists yet): never a
  // refusal after the art.
  if (PREMIUM_FRAME_TEMPLATES.has(template)) return {};
  // (A two-colour Expedition keeps its plain land master `c`, TODO 4.11:
  // gated there, as the save gates it.)
  if (frameGateError(template, partFrameColors ?? frameGateColors(template, { plainLandMaster: storedAnatomyOf(source.frame_style).plainLandMaster }, colours), verifiedKeys) !== null) return {};
  if (frameKindGateError(template, cardFieldsFace(source)) !== null) return {};

  const back = (source.back_face ?? null) as CardBackFace | null;
  // A battle with no back of its own (TODO 5.5: none, or a legacy back)
  // remixes as it did before — the battle frame, one face; one whose back
  // can't follow it (a single-face plan, an unverified back) the same.
  if (isBattleFront(template) && !hasBackOfItsOwn(template, back)) {
    return dfcFrontTypeError(template, source.card_type) === null ? { frame_template: template } : {};
  }
  // A double-sided token (TODO 5.5 (c)): its back of its own — a token
  // template in the front's design — through the save's gate (derived again
  // for the front, verified in its colour); short of it, or on a one-credit
  // plan, the token alone on its frame.
  if (isTokenPairFront(template) && back && isTokenPairBack(template, back.frame_style?.template)) {
    if (options.singleFace) return { frame_template: template };
    const gate = resolveDfcBackFace({
      frontTemplate: template,
      back: { ...carriedBackFace(back), frame_style: { template: back.frame_style!.template! } },
      family: null,
      frontColorIdentity: colours,
      verifiedKeys,
    });
    if (!gate.ok || !gate.back || !gate.tokenPair) return { frame_template: template };
    return { frame_template: template, back_face: gate.back as CardBackFace };
  }
  if (templateHasBackFace(template)) {
    // Both faces or neither (TODO 5.4's rule): the front body with the back
    // on its own body, each verified in its colour — exactly what the save
    // checks (dfcFrontTypeError, dfcFrontColorError, resolveDfcBackFace).
    if (dfcFrontTypeError(template, source.card_type) !== null) return {};
    // (A battle whose back can't follow it is the one-faced battle.)
    const oneFaced = isBattleFront(template) ? { frame_template: template } : {};
    if (options.singleFace || !back) return oneFaced;
    if (
      dfcFrontColorError(
        template,
        { cardType: source.card_type, supertype: source.supertype },
        colours,
        verifiedKeys,
      ) !== null
    ) {
      return {};
    }
    const gate = resolveDfcBackFace({
      frontTemplate: template,
      // (A battle's back — TODO 5.5 — names the ▼ back it derives: a back
      // with no body there is the legacy back, which the gate keeps as it
      // is and a remix leaves behind.)
      back: isBattleFront(template)
        ? { ...carriedBackFace(back), frame_style: { template: bodyFor("transform", "back", back.card_type ?? null) ?? undefined } }
        : carriedBackFace(back),
      family: storedAnatomyOf(source.frame_style).dfcIcon,
      frontColorIdentity: colours,
      verifiedKeys,
    });
    if (!gate.ok || !gate.back || !gate.layout) return oneFaced;
    return { frame_template: template, back_face: gate.back as CardBackFace };
  }
  if (templatePaintsSecondFace(template) && back) {
    return { frame_template: template, back_face: carriedBackFace(back) };
  }
  return { frame_template: template };
}

/**
 * Where an own card's remix saves INSTEAD when it saves with rules or
 * flavour text and its kept frame draws none (a `textless` profile, TODO
 * 1.24 — remixSavedFrame decides, once the text is known):
 *   • a TOKEN: the 2014–19 arch its type words pick (`m15token`, or
 *     `m15tokenartifact` for the Artifact word — typeWordFrameFor), whose
 *     scrim keeps the text — the stand-in a PRINTING of that token gets
 *     from the registry — where the save's gates pass it in the card's
 *     colour;
 *   • else `null` = the default landing, no template — where this card
 *     lands when its frame is NOT kept (above) — where the gates pass that;
 *   • `undefined` = neither, so the kept frame stands (a hidden text,
 *     never a refused save after the art).
 * Pure.
 */
export function ownCardTextStandIn(
  source: OwnCardRemixSource,
  verifiedKeys: ReadonlySet<string>,
): FrameTemplate | null | undefined {
  const colours = source.color_identity ?? [];
  const face = cardFieldsFace(source);
  const passes = (template: FrameTemplate | undefined) =>
    frameGateError(template, colours, verifiedKeys) === null &&
    frameKindGateError(template, face) === null;
  if (source.card_type === "token") {
    const arch = typeWordFrameFor("token", "m15token", source.supertype);
    if (passes(arch)) return arch;
  }
  return passes(undefined) ? null : undefined;
}

/** An own card's rules text as the remix copies it: the stored text, or —
 *  for a walker / saga stored with its rows alone (rules_text NULL, the
 *  rows in face_content) — the rows in the canonical text the renderers
 *  parse back. Without it such a card was remixed with no abilities. */
export function ownCardRulesText(
  source: Pick<Card, "rules_text" | "face_content"> & { frame_style?: Card["frame_style"] },
): string | undefined {
  // A STATION card draws its rows BEFORE its text (TODO 4.27a): where the
  // two disagree (rows written through the API beside another text) the
  // remix copies what the card shows — the rows, as the editor opens them
  // (stationOpenText). The stored text everywhere else, byte for byte.
  const template = (source.frame_style as { template?: unknown } | null | undefined)?.template;
  if (source.face_content?.station && typeof template === "string" && isStationFrame(template)) {
    const shown = stationOpenText(source.rules_text, source.face_content);
    if (shown.trim()) return shown;
  }
  if (source.rules_text?.trim()) return source.rules_text;
  const abilities = source.face_content?.loyalty?.abilities;
  if (abilities && abilities.length > 0) return serializeLoyalty(abilities);
  const saga = source.face_content?.saga;
  if (saga && saga.chapters.length > 0) return serializeSaga(saga.intro, saga.chapters);
  return source.rules_text ?? undefined;
}

// ---------------------------------------------------------------------------
// Emblems are NOT remixed (owner 2026-10-13). An emblem prints its
// planeswalker's name; a remix renames every card by itself, so the emblem
// would stop matching its (separately renamed) walker — and the AI never
// designs emblems. The entry is left out at PLAN time (the estimate prices
// it nothing and counts it; createDeckRemixJob makes no step for it), and a
// step of an older plan that still names one is refused before anything is
// generated. The remixed deck simply has no emblem.
// ---------------------------------------------------------------------------

/** The step error of an emblem entry an older plan still carries. */
export const REMIX_EMBLEM_LEFT_OUT =
  "Emblems aren't remixed — this one is left out of the new deck. Nothing was charged.";

/** True when a remix source — an own card's row or a mapped printing — is
 *  an emblem. */
export function isEmblemRemixSource(source: { card_type?: string | null } | null | undefined): boolean {
  return source?.card_type === "emblem";
}

/** A deck's entries as the remix takes them, in deck order: every entry
 *  with a source (an own card or a printing) but the user's own EMBLEMS,
 *  which are counted instead. ONE filter for the estimate and the plan, so
 *  the batch cap cuts the same list in both. (A printed emblem is known
 *  only once its printing is resolved: the estimate prices it 0 and the
 *  plan drops what the estimate priced 0.) */
export function remixableDeckItems<
  T extends {
    entry: { card_id: string | null; scryfall_id: string | null };
    card: { card_type?: string | null } | null;
  },
>(items: readonly T[]): { remixable: T[]; ownEmblems: number } {
  const remixable: T[] = [];
  let ownEmblems = 0;
  for (const item of items) {
    if (!item.entry.card_id && !item.entry.scryfall_id) continue;
    if (item.entry.card_id && isEmblemRemixSource(item.card)) ownEmblems += 1;
    else remixable.push(item);
  }
  return { remixable, ownEmblems };
}

/**
 * The frames a remix SAVES on — the front's and, for a double-sided token
 * (TODO 5.5 (c)), its back's — decided once the final text is known and
 * BEFORE any picture is made (owner Round 78: never charge for, or paint, a
 * back that can't be saved). The front is `remixSavedFrame`'s answer (the
 * token's text height, a textless landing's stand-in); a token back must
 * then pass the save's gate (resolveDfcBackFace) under that front. When it
 * can't — the front moved to a stand-in its back can't follow — the pair
 * stays on its LANDING, where the plan priced it; when the back can't be
 * saved there either (a tick withdrawn since the plan), `ok: false`: the
 * step fails before the art and its credits are refunded. Every other card
 * is `remixSavedFrame`'s answer, unchanged.
 */
export function remixSavedFrames(
  input: Parameters<typeof remixSavedFrame>[0] & {
    /** The back as it will be sent (the remix's names applied), or none. */
    back?: CardBackFace | null;
  },
): { ok: true; template: FrameTemplate | undefined } | { ok: false } {
  const { back, ...front } = input;
  const template = remixSavedFrame(front);
  const landing = input.template;
  if (!back || !isTokenPairFront(landing) || !isTokenPairBack(landing, back.frame_style?.template)) {
    return { ok: true, template };
  }
  const saves = (candidate: FrameTemplate | undefined) => {
    if (!candidate || !isTokenPairFront(candidate)) return false;
    const gate = resolveDfcBackFace({
      frontTemplate: candidate,
      back: back as never,
      family: null,
      frontColorIdentity: input.colorIdentity,
      verifiedKeys: input.verifiedKeys,
    });
    return gate.ok && gate.tokenPair === true;
  };
  if (saves(template)) return { ok: true, template };
  if (template !== landing && saves(landing)) return { ok: true, template: landing };
  return { ok: false };
}
