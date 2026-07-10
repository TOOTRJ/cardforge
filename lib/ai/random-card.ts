import "server-only";

import {
  designSingleCard,
  designedCardSchema,
  type DesignedCard,
  type SingleCardOptions,
} from "@/lib/ai/card-design";

// ---------------------------------------------------------------------------
// Random card generator — thin wrapper over the shared card-design engine
// (lib/ai/card-design.ts), which owns prompting, lint, and the judge→fix
// pass. This module keeps the historical exports the random-card route and
// its tests rely on.
//
// The art generator (lib/ai/random-art.ts) takes the returned art_prompt and
// produces a public image URL. Everything that lands in the editor is a
// patch — the user can edit any field before saving.
// ---------------------------------------------------------------------------

/**
 * True when the OpenAI key is present. The TEXT pipeline no longer requires
 * OpenAI (see lib/ai/provider.ts — gateway/Anthropic preferred); this now
 * only gates the gpt-image art call and the moderation scan.
 */
export function isOpenAiConfigured(): boolean {
  return Boolean(process.env.OPENAI_API_KEY?.trim());
}

export const randomCardSchema = designedCardSchema;
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
