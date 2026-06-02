// Font-size tiering for the rules+flavor text box. Lives in a shared
// (non-"use client") module so both the live preview (card-preview.tsx,
// client component) and the Satori server renderer (card-image.tsx,
// server-only) can import it without crossing the client/server boundary.
//
// Discrete tiers — same character count gets the same font size in both
// renderers, so the baked PNG matches the editor preview pixel for pixel.

export type RulesFontTier = 0 | 1 | 2 | 3;

export function rulesFontTier(
  rulesText: string | null | undefined,
  flavorText: string | null | undefined,
): RulesFontTier {
  const total = (rulesText?.length ?? 0) + (flavorText?.length ?? 0);
  if (total <= 140) return 0;
  if (total <= 280) return 1;
  if (total <= 440) return 2;
  return 3;
}

// Rules-box base font size as a fraction of card WIDTH, per length tier. Shared
// by the live preview (× card width via `cqw` container units) and the Satori
// bake (× card width in px) so a given amount of text renders at the same size
// in both. One table = one source of truth, no drift between editor and export.
export const RULES_SIZE_PCT_BY_TIER: Record<RulesFontTier, number> = {
  0: 0.032,
  1: 0.028,
  2: 0.024,
  3: 0.0205,
};
