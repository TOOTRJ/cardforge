// ---------------------------------------------------------------------------
// Frame-first design (the AI dialog redesign, PR 1). When the maker picks a
// frame, the card is designed FOR it: the designer reads a brief of the
// frame's era wording and its limits — what its type words, subtypes, text
// and rows must be for the frame to dress the card — and the plan keeps the
// frame only when the design really fits it (`frameFitOf`, read through
// resolveGeneratedFrame with no random fallback). A design that does not fit
// is redone once, then refused, before any credit is reserved.
//
// Every rule here is READ from the creator's own gates (lib/creator/
// card-kinds.ts, lib/cards/token-height.ts, the frame profile), never kept
// by hand, so the brief can't drift from what resolveGeneratedFrame checks.
// Pure: no I/O.
// ---------------------------------------------------------------------------

import { colorWord } from "@/components/cards/frame-layer";
import {
  FRAME_COLOR_KEYS,
  SUBTYPE_DRESS_WORDS,
  borrowedTypeWord,
  enchantmentFrameFor,
  hasRowDress,
  isEnchantmentDress,
  isRowDress,
  kindFromCard,
  subtypeDressOf,
  subtypeFrameFor,
  templateIsBasicOnly,
} from "@/lib/creator/card-kinds";
import { eraForTemplate } from "@/lib/creator/frame-picker";
import { frameChoicesForType, resolveGeneratedFrame } from "@/lib/creator/frame-random";
import { isStationFrame } from "@/lib/cards/station-frame";
import { getFrameProfile } from "@/lib/cards/template-layout";
import { tokenHeightOf } from "@/lib/cards/token-height";
import { FRAME_ERA_LABELS, FRAME_TEMPLATE_LABELS, type CardType, type FrameEra, type FrameTemplate } from "@/types/card";

/** The era's design sensibility. The templating stays modern Oracle wording
 *  everywhere (the design system prompt's rule; the creator prints it). */
const ERA_WORDING: Record<FrameEra, string> = {
  classic:
    "It is a card of the first printings (1993): one simple, iconic effect in short plain rules text, no keyword soup — still in modern Oracle wording.",
  retro:
    "It is an old-border card (1997–2003): the straightforward mechanics of that era — still in modern Oracle wording.",
  modern:
    "It is a card of the 2003–2014 frame: the mechanics of that era — still in modern Oracle wording.",
  m15: "It is a modern card (2015 on).",
  showcase: "It is a modern card in a showcase treatment: the same card, a special look.",
};

/** About how much rules text the frame's box holds at a readable size. */
function rulesBudget(template: FrameTemplate): number {
  const token = tokenHeightOf(template);
  if (token) return token.height === "textless" ? 0 : token.height === "regular" ? 110 : 330;
  if (getFrameProfile(template).textless) return 0;
  const era = eraForTemplate(template);
  return era === "m15" || era === "showcase" ? 300 : 200;
}

/**
 * The frame brief the designer reads (one paragraph), for a card of
 * `cardType` on `template`. `colorKeys` are the colours the frame is
 * published in when the card's colour is FREE (the design is held to them);
 * omit it when the colour is pinned.
 */
export function frameBrief(
  template: FrameTemplate,
  cardType: CardType,
  colorKeys?: readonly string[],
): string {
  const kind = kindFromCard(cardType, undefined);
  const parts: string[] = [
    `FRAME (the maker picked it — design the card FOR it): "${FRAME_TEMPLATE_LABELS[template]}", ${FRAME_ERA_LABELS[eraForTemplate(template)]}.`,
    ERA_WORDING[eraForTemplate(template)],
  ];

  // Type words a frame dresses (the artifact frame a creature borrows, Nyx).
  const borrowed = borrowedTypeWord(kind, template);
  if (borrowed) parts.push(`Its supertype must include the word "${borrowed}".`);
  else if (isEnchantmentDress(template) && kind !== "enchantment") {
    parts.push(`Its supertype must include the word "Enchantment".`);
  }
  // …and the word a base frame must NOT say, where saying it would move the
  // card onto a dress (an Enchantment Creature on Standard → Nyx).
  if (!isEnchantmentDress(template) && kind !== "enchantment" && enchantmentFrameFor(kind, template, { cardType, supertype: "Enchantment" }) !== template) {
    parts.push(`Its supertype must NOT include "Enchantment".`);
  }

  // Subtype dresses (Vehicle, Spacecraft, Planet) and their bases.
  const dressWord = subtypeDressOf(template);
  if (dressWord) {
    parts.push(`Its subtypes must include "${dressWord}".`);
    if (dressWord === "Vehicle") parts.push("It prints a power and toughness and has Crew N.");
  }
  const forbidden = SUBTYPE_DRESS_WORDS.filter(
    (word) => word !== dressWord && subtypeFrameFor(template, [word]) !== template,
  );
  if (forbidden.length > 0) parts.push(`Its subtypes must NOT include ${forbidden.map((word) => `"${word}"`).join(" or ")}.`);
  if (isStationFrame(template)) {
    parts.push(
      "Follow the Station rules: the Station line as the last line of the top text, then one to three tier lines (\"N+ | text\", rising numbers), the power and toughness printed on a tier.",
    );
  }

  // Tokens: the Artifact word and the height its text picks.
  const token = tokenHeightOf(template);
  if (token) {
    parts.push(
      token.artifact
        ? `Its supertype must include "Artifact".`
        : `Its supertype must NOT include "Artifact".`,
    );
    if (token.nyx) parts.push(`Its supertype must include "Enchantment".`);
    parts.push(
      token.height === "textless"
        ? "This frame has NO text box: rules_text must be empty and flavor_text null."
        : token.height === "regular"
          ? "Its text box is short: one or two short abilities (about 110 characters in all), little or no flavor text."
          : "Its text box is tall: three or more abilities or a long ability (about 160–330 characters).",
    );
  } else if (getFrameProfile(template).textless) {
    parts.push("This frame prints NO rules or flavor text: rules_text must be empty and flavor_text null.");
  }

  // Basic lands only (the full-art basics).
  if (templateIsBasicOnly(template)) {
    parts.push(
      'It is ONE basic land: supertype "Basic", exactly one basic land subtype (Plains, Island, Swamp, Mountain or Forest), the title that land type, and no rules text — the frame prints the big mana symbol.',
    );
  }

  // Walker rows (the borderless planeswalker's two boxes).
  if (kind === "planeswalker") {
    if (isRowDress(kind, template)) parts.push("It has FOUR or more loyalty abilities, one per line.");
    else if (hasRowDress(kind, template)) parts.push("It has two or three loyalty abilities, one per line.");
    else parts.push("It has two to four loyalty abilities, one per line.");
  }

  // The card's colour, when it is free: one the frame is published in.
  if (colorKeys && colorKeys.length > 0 && !FRAME_COLOR_KEYS.every((key) => colorKeys.includes(key))) {
    parts.push(`Its color must be ${colorKeys.map(colorWord).join(" or ")} — the frame is published in no other.`);
  }

  const budget = rulesBudget(template);
  if (budget > 0) {
    parts.push(`All its text must fit the frame's text box at a readable size: keep the rules text under about ${budget} characters.`);
  }
  return parts.join(" ");
}

/** The SHAPE a frame holds the text in — what a pick of a height or a box
 *  means: a token's height, the walker's tall box, a textless frame. */
function shapeOf(template: FrameTemplate): string {
  const token = tokenHeightOf(template);
  if (token) return `token:${token.height}`;
  if (template === "m15borderlesspwtall") return "rows:tall";
  return getFrameProfile(template).textless ? "textless" : "box";
}

/** The DRESSES a frame stands for — what a pick of it asks the card to
 *  be: a subtype's frame (Vehicle, Spacecraft, Planet), the enchantment
 *  dress, a frame the kind borrows for a type word, a token's Artifact or
 *  Nyx design. A plain frame stands for none. */
function dressesOf(kind: ReturnType<typeof kindFromCard>, template: FrameTemplate): Set<string> {
  const out = new Set<string>();
  const subtype = subtypeDressOf(template);
  if (subtype) out.add(`subtype:${subtype}`);
  if (isEnchantmentDress(template)) out.add("word:Enchantment");
  const borrowed = borrowedTypeWord(kind, template);
  if (borrowed) out.add(`word:${borrowed}`);
  const token = tokenHeightOf(template);
  if (token?.artifact) out.add("word:Artifact");
  if (token?.nyx) out.add("word:Enchantment");
  return out;
}

export type FrameFit = {
  /** The frame the card saves with (resolveGeneratedFrame with no random
   *  fallback), or null when the design can't be dressed by the frame
   *  picked at all — or it lands off every dress the pick stands for (a
   *  plain creature asked onto Nyx lands on the plain frame: not a fit). */
  frame: FrameTemplate | null;
  /** True when it is the frame picked or a dress the card's own words
   *  carry it onto from there (a Vehicle on the Artifact frame, an Artifact
   *  token's frame from the plain one), in the SAME text shape. False for a
   *  token height, walker box or textless frame the maker didn't pick: the
   *  design is redone once, and kept only if no answer fits exactly. */
  exact: boolean;
};

/** How a designed card fits the frame its maker picked. */
export function frameFitOf(input: {
  template: FrameTemplate;
  cardType: CardType;
  colorIdentity: Parameters<typeof resolveGeneratedFrame>[0]["colorIdentity"];
  verifiedKeys: ReadonlySet<string>;
  face: Parameters<typeof resolveGeneratedFrame>[0]["face"];
}): FrameFit {
  const resolved = resolveGeneratedFrame({
    cardType: input.cardType,
    requested: input.template,
    colorIdentity: input.colorIdentity,
    verifiedKeys: input.verifiedKeys,
    face: input.face,
    fallback: "none",
    random: () => 0,
  });
  if (resolved === null) return { frame: null, exact: false };
  const kind = kindFromCard(input.cardType, undefined);
  const landed = dressesOf(kind, resolved);
  const keepsDresses = [...dressesOf(kind, input.template)].every((dress) => landed.has(dress));
  if (!keepsDresses) return { frame: null, exact: false };
  return { frame: resolved, exact: shapeOf(resolved) === shapeOf(input.template) };
}

/** The colour keys `template` is published in for a card of `cardType` —
 *  the colours a free design is held to on that frame. */
export function frameColorKeysOf(
  cardType: CardType,
  template: FrameTemplate,
  verifiedKeys: ReadonlySet<string>,
): string[] {
  return [...(frameChoicesForType(cardType, verifiedKeys).find((choice) => choice.template === template)?.availableColorKeys ?? [])];
}
