// ---------------------------------------------------------------------------
// Which TYPEFACE a piece of card text is set in — ONE resolver, read by both
// renderers at every text site (TODO 4.8.0; era design 2026-10-06 §8).
// Client-safe, no imports but types and the generated metric tables.
// (lib/cards/faces.ts is the DOUBLE-FACED card's module; this one is about
// fonts.)
//
// Before it, a slot's `font` was honoured unevenly: the bake's Band and
// FlipsideBake hard-coded the display face while the preview's BandSlot and
// FlipsideOverlay read the slot, and stats, numerals, badges, second faces
// and the brand mark were hard-coded in both. Every profile said "display"
// there, so no card was wrong — but a profile that set `font: "body"` on a
// type line would have changed the preview and not the bake. Now:
//
//   slotFace(slot)          the face of a slot that carries `font` (a
//                           TextSlot, a StatSlot) — what a renderer calls
//                           with the slot it is drawing;
//   faceOf(profile, role)   the face of a ROLE on a profile: the role's slot
//                           where it has one, the profile's own field where
//                           it has none (walker badges, saga numerals), and
//                           ALWAYS the brand face for the pipglyph.com mark.
//
// A face answers everything a renderer or a fit needs of it: its registered
// family and fallback chain (as the bake and the browser spell it), its hhea
// line box, and its metric table
// (lib/cards/font-metrics.ts, generated from the TTF).
//
// The faces are the ones the repo HAS (owner decision 2026-10-07: no new
// typeface now): "display" = CardDisplay (Beleren Bold), "body" = MPlantin.
// A new face is an entry here, a line in scripts/lib/font-metrics.mjs and in
// lib/render/card-fonts.ts cardFonts() (registered before Keyrune, never
// last) — and nothing in either renderer.
// ---------------------------------------------------------------------------

import { LINE_FACE_METRICS, type LineFaceId, type LineFaceMetrics } from "@/lib/cards/font-metrics";
import type { FrameProfile, StatSlot, TextSlot } from "@/lib/cards/template-layout";

/** A slot's face (TextSlot.font, StatSlot.font). */
export type SlotFace = "display" | "body";

/** What a name, type line, stat or strip word is set in when its slot names
 *  no face. (Every shipped TextSlot names one; a StatSlot names none and
 *  takes this.) */
export const DEFAULT_SLOT_FACE: SlotFace = "display";

/** What a FOOTER is set in when its slot names no face: the body face, as
 *  both renderers always read an unset `font` there (every shipped footer
 *  says "display"). A RULES box never asks: its lines are broken on
 *  MPlantin's advances (lib/cards/rules-layout.ts — one rules layout) and
 *  both renderers draw it in TYPE_FACES.body, whatever its slot says. */
export const TEXT_DEFAULT_FACE: SlotFace = "body";

export type TypeFace = {
  id: SlotFace;
  /** The family both renderers register the face under (the Satori fonts
   *  array, lib/render/card-fonts.ts; `@font-face`, app/globals.css). */
  family: string;
  /** `font-family` as the BAKE sets it: the face, then the faces Satori may
   *  fall back to for a character it lacks. */
  bakeFamily: string;
  /** `font-family` as the PREVIEW sets it: the same chain, then the
   *  browser's serifs while a web font loads. */
  previewFamily: string;
  /** The weight the face's one master is registered with in the bake. Its
   *  `@font-face` covers 400–700 with that master (app/globals.css), so a
   *  site's own `font-weight` (600, 700) draws the same glyphs in the
   *  browser — never a synthesized bold — as in Satori, which takes the
   *  nearest registered weight. */
  registeredWeight: number;
  /** Which table of lib/cards/font-metrics.ts measures it. */
  metricsId: LineFaceId;
  metrics: LineFaceMetrics;
  /** hhea ascent / descent, em: a `line-height: normal` box is their sum
   *  (plus the face's line gap), in the browser and in Satori alike. */
  ascentEm: number;
  descentEm: number;
  /** The baseline below the centre of the face's own line box, per em —
   *  what a band whose text grows by Δ lowers its baseline by, × Δ
   *  (lib/cards/template-layout.ts slotTextDy). */
  baselineBelowCentreEm: number;
};

const SERIF_FALLBACK = 'Georgia, "Times New Roman", serif';

function face(id: SlotFace, family: string, fallbacks: readonly string[], metricsId: LineFaceId): TypeFace {
  const metrics = LINE_FACE_METRICS[metricsId];
  const bakeFamily = [family, ...fallbacks].map((name) => `"${name}"`).join(", ");
  return {
    id,
    family,
    bakeFamily,
    previewFamily: `${bakeFamily}, ${SERIF_FALLBACK}`,
    registeredWeight: 400,
    metricsId,
    metrics,
    ascentEm: metrics.ascender / metrics.unitsPerEm,
    descentEm: metrics.descender / metrics.unitsPerEm,
    // The same expression the hand-kept constant was: (1917 − 552) ÷ 2 ÷ 2048.
    baselineBelowCentreEm: (metrics.ascender - metrics.descender) / 2 / metrics.unitsPerEm,
  };
}

/** What a saga's chapter numerals are set in when the profile names no
 *  face: MPlantin, as printed (TODO 4.21c). */
export const NUMERAL_DEFAULT_FACE: SlotFace = "body";

/** The faces a slot can be set in. */
export const TYPE_FACES: Readonly<Record<SlotFace, TypeFace>> = {
  // Beleren Bold, falling back to MPlantin for what it lacks.
  display: face("display", "CardDisplay", ["MPlantin"], "display"),
  body: face("body", "MPlantin", [], "body"),
};

/** The pipglyph.com mark's face: the brand's, whatever the profile says
 *  (era design D16) — never a frame's era face. */
export const BRAND_FACE: TypeFace = TYPE_FACES.display;

/** The face named `font` (a slot's field), the default when it names none. */
export function typeFace(font: SlotFace | undefined): TypeFace {
  return TYPE_FACES[font ?? DEFAULT_SLOT_FACE];
}

/** The face a slot's text is set in — both renderers, every single-line
 *  slot: a name or type band, a stat value, the strip's word. `fallback` is
 *  the face of a slot that names none (the display face). */
export function slotFace(slot: { font?: SlotFace } | null | undefined, fallback: SlotFace = DEFAULT_SLOT_FACE): TypeFace {
  return typeFace(slot?.font ?? fallback);
}

/** The face the FOOTER's artist line (and a clean download's custom mark)
 *  is set in: the slot's, the body face when it names none. */
export function footerFace(footer: { font?: SlotFace } | null | undefined): TypeFace {
  return slotFace(footer, TEXT_DEFAULT_FACE);
}

/** The text roles a card draws outside its rules box. */
export type FaceRole =
  | "name"
  | "typeLine"
  /** P/T (and a walker's loyalty, a battle's defense: `slotFace` of their
   *  own slot where it differs). */
  | "stat"
  /** A saga's chapter numerals. */
  | "numeral"
  /** A planeswalker's loyalty-cost badges. */
  | "badge"
  | "secondName"
  | "secondType"
  | "secondStat"
  | "footer"
  /** The modal strip's type word. */
  | "stripWord"
  /** The pipglyph.com brand mark. */
  | "mark";

export const FACE_ROLES: readonly FaceRole[] = [
  "name",
  "typeLine",
  "stat",
  "numeral",
  "badge",
  "secondName",
  "secondType",
  "secondStat",
  "footer",
  "stripWord",
  "mark",
];

type FaceProfile = {
  title?: Pick<TextSlot, "font">;
  /** The type line's slot (FrameProfile.type). */
  type?: Pick<TextSlot, "font">;
  footer?: Pick<TextSlot, "font">;
  pt?: Pick<StatSlot, "font">;
  loyalty?: Pick<StatSlot, "font">;
  defense?: Pick<StatSlot, "font">;
  reversePt?: Pick<StatSlot, "font">;
  adventure?: { title: Pick<TextSlot, "font">; type: Pick<TextSlot, "font"> };
  flipside?: { word: Pick<TextSlot, "font"> };
  secondFace?: { title: Pick<TextSlot, "font">; type: Pick<TextSlot, "font">; pt?: Pick<StatSlot, "font"> };
  loyaltyRows?: Pick<NonNullable<FrameProfile["loyaltyRows"]>, "badgeFont">;
  chapters?: { badge: Pick<NonNullable<FrameProfile["chapters"]>["badge"], "numeralFont"> };
};

/**
 * The face `role` is set in on `profile`: its slot's `font` where the role
 * has a slot, the profile's own field where it has none (`loyaltyRows
 * .badgeFont`, `chapters.badge.numeralFont`), the default face where the
 * profile says nothing (the body face for a saga's numerals, as the prints
 * set them) — and the BRAND face for the mark, always.
 */
export function faceOf(profile: FaceProfile, role: FaceRole): TypeFace {
  switch (role) {
    case "mark":
      return BRAND_FACE;
    case "name":
      return slotFace(profile.title);
    case "typeLine":
      return slotFace(profile.type);
    case "footer":
      return footerFace(profile.footer);
    case "stat":
      return slotFace(profile.pt ?? profile.loyalty ?? profile.defense);
    case "stripWord":
      return slotFace(profile.flipside?.word);
    case "secondName":
      return slotFace(profile.secondFace?.title);
    case "secondType":
      return slotFace(profile.secondFace?.type);
    case "secondStat":
      return slotFace(profile.secondFace?.pt);
    case "badge":
      return typeFace(profile.loyaltyRows?.badgeFont);
    case "numeral":
      // Since TODO 4.21c the prints' numerals are set in the BODY face.
      return typeFace(profile.chapters?.badge.numeralFont ?? NUMERAL_DEFAULT_FACE);
  }
}

/** Every face `profile` draws text in outside its rules box — the roles it
 *  HAS (a badge only with ability rows, a numeral only with a chapter rail)
 *  and the slots a role does not name (a walker's loyalty, a battle's
 *  defense, the reverse P/T, the adventure panel's bars): what
 *  lib/render/card-fonts.ts cardFonts() registers for a render. (The rules
 *  box's body face and the brand face are always among a render's fonts.) */
export function facesOf(profile: FaceProfile): SlotFace[] {
  const ids = new Set<SlotFace>([BRAND_FACE.id, faceOf(profile, "name").id, faceOf(profile, "typeLine").id]);
  if (profile.footer) ids.add(footerFace(profile.footer).id);
  if (profile.loyaltyRows) ids.add(faceOf(profile, "badge").id);
  if (profile.chapters) ids.add(faceOf(profile, "numeral").id);
  const slots = [
    profile.pt,
    profile.loyalty,
    profile.defense,
    profile.reversePt,
    profile.flipside?.word,
    profile.secondFace?.title,
    profile.secondFace?.type,
    profile.secondFace?.pt,
    profile.adventure?.title,
    profile.adventure?.type,
  ];
  for (const slot of slots) if (slot) ids.add(slotFace(slot).id);
  return (Object.keys(TYPE_FACES) as SlotFace[]).filter((id) => ids.has(id));
}
