// ---------------------------------------------------------------------------
// The creator's full-art token frames (TODO 4.48 / 4.50, owner decisions
// 2026-09-29) — the default switch and the automatic height, the full-art
// half of round 11's text-box follow (components/creator/card-creator-form.tsx
// runs both in one effect):
//
//   * The default switch: a NEW token — the token kind entered on the M15
//     era's standard, the 2014–19 arch — starts on the full-art template its
//     text and type words ask for when that template is VERIFIED in the
//     card's colour (newTokenFrame), else on the arch round 11 picks (the
//     text box when it has text, the artifact dress for an Artifact). Per
//     colour and per height, as every creator frame is gated (frame_reviews):
//     until the owner verifies them nothing changes. The arch stays offered
//     as "Token (2014–2019)" — the new look's off switch — and stored cards
//     keep their frame (docs/FRAMES.md "Additions vs corrections"). Imports
//     follow the printing (the registry's `token/m20` and `borderless/token`
//     rules, onceVerified) and the AI jobs follow the text on whichever
//     design they land on (lib/creator/card-kinds.ts tokenFrameFor).
//
//   * The height: automatic, with a manual choice that sticks (owner
//     decision 5). A full-art token takes the smallest printed height its
//     text fits (lib/cards/token-height.ts — the import's rule too); the
//     creator follows the text as it changes until the user picks a height,
//     and from then on keeps theirs. Round 11's rules for the arch's text box
//     (followTokenTextBox) hold here too: ANY height picked in the setup
//     panel's Variations sticks — the one the text asks for included
//     (pinsTokenHeight: the form's `manual` flag); a Frame-section pick goes
//     back to automatic; and the frame follows only while it wears the
//     height the text asked for BEFORE the edit, so a stored card whose
//     height disagrees with its text (a pick from an earlier session) keeps
//     it. The Artifact word picks the artifact template at the same height
//     (4.50; the form's type-word effect owns that dress). The form never
//     lands on an unverified combo: it keeps the frame it has and says so.
//
// Pure and client-safe.
// ---------------------------------------------------------------------------

import { isFrameComboAvailable } from "@/lib/cards/frame-availability";
import { printsPowerToughness, supertypeHasWord } from "@/lib/cards/card-display";
import {
  m20TokenHeightOf,
  m20TokenTemplate,
  tokenHeightForText,
  type M20TokenHeight,
  type TokenHeightText,
} from "@/lib/cards/token-height";
import { tokenFrameFor } from "@/lib/creator/card-kinds";
import type { CardType, FrameTemplate } from "@/types/card";

/** The 2014–19 arch the M15 era's token standard (m15token) lands on, in
 *  every dress the token's rules give it: its text box and its Artifact
 *  word (round 11's pick). */
const ARCH_TOKEN_FRAMES: ReadonlySet<FrameTemplate> = new Set([
  "m15token",
  "m15tokentext",
  "m15tokenartifact",
  "m15tokenartifacttext",
]);

/** True for the 2014–19 arch in any of its dresses — where a token lands
 *  when it enters the token kind on the M15 era (planKindChange). */
export function isArchTokenFrame(template: FrameTemplate | string | null | undefined): boolean {
  return ARCH_TOKEN_FRAMES.has(template as FrameTemplate);
}

export type TokenFrameText = Omit<TokenHeightText, "artifact"> & {
  /** The token's type words (supertype): "Artifact" picks the artifact
   *  template. */
  supertype: string | null | undefined;
};

/** A token face's TokenFrameText: its words, its text and whether it prints
 *  a P/T (printsPowerToughness — the plate keeps the rules out). */
export function tokenFrameText(face: {
  cardType: CardType | null | undefined;
  supertype: string | null | undefined;
  subtypes?: readonly string[] | null;
  rulesText: string | null | undefined;
  flavorText: string | null | undefined;
  power?: string | null;
  toughness?: string | null;
}): TokenFrameText {
  return {
    supertype: face.supertype ?? null,
    rulesText: face.rulesText ?? null,
    flavorText: face.flavorText ?? null,
    printsPowerToughness: printsPowerToughness(face),
  };
}

/** Whether two TokenFrameTexts ask for the same frame inputs. */
export function sameTokenFrameText(a: TokenFrameText, b: TokenFrameText): boolean {
  return (
    (a.supertype ?? "") === (b.supertype ?? "") &&
    (a.rulesText ?? "") === (b.rulesText ?? "") &&
    (a.flavorText ?? "") === (b.flavorText ?? "") &&
    a.printsPowerToughness === b.printsPowerToughness
  );
}

/** The full-art template the text and the type words ask for. */
export function autoM20TokenFrame(text: TokenFrameText): FrameTemplate {
  const artifact = supertypeHasWord(text.supertype, "Artifact");
  return m20TokenTemplate(tokenHeightForText({ ...text, artifact }), artifact);
}

/**
 * The frame a NEW token starts on (the default switch): the full-art
 * template its text asks for when that template is verified in the card's
 * colour, else the arch round 11 picks — its text box when it has text, its
 * artifact dress for an Artifact (tokenFrameFor).
 */
export function newTokenFrame(
  text: TokenFrameText,
  colorKey: string,
  verifiedKeys: ReadonlySet<string>,
): FrameTemplate {
  const full = autoM20TokenFrame(text);
  if (isFrameComboAvailable(full, colorKey, verifiedKeys)) return full;
  return tokenFrameFor("token", "m15token", text);
}

/**
 * The frame a full-art token follows to as its text or type words change:
 * the height the text now asks for — but only while the card wears the
 * height the text asked for before the edit (`previous`) and the user
 * hasn't picked one (`heightPinned`); otherwise the height it is on (round
 * 11's rule, followTokenTextBox: a frame that disagreed with the text is a
 * choice the user made, and it sticks) — dressed by the Artifact word
 * either way. Any other template is returned as it is (the arch, a
 * showcase). With `verifiedKeys`, a target that isn't verified in the
 * card's colour returns the template as it is (the form never moves a card
 * onto an unverified combo); without them, the target itself — the caller
 * checks it and says why it stays.
 */
export function followTokenHeight(
  input: TokenFrameText & {
    template: FrameTemplate;
    /** The text and type words before this edit. */
    previous: TokenFrameText;
    /** The user picked a height this session (pinsTokenHeight). */
    heightPinned: boolean;
    colorKey?: string;
    verifiedKeys?: ReadonlySet<string>;
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
  if (next === input.template || !input.verifiedKeys) return next;
  return isFrameComboAvailable(next, input.colorKey ?? "", input.verifiedKeys) ? next : input.template;
}

/**
 * Whether a frame pick pins the height (owner decision 5: the creator
 * follows the text "until the user picks a height"): a full-art height
 * picked in the setup panel's Variations — whichever it is, the one the
 * text asks for included, as round 11's text-box chips stick. A pick in the
 * Frame section goes back to automatic, and a frame outside the family pins
 * nothing here (round 11's own flag covers the arch). The form keeps ONE
 * flag for both (a Variations pick), so this is its rule on the full-art
 * family.
 */
export function pinsTokenHeight(picked: FrameTemplate, pick: { variation: boolean }): boolean {
  return pick.variation && m20TokenHeightOf(picked) !== null;
}
