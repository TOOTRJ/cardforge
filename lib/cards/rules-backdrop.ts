// ---------------------------------------------------------------------------
// WHEN the rules box's translucent backdrop (TextSlot.backdropHex) is drawn —
// the ONE rule both renderers ask: the live preview
// (components/cards/card-preview.tsx) and the bake (lib/render/card-image.tsx).
//
// A frame whose text region is a see-through cut-out over the art (the
// planeswalker windows) fills it behind the text. Never where something else
// fills the region — ability rows (or the editor's hint rows) paint their own
// stripes, a saga rail its own chapters — and never on a textless frame. A
// box with no text draws it only when its slot says `backdropWhenEmpty`
// (TODO 4.33, owner round 15, 2026-09-29: a borderless walker with no ability
// text shows the first stripe's light ground, never the bare art).
// ---------------------------------------------------------------------------
import type { TextSlot } from "./template-layout";

export type RulesBackdropState = {
  /** The box has text to draw (rules or flavor; not a basic land's). */
  hasRulesContent: boolean;
  /** The frame prints no text at all (FrameProfile.textless). */
  textless: boolean;
  /** A saga chapter rail replaces the box. */
  chapters: boolean;
  /** Ability rows are drawn in the box: the card's own, or the editor's
   *  hint rows for an empty walker. */
  rowsDrawn: boolean;
};

export function drawsRulesBackdrop(slot: Pick<TextSlot, "backdropHex" | "backdropWhenEmpty">, state: RulesBackdropState): boolean {
  if (!slot.backdropHex || state.textless || state.chapters || state.rowsDrawn) return false;
  return state.hasRulesContent || slot.backdropWhenEmpty === true;
}
