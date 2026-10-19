// ---------------------------------------------------------------------------
// The full-art token's printed height (TODO 4.48, owner decisions
// 2026-09-29): ONE design printed at three heights — no box, the regular box,
// the tall box — and the text picks it: the smallest height whose text fits
// (layout v33's real-wrap fit, 3.29) — the regular box down to 72 px, as
// WotC sets it:
//
//   no rules and no flavour           → textless (TFDN #6 Soldier)
//   fits the regular box at ≥ 72 px   → regular  (TFDN #27 Cat, TFDN #23
//                                                  Treasure, TTDC #12
//                                                  Dragon Egg at 72)
//   otherwise                         → tall     (TLCI #17 Map, TBLB #5)
//
// The regular box's floor (owner decision 2026-09-29, M20_TOKEN_REGULAR_MIN_PX):
// "fits at the standard 76 px" sent 13 regular-box prints of 139–194
// characters tall; WotC sets those at 8.5 pt and below rather than grow the
// box. 72 px (8.5 pt) takes back the ones that fit there (TTDC #12, TBLB
// #16 / #18, TDRC #16, TM3C #22) and keeps every tall print tall — they fit
// the regular box at 70 px at most.
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
 *  dress (4.50), and the Nyx dress of each (4.51: the starfield in the name
 *  pill, an Enchantment token's). */
export const M20_TOKEN_TEMPLATES: Readonly<
  Record<M20TokenHeight, { plain: FrameTemplate; artifact: FrameTemplate; nyx: FrameTemplate; artifactNyx: FrameTemplate }>
> = {
  textless: { plain: "m20token", artifact: "m20tokenartifact", nyx: "m20tokennyx", artifactNyx: "m20tokenartifactnyx" },
  regular: { plain: "m20tokentext", artifact: "m20tokenartifacttext", nyx: "m20tokennyxtext", artifactNyx: "m20tokenartifactnyxtext" },
  tall: { plain: "m20tokentall", artifact: "m20tokenartifacttall", nyx: "m20tokennyxtall", artifactNyx: "m20tokenartifactnyxtall" },
};

/** The template for a height, plain or artifact, plain or Nyx. */
export function m20TokenTemplate(height: M20TokenHeight, artifact: boolean, nyx = false): FrameTemplate {
  const set = M20_TOKEN_TEMPLATES[height];
  if (nyx) return artifact ? set.artifactNyx : set.nyx;
  return artifact ? set.artifact : set.plain;
}

/** A full-art token template's height, or null for any other template. */
export function m20TokenHeightOf(template: FrameTemplate | string | null | undefined): M20TokenHeight | null {
  for (const height of M20_TOKEN_HEIGHTS) {
    const set = M20_TOKEN_TEMPLATES[height];
    if (template === set.plain || template === set.artifact || template === set.nyx || template === set.artifactNyx) return height;
  }
  return null;
}

/** True for the twelve full-art token templates (the Nyx dress's six too). */
export function isM20TokenTemplate(template: FrameTemplate | string | null | undefined): boolean {
  return m20TokenHeightOf(template) !== null;
}

/** True for the artifact templates, plain or Nyx. */
export function isM20ArtifactTokenTemplate(template: FrameTemplate | string | null | undefined): boolean {
  return M20_TOKEN_HEIGHTS.some(
    (height) => M20_TOKEN_TEMPLATES[height].artifact === template || M20_TOKEN_TEMPLATES[height].artifactNyx === template,
  );
}

/** A full-art token template without the Nyx dress (its plain twin at the
 *  same height, artifact or not); any other template as it is. */
export function m20TokenTwinWithoutNyx(template: FrameTemplate): FrameTemplate {
  const height = m20TokenHeightOf(template);
  return height ? m20TokenTemplate(height, isM20ArtifactTokenTemplate(template), false) : template;
}

/** True for the Nyx dress's six templates (TODO 4.51). */
export function isM20NyxTokenTemplate(template: FrameTemplate | string | null | undefined): boolean {
  return M20_TOKEN_HEIGHTS.some(
    (height) => M20_TOKEN_TEMPLATES[height].nyx === template || M20_TOKEN_TEMPLATES[height].artifactNyx === template,
  );
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

/** The smallest rules size, HD px, at which the regular box still holds a
 *  text before the text asks for the tall box: 72 px = 8.5 pt, two steps
 *  under the 76 px standard (owner decision 2026-09-29; above). */
export const M20_TOKEN_REGULAR_MIN_PX = 72;

/** The size, HD px, the rules fit `height`'s box at — the largest ladder step
 *  at which they fit at both bake targets, clear of the plate — or null when
 *  they don't fit it even at the floor. */
export function tokenTextFitPx(height: Exclude<M20TokenHeight, "textless">, text: TokenHeightText): number | null {
  const profile = getFrameProfile(m20TokenTemplate(height, text.artifact === true));
  const layout = mainRulesLayout({
    layout: profile,
    rulesText: text.rulesText,
    flavorText: text.flavorText,
    aspect: 7 / 5,
    show: { pt: text.printsPowerToughness },
  });
  return layout.clipped ? null : layout.sizePx;
}

/** True when the text fits `height`'s box at the rules standard size — the
 *  first step of the ladder, at both bake targets, clear of the plate. */
export function tokenTextFitsAtStandardSize(height: Exclude<M20TokenHeight, "textless">, text: TokenHeightText): boolean {
  const profile = getFrameProfile(m20TokenTemplate(height, text.artifact === true));
  return tokenTextFitPx(height, text) === rulesLadderPx(profile.rules.sizePct)[0];
}

/** True when the regular box holds the text at M20_TOKEN_REGULAR_MIN_PX or
 *  more — the height rule's test (above). */
export function tokenTextFitsRegularBox(text: TokenHeightText): boolean {
  return (tokenTextFitPx("regular", text) ?? 0) >= M20_TOKEN_REGULAR_MIN_PX;
}

/** The height the text asks for (TODO 4.48's rule, above). */
export function tokenHeightForText(text: TokenHeightText): M20TokenHeight {
  if (!text.rulesText?.trim() && !text.flavorText?.trim()) return "textless";
  return tokenTextFitsRegularBox(text) ? "regular" : "tall";
}
