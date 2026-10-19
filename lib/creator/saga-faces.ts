// ---------------------------------------------------------------------------
// A saga's colour on its two faces (TODO 5.5 (b); owner Round 73).
//
// A double-faced saga's back takes the front's colour unless it names its
// own, and a colourless back needs an Artifact word (design D2: the back
// body's `c` is the artifact master standing in) — no colourless
// transforming saga was printed. So a colourless saga that goes two-faced
// moves to the first colour BOTH faces are published in, and says so; where
// no colour has both, it stays colourless and says that it can't be saved
// with two faces until one does — the Transform kind's rule
// (leaveColourlessDfcFront), in a saga's words.
//
// Pure: no React, no form state.
// ---------------------------------------------------------------------------

import { colorWord } from "@/components/cards/frame-layer";
import { bodyFor, type DfcIconFamily } from "@/lib/cards/dfc";
import { isFrameComboAvailable } from "@/lib/cards/frame-availability";
import type { FrameColorKey } from "@/lib/creator/card-kinds";

/** The toast when no colour has both faces published (the save is then
 *  refused with SAGA_TWO_FACES_COLOURLESS while the saga stays colourless). */
export const SAGA_TWO_FACES_NEEDS_COLOUR =
  "A double-faced saga needs a colour, and no colour has both of its faces' frames published yet — it can't be saved with two faces until one does.";

/** The form's refusal of a colourless two-faced saga (its back takes the
 *  front's colour), where the back face's colour is refused. */
export const SAGA_TWO_FACES_COLOURLESS = "A double-faced saga needs a colour — pick one on the Card step to save it with two faces.";

/** The line when a colourless saga is moved to a colour. */
export function sagaTwoFacesColourMoved(key: FrameColorKey): string {
  return `A double-faced saga needs a colour — switched the colour to ${colorWord(key)}.`;
}

/** The first colour both faces of a two-faced saga are published in — the
 *  front (`sagadfcfront`) and the creature back the family derives — or
 *  null when none is. */
export function sagaTwoFacesColour(verifiedKeys: ReadonlySet<string>, family: DfcIconFamily): FrameColorKey | null {
  const back = bodyFor("transform", "back", "creature", family);
  if (!back) return null;
  return (
    (["w", "u", "b", "r", "g", "m"] as const).find(
      (k) => isFrameComboAvailable("sagadfcfront", k, verifiedKeys) && isFrameComboAvailable(back, k, verifiedKeys),
    ) ?? null
  );
}

/** What a colourless saga becomes on going two-faced: the colour it moves
 *  to (or null: it stays colourless) and the line that says so. */
export function sagaTwoFacesColourMove(
  verifiedKeys: ReadonlySet<string>,
  family: DfcIconFamily,
): { key: FrameColorKey | null; message: string } {
  const key = sagaTwoFacesColour(verifiedKeys, family);
  return key ? { key, message: sagaTwoFacesColourMoved(key) } : { key: null, message: SAGA_TWO_FACES_NEEDS_COLOUR };
}
