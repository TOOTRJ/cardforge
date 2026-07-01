// Pure, React-free panel model for the card-creator editor. Kept side-effect
// free so it's unit-testable under the node test env and so both the client
// form and the tests derive the SAME panel list from the same rules.
//
// The editor is FRAME-AWARE: which panels appear (and a couple of panel
// labels) depend on the chosen frame template + card type + whether a back
// face exists. Field→panel routing is derived from the panel defs (no
// hand-kept map to drift).

import type { CardType, FrameTemplate } from "@/types/card";
import type { FormValues } from "@/lib/creator/form-types";
import {
  normalizeFrameTemplate,
  showsDefense,
  showsLoyalty,
  showsPowerToughness,
} from "@/lib/cards/card-display";
import { getFrameProfile } from "@/lib/cards/template-layout";

export type StepKey =
  | "identity"
  | "pips"
  | "frame"
  | "art"
  | "text"
  | "abilities"
  | "layout"
  | "effects"
  | "publish";

export type StepContext = {
  template: FrameTemplate | string | undefined;
  cardType: CardType | "" | null | undefined;
  hasBackFace: boolean;
};

export type StepDef = {
  key: StepKey;
  /** Fallback label. The "layout" panel's label is dynamic — use stepLabel(). */
  label: string;
  /** Short helper shown under the panel label on mobile. */
  description: string;
  /** Form fields this panel owns — drives per-panel validation + error routing. */
  fields: (keyof FormValues)[];
  /** Whether this panel appears for the given context. */
  isVisible: (ctx: StepContext) => boolean;
};

const always = () => true;

// ---------------------------------------------------------------------------
// Frame-derived predicates (thin wrappers so the form + tests agree).
// ---------------------------------------------------------------------------

/** True when the frame is the Adventure frame (its second "face" is the inline
 *  adventure spell, sourced from the back-face content). */
export function isAdventureFrame(
  template: FrameTemplate | string | undefined,
): boolean {
  return getFrameProfile(normalizeFrameTemplate(template)).adventure != null;
}

/** True when the frame has an INTRINSIC second face drawn from the back-face
 *  content (Adventure's storybook page, or a flip/split/aftermath rotated face).
 *  Such frames always show the back-face/layout panel — the second face isn't
 *  optional, it's part of the frame. */
export function hasInlineBackFace(
  template: FrameTemplate | string | undefined,
): boolean {
  const p = getFrameProfile(normalizeFrameTemplate(template));
  return p.adventure != null || p.secondFace != null;
}

/** True when the frame paints no mana cost (tokens, some lands), so the cost
 *  field should be hidden. */
export function hidesCost(
  template: FrameTemplate | string | undefined,
): boolean {
  return getFrameProfile(normalizeFrameTemplate(template)).hideCost === true;
}

/** Which stat inputs are relevant for a card type — P/T vs loyalty vs defense.
 *  Mirrors the renderer's gating so the form never shows a stat the card can't
 *  display. */
export function statVisibility(cardType: CardType | "" | null | undefined): {
  pt: boolean;
  loyalty: boolean;
  defense: boolean;
} {
  const ct = (cardType || null) as CardType | null;
  return {
    pt: showsPowerToughness(ct),
    loyalty: showsLoyalty(ct),
    defense: showsDefense(ct),
  };
}

// ---------------------------------------------------------------------------
// Panel definitions (declaration order = display order).
// ---------------------------------------------------------------------------

const STEP_DEFS: StepDef[] = [
  {
    // Frame leads the flow: the user picks the era + frame first, then fills in
    // the card's identity. The frame picker reads card_type / color_identity,
    // which start from their defaults (creature / colorless) and update the
    // type-derived standard frame automatically as those are set on later steps
    // — so leading with Frame never strands the picker.
    key: "frame",
    label: "Frame",
    description: "Era & frame style",
    fields: ["frame_style"],
    isVisible: always,
  },
  {
    key: "identity",
    label: "Identity",
    description: "Name, type & rarity",
    fields: [
      "title",
      "card_type",
      "supertype",
      "subtypes_text",
      "rarity",
      "game_system_id",
      "template_id",
    ],
    isVisible: always,
  },
  {
    key: "pips",
    label: "Pips",
    description: "Mana cost & color identity",
    fields: ["cost", "color_identity"],
    isVisible: always,
  },
  {
    key: "art",
    label: "Art",
    description: "Upload & position art",
    fields: ["artist_credit", "art_url", "art_position"],
    isVisible: always,
  },
  {
    key: "text",
    label: "Text",
    description: "Rules & flavor",
    fields: ["rules_text", "flavor_text"],
    isVisible: always,
  },
  {
    // Stats only exist for types that display them (P/T for creatures/tokens,
    // loyalty for planeswalkers, defense for battles); spells/etc. hide the
    // whole panel.
    key: "abilities",
    label: "Abilities",
    description: "Stats & combat numbers",
    fields: ["power", "toughness", "loyalty", "defense"],
    isVisible: (ctx) => {
      const v = statVisibility(ctx.cardType);
      return v.pt || v.loyalty || v.defense;
    },
  },
  {
    // Adventure spell (Adventure frame) or the back face (any DFC). Present when
    // the frame's second face is intrinsic (Adventure) or the user enabled a
    // back face. Label flips via stepLabel().
    key: "layout",
    label: "Back face",
    description: "The second face",
    fields: ["has_back_face", "back_face"],
    isVisible: (ctx) => hasInlineBackFace(ctx.template) || ctx.hasBackFace,
  },
  {
    // Edits frame_style.finish — error routing for frame_style stays owned by
    // the "frame" panel (the primary owner), so this panel lists no fields.
    key: "effects",
    label: "Effects",
    description: "Finish & treatments",
    fields: [],
    isVisible: always,
  },
  {
    key: "publish",
    label: "Publish",
    description: "Visibility, set & save",
    fields: ["visibility", "slug", "source_scryfall_id", "tags_text"],
    isVisible: always,
  },
];

// ---------------------------------------------------------------------------
// Public API.
// ---------------------------------------------------------------------------

/** The ordered list of panels visible for the given context. */
/** The fixed panel order — visibility filters this list, never reorders it.
 *  Useful for resolving a panel key from a URL before context is known. */
export const STEP_ORDER: StepKey[] = STEP_DEFS.map((s) => s.key);

export function visibleSteps(ctx: StepContext): StepDef[] {
  return STEP_DEFS.filter((step) => step.isVisible(ctx));
}

/** The display label for a panel — dynamic for the "layout" panel (Adventure
 *  vs Back face). */
export function stepLabel(step: StepDef, ctx: StepContext): string {
  if (step.key === "layout") {
    if (isAdventureFrame(ctx.template)) return "Adventure";
    const t = normalizeFrameTemplate(ctx.template);
    if (t === "flip") return "Flip side";
    if (t === "split") return "Other half";
    if (t === "aftermath") return "Aftermath";
    return "Back face";
  }
  return step.label;
}

/** Map every owned field to its panel key, derived from the defs. Used to
 *  route a server validation error to the right panel. Note frame_style maps
 *  to "frame" even though the finish lives on the effects panel (frame is the
 *  primary owner). */
export function buildFieldToStep(
  steps: StepDef[] = STEP_DEFS,
): Map<keyof FormValues, StepKey> {
  const map = new Map<keyof FormValues, StepKey>();
  for (const step of steps) {
    for (const field of step.fields) {
      if (!map.has(field)) map.set(field, step.key);
    }
  }
  return map;
}

/** Route a (possibly nested, e.g. "back_face.title") field name to a visible
 *  panel index, falling back to the last (publish) panel. */
export function stepIndexForField(
  fieldName: string,
  steps: StepDef[],
): number {
  const root = fieldName.split(".")[0] as keyof FormValues;
  const fieldToStep = buildFieldToStep(steps);
  const key = fieldToStep.get(root);
  const idx = key ? steps.findIndex((s) => s.key === key) : -1;
  return idx >= 0 ? idx : steps.length - 1;
}
