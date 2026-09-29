// ---------------------------------------------------------------------------
// The full-art token's printed height (TODO 4.48, owner decision
// 2026-09-29): ONE design printed at three heights — no box, the regular box,
// the tall box — and the text picks it: the smallest height whose text fits
// at the rules standard size (layout v33's real-wrap fit, 3.29):
//
//   no rules and no flavour         → textless (TFDN #6 Soldier)
//   fits the regular box at 76 px   → regular  (TFDN #27 Cat, TFDN #23 Treasure)
//   otherwise                       → tall     (TLCI #17 Map, TBLB #5)
//
// Scryfall has no field for the height, so the import resolves a printing
// by the same rule (lib/scryfall/frame-signatures.ts, family "m20"), and the
// creator follows it while the user hasn't picked a height
// (lib/creator/token-frame-auto.ts). The artifact templates (TODO 4.50) are
// the same heights, picked by the Artifact type word.
//
// Pure and client-safe: it runs the same rules layout the renderers draw.
// ---------------------------------------------------------------------------

import { mainRulesLayout } from "@/lib/cards/rules-box";
import { rulesLadderPx } from "@/lib/cards/rules-layout";
import { getFrameProfile, type M20TokenHeight } from "@/lib/cards/template-layout";
import type { FrameTemplate } from "@/types/card";

export type { M20TokenHeight };

/** The printed heights, smallest first. */
export const M20_TOKEN_HEIGHTS: readonly M20TokenHeight[] = ["textless", "regular", "tall"];

/** The full-art token templates by height: the plain one and its artifact
 *  dress (4.50). */
export const M20_TOKEN_TEMPLATES: Readonly<Record<M20TokenHeight, { plain: FrameTemplate; artifact: FrameTemplate }>> = {
  textless: { plain: "m20token", artifact: "m20tokenartifact" },
  regular: { plain: "m20tokentext", artifact: "m20tokenartifacttext" },
  tall: { plain: "m20tokentall", artifact: "m20tokenartifacttall" },
};

/** The template for a height, plain or artifact. */
export function m20TokenTemplate(height: M20TokenHeight, artifact: boolean): FrameTemplate {
  const pair = M20_TOKEN_TEMPLATES[height];
  return artifact ? pair.artifact : pair.plain;
}

/** A full-art token template's height, or null for any other template. */
export function m20TokenHeightOf(template: FrameTemplate | string | null | undefined): M20TokenHeight | null {
  for (const height of M20_TOKEN_HEIGHTS) {
    const pair = M20_TOKEN_TEMPLATES[height];
    if (template === pair.plain || template === pair.artifact) return height;
  }
  return null;
}

/** True for the six full-art token templates. */
export function isM20TokenTemplate(template: FrameTemplate | string | null | undefined): boolean {
  return m20TokenHeightOf(template) !== null;
}

/** True for the three artifact templates. */
export function isM20ArtifactTokenTemplate(template: FrameTemplate | string | null | undefined): boolean {
  return M20_TOKEN_HEIGHTS.some((height) => M20_TOKEN_TEMPLATES[height].artifact === template);
}

export type TokenHeightText = {
  rulesText: string | null | undefined;
  flavorText?: string | null | undefined;
  /** The card draws its P/T plate (printsPowerToughness): the rules keep out
   *  of the plate's ink, as the renderers lay them out. */
  printsPowerToughness: boolean;
  /** The artifact templates' plates are M15's artifact set; their ink is
   *  the keep-out. */
  artifact?: boolean;
};

/** True when the text fits `height`'s box at the rules standard size — the
 *  first step of the ladder, at both bake targets, clear of the plate. */
export function tokenTextFitsAtStandardSize(height: Exclude<M20TokenHeight, "textless">, text: TokenHeightText): boolean {
  const profile = getFrameProfile(m20TokenTemplate(height, text.artifact === true));
  const layout = mainRulesLayout({
    layout: profile,
    rulesText: text.rulesText,
    flavorText: text.flavorText,
    aspect: 7 / 5,
    show: { pt: text.printsPowerToughness },
  });
  return !layout.clipped && layout.sizePx === rulesLadderPx(profile.rules.sizePct)[0];
}

/** The height the text asks for (TODO 4.48's rule, above). */
export function tokenHeightForText(text: TokenHeightText): M20TokenHeight {
  if (!text.rulesText?.trim() && !text.flavorText?.trim()) return "textless";
  return tokenTextFitsAtStandardSize("regular", text) ? "regular" : "tall";
}
