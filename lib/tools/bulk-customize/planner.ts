// ---------------------------------------------------------------------------
// Bulk Customize — what ONE card of a batch saves as (pure; the tested path:
// tests/unit/tools/bulk-customize-planner.test.ts).
//
// The card starts as the creator's import of its printing would: the
// printing mapped (mapScryfallToFormPatch) and finalized against the
// verified combos (finalizeImportMatch), its frame resolved like the AI deck
// remix's (scryfallRemixMechanics — the printing's own frame where it is
// published in the card's colour, else its card type's standard; a layout
// kind on its layout template). Then the batch's look is applied where the
// card can wear it, judged by the SAVE's own gates (frameGateError in the
// card's colour, frameKindGateError for its kind) — a card that can't keeps
// its printing's frame and the batch says so. Nothing here refuses a save
// after the art is paid for: a look that can't apply falls back first.
//
// A card the choices leave UNCHANGED (every change it was offered fell back)
// is skipped, never saved: it would be an exact copy of the real card
// (lib/cards/exact-copy.ts). Its art choice alone is not a change — keeping
// the printing's art or adding your own later leaves the card the import.
// ---------------------------------------------------------------------------

import type { ScryfallImportPatch } from "@/lib/scryfall/import-mapper";
import { remixSavedFrames, scryfallRemixMechanics } from "@/lib/ai/remix-mechanics";
import { importedAnatomy, frameAnatomyOf, type FrameAnatomyStyle } from "@/lib/cards/anatomy";
import { templateTakesBackBody } from "@/lib/cards/dfc";
import { frameGateError } from "@/lib/cards/frame-availability";
import { cardFieldsFace, frameKindGateError } from "@/lib/cards/frame-kind-gate";
import { frameGateColors } from "@/lib/cards/part-color";
import { KEYRUNE_CODEPOINTS } from "@/lib/cards/keyrune-metrics";
import { PIPGLYPH_ROSE_WATERMARK, defaultWatermarkFor, usesDefaultWatermark } from "@/lib/cards/watermark";
import { printsPowerToughness } from "@/lib/cards/card-display";
import { stationSaveFields } from "@/lib/ai/station-design";
import { kindFromCard, type CardKind } from "@/lib/creator/card-kinds";
import { eraForTemplate, isTreatmentBody } from "@/lib/creator/frame-picker";
import { describeFrame } from "@/lib/creator/frame-resolve";
import {
  ERA_TYPE_FRAME,
  FRAME_TEMPLATE_SET,
  type CardBackFace,
  type CardType,
  type CardWatermark,
  type ColorIdentity,
  type FrameTemplate,
} from "@/types/card";
import {
  BULK_AI_ART_CREDITS_PER_FACE,
  BULK_LOOK_LABELS,
  BULK_WATERMARK_KEEP,
  BULK_WATERMARK_NONE,
  type BulkChoices,
  type BulkLook,
} from "@/lib/tools/bulk-customize/model";

/** The kinds a batch's look re-frames: the one-faced standard kinds, whose
 *  frame comes from an era (ERA_TYPE_FRAME). Every other kind — two-part,
 *  double-faced, token, emblem, saga, battle, station, Prepare… — keeps the
 *  frame its printing lands on. */
const REFRAMED_KINDS: ReadonlySet<CardKind> = new Set<CardKind>([
  "creature",
  "instant",
  "sorcery",
  "artifact",
  "enchantment",
  "land",
  "planeswalker",
]);

/** What changed on a card, against the creator's plain import of it. */
export type BulkChange = "frame" | "border" | "set_symbol" | "watermark" | "ai_art";

/** The fields a batch card saves — createCardAction's payload, short of
 *  the art (the step adds the picture and its credit) and the game system. */
export type BulkCardPayload = {
  title: string;
  cost?: string;
  color_identity: ColorIdentity[];
  supertype?: string;
  card_type?: CardType;
  subtypes: string[];
  printed_types?: string | null;
  nickname?: string;
  rarity?: string;
  rules_text?: string;
  flavor_text?: string;
  power?: string;
  toughness?: string;
  loyalty?: string;
  defense?: string;
  face_content?: unknown;
  frame_style: FrameAnatomyStyle & { template?: FrameTemplate };
  back_face?: CardBackFace;
  source_scryfall_id?: string;
  set_icon_code?: string | null;
  set_code?: string | null;
  collector_number?: string | null;
  lang?: string;
  watermark: CardWatermark | null;
  artist_credit?: string;
  visibility: "public" | "unlisted" | "private";
  /** Never an exact copy: the batch saves only a card it changed (the
   *  provenance then stores no fingerprint — the card reads "Edited"). */
  import_unchanged: false;
};

export type BulkPlannedCard =
  | {
      ok: true;
      title: string;
      payload: BulkCardPayload;
      changes: BulkChange[];
      /** Per-card words for the dialog and the step ("kept its printing's
       *  frame: …"). Never a refusal. */
      notes: string[];
      /** The card has a back face with a picture of its own (a double-faced
       *  body): its art is two pictures. */
      doubleFaced: boolean;
      /** Credits the card's art costs (0 unless the batch paints AI art). */
      credits: number;
    }
  | {
      ok: false;
      title: string;
      /** "unchanged" = every change fell back (an exact copy — skipped);
       *  "no_frame" = nothing is published in the card's colour (the
       *  creator couldn't import it either). */
      reason: "unchanged" | "no_frame";
      message: string;
    };

export type BulkPlanInput = {
  /** The printing mapped AND finalized (the named route's patch). */
  patch: ScryfallImportPatch;
  /** The name to fall back on (the deck entry's, the collection row's). */
  fallbackTitle: string;
  /** Scryfall's set code of the printing (lower case), for its symbol. */
  scryfallSet?: string | null;
  choices: BulkChoices;
  verifiedKeys: ReadonlySet<string>;
  /** The maker's plan removes the watermark (entitlements.removeWatermark):
   *  a free account's creatures and spells always carry the Rose. */
  removeWatermark: boolean;
};

/** The template `look` dresses a card of `cardType` in, or null when the
 *  look has no frame for it (the 1993 frame has no planeswalker). Pure. */
export function lookTemplateFor(
  look: Exclude<BulkLook, "keep">,
  cardType: CardType,
  supertype: string | undefined,
  landing: FrameTemplate,
): FrameTemplate | null {
  const artifactWord = /\bartifact\b/i.test(supertype ?? "") || cardType === "artifact";
  switch (look) {
    case "m15": {
      // A card already on a 2015 dress of its own (the artifact, Vehicle,
      // Nyx, snow, devoid or Universes Beyond frame) keeps it: the look is
      // the 2015 era, not the plain M15 spell frame.
      if (eraForTemplate(landing) === "m15" && !isTreatmentBody(landing) && FRAME_TEMPLATE_SET[landing] !== "borderless") {
        return landing;
      }
      if (artifactWord && cardType !== "land") return "m15artifact";
      return ERA_TYPE_FRAME.m15?.[cardType] ?? null;
    }
    case "borderless":
      if (cardType === "planeswalker") return "m15borderlesspw";
      if (cardType === "land") return "m15borderlessland";
      return artifactWord ? "m15borderlessartifact" : "m15borderless";
    case "extended":
      if (cardType === "planeswalker") return null;
      return cardType === "land" ? "extendedartland" : "extendedart";
    case "retro":
    case "modern":
    case "classic":
      return ERA_TYPE_FRAME[look]?.[cardType] ?? null;
  }
}

/** Why `template` can't dress this card, or null (the save's own gates). */
function frameRefusal(
  template: FrameTemplate,
  style: FrameAnatomyStyle,
  colors: readonly ColorIdentity[],
  face: Parameters<typeof cardFieldsFace>[0],
  verifiedKeys: ReadonlySet<string>,
): string | null {
  return (
    frameGateError(template, frameGateColors(template, style, colors), verifiedKeys) ??
    frameKindGateError(template, cardFieldsFace(face))
  );
}

/** The Keyrune code of the printing's set, or null when PipGlyph has no
 *  glyph for it. */
export function printingSetSymbolCode(scryfallSet: string | null | undefined, printedSetCode?: string | null): string | null {
  for (const raw of [scryfallSet, printedSetCode]) {
    const code = raw?.trim().toLowerCase();
    if (code && /^[a-z0-9]+$/.test(code) && Object.prototype.hasOwnProperty.call(KEYRUNE_CODEPOINTS, code)) return code;
  }
  return null;
}

/** The watermark a card of `cardType` saves with under `choice`, as the
 *  card action will store it (a free account's creatures and spells always
 *  carry the Rose — createCardAction enforces it). */
export function effectiveWatermark(
  choice: BulkChoices["watermark"],
  cardType: string | undefined,
  removeWatermark: boolean,
): CardWatermark | null {
  if (usesDefaultWatermark(cardType) && !removeWatermark) return PIPGLYPH_ROSE_WATERMARK;
  if (choice === BULK_WATERMARK_KEEP) return defaultWatermarkFor(cardType, removeWatermark);
  if (choice === BULK_WATERMARK_NONE) return null;
  return { kind: "preset", key: choice, size: "normal" };
}

function watermarkKey(wm: CardWatermark | null): string {
  if (!wm) return "none";
  return wm.kind === "custom" ? `custom:${wm.url}` : `${wm.kind}:${wm.key}`;
}

/**
 * One card of a batch: what it saves as, or why it is left out. Pure.
 */
export function planCustomizedCard(input: BulkPlanInput): BulkPlannedCard {
  const { patch, choices, verifiedKeys } = input;
  const fallbackTitle = patch.title ?? input.fallbackTitle;
  const resolved = scryfallRemixMechanics(patch, input.fallbackTitle, verifiedKeys);
  if (!resolved.ok) {
    return { ok: false, title: fallbackTitle, reason: "no_frame", message: resolved.error };
  }
  const m = resolved.mechanics;
  const title = m.title;
  const notes: string[] = [];
  const changes: BulkChange[] = [];
  const colors = (m.color_identity && m.color_identity.length > 0 ? m.color_identity : ["colorless"]) as ColorIdentity[];
  const cardType = (m.card_type ?? "creature") as CardType;
  const fields = {
    card_type: m.card_type,
    supertype: m.supertype,
    subtypes: m.subtypes,
    title,
    rules_text: m.rules_text,
  };

  // ---- The frame ----
  // The landing the import gives it (a textless landing gives way to its
  // stand-in when the card has text — the remix's rule, TODO 1.24).
  const landed = remixSavedFrames({
    standIn: m.text_stand_in,
    printedHeight: m.printed_height === true,
    template: m.frame_template,
    cardType: m.card_type,
    supertype: m.supertype,
    subtypes: m.subtypes,
    rulesText: m.rules_text,
    flavorText: m.flavor_text,
    power: m.power,
    toughness: m.toughness,
    colorIdentity: colors,
    verifiedKeys,
    back: m.back_face ?? null,
  });
  const landing: FrameTemplate = (landed.ok ? landed.template : undefined) ?? m.frame_template;
  let template = landing;
  let style: FrameAnatomyStyle = { ...m.anatomy };
  let colorIdentity = colors;

  if (choices.look !== "keep") {
    const label = BULK_LOOK_LABELS[choices.look];
    const kind = kindFromCard(cardType, landing);
    if (m.back_face || !REFRAMED_KINDS.has(kind)) {
      notes.push(`Kept its own frame: the ${label.toLowerCase()} isn't offered for this kind of card.`);
    } else {
      const target = lookTemplateFor(choices.look, cardType, m.supertype, landing);
      if (!target) {
        notes.push(`Kept its printing's frame: there's no ${label.toLowerCase()} for this card type.`);
      } else if (target !== landing) {
        // The printing's own switches, judged for the NEW frame (the crown
        // where it draws one, the pair where it has pair masters).
        const anatomy = importedAnatomy(patch, target);
        const { dfcIcon: _family, ...targetStyle } = anatomy.style;
        void _family;
        const targetColors = (anatomy.colorIdentity && anatomy.colorIdentity.length > 0
          ? anatomy.colorIdentity
          : colors) as ColorIdentity[];
        const refusal = frameRefusal(target, targetStyle, targetColors, fields, verifiedKeys);
        if (refusal) {
          notes.push(`Kept its printing's frame: the ${describeFrame(target)} frame isn't ready for this card yet.`);
        } else {
          template = target;
          style = targetStyle;
          colorIdentity = targetColors;
          changes.push("frame");
        }
      }
    }
  }

  // ---- The border (only where the frame draws a white one) ----
  if (frameAnatomyOf(template).border) {
    const printed = style.border === "white" ? "white" : "black";
    const wanted = choices.border === "keep" ? printed : choices.border;
    if (wanted === "white") style = { ...style, border: "white" };
    else {
      const { border: _border, ...rest } = style;
      void _border;
      style = rest;
    }
    if (wanted !== printed) changes.push("border");
  } else if (style.border !== undefined) {
    const { border: _border, ...rest } = style;
    void _border;
    style = rest;
  }

  // ---- The set symbol ----
  let setIconCode: string | null = null;
  if (choices.setSymbol === "printing") {
    setIconCode = printingSetSymbolCode(input.scryfallSet, patch.collector?.set_code);
    if (setIconCode) changes.push("set_symbol");
    else notes.push("No set symbol: PipGlyph has no symbol for this printing's set.");
  }

  // ---- The watermark ----
  const baselineWatermark = effectiveWatermark(BULK_WATERMARK_KEEP, m.card_type, input.removeWatermark);
  const watermark = effectiveWatermark(choices.watermark, m.card_type, input.removeWatermark);
  if (watermarkKey(watermark) !== watermarkKey(baselineWatermark)) changes.push("watermark");
  else if (choices.watermark !== BULK_WATERMARK_KEEP && usesDefaultWatermark(m.card_type) && !input.removeWatermark) {
    notes.push("Keeps the PipGlyph Rose: free accounts' creatures and spells always carry it.");
  }

  // ---- The art ----
  const doubleFaced = Boolean(m.back_face) && templateTakesBackBody(template);
  if (choices.art === "ai") changes.push("ai_art");

  if (changes.length === 0) {
    return {
      ok: false,
      title,
      reason: "unchanged",
      message: notes[0]
        ? `${notes[0]} With nothing changed it would be the real card, so it isn't made.`
        : "Nothing would change on this card, so it isn't made.",
    };
  }

  const station = stationSaveFields({
    template,
    rulesText: m.rules_text,
    hasPt: printsPowerToughness({
      cardType: m.card_type,
      supertype: m.supertype,
      subtypes: m.subtypes,
      power: m.power,
      toughness: m.toughness,
    }),
  });

  const keepArt = choices.art === "keep";
  const backFace: CardBackFace | undefined = m.back_face
    ? {
        ...m.back_face,
        // The back's printed artist travels with its printed art.
        ...(keepArt && doubleFaced && patch.back_face?.artist_credit ? { artist_credit: patch.back_face.artist_credit } : {}),
      }
    : undefined;

  const payload: BulkCardPayload = {
    title,
    cost: m.cost,
    color_identity: colorIdentity,
    supertype: m.supertype,
    card_type: m.card_type,
    subtypes: m.subtypes,
    ...(patch.printed_types !== undefined ? { printed_types: patch.printed_types } : {}),
    ...(patch.nickname ? { nickname: patch.nickname } : {}),
    rarity: m.rarity,
    rules_text: station?.rules_text ?? m.rules_text,
    ...(station ? { face_content: station.face_content } : {}),
    flavor_text: m.flavor_text,
    power: m.power,
    toughness: m.toughness,
    loyalty: m.loyalty,
    defense: m.defense,
    frame_style: { template, ...style },
    ...(backFace ? { back_face: backFace } : {}),
    source_scryfall_id: m.source_scryfall_id,
    set_icon_code: setIconCode,
    ...(patch.collector
      ? { set_code: patch.collector.set_code, collector_number: patch.collector.collector_number, lang: patch.collector.lang }
      : {}),
    watermark,
    ...(keepArt && patch.artist_credit ? { artist_credit: patch.artist_credit } : {}),
    // A card with no picture yet is never published.
    visibility: choices.art === "later" ? "private" : choices.visibility,
    import_unchanged: false,
  };

  return {
    ok: true,
    title: backFace?.title && doubleFaced ? `${title} // ${backFace.title}` : title,
    payload,
    changes,
    notes,
    doubleFaced,
    credits: choices.art === "ai" ? BULK_AI_ART_CREDITS_PER_FACE * (doubleFaced ? 2 : 1) : 0,
  };
}
