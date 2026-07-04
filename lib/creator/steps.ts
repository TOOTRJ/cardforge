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
import { KIND_DEFS, type CardKind } from "@/lib/creator/card-kinds";

export type StepKey =
  | "kind"
  | "frame"
  | "identity"
  | "pips"
  | "art"
  | "text"
  | "publish";

export type StepContext = {
  template: FrameTemplate | string | undefined;
  cardType: CardType | "" | null | undefined;
  hasBackFace: boolean;
  /** Derived via kindFromCard(cardType, template) — the wizard-level "what
   *  am I making" that drives step visibility and per-kind panel config. */
  kind: CardKind;
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
    // Kind leads the flow: the broadest structural choice (creature? saga?
    // split?) comes first, and everything downstream — which frames the
    // gallery offers, which art/text inputs appear — derives from it. The
    // kind writes card_type (+ the frame template, via planKindChange), so
    // this step owns card_type for error routing.
    key: "kind",
    label: "Card kind",
    description: "What are you making?",
    fields: ["card_type"],
    isVisible: always,
  },
  {
    // Every frame across every era that fits the chosen kind, grouped by
    // era, with the frame's color picked inline underneath (color is a pure
    // PNG swap — geometry is per-template — so it's safely last).
    key: "frame",
    label: "Frame",
    description: "Every era's frame & its color",
    fields: ["frame_style", "color_identity"],
    isVisible: always,
  },
  {
    key: "identity",
    label: "Identity",
    description: "Name & rarity",
    fields: [
      "title",
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
    description: "Mana cost",
    fields: ["cost"],
    // Token/land frames paint no mana cost — skip the step entirely instead
    // of showing an empty panel.
    isVisible: (ctx) => !hidesCost(ctx.template),
  },
  {
    // Front artwork, plus (under "More options") the artist credit and the
    // whole back-face editor — the back face used to be its own step; folding
    // it in here keeps the stepper short. Its stat fields (P/T etc.) live on
    // the back-face editor itself, so the "text" step's stat fields are front-
    // only.
    key: "art",
    label: "Art",
    description: "Artwork, artist & back face",
    fields: ["artist_credit", "art_url", "art_position", "has_back_face", "back_face"],
    isVisible: always,
  },
  {
    // Rules + flavor + the front face's stats (P/T for creatures/tokens,
    // loyalty for planeswalkers, defense for battles). Stats are gated inside
    // the panel by card type; the step itself is always present.
    key: "text",
    label: "Text & stats",
    description: "Rules, flavor & combat numbers",
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
    // Finish/treatment (frame_style.finish — error routing stays with the
    // "frame" panel, so it isn't listed here) plus visibility, set, tags, save.
    key: "publish",
    label: "Publish",
    description: "Finish, visibility & save",
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

/** The display label for a panel. Static now that the back face lives inside
 *  the Art step; kept as a function so callers don't need to change. */
export function stepLabel(step: StepDef): string {
  return step.label;
}

/** Map every owned field to its panel key, derived from the defs. Used to
 *  route a server validation error to the right panel. Note frame_style maps
 *  to "frame" even though the finish now lives on the Publish step (frame is
 *  the primary owner). */
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

// ---------------------------------------------------------------------------
// Per-kind panel configuration — which inputs the Art and Text steps render.
// Pure config, consumed by the panels; the structured editors themselves land
// in later PRs, so "standard" panels ignore variants they don't know yet.
// ---------------------------------------------------------------------------

export type KindPanelConfig = {
  /** Art inputs the Art step renders. "second" = the inline second face's own
   *  art window (split/aftermath halves each show their own illustration;
   *  flip and adventure share the front art). */
  artSlots: Array<"front" | "second">;
  /** Which rules editor the Text step renders for the front face. */
  textVariant: "standard" | "saga" | "adventure" | "split" | "flip";
  /** The frame paints an intrinsic second face — has_back_face is forced on
   *  and the layout editor presents "clear", never "remove". */
  forcedBackFace: boolean;
};

export function panelConfigFor(ctx: StepContext): KindPanelConfig {
  const kind = ctx.kind;
  const textVariant =
    kind === "saga" || kind === "adventure" || kind === "flip"
      ? kind
      : kind === "split" || kind === "aftermath"
        ? "split"
        : "standard";
  return {
    artSlots:
      kind === "split" || kind === "aftermath" ? ["front", "second"] : ["front"],
    textVariant,
    forcedBackFace: KIND_DEFS[kind].inlineSecondFace,
  };
}
