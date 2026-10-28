// ---------------------------------------------------------------------------
// What the AI dialog offers as a card KIND and a FRAME (the AI dialog
// redesign, PR 1). Pure — no React, no Supabase: the dialog, the jobs route
// and the unit tests share it.
//
// Kinds: the creator's kind list (lib/creator/card-kinds.ts), but only the
// ONE-FACED kinds the design engine can write today. Sagas and the two-part
// layouts (split, aftermath, adventure, flip, Prepare) are PR 2, the
// double-faced kinds PR 3; a battle has no published frame and the emblem is
// pin-only (owner decision). A kind with no frame published in any colour is
// still listed, as an off chip with its reason.
//
// Frames: every frame the creator's gallery offers for the kind
// (framesForKind — eras, skins, borrowed frames, dresses, treatments and
// showcases) that is published in at least one colour. When the card's
// colour is PINNED (the Colors field not being written), a frame that isn't
// published in that colour is an off chip with its reason; when the colour
// is FREE, every one is offered and the colour is then constrained to the
// ones the frame has (`frameColorWords`).
// ---------------------------------------------------------------------------

import { colorWord } from "@/components/cards/frame-layer";
import {
  FRAME_COLOR_KEYS,
  framesForKind,
  kindHasAvailableFrame,
  type FrameColorKey,
} from "@/lib/creator/card-kinds";
import {
  FRAME_ERA_LABELS,
  FRAME_TEMPLATE_LABELS,
  type CardType,
  type FrameEra,
  type FrameTemplate,
} from "@/types/card";

/** The kinds PR 1 can generate, in the creator's chip order. Each is a
 *  standard kind: its card type is the kind itself. */
export const AI_DESIGN_KINDS = [
  "creature",
  "instant",
  "sorcery",
  "artifact",
  "enchantment",
  "land",
  "planeswalker",
  "token",
] as const satisfies readonly CardType[];

export type AiDesignKind = (typeof AI_DESIGN_KINDS)[number];

export function isAiDesignKind(value: unknown): value is AiDesignKind {
  return typeof value === "string" && (AI_DESIGN_KINDS as readonly string[]).includes(value);
}

/** Why a kind chip is off, or null when the kind can be generated. */
export function aiKindOffReason(kind: AiDesignKind, verifiedKeys: ReadonlySet<string>): string | null {
  return kindHasAvailableFrame(kind, verifiedKeys) ? null : "No frame published yet";
}

export type AiFrameOption = {
  template: FrameTemplate;
  era: FrameEra;
  label: string;
  eraLabel: string;
  /** The colour keys this frame is published in. */
  colorKeys: FrameColorKey[];
  /** Null when it can be picked; else why not (an off chip's words). */
  offReason: string | null;
};

/**
 * The frames the dialog lists for `kind`. `colorKey` is the card's PINNED
 * colour key, or null when the colour is free (being written, or empty).
 * Order: the gallery's (border eras oldest → newest with their skins, then
 * the showcases).
 */
export function aiFrameOptions(
  kind: AiDesignKind,
  verifiedKeys: ReadonlySet<string>,
  colorKey: FrameColorKey | null,
): AiFrameOption[] {
  return framesForKind(kind, verifiedKeys)
    .filter((choice) => choice.availableColorKeys.length > 0)
    .map((choice) => ({
      template: choice.template,
      era: choice.era,
      label: FRAME_TEMPLATE_LABELS[choice.template],
      eraLabel: FRAME_ERA_LABELS[choice.era],
      colorKeys: choice.availableColorKeys,
      offReason:
        colorKey && !choice.availableColorKeys.includes(colorKey)
          ? `Not published in ${colorWord(colorKey)} yet`
          : null,
    }));
}

/** "white, blue or red" (or "any color") — the colours a frame is published in, for the
 *  dialog's note when the colour is free. */
export function frameColorWords(colorKeys: readonly string[]): string {
  if (FRAME_COLOR_KEYS.every((key) => colorKeys.includes(key))) return "any color";
  const words = colorKeys.map(colorWord);
  if (words.length <= 1) return words.join("");
  return `${words.slice(0, -1).join(", ")} or ${words[words.length - 1]}`;
}
