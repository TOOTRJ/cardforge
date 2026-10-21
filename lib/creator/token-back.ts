// ---------------------------------------------------------------------------
// A double-sided token's BACK body (TODO 5.5 (c), owner Round 76).
//
// Two tokens back to back (lib/cards/token-faces.ts): the back wears a token
// template in the FRONT's design, derived from the back's own words and text
// exactly as a token's frame is (tokenFrameFor — the Artifact word's dress,
// the arch's text box, the full-art token's height) and, on the full-art
// design, the Nyx dress where its words say Enchantment in ONE colour (the
// rule a new token follows onto it, owner Round 74). There is no pick: the
// creator draws it, the import lands it and the server's gate stores it
// through this ONE function, so the three never disagree.
//
// Pure: no React, no form state, no I/O.
// ---------------------------------------------------------------------------

import { printsPowerToughness } from "@/lib/cards/card-display";
import { pickFrameColorKey } from "@/lib/cards/frame-color-key";
import { TOKEN_DESIGN_BASE, tokenDesignOf } from "@/lib/cards/token-faces";
import { enchantmentFrameFor, tokenFrameFor } from "@/lib/creator/card-kinds";
import type { ColorIdentity, FrameTemplate } from "@/types/card";

/** A token back as far as its body goes: its type words, subtypes, text,
 *  P/T and colour (its own; the caller passes the front's when it names
 *  none). */
export type TokenBackFace = {
  supertype?: string | null;
  subtypes?: readonly string[] | string | null;
  rulesText?: string | null;
  flavorText?: string | null;
  power?: string | null;
  toughness?: string | null;
  colorIdentity?: readonly ColorIdentity[] | null;
};

function subtypeList(value: TokenBackFace["subtypes"]): string[] {
  if (Array.isArray(value)) return [...value];
  if (typeof value === "string") {
    return value
      .split(/[,\s]+/)
      .map((word) => word.trim())
      .filter(Boolean);
  }
  return [];
}

/**
 * The token template a double-sided token's back wears under a card on
 * `frontTemplate`, or null when the front is not a token template (no
 * token back exists there).
 */
export function tokenBackBodyFor(
  frontTemplate: FrameTemplate | string | null | undefined,
  back: TokenBackFace,
): FrameTemplate | null {
  const design = tokenDesignOf(frontTemplate);
  if (!design) return null;
  const subtypes = subtypeList(back.subtypes);
  const face = {
    supertype: back.supertype ?? null,
    rulesText: back.rulesText ?? null,
    flavorText: back.flavorText ?? null,
    printsPowerToughness: printsPowerToughness({
      cardType: "token",
      supertype: back.supertype ?? null,
      subtypes,
      power: back.power ?? null,
      toughness: back.toughness ?? null,
    }),
  };
  const dressed = tokenFrameFor("token", TOKEN_DESIGN_BASE[design], face);
  return enchantmentFrameFor(
    "token",
    dressed,
    { cardType: "token", supertype: back.supertype ?? null, subtypes },
    pickFrameColorKey([...(back.colorIdentity ?? [])]),
  );
}
