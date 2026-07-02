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

// Templates users could already pick when the verification system shipped
// (2026-07): the era standards + type-derived frames. The M15 special
// layouts and the showcase treatments were "coming soon" — those now gate
// on verification instead.
export const GRANDFATHERED_TEMPLATES: ReadonlySet<FrameTemplate> = new Set([
  "m15",
  "m15land",
  "m15token",
  "m15pw",
  "battle",
  "agclassic",
  "alphaland",
  "alphatoken",
  "retro",
  "retroland",
  "modern",
  "modernland",
]);

export function isFrameComboAvailable(
  template: FrameTemplate,
  colorKey: string,
  verifiedKeys: ReadonlySet<string>,
): boolean {
  if (GRANDFATHERED_TEMPLATES.has(template)) return true;
  return verifiedKeys.has(frameComboKey(template, colorKey));
}
