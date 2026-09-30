// Pure frame selection for AI-generated cards. Shared by createCardGenerationJob
// (lib/ai/generation-jobs.ts), the AI options dialog (frameChoicesForType)
// and unit tests — no React, no Supabase.
//
// The AI options dialog lets the user pick a specific frame, ask for a
// random one, or leave it alone. Selection respects the same verification
// gate as the picker (lib/cards/frame-availability.ts): only PUBLISHED
// (template, color) combos are ever chosen, using the color key the
// generated card will actually render with.

import type { CardType, ColorIdentity, FrameTemplate } from "@/types/card";
import {
  borrowedFrameFits,
  framesForKind,
  isSingleBasicLand,
  kindFromCard,
  templateIsBasicOnly,
  tokenFrameFits,
  tokenFrameFor,
  typeWordFrameFits,
  typeWordFrameFor,
  type FrameChoice,
  type TokenFrameFace,
} from "@/lib/creator/card-kinds";
import { pickFrameColorKey } from "@/components/cards/frame-layer";
import { printsPowerToughness } from "@/lib/cards/card-display";
import { isM20TokenTemplate } from "@/lib/cards/token-height";
import type { BasicLandFace } from "@/lib/cards/watermark";

export type FrameRequest = FrameTemplate | "random" | undefined;

/** Frames that can dress this card type at all (any color published). */
export function frameChoicesForType(
  cardType: CardType,
  verifiedKeys: ReadonlySet<string>,
): FrameChoice[] {
  return framesForKind(kindFromCard(cardType, undefined), verifiedKeys);
}

/**
 * Resolve the frame an AI-generated card should save with.
 *
 *   - specific template → kept when it dresses the type AND its color for
 *     this card is published (and, for a basic-only frame, the card is one
 *     basic land; for a frame a creature borrows, the card says its word —
 *     an Artifact Creature on the artifact frame, an Enchantment Creature on
 *     Nyx); otherwise falls back like "random".
 *   - "random" → a uniformly random published frame whose available colors
 *     include the generated card's color key.
 *   - undefined → null (caller keeps the creator's era default).
 *
 * Returns null when nothing qualifies — the caller falls back to the
 * default kind frame, exactly like a manual type pick would.
 */
export function resolveGeneratedFrame(input: {
  cardType: CardType;
  requested: FrameRequest;
  colorIdentity: ColorIdentity[];
  verifiedKeys: ReadonlySet<string>;
  /** The generated card's identity. A basic-only frame (the full-art basic
   *  land) is a candidate only when this is one basic land; without it,
   *  those frames are left out. Its rules and flavour text pick a token's
   *  text box (TODO 4.49 (b)) and a full-art token's height (4.48; its P/T,
   *  when printed, keeps the rules clear of the plate); without them, the
   *  textless frame. */
  face?: BasicLandFace & { flavorText?: string | null; power?: string | null; toughness?: string | null };
  /** Injectable RNG for tests. Defaults to Math.random. */
  random?: () => number;
}): FrameTemplate | null {
  const { cardType, requested, colorIdentity, verifiedKeys, face } = input;
  if (!requested) return null;

  const colorKey = pickFrameColorKey(colorIdentity);
  const choices = frameChoicesForType(cardType, verifiedKeys);
  const basicLand = face !== undefined && isSingleBasicLand(face);
  // A frame never dresses a card as a type it isn't: the artifact frame a
  // creature borrows (TODO 1.7) is for an Artifact Creature only, the Nyx
  // showcase (owner decision A3) for an Enchantment Creature — asked for by
  // name or picked at random.
  // …and a token's type words pick between the plain and the artifact
  // token frame (TODO 3b.15): a Treasure never lands on the plain one, a
  // Soldier never on the artifact one; a request for either means the one
  // the words pick. Its text picks the text box the same way (TODO 4.49
  // (b), owner decision 5): rules or flavour text → the text-box arch, none
  // → the textless one, whichever of the two was asked for. That one is a
  // preference, not a gate: while the box isn't published in the card's
  // colour, the textless arch (whose scrim keeps the text) is what was asked
  // for, as in the creator.
  // …and on the full-art token design (TODO 4.48) the text picks the
  // height the same way — no text → no box, the regular box, the tall box —
  // whichever height was asked for.
  const kind = kindFromCard(cardType, undefined);
  const type = { cardType, supertype: face?.supertype };
  const tokenFace: TokenFrameFace = {
    supertype: face?.supertype,
    rulesText: face?.rulesText,
    flavorText: face?.flavorText,
    printsPowerToughness: printsPowerToughness({
      cardType: cardType,
      supertype: face?.supertype,
      subtypes: face?.subtypes,
      power: face?.power,
      toughness: face?.toughness,
    }),
  };
  const typed = choices.filter(
    (choice) =>
      choice.availableColorKeys.includes(colorKey as never) &&
      (basicLand || !templateIsBasicOnly(choice.template)) &&
      borrowedFrameFits(kind, choice.template, type) &&
      typeWordFrameFits(kind, choice.template, face?.supertype),
  );
  const boxed = typed.filter((choice) => tokenFrameFits(kind, choice.template, tokenFace));
  const pool = boxed.length > 0 ? boxed : typed;

  if (requested !== "random") {
    const wanted = tokenFrameFor(kind, requested, tokenFace);
    const asked = typeWordFrameFor(kind, requested, face?.supertype);
    // The height asked for stands in only on the arch, whose textless frame
    // keeps the text on its scrim: a full-art height the text doesn't fit
    // would hide it (the textless height) or leave an empty box — the pool
    // below picks a published frame the text fits.
    const match =
      typed.find((choice) => choice.template === wanted) ??
      (isM20TokenTemplate(asked) ? undefined : typed.find((choice) => choice.template === asked));
    if (match) return match.template;
    // Requested frame can't dress this card (wrong type after generation, or
    // that color isn't published) — degrade to a random valid one.
  }

  if (pool.length === 0) return null;
  const rng = input.random ?? Math.random;
  return pool[Math.floor(rng() * pool.length) % pool.length].template;
}

/** Color words a specific frame can render, for steering generation toward
 *  a color the frame actually has published art for. */
export function colorHintsForFrame(
  cardType: CardType,
  template: FrameTemplate,
  verifiedKeys: ReadonlySet<string>,
): ColorIdentity[] {
  const choice = frameChoicesForType(cardType, verifiedKeys).find(
    (c) => c.template === template,
  );
  if (!choice) return [];
  const byKey: Record<string, ColorIdentity> = {
    w: "white",
    u: "blue",
    b: "black",
    r: "red",
    g: "green",
    c: "colorless",
    m: "multicolor",
  };
  return choice.availableColorKeys
    .map((key) => byKey[key])
    .filter((word): word is ColorIdentity => Boolean(word));
}
