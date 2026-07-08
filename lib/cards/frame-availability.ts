import type { FrameTemplate } from "@/types/card";
import { frameComboKey } from "@/lib/cards/frame-reference-registry";

// ---------------------------------------------------------------------------
// Frame availability — which (template, color) combinations the frame picker
// offers to users.
//
// A combination is available when EITHER:
//   * its template was already user-reachable before the verification
//     system existed (grandfathered below — pulling live frames from
//     production wasn't an option; cards already use them), OR
//   * an admin has verified it in /admin/frame-compare (frame_reviews row
//     with verified = true). Checking the box publishes the combination;
//     unchecking withdraws it from the picker (existing cards keep
//     rendering — gating only affects NEW frame selection).
//
// The previously hard-coded "coming soon" gate on the M15 special layouts
// (saga / adventure / split / flip / aftermath / snow / devoid) is now
// driven by this: verify a combo in the tool and it goes live.
//
// Pure + client-safe: the picker runs it client-side against the verified
// keys the page fetched server-side.
// ---------------------------------------------------------------------------

// Verification is the ONLY gate (owner decision, 2026-07-04): a combo is
// pickable exactly when its frame_reviews checkbox is checked in
// /admin/frame-compare. The old grandfathered list (era standards open by
// default) is gone — new frames stay "Soon" until the owner marks them
// ready. Existing cards keep rendering whatever they saved; gating only
// affects NEW frame selection.
export const GRANDFATHERED_TEMPLATES: ReadonlySet<FrameTemplate> = new Set();

export function isFrameComboAvailable(
  template: FrameTemplate,
  colorKey: string,
  verifiedKeys: ReadonlySet<string>,
): boolean {
  return verifiedKeys.has(frameComboKey(template, colorKey));
}
