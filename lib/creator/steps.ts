// Pure, React-free panel model for the card-creator editor. Kept side-effect
// free so it's unit-testable under the node test env and so both the client
// form and the tests derive the SAME panel list from the same rules.
//
// The editor is FRAME-AWARE: what each panel renders depends on the chosen
// frame template + card type + whether a back face exists. Field→panel
// routing is derived from the panel defs (no hand-kept map to drift).

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

export type StepKey = "card" | "identity" | "text" | "publish";

/** Old step keys (pre-compaction) → their new home, so bookmarked/redirect
 *  `?step=` URLs keep resolving. */
export const LEGACY_STEP_ALIASES: Record<string, StepKey> = {
  kind: "card",
  frame: "card",
  pips: "identity",
  art: "identity",
};

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
  /** Display label (see stepLabel()). */
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
 *  display. Subtypes matter too: Vehicles/Spacecraft print P/T without being
 *  creatures. */
export function statVisibility(
  cardType: CardType | "" | null | undefined,
  subtypes?: readonly string[] | null,
): {
  pt: boolean;
  loyalty: boolean;
  defense: boolean;
} {
  const ct = (cardType || null) as CardType | null;
  return {
    pt: showsPowerToughness(ct, subtypes),
    loyalty: showsLoyalty(ct),
    defense: showsDefense(ct),
  };
}

// ---------------------------------------------------------------------------
// Panel definitions (declaration order = display order).
// ---------------------------------------------------------------------------

const STEP_DEFS: StepDef[] = [
  {
    // Everything that decides what the card IS: the type (incl. the
    // structural layouts — users just pick "Saga", they don't need to know
    // it's structurally different), the frame across every era + showcase,
    // and the frame's color. Each lives in its own collapsible so the step
    // stays compact; sensible defaults (Creature / M15 standard / colorless)
    // mean a user can skip straight past it.
    key: "card",
    label: "Card",
    description: "Type, frame & color",
    fields: ["card_type", "frame_style", "color_identity"],
    isVisible: always,
  },
  {
    // The card's substance in one pass: name + rarity, the mana cost (the
    // pips panel hides itself for cost-less frames), and the artwork with
    // the back-face editor under its "More options".
    key: "identity",
    label: "Identity",
    description: "Name, cost & art",
    fields: [
      "title",
      "supertype",
      "subtypes_text",
      "rarity",
      "game_system_id",
      "template_id",
      "cost",
      "artist_credit",
      "art_url",
      "art_position",
      "has_back_face",
      "back_face",
    ],
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
      "loyalty_abilities",
      "saga_intro",
      "saga_chapters",
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
    // Card panel, frame_style's primary owner, so it isn't listed here) plus
    // visibility, set, tags, save.
    key: "publish",
    label: "Publish",
    description: "Finish, visibility & save",
    fields: ["visibility", "slug", "source_scryfall_id", "tags_text", "watermark"],
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
 *  to "card" even though the finish now lives on the Publish step (the Card
 *  panel is the primary owner). */
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
  /** Which rules editor the Text step renders for the front face.
   *  "loyalty" = the planeswalker ability-row editor; "saga" = the chapter
   *  editor; the rest use the standard rules textarea. */
  textVariant: "standard" | "loyalty" | "saga" | "adventure" | "split" | "flip";
  /** The frame paints an intrinsic second face — has_back_face is forced on
   *  and the layout editor presents "clear", never "remove". */
  forcedBackFace: boolean;
};

export function panelConfigFor(ctx: StepContext): KindPanelConfig {
  const kind = ctx.kind;
  const textVariant =
    kind === "saga" || kind === "adventure" || kind === "flip"
      ? kind
      : kind === "planeswalker"
        ? ("loyalty" as const)
        : kind === "split" || kind === "aftermath"
          ? ("split" as const)
          : ("standard" as const);
  return {
    artSlots:
      kind === "split" || kind === "aftermath" ? ["front", "second"] : ["front"],
    textVariant,
    forcedBackFace: KIND_DEFS[kind].inlineSecondFace,
  };
}
