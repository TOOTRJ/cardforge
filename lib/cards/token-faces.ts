// ---------------------------------------------------------------------------
// Double-sided tokens (TODO 5.5 (c), owner Round 76) — the pure vocabulary.
//
// A double-sided token is TWO TOKENS BACK TO BACK (Guild Kit #4 Goblin //
// Soldier, F17 #11 Dinosaur // Treasure, Q07 #T12 Goblin // Blood): each face
// an ordinary token of its era, in its own colour, at its own height, the
// Artifact dress where its own words say Artifact — no transform icon, no
// cross-face block. So the back is not a double-faced BACK body (the
// `FrameProfile.dfc` bodies of lib/cards/dfc.ts, which are never a card's
// own template): it is another TOKEN template — the very templates a
// one-faced token wears — in the FRONT'S DESIGN: the 2014–19 arch with the
// arch, the full-art (M20+) token with the full-art token. Which one is
// derived from the back's own words and text exactly as a token's frame is
// (lib/creator/token-back.ts `tokenBackBodyFor`); the server's ONE gate
// (lib/cards/dfc-gate.ts `resolveDfcBackFace`) stores it.
//
// The transforming Incubator // Phyrexian (TMOM #16–18, TEOC #15, TFRC #13:
// the ▲ well, the ▼ and the back's 0/0 on the front) lands on the plain pair
// meanwhile, `nearest` (the registry's `dfc-token-transform` gap; its own
// body is TODO 5.5 (d)).
//
// Pure and client-safe (both renderers read it through lib/cards/faces.ts):
// no profile, no creator import.
// ---------------------------------------------------------------------------

import { isM20TokenTemplate } from "@/lib/cards/token-height";
import type { FrameTemplate } from "@/types/card";

/** A token template's DESIGN: the 2014–19 arch (`m15token…`, every dress and
 *  height) or the full-art token (`m20token…`, Nyx included). */
export type TokenDesign = "arch" | "fullart";

/** The design `template` belongs to, or null for any other template. */
export function tokenDesignOf(template: FrameTemplate | string | null | undefined): TokenDesign | null {
  if (!template) return null;
  if (isM20TokenTemplate(template)) return "fullart";
  // Every arch template is named `m15token…` — the textless and text-box
  // heights, their Artifact dress (and the tall box of TODO 4.55).
  return template.startsWith("m15token") ? "arch" : null;
}

/** The plain, textless template of a design — what the back's own words and
 *  text dress (tokenFrameFor) to the back's body. */
export const TOKEN_DESIGN_BASE: Readonly<Record<TokenDesign, FrameTemplate>> = {
  arch: "m15token",
  fullart: "m20token",
};

/** A card on this template may carry a token BACK of its own: a token
 *  template (either design). */
export function isTokenPairFront(template: FrameTemplate | string | null | undefined): boolean {
  return tokenDesignOf(template) !== null;
}

/** `back` is a token back body for a card on `front`: both token templates
 *  of the SAME design (an arch back under a full-art front is not one). */
export function isTokenPairBack(
  front: FrameTemplate | string | null | undefined,
  back: FrameTemplate | string | null | undefined,
): boolean {
  const design = tokenDesignOf(front);
  return design !== null && tokenDesignOf(back) === design;
}
