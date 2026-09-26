import type { ColorIdentity, FrameTemplate } from "@/types/card";
import { frameComboKey } from "@/lib/cards/frame-reference-registry";
import { colorWord, pickFrameColorKey } from "@/components/cards/frame-layer";
import { normalizeFrameTemplate } from "@/lib/cards/card-display";

// ---------------------------------------------------------------------------
// Frame availability — which (template, color) combinations the creator
// offers to users.
//
// Verification is the ONLY gate (owner decision, 2026-07-04): a combination
// is pickable exactly when its frame_reviews checkbox is checked in
// /admin/frame-compare. Checking the box publishes the combination;
// unchecking withdraws it. Existing cards keep rendering whatever they saved
// — gating only affects NEW frame selection.
//
// The gate is enforced twice: in the picker (chips) and on the server
// (frameGateError, called by the create/update actions), so a crafted
// payload or a stale client can't save a combination the admin hasn't
// published.
//
// The gate is per COLOUR (pickFrameColorKey), never per master: a colour a
// profile dresses by type (FrameProfile.artifactMasterKeys — Alpha's
// colourless artifact paints the brown artifact card "a") is published with
// its colour, so verifying agclassic/c publishes both of its masters.
//
// Pure + client-safe: the picker runs it client-side against the verified
// keys the page fetched server-side.
// ---------------------------------------------------------------------------

export function isFrameComboAvailable(
  template: FrameTemplate,
  colorKey: string,
  verifiedKeys: ReadonlySet<string>,
): boolean {
  return verifiedKeys.has(frameComboKey(template, colorKey));
}

/** The server-side form of the gate: null when the card's frame/colour pair
 *  is published, else the field error to return for `frame_style`. Unknown
 *  or legacy template values resolve to the default frame, exactly as the
 *  renderers treat them. */
export function frameGateError(
  template: FrameTemplate | string | null | undefined,
  colorIdentity: readonly ColorIdentity[] | null | undefined,
  verifiedKeys: ReadonlySet<string>,
): string | null {
  const resolved = normalizeFrameTemplate(template);
  const colorKey = pickFrameColorKey(colorIdentity ? [...colorIdentity] : undefined);
  if (isFrameComboAvailable(resolved, colorKey, verifiedKeys)) return null;
  return `That frame isn't available in ${colorWord(colorKey)} yet — pick another frame or colour.`;
}
