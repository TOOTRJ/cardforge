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
