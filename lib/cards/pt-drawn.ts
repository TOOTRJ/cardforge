// ---------------------------------------------------------------------------
// pt-drawn — does this face's FRAME draw a power / toughness?
//
// A face prints its P/T when two things hold: its type shows one and it has
// a value (lib/cards/card-display.ts printsPowerToughness), and the frame it
// is drawn on has the slot — both renderers gate the plate on
// `Boolean(layout.pt) && printsPowerToughness(face)` (front, and a back
// drawn as a face of its own) or on `secondFace.pt` (a half painted on the
// front's master: flip, split, aftermath). This module answers the SECOND
// half from the same profile data, so nothing keeps a list of templates:
//
//   • the creator's note under the P/T inputs (a saga whose type says
//     Creature keeps its 9/9 in the row, and the picture shows none);
//   • the public card page's "Card details", which lists only what the
//     render shows (CLAUDE.md, the SEO contract).
//
// It reads the CODE profile. A stored override moves a slot's rect and can
// never REMOVE a slot; the layout editor offers only the slots a profile
// already has (lib/cards/profile-override.ts listSlotPaths), so none adds
// one either. The override schema itself would take a `pt` on a template
// with none (mergeProfile would copy it in) — only a hand-made admin payload
// gets there, and this module would then disagree with the bake.
// tests/unit/render/pt-drawn-bake.test.tsx holds the answers to real bakes.
//
// Pure: no rendering, no I/O.
// ---------------------------------------------------------------------------

import { normalizeFrameTemplate } from "@/lib/cards/card-display";
import { isDfcBackBody, templateHasBackFace } from "@/lib/cards/dfc";
import { isTokenPairBack } from "@/lib/cards/token-faces";
import { resolveStationTiers } from "@/lib/cards/station";
import { getFrameProfile, type FrameProfile } from "@/lib/cards/template-layout";
import type { FaceContent } from "@/types/card";

type PtSlots = Pick<FrameProfile, "pt" | "tiers" | "secondFace" | "adventure">;

/** A face drawn as a card face of its own on this profile — a front, or a
 *  back on its own body — has a P/T slot. */
export function profileDrawsPowerToughness(profile: Pick<FrameProfile, "pt" | "tiers">): boolean {
  // …or the station frame's plate (TODO 4.27a): no corner slot, the P/T is
  // drawn on a tier (lib/cards/station-layout.ts).
  return Boolean(profile.pt || profile.tiers);
}

/** The second face a profile paints on its OWN master (a flip's lower half,
 *  a split's right half, an aftermath's turned spell, an adventure's page)
 *  has a P/T slot; null when the profile paints no second face. */
export function profileSecondFaceDrawsPowerToughness(profile: PtSlots): boolean | null {
  if (profile.secondFace) return Boolean(profile.secondFace.pt);
  // The adventure's page is a spell: it has no stat slot at all.
  if (profile.adventure) return false;
  return null;
}

/** The text a station card's tiers are read from (what both renderers read:
 *  the structured rows first, else the rules text's grammar). */
export type TierText = { rulesText?: string | null; faceContent?: FaceContent | null };

/** The front face of a card on `template` draws a P/T. On the station frame
 *  the P/T is printed on a TIER's plate, so a card with no tier (allowed:
 *  owner round 54, decision 5) draws none — pass the card's `text` and the
 *  answer says so; without it the answer is the frame's alone. */
export function frontDrawsPowerToughness(template: string | null | undefined, text?: TierText): boolean {
  const profile = getFrameProfile(normalizeFrameTemplate(template));
  if (profile.tiers && text) return resolveStationTiers(text.faceContent, text.rulesText, false).tiers.length > 0;
  return profileDrawsPowerToughness(profile);
}

/** The frame prints its P/T on a tier (the station frame). */
export function frontPrintsPowerToughnessOnTier(template: string | null | undefined): boolean {
  return Boolean(getFrameProfile(normalizeFrameTemplate(template)).tiers);
}

/**
 * The second / back face of a card on `template` draws a P/T — the three
 * ways a card's `back_face` reaches the picture (lib/cards/faces.ts):
 *
 *   • painted on the front's master (flip, split, aftermath, adventure):
 *     that profile's `secondFace.pt`;
 *   • a double-faced card's back on its own BODY (`backBody`, honoured as
 *     backBodyOf honours it: a back body under a front body): the body's
 *     slot;
 *   • a legacy back (no body): the back's content on the FRONT's frame, so
 *     the front's slot.
 */
export function secondFaceDrawsPowerToughness(
  template: string | null | undefined,
  backBody?: string | null,
): boolean {
  const front = normalizeFrameTemplate(template);
  const inline = profileSecondFaceDrawsPowerToughness(getFrameProfile(front));
  if (inline !== null) return inline;
  // (…and a double-sided token's back — TODO 5.5 (c) — its own token.)
  if (backBody && ((templateHasBackFace(front) && isDfcBackBody(backBody)) || isTokenPairBack(front, backBody))) {
    return profileDrawsPowerToughness(getFrameProfile(backBody));
  }
  return profileDrawsPowerToughness(getFrameProfile(front));
}

/** The note the creator prints under P/T inputs whose frame draws none. No
 *  "yet": most of these frames never print one (a walker, a battle, a split
 *  half); the saga body's is TODO 4.5c. */
export const PT_NOT_DRAWN_NOTE =
  "This frame doesn't draw power / toughness. The numbers are saved with the card, but the picture won't show them.";

/** …and under the P/T inputs of a station card that has no tier yet: this
 *  frame DOES print one — on a tier's plate. */
export const PT_NEEDS_TIER_NOTE =
  "This frame prints power / toughness on a tier. Add a tier and the numbers appear on it; until then they are saved with the card, but the picture won't show them.";
