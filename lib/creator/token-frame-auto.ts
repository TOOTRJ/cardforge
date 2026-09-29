// ---------------------------------------------------------------------------
// The creator's full-art token frames (TODO 4.48 / 4.50, owner decisions
// 2026-09-29) — the default switch and the automatic height, kept apart
// from the form on purpose:
//
//   * NOT WIRED YET. Round 11 (feat/token-textbox-move) ships the creator's
//     automatic pick between the 2014–19 arch's textless and text-box
//     frames first; this module is the full-art family's half of the same
//     mechanism and is wired into it once that merges (the form's frame
//     follows `followTokenHeight`, a Variations pick sets `heightPinned`
//     through `pinsTokenHeight` — round 11's `manual` — and a new token
//     starts on `newTokenFrame`). Until then nothing in the app
//     imports it, so no card, preview or bake changes.
//
//   * The default switch: once 4.48 is VERIFIED, a NEW token defaults to the
//     full-art design — the token kind's standard (ERA_TYPE_FRAME.m15.token)
//     becomes `m20token`, the arch stays available as "Token (2014–2019)",
//     and stored cards keep their frame. Per colour, as every creator frame
//     is gated (frame_reviews): a colour whose full-art template isn't
//     verified yet starts on the arch.
//
//   * The height: automatic, with a manual choice that sticks (owner
//     decision 5). A new token takes the smallest printed height its text
//     fits at the rules standard size (lib/cards/token-height.ts — the
//     import's rule too); the creator follows the text as it changes until
//     the user picks a height, and from then on keeps theirs. Round 11's
//     rules for the arch's text box (followTokenTextBox) hold here too: ANY
//     height picked in the setup panel's Variations sticks — the one the
//     text asks for included (pinsTokenHeight); a Frame-section pick goes
//     back to automatic; and the frame follows only while it wears the
//     height the text asked for BEFORE the edit, so a stored card whose
//     height disagrees with its text (a pick from an earlier session) keeps
//     it. The Artifact word picks the artifact template at the same height
//     (4.50). The form never lands on an unverified combo: a height that
//     isn't verified in the card's colour keeps the frame it has (the
//     type-word dress's rule, typeWordFrameFor).
//
// Pure and client-safe.
// ---------------------------------------------------------------------------

import { isFrameComboAvailable } from "@/lib/cards/frame-availability";
import { supertypeHasWord } from "@/lib/cards/card-display";
import {
  m20TokenHeightOf,
  m20TokenTemplate,
  tokenHeightForText,
  type M20TokenHeight,
  type TokenHeightText,
} from "@/lib/cards/token-height";
import type { FrameTemplate } from "@/types/card";

/** The token kind's standard once the full-art family is verified (owner
 *  decision 2026-09-29), and the arch it replaces. */
export const TOKEN_STANDARD_ONCE_VERIFIED: FrameTemplate = "m20token";
export const ARCH_TOKEN_STANDARD: FrameTemplate = "m15token";

/**
 * The picker's labels at the switch: the full-art family becomes "Token" and
 * the arch "Token (2014–2019)" (owner decision 2026-09-29). Applied to
 * FRAME_TEMPLATE_LABELS (types/card.ts) in the same change that makes
 * `m20token` the kind's standard; today's labels name the full-art family
 * "Full-art Token…" while it is a variation of the arch.
 */
export const TOKEN_FRAME_LABELS_AFTER_SWITCH: Readonly<Partial<Record<FrameTemplate, string>>> = {
  m20token: "Token",
  m20tokentext: "Token, text box",
  m20tokentall: "Token, tall text box",
  m20tokenartifact: "Artifact Token",
  m20tokenartifacttext: "Artifact Token, text box",
  m20tokenartifacttall: "Artifact Token, tall text box",
  m15token: "Token (2014–2019)",
  m15tokentext: "Token (2014–2019), text box",
  m15tokenartifact: "Artifact Token (2014–2019)",
  m15tokenartifacttext: "Artifact Token (2014–2019), text box",
};

/** The token kind's variations at the switch (TEMPLATE_SKIN_VARIANTS keyed
 *  by the new standard): the full-art heights, their artifact templates
 *  (type-word dresses the pickers hide), then the arch and its dresses. */
export const TOKEN_SKINS_AFTER_SWITCH: readonly FrameTemplate[] = [
  "m20tokentext",
  "m20tokentall",
  "m20tokenartifact",
  "m20tokenartifacttext",
  "m20tokenartifacttall",
  "m15token",
  "m15tokenartifact",
  "m15tokentext",
  "m15tokenartifacttext",
];

export type TokenFrameText = Omit<TokenHeightText, "artifact"> & {
  /** The token's type words (supertype): "Artifact" picks the artifact
   *  template. */
  supertype: string | null | undefined;
};

/** The full-art template the text and the type words ask for. */
export function autoM20TokenFrame(text: TokenFrameText): FrameTemplate {
  const artifact = supertypeHasWord(text.supertype, "Artifact");
  return m20TokenTemplate(tokenHeightForText({ ...text, artifact }), artifact);
}

/**
 * The frame a NEW token starts on (the default switch): the full-art
 * template its text asks for when that template is verified in the card's
 * colour, else the arch (its artifact dress for an Artifact).
 */
export function newTokenFrame(
  text: TokenFrameText,
  colorKey: string,
  verifiedKeys: ReadonlySet<string>,
): FrameTemplate {
  const full = autoM20TokenFrame(text);
  if (isFrameComboAvailable(full, colorKey, verifiedKeys)) return full;
  return supertypeHasWord(text.supertype, "Artifact") ? "m15tokenartifact" : ARCH_TOKEN_STANDARD;
}

/**
 * The frame a full-art token follows to as its text or type words change:
 * the height the text now asks for — but only while the card wears the
 * height the text asked for before the edit (`previous`) and the user
 * hasn't picked one (`heightPinned`); otherwise the height it is on (round
 * 11's rule, followTokenTextBox: a frame that disagreed with the text is a
 * choice the user made, and it sticks) — dressed by the Artifact word
 * either way. Any other template is returned as it is (the arch, a
 * showcase), and so is a full-art frame whose target isn't verified in the
 * card's colour: the form never moves a card onto an unverified combo.
 */
export function followTokenHeight(
  input: TokenFrameText & {
    template: FrameTemplate;
    /** The text and type words before this edit. */
    previous: TokenFrameText;
    /** The user picked a height this session (pinsTokenHeight). */
    heightPinned: boolean;
    colorKey: string;
    verifiedKeys: ReadonlySet<string>;
  },
): FrameTemplate {
  const current = m20TokenHeightOf(input.template);
  if (!current) return input.template;
  const artifact = supertypeHasWord(input.supertype, "Artifact");
  const followed =
    !input.heightPinned &&
    current ===
      tokenHeightForText({ ...input.previous, artifact: supertypeHasWord(input.previous.supertype, "Artifact") });
  const height: M20TokenHeight = followed ? tokenHeightForText({ ...input, artifact }) : current;
  const next = m20TokenTemplate(height, artifact);
  if (next === input.template) return next;
  return isFrameComboAvailable(next, input.colorKey, input.verifiedKeys) ? next : input.template;
}

/**
 * Whether a frame pick pins the height (owner decision 5: the creator
 * follows the text "until the user picks a height"): a full-art height
 * picked in the setup panel's Variations — whichever it is, the one the
 * text asks for included, as round 11's text-box chips stick. A pick in the
 * Frame section (the family's standard) goes back to automatic, and a frame
 * outside the family pins nothing here (round 11's own flag covers the
 * arch).
 */
export function pinsTokenHeight(picked: FrameTemplate, pick: { variation: boolean }): boolean {
  return pick.variation && m20TokenHeightOf(picked) !== null;
}
