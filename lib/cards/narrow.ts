import {
  isCardType,
  isColorIdentity,
  isRarity,
  isVisibility,
  type Card,
  type CardWatermark,
  type ColorIdentity,
  type FaceContent,
} from "@/types/card";
import type { Card as CardRow } from "@/types/supabase";

// ---------------------------------------------------------------------------
// Row → domain narrowing. Every card query returns rows whose enum-typed text
// columns are typed as plain `string`; the rest of the app gets the narrower
// unions from types/card.ts through this one function (the card, deck and
// set query modules used to carry byte-identical copies of it).
// ---------------------------------------------------------------------------

export function narrowCard(row: CardRow): Card {
  return {
    ...row,
    visibility: isVisibility(row.visibility) ? row.visibility : "private",
    rarity: row.rarity === null ? null : isRarity(row.rarity) ? row.rarity : null,
    card_type:
      row.card_type === null
        ? null
        : isCardType(row.card_type)
          ? row.card_type
          : null,
    color_identity: row.color_identity.filter(isColorIdentity) as ColorIdentity[],
    // jsonb columns (migration 0050) are validated app-side on write
    // (lib/validation/card.ts), so the cast is the trust boundary here, same
    // as art_position/frame_style downstream.
    face_content: (row.face_content as FaceContent | null) ?? null,
    watermark: (row.watermark as CardWatermark | null) ?? null,
  };
}
