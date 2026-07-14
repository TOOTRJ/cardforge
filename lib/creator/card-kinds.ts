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
  TEMPLATE_SKIN_VARIANTS,
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
import { getFrameProfile } from "@/lib/cards/template-layout";
import { isFrameComboAvailable } from "@/lib/cards/frame-availability";
import {
  BASIC_LAND_NAME_BY_KEY,
  basicLandNameForColorKey,
} from "@/lib/cards/watermark";
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
   *  a flip/split/aftermath half) → the wizard force-enables has_back_face.
   *  DERIVED from the frame profile (templatePaintsSecondFace) — never
   *  hand-kept, so it can't drift from what the renderer actually paints. */
  inlineSecondFace: boolean;
  /** Representative template for the kind chip's thumbnail. */
  previewTemplate: FrameTemplate;
};

/** True when the template's profile paints an intrinsic second face drawn
 *  from back-face content (Adventure's storybook page, a flip/split/
 *  aftermath half). The ONE source of truth — steps.ts hasInlineBackFace and
 *  KIND_DEFS.inlineSecondFace both resolve through it. */
export function templatePaintsSecondFace(
  template: FrameTemplate | string | undefined,
): boolean {
  const p = getFrameProfile(normalizeFrameTemplate(template));
  return p.adventure != null || p.secondFace != null;
}

const RAW_KIND_DEFS: Record<CardKind, Omit<KindDef, "inlineSecondFace">> = {
  creature: {
    label: "Creature",
    cardType: "creature",
    layoutTemplates: null,
    previewTemplate: "m15",
  },
  instant: {
    label: "Instant",
    cardType: "instant",
    layoutTemplates: null,
    previewTemplate: "m15",
  },
  sorcery: {
    label: "Sorcery",
    cardType: "sorcery",
    layoutTemplates: null,
    previewTemplate: "m15",
  },
  artifact: {
    label: "Artifact",
    cardType: "artifact",
    layoutTemplates: null,
    previewTemplate: "m15artifact",
  },
  enchantment: {
    label: "Enchantment",
    cardType: "enchantment",
    layoutTemplates: null,
    previewTemplate: "m15",
  },
  land: {
    label: "Land",
    cardType: "land",
    layoutTemplates: null,
    previewTemplate: "m15land",
  },
  planeswalker: {
    label: "Planeswalker",
    cardType: "planeswalker",
    layoutTemplates: null,
    previewTemplate: "m15pw",
  },
  battle: {
    label: "Battle",
    cardType: "battle",
    layoutTemplates: null,
    previewTemplate: "battle",
  },
  token: {
    label: "Token",
    cardType: "token",
    layoutTemplates: null,
    previewTemplate: "m15token",
  },
  saga: {
    label: "Saga",
    cardType: "enchantment",
    layoutTemplates: ["saga"],
    previewTemplate: "saga",
  },
  adventure: {
    label: "Adventure",
    cardType: "creature",
    layoutTemplates: ["adventure"],
    previewTemplate: "adventure",
  },
  split: {
    label: "Split",
    cardType: "instant",
    layoutTemplates: ["split"],
    previewTemplate: "split",
  },
  aftermath: {
    label: "Aftermath",
    cardType: "sorcery",
    layoutTemplates: ["aftermath"],
    previewTemplate: "aftermath",
  },
  flip: {
    label: "Flip",
    cardType: "creature",
    layoutTemplates: ["flip"],
    previewTemplate: "flip",
  },
};

export const KIND_DEFS: Record<CardKind, KindDef> = Object.fromEntries(
  (Object.entries(RAW_KIND_DEFS) as [CardKind, Omit<KindDef, "inlineSecondFace">][]).map(
    ([kind, def]) => [
      kind,
      {
        ...def,
        // Standard kinds never paint a second face; layout kinds ask their
        // template's profile (saga's chapter rail is NOT a second face).
        inlineSecondFace: def.layoutTemplates
          ? templatePaintsSecondFace(def.layoutTemplates[0])
          : false,
      },
    ],
  ),
) as Record<CardKind, KindDef>;

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

// Type-specific showcase treatments: real expeditions / full-art basics are
// land trade dress, Nyx constellation is enchantment dress. Absent = any
// standard kind (stats still gate on type).
const SHOWCASE_KIND_RESTRICTION: Partial<Record<FrameTemplate, CardKind[]>> = {
  expeditionland: ["land"],
  fullartland: ["land"],
  m15textlessland: ["land"],
  nyx: ["enchantment"],
};

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
    // Skins re-dress a specific BASE frame with identical geometry
    // (m15snow → m15, m15snowland → m15land, m15tokenartifact → m15token),
    // so each era standard brings exactly its own variants.
    for (const skin of TEMPLATE_SKIN_VARIANTS[standard] ?? []) {
      out.push({
        template: skin,
        era,
        group: "skin",
        availableColorKeys: colors(skin),
      });
    }
  }
  // Showcase treatments dress any standard kind (stats still gate on type),
  // except the type-restricted premium dresses above.
  for (const t of SHOWCASE_TEMPLATES) {
    const restriction = SHOWCASE_KIND_RESTRICTION[t];
    if (restriction && !restriction.includes(kind)) continue;
    out.push({
      template: t,
      era: "showcase",
      group: "showcase",
      availableColorKeys: colors(t),
    });
  }
  return out;
}

// Reverse skin map: variant → its base (m15snow → m15). Built from
// TEMPLATE_SKIN_VARIANTS so the two can't drift.
const SKIN_BASE: ReadonlyMap<FrameTemplate, FrameTemplate> = new Map(
  (Object.entries(TEMPLATE_SKIN_VARIANTS) as [FrameTemplate, FrameTemplate[]][]).flatMap(
    ([base, skins]) => (skins ?? []).map((s) => [s, base] as const),
  ),
);

/** The FRAME-section template a stored template maps to: a skin resolves to
 *  its base, a showcase treatment to the kind's M15 standard (showcase is
 *  M15-era trade dress), everything else to itself. The Variations section
 *  owns the difference between this and the actual template. */
export function baseFrameFor(
  kind: CardKind,
  template: FrameTemplate,
): FrameTemplate {
  const skinBase = SKIN_BASE.get(template);
  if (skinBase) return skinBase;
  if (FRAME_SET_ERA[FRAME_TEMPLATE_SET[template]] === "showcase") {
    return standardFrameFor("m15", KIND_DEFS[kind].cardType) ?? template;
  }
  return template;
}

/** True when the template has at least one PUBLISHED color. */
export function templateHasAvailableColor(
  template: FrameTemplate,
  verifiedKeys: ReadonlySet<string>,
): boolean {
  return FRAME_COLOR_KEYS.some((k) =>
    isFrameComboAvailable(template, k, verifiedKeys),
  );
}

/** The first gallery frame for a kind with any published color, or null when
 *  the whole kind is unpublished. Kind selection falls back through this so
 *  picking a card type can never land on an unverified frame. */
export function firstAvailableFrame(
  kind: CardKind,
  verifiedKeys: ReadonlySet<string>,
): FrameChoice | null {
  return (
    framesForKind(kind, verifiedKeys).find(
      (f) => f.availableColorKeys.length > 0,
    ) ?? null
  );
}

/** True when the kind has at least one published frame — drives the kind
 *  chips' enable/disable in the creator. */
export function kindHasAvailableFrame(
  kind: CardKind,
  verifiedKeys: ReadonlySet<string>,
): boolean {
  return firstAvailableFrame(kind, verifiedKeys) !== null;
}

// ---------------------------------------------------------------------------
// Basic-land auto-identity — picking the Land kind starts you on a real
// basic (name + Basic supertype + subtype), which is what makes the big
// mana symbol render immediately. The seed follows the frame color while
// untouched and is cleared when the user leaves the Land kind, so it can
// never overwrite a name the user typed.
// ---------------------------------------------------------------------------

export type BasicLandSeed = {
  title: string;
  supertype: string;
  subtypes_text: string;
};

/** The identity the creator seeds for a land of the given frame color
 *  ("c" → Wastes). "m" has no basic — multicolor lands are nonbasics the
 *  user names themselves — so it returns null. */
export function basicLandSeedForColorKey(key: string): BasicLandSeed | null {
  const name = basicLandNameForColorKey(key);
  return name
    ? { title: name, supertype: "Basic", subtypes_text: name }
    : null;
}

/** True when the identity fields are untouched (all empty) or still exactly
 *  match one of the auto-seeds — the only states the creator is allowed to
 *  rewrite (color-follow, or cleanup on leaving the Land kind). */
export function isSeedableLandIdentity(v: BasicLandSeed): boolean {
  const title = v.title.trim();
  const supertype = v.supertype.trim();
  const subtypes = v.subtypes_text.trim();
  if (!title && !supertype && !subtypes) return true;
  return Object.values(BASIC_LAND_NAME_BY_KEY).some(
    (name) =>
      title === name && supertype === "Basic" && subtypes === name,
  );
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
