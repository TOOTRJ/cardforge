import "server-only";

import { designCards } from "@/lib/ai/card-design";
import {
  fillPromptNote,
  pickFillResult,
  type CardFillField,
  type CardFillLocked,
  type CardFillResult,
  type CardFillSteer,
  type DesignedLike,
} from "@/lib/ai/card-fill-shared";
import {
  emptyStationTiers,
  mergeStationFill,
  repairStationText,
  StationGapUnfilledError,
  stationGapsLeftEmpty,
  stationWordOf,
} from "@/lib/ai/station-design";
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

/**
 * The rules text a fill hands back for a Spacecraft / Planet (TODO 4.27a,
 * PR 3) — the designed text for every other card, untouched.
 *
 * The design engine lints the card the MODEL returned; a fill keeps only the
 * wanted fields and the rest is the form's — so the card that is really
 * being written is the pinned identity with the designed text. That card is
 * put into the printed tier shape here (repairStationText: the autofix of
 * lib/ai/mtg-rules.ts, on the identity the form holds), and where the form's
 * text already has tiers, a tier left empty is the only line written
 * (mergeStationFill).
 */
function stationFillRules(input: DesignCardFillInput, designed: DesignedLike, text: string): string {
  const wantsType = input.want.includes("card_type");
  const wantsStats = input.want.includes("stats");
  const card = {
    card_type: (wantsType ? designed.card_type : input.locked.card_type) ?? designed.card_type,
    subtypes: (wantsType ? designed.subtypes : input.locked.subtypes) ?? designed.subtypes,
    rules_text: text,
    power: wantsStats ? designed.power : (input.locked.power ?? null),
    toughness: wantsStats ? designed.toughness : (input.locked.toughness ?? null),
  };
  if (!stationWordOf(card)) return text;
  const current = input.locked.station_text;
  if (current && emptyStationTiers(current).length > 0) {
    const merged = mergeStationFill(current, text);
    // The gap the maker left is what this fill was asked for: came back
    // unwritten, the fill is refused HERE — at plan time, before the job
    // (and its one credit) exists (owner 2026-10-14).
    const left = stationGapsLeftEmpty(current, merged);
    if (left.length > 0) throw new StationGapUnfilledError(left.length);
    return merged;
  }
  return repairStationText(card);
}

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
  const fields = pickFillResult(designed, input.want);
  if (fields.rules_text !== undefined) {
    fields.rules_text = stationFillRules(input, designed, fields.rules_text);
  }
  return { fields, art_prompt: designed.art_prompt };
}
