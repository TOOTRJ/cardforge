// Pure, React-free model for the KIND-FIRST creator flow: the user picks what
// they're making (a "card kind"), then a frame from every era that can dress
// that kind, then the frame's color.
//
// A kind is a WIZARD-LEVEL concept and is never persisted. Cards keep storing
// `card_type` + `frame_style.template`; `kindFromCard()` re-derives the kind
// on load, so drafts, edit mode, and legacy rows work with no migration and
// there is no second source of truth to fall out of sync.
//
// Standard kinds mirror CardType (minus the legacy "spell"). Layout kinds
// promote the structural M15 layouts (Saga, Adventure, Split, Aftermath,
// Flip) to first-class choices — they change the card's anatomy, so they ARE
// what the user is making. Skins (m15snow/m15devoid) are NOT kinds: a snow
// creature is still a creature; the gallery offers them as variants.
//
// Kept side-effect free + dependency-light so it's unit-testable and shared
// by the form, panels, and import mappers.

import {
  ERA_SKIN_VARIANTS,
  ERA_TYPE_FRAME,
  FRAME_ERA_LABELS,
  FRAME_ERA_VALUES,
  FRAME_SET_ERA,
  FRAME_TEMPLATE_SET,
  FRAME_TEMPLATE_VALUES,
  type CardType,
  type FrameEra,
  type FrameTemplate,
} from "@/types/card";
import { normalizeFrameTemplate } from "@/lib/cards/card-display";
import { isFrameComboAvailable } from "@/lib/cards/frame-availability";
import { eraForTemplate, standardFrameFor } from "@/lib/creator/frame-picker";

// ---------------------------------------------------------------------------
// Kind taxonomy
// ---------------------------------------------------------------------------

export const CARD_KIND_VALUES = [
  // Standard kinds — mirror CardType, minus the legacy "spell".
  "creature",
  "instant",
  "sorcery",
  "artifact",
  "enchantment",
  "land",
  "planeswalker",
  "battle",
  "token",
  // Layout kinds — structural M15 layouts promoted to first-class picks.
  "saga",
  "adventure",
  "split",
  "aftermath",
  "flip",
] as const;
export type CardKind = (typeof CARD_KIND_VALUES)[number];

export type KindDef = {
  label: string;
  /** The card_type written when this kind is chosen. */
  cardType: CardType;
  /** Exact template family for layout kinds; null → standard kind whose
   *  frames come from ERA_TYPE_FRAME per era (+ skins + showcase). */
  layoutTemplates: readonly FrameTemplate[] | null;
  /** The frame paints an intrinsic second face (Adventure's storybook page,
   *  a flip/split/aftermath half) → the wizard force-enables has_back_face. */
  inlineSecondFace: boolean;
  /** Representative template for the kind chip's thumbnail. */
  previewTemplate: FrameTemplate;
};

export const KIND_DEFS: Record<CardKind, KindDef> = {
  creature: {
    label: "Creature",
    cardType: "creature",
    layoutTemplates: null,
    inlineSecondFace: false,
    previewTemplate: "m15",
  },
  instant: {
    label: "Instant",
    cardType: "instant",
    layoutTemplates: null,
    inlineSecondFace: false,
    previewTemplate: "m15",
  },
  sorcery: {
    label: "Sorcery",
    cardType: "sorcery",
    layoutTemplates: null,
    inlineSecondFace: false,
    previewTemplate: "m15",
  },
  artifact: {
    label: "Artifact",
    cardType: "artifact",
    layoutTemplates: null,
    inlineSecondFace: false,
    previewTemplate: "m15",
  },
  enchantment: {
    label: "Enchantment",
    cardType: "enchantment",
    layoutTemplates: null,
    inlineSecondFace: false,
    previewTemplate: "m15",
  },
  land: {
    label: "Land",
    cardType: "land",
    layoutTemplates: null,
    inlineSecondFace: false,
    previewTemplate: "m15land",
  },
  planeswalker: {
    label: "Planeswalker",
    cardType: "planeswalker",
    layoutTemplates: null,
    inlineSecondFace: false,
    previewTemplate: "m15pw",
  },
  battle: {
    label: "Battle",
    cardType: "battle",
    layoutTemplates: null,
    inlineSecondFace: false,
    previewTemplate: "battle",
  },
  token: {
    label: "Token",
    cardType: "token",
    layoutTemplates: null,
    inlineSecondFace: false,
    previewTemplate: "m15token",
  },
  saga: {
    label: "Saga",
    cardType: "enchantment",
    layoutTemplates: ["saga"],
    inlineSecondFace: false,
    previewTemplate: "saga",
  },
  adventure: {
    label: "Adventure",
    cardType: "creature",
    layoutTemplates: ["adventure"],
    inlineSecondFace: true,
    previewTemplate: "adventure",
  },
  split: {
    label: "Split",
    cardType: "instant",
    layoutTemplates: ["split"],
    inlineSecondFace: true,
    previewTemplate: "split",
  },
  aftermath: {
    label: "Aftermath",
    cardType: "sorcery",
    layoutTemplates: ["aftermath"],
    inlineSecondFace: true,
    previewTemplate: "aftermath",
  },
  flip: {
    label: "Flip",
    cardType: "creature",
    layoutTemplates: ["flip"],
    inlineSecondFace: true,
    previewTemplate: "flip",
  },
};

// Reverse map: layout template → its kind (saga → saga, adventure →
// adventure, …). Skins and standards are deliberately absent — they resolve
// through the card_type branch of kindFromCard.
const TEMPLATE_KIND: ReadonlyMap<FrameTemplate, CardKind> = new Map(
  (Object.entries(KIND_DEFS) as [CardKind, KindDef][]).flatMap(
    ([kind, def]) => (def.layoutTemplates ?? []).map((t) => [t, kind] as const),
  ),
);

/** Derive the kind from persisted/form state. The template wins (a saga
 *  frame IS the saga kind, whatever card_type says); otherwise card_type
 *  maps 1:1. Legacy "spell" displays as sorcery WITHOUT rewriting the stored
 *  card_type — writes only happen on an explicit kind change. */
export function kindFromCard(
  cardType: CardType | "" | null | undefined,
  template: FrameTemplate | string | null | undefined,
): CardKind {
  const byTemplate = TEMPLATE_KIND.get(normalizeFrameTemplate(template));
  if (byTemplate) return byTemplate;
  const ct = (cardType || "creature") as CardType;
  return ct === "spell" ? "sorcery" : (ct as CardKind);
}

// ---------------------------------------------------------------------------
// Frame gallery — every frame that can dress a kind, across all eras
// ---------------------------------------------------------------------------

/** The 7-color PNG contract every template ships (frame-layer.tsx maps a
 *  ColorIdentity[] onto one of these via pickFrameColorKey). */
export const FRAME_COLOR_KEYS = ["w", "u", "b", "r", "g", "c", "m"] as const;
export type FrameColorKey = (typeof FRAME_COLOR_KEYS)[number];

export type FrameChoice = {
  template: FrameTemplate;
  /** Groups/labels the gallery section this frame renders under. */
  era: FrameEra;
  group: "standard" | "skin" | "layout" | "showcase";
  /** Color keys the verification gate has published for this template.
   *  Empty → render the tile disabled with a Soon badge. */
  availableColorKeys: FrameColorKey[];
};

const SHOWCASE_TEMPLATES: readonly FrameTemplate[] =
  FRAME_TEMPLATE_VALUES.filter(
    (t) => FRAME_SET_ERA[FRAME_TEMPLATE_SET[t]] === "showcase",
  );

/** All frames offered for a kind, across every era, in gallery display
 *  order: border-era standards (+ their skin variants) oldest→newest, then
 *  layout templates, then showcase treatments. There is deliberately NO
 *  fallback here — an era with no frame for the kind simply doesn't appear,
 *  which removes the picker's dead ends by construction. */
export function framesForKind(
  kind: CardKind,
  verifiedKeys: ReadonlySet<string>,
): FrameChoice[] {
  const def = KIND_DEFS[kind];
  const colors = (t: FrameTemplate) =>
    FRAME_COLOR_KEYS.filter((k) => isFrameComboAvailable(t, k, verifiedKeys));

  // Layout kinds are exactly their template family (all M15-era today).
  if (def.layoutTemplates) {
    return def.layoutTemplates.map((t) => ({
      template: t,
      era: eraForTemplate(t),
      group: "layout" as const,
      availableColorKeys: colors(t),
    }));
  }

  const out: FrameChoice[] = [];
  for (const era of FRAME_ERA_VALUES) {
    if (era === "showcase") continue; // appended below, after border eras
    const standard = ERA_TYPE_FRAME[era]?.[def.cardType];
    if (!standard) continue;
    out.push({
      template: standard,
      era,
      group: "standard",
      availableColorKeys: colors(standard),
    });
    // Skins re-dress the era's plain spell frame (m15snow/m15devoid keep the
    // m15 geometry wholesale) — offer them only where the era standard for
    // this kind IS that base frame (creature/instant/sorcery/artifact/
    // enchantment; not land/token/planeswalker/battle, whose standards have
    // their own geometry).
    if (standard === "m15") {
      for (const skin of ERA_SKIN_VARIANTS[era]) {
        out.push({
          template: skin,
          era,
          group: "skin",
          availableColorKeys: colors(skin),
        });
      }
    }
  }
  // Showcase treatments dress any standard kind (stats still gate on type).
  for (const t of SHOWCASE_TEMPLATES) {
    out.push({
      template: t,
      era: "showcase",
      group: "showcase",
      availableColorKeys: colors(t),
    });
  }
  return out;
}

/** True when the template is one the gallery would offer for the kind. Used
 *  by edit mode to pin a saved-but-mismatched legacy frame ("Current frame")
 *  instead of silently swapping it. */
export function isFrameValidForKind(
  kind: CardKind,
  template: FrameTemplate,
  verifiedKeys: ReadonlySet<string>,
): boolean {
  return framesForKind(kind, verifiedKeys).some((f) => f.template === template);
}

// ---------------------------------------------------------------------------
// Kind changes — the ONLY writer of frame_style.template in the new flow
// ---------------------------------------------------------------------------

export type KindChangePatch = {
  card_type: CardType;
  template: FrameTemplate;
  /** Present (true) when entering a kind whose frame paints an intrinsic
   *  second face — the form force-enables the back-face editor. */
  has_back_face?: true;
};

export type KindChangePlan =
  | { action: "apply"; patch: KindChangePatch }
  | {
      action: "confirm";
      reason: "era-lacks-kind";
      /** User-facing prompt copy for the confirm dialog. */
      message: string;
      patch: KindChangePatch;
    };

/** Plan the state transition for an explicit kind change. Stays in the
 *  current frame's era when it has an equivalent frame for the new kind
 *  (m15 creature → m15pw); otherwise returns a CONFIRM plan that falls
 *  forward to the M15 era only if the user accepts — never silently.
 *  Everything not in the patch is untouched by design: title, text, art,
 *  cost, and colors always survive a kind change. */
export function planKindChange(
  next: CardKind,
  current: {
    cardType: CardType | "" | null | undefined;
    template: FrameTemplate | string | null | undefined;
  },
): KindChangePlan {
  const def = KIND_DEFS[next];
  const backFace = def.inlineSecondFace ? { has_back_face: true as const } : {};

  // Layout kinds are deterministic — one template family.
  if (def.layoutTemplates) {
    return {
      action: "apply",
      patch: {
        card_type: def.cardType,
        template: def.layoutTemplates[0],
        ...backFace,
      },
    };
  }

  const era = eraForTemplate(normalizeFrameTemplate(current.template));
  const sameEra = standardFrameFor(era, def.cardType);
  if (sameEra) {
    return {
      action: "apply",
      patch: { card_type: def.cardType, template: sameEra, ...backFace },
    };
  }

  // The era can't frame this kind (Classic has no planeswalker; showcase has
  // no type mapping). M15 frames every kind — but switching era is the
  // user's call, not ours.
  const fallback = standardFrameFor("m15", def.cardType);
  return {
    action: "confirm",
    reason: "era-lacks-kind",
    message: `${FRAME_ERA_LABELS[era]} has no ${def.label} frame — switch to the M15 ${def.label} frame?`,
    // M15 covers every card type, so fallback can't be null; the ?? only
    // satisfies the type system.
    patch: {
      card_type: def.cardType,
      template: fallback ?? "m15",
      ...backFace,
    },
  };
}
