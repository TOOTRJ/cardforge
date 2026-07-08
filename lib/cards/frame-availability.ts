import type { FrameTemplate } from "@/types/card";
import { frameComboKey } from "@/lib/cards/frame-reference-registry";

// ---------------------------------------------------------------------------
// Frame availability — which (template, color) combinations the creator
// offers to users.
//
// Verification is the ONLY gate (owner decision, 2026-07-04): a combination
// is pickable exactly when its frame_reviews checkbox is checked in
// /admin/frame-compare. Checking the box publishes the combination;
// unchecking withdraws it from the picker. Existing cards keep rendering
// whatever they saved — gating only affects NEW frame selection.
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
