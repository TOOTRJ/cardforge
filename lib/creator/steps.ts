// Pure, React-free step model for the card-creator stepper. Kept side-effect
// free so it's unit-testable under the node test env and so both the client
// form and the tests derive the SAME step list from the same rules.
//
// The stepper is FRAME-AWARE: which steps appear (and a couple of step labels)
// depend on the chosen frame template + card type + whether a back face exists.
// Field→step routing is derived from the step defs (no hand-kept map to drift).

import type { CardType, FrameTemplate } from "@/types/card";
import type { FormValues } from "@/lib/creator/form-types";
import {
  normalizeFrameTemplate,
  showsDefense,
  showsLoyalty,
  showsPowerToughness,
} from "@/lib/cards/card-display";
import { getFrameProfile } from "@/lib/cards/template-layout";

export type StepKey = "frame" | "details" | "art" | "rules" | "extra" | "publish";

export type StepContext = {
  template: FrameTemplate | string | undefined;
  cardType: CardType | "" | null | undefined;
  hasBackFace: boolean;
};

export type StepDef = {
  key: StepKey;
  /** Fallback label. The "extra" step's label is dynamic — use stepLabel(). */
  label: string;
  /** Short helper shown under the step label on mobile. */
  description: string;
  /** Form fields this step owns — drives per-step validation + error routing. */
  fields: (keyof FormValues)[];
  /** Whether this step appears for the given context. */
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
 *  Such frames always show the back-face/extra step — the second face isn't
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
// Step definitions (declaration order = display order).
// ---------------------------------------------------------------------------

const STEP_DEFS: StepDef[] = [
  {
    key: "frame",
    label: "Frame",
    description: "Pick a card frame",
    fields: ["frame_style"],
    isVisible: always,
  },
  {
    key: "details",
    label: "Details",
    description: "Name, type & color",
    fields: [
      "title",
      "cost",
      "card_type",
      "supertype",
      "subtypes_text",
      "rarity",
      "color_identity",
      "game_system_id",
      "template_id",
    ],
    isVisible: always,
  },
  {
    key: "art",
    label: "Art",
    description: "Upload & frame the art",
    fields: ["artist_credit", "art_url", "art_position"],
    isVisible: always,
  },
  {
    key: "rules",
    label: "Rules",
    description: "Abilities, flavor & stats",
    fields: [
      "rules_text",
      "flavor_text",
      "power",
      "toughness",
      "loyalty",
      "defense",
    ],
    isVisible: always,
  },
  {
    // Adventure spell (Adventure frame) or the back face (any DFC). Present when
    // the frame's second face is intrinsic (Adventure) or the user enabled a
    // back face. Label flips via stepLabel().
    key: "extra",
    label: "Back face",
    description: "The second face",
    fields: ["has_back_face", "back_face"],
    isVisible: (ctx) => hasInlineBackFace(ctx.template) || ctx.hasBackFace,
  },
  {
    key: "publish",
    label: "Publish",
    description: "Visibility, finish & save",
    fields: ["visibility", "slug", "source_scryfall_id"],
    isVisible: always,
  },
];

// ---------------------------------------------------------------------------
// Public API.
// ---------------------------------------------------------------------------

/** The ordered list of steps visible for the given context. */
export function visibleSteps(ctx: StepContext): StepDef[] {
  return STEP_DEFS.filter((step) => step.isVisible(ctx));
}

/** The display label for a step — dynamic for the "extra" step (Adventure vs
 *  Back face). */
export function stepLabel(step: StepDef, ctx: StepContext): string {
  if (step.key === "extra") {
    if (isAdventureFrame(ctx.template)) return "Adventure";
    if (normalizeFrameTemplate(ctx.template) === "flip") return "Flip side";
    return "Back face";
  }
  return step.label;
}

/** Map every owned field to its step key, derived from the defs. Used to route a
 *  server validation error to the right step. Note frame_style maps to "frame"
 *  even though the finish lives on the publish step (frame is the primary owner).
 */
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
 *  step index, falling back to the last (publish) step. */
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
