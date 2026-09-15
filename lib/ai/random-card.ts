import "server-only";

import {
  designSingleCard,
  type DesignedCard,
  type SingleCardOptions,
} from "@/lib/ai/card-design";

// ---------------------------------------------------------------------------
// Random card generator — thin wrapper over the shared card-design engine
// (lib/ai/card-design.ts), which owns prompting, lint, and the judge→fix
// pass. This module is the card job-step wrapper consumed by
// lib/ai/generation-jobs.ts (kind "card").
//
// The art generator (lib/ai/random-art.ts) takes the returned art_prompt and
// produces a public image URL. Everything that lands in the editor is a
// patch — the user can edit any field before saving.
// ---------------------------------------------------------------------------

export type RandomCardOutput = DesignedCard;

/**
 * Design one card via the shared engine. `options` steers theme/style/type/
 * rarity when the caller collected them (the options dialog); empty options
 * = the classic "surprise me" button. Callers own rate-limiting/credits.
 */
export async function generateRandomCard(
  options: SingleCardOptions = {},
): Promise<RandomCardOutput> {
  const { card } = await designSingleCard(options);
  return card;
}
