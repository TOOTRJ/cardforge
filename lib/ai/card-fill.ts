import "server-only";

import { designCards } from "@/lib/ai/card-design";
import {
  fillPromptNote,
  pickFillResult,
  type CardFillField,
  type CardFillLocked,
  type CardFillResult,
  type CardFillSteer,
} from "@/lib/ai/card-fill-shared";
import type { ColorIdentity } from "@/types/card";

// ---------------------------------------------------------------------------
// Per-field card design — the server half of the creator's "fill" flow. The
// shared design engine (lint + judge + autofix) designs a COMPLETE card
// around the pinned values; only the wanted fields are kept.
// ---------------------------------------------------------------------------

export type DesignCardFillInput = {
  want: readonly CardFillField[];
  locked: CardFillLocked;
  steer: CardFillSteer;
  theme?: string;
  style?: string;
  /** Deck brief for deck-aware design (Pro). */
  context?: string;
  colorHint?: ColorIdentity;
};

export async function designCardFill(
  input: DesignCardFillInput,
): Promise<{ fields: CardFillResult; art_prompt: string }> {
  const wantsType = input.want.includes("card_type");
  const wantsRarity = input.want.includes("rarity");
  const wantsColors = input.want.includes("color_identity");
  const { cards } = await designCards({
    theme: input.theme,
    style: input.style,
    context: input.context,
    slots: [
      {
        cardType: wantsType ? input.steer.card_type : input.locked.card_type,
        rarity: wantsRarity ? input.steer.rarity : input.locked.rarity,
        colorHint:
          input.colorHint ??
          (!wantsColors ? input.locked.color_identity?.[0] : undefined),
        note: fillPromptNote(input.locked, input.want),
      },
    ],
  });
  const designed = cards[0];
  return {
    fields: pickFillResult(designed, input.want),
    art_prompt: designed.art_prompt,
  };
}
