// ---------------------------------------------------------------------------
// What the AI dialog offers as a card KIND and a FRAME (the AI dialog
// redesign, PR 1). Pure — no React, no Supabase: the dialog, the jobs route
// and the unit tests share it.
//
// Kinds: the creator's kind list (lib/creator/card-kinds.ts), but only the
// kinds the design engine can write: the one-faced kinds (PR 1) and, since
// PR 2, the saga and the one-picture two-part layouts (adventure, Prepare,
// split, aftermath, flip — lib/ai/layout-design.ts) and, since PR 3, the
// double-faced kinds (transform, modal, the double-faced saga, the
// double-sided token — lib/ai/dfc-design.ts). A battle has no published
// frame, no walker face has a double-faced body (owner Q2: ask first), and
// the emblem is pin-only (owner decision). A kind with no frame published in any colour is still
// listed, as an off chip with its reason.
//
// Frames: every frame the creator's gallery offers for the kind
// (framesForKind — eras, skins, borrowed frames, dresses, treatments and
// showcases) that is published in at least one colour. When the card's
// colour is PINNED (the Colors field not being written), a frame that isn't
// published in that colour is an off chip with its reason; when the colour
// is FREE, every one is offered and the colour is then constrained to the
// ones the frame has (`frameColorWords`).
// ---------------------------------------------------------------------------

import { colorWord, pickFrameColorKey } from "@/components/cards/frame-layer";
import {
  FRAME_COLOR_KEYS,
  framesForKind,
  kindHasAvailableFrame,
  type FrameColorKey,
} from "@/lib/creator/card-kinds";
import { AI_LAYOUT_KINDS, LAYOUT_TEMPLATE, isAiLayoutKind, type AiLayoutKind } from "@/lib/ai/layout-design";
import { AI_DFC_KINDS, dfcFrontChoices, dfcKindOffReason, isAiDfcKind, type AiDfcKind } from "@/lib/ai/dfc-design";
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

/** Every kind the dialog's Card kind row offers, in the creator's order:
 *  the one-faced kinds, then the saga and the two-part layouts (PR 2). */
export type AiDialogKind = AiDesignKind | AiLayoutKind | AiDfcKind;
export const AI_DIALOG_KINDS: readonly AiDialogKind[] = [...AI_DESIGN_KINDS, ...AI_LAYOUT_KINDS, ...AI_DFC_KINDS];

/** Why a kind chip is off, or null when the kind can be generated. A layout
 *  kind is judged on its ONE frame (never the double-faced saga front). */
export function aiKindOffReason(kind: AiDialogKind, verifiedKeys: ReadonlySet<string>): string | null {
  // A double-faced kind: its front AND its default back published (PR 3).
  if (isAiDfcKind(kind)) return dfcKindOffReason(kind, verifiedKeys);
  const published = isAiLayoutKind(kind)
    ? aiFrameOptions(kind, verifiedKeys, null).length > 0
    : kindHasAvailableFrame(kind, verifiedKeys);
  return published ? null : "No frame published yet";
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
  kind: AiDialogKind,
  verifiedKeys: ReadonlySet<string>,
  colorKey: FrameColorKey | null,
): AiFrameOption[] {
  // A double-faced kind lists its FRONT frames (PR 3); the back's body is
  // derived from the back the AI designs.
  const choices = isAiDfcKind(kind) ? dfcFrontChoices(kind, verifiedKeys) : framesForKind(kind, verifiedKeys);
  return choices
    // A layout kind is made on its one frame (the double-faced saga front
    // is PR 3's).
    .filter((choice) => !isAiLayoutKind(kind) || choice.template === LAYOUT_TEMPLATE[kind])
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

/** The colour key the dialog holds a KEPT colour to: the card's frame
 *  colour key — "c" for a card with no colour, as the server reads it (a
 *  colourless fill is pinned to the colourless frames), never "free". */
export function aiDialogColorKey(colorIdentity: Parameters<typeof pickFrameColorKey>[0] | null | undefined): FrameColorKey {
  return pickFrameColorKey(colorIdentity ?? []) as FrameColorKey;
}

/** "white, blue or red" (or "any color") — the colours a frame is published in, for the
 *  dialog's note when the colour is free. */
export function frameColorWords(colorKeys: readonly string[]): string {
  if (FRAME_COLOR_KEYS.every((key) => colorKeys.includes(key))) return "any color";
  const words = colorKeys.map(colorWord);
  if (words.length <= 1) return words.join("");
  return `${words.slice(0, -1).join(", ")} or ${words[words.length - 1]}`;
}
