// Pure frame selection for AI-generated cards. Shared by the random-card
// route (server) and unit tests — no React, no Supabase.
//
// The AI options dialog lets the user pick a specific frame, ask for a
// random one, or leave it alone. Selection respects the same verification
// gate as the picker (lib/cards/frame-availability.ts): only PUBLISHED
// (template, color) combos are ever chosen, using the color key the
// generated card will actually render with.

import type { CardType, ColorIdentity, FrameTemplate } from "@/types/card";
import { framesForKind, kindFromCard, type FrameChoice } from "@/lib/creator/card-kinds";
import { pickFrameColorKey } from "@/components/cards/frame-layer";

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
 *     this card is published; otherwise falls back like "random".
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
  /** Injectable RNG for tests. Defaults to Math.random. */
  random?: () => number;
}): FrameTemplate | null {
  const { cardType, requested, colorIdentity, verifiedKeys } = input;
  if (!requested) return null;

  const colorKey = pickFrameColorKey(colorIdentity);
  const choices = frameChoicesForType(cardType, verifiedKeys);
  const pool = choices.filter((choice) =>
    choice.availableColorKeys.includes(colorKey as never),
  );

  if (requested !== "random") {
    const match = pool.find((choice) => choice.template === requested);
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
