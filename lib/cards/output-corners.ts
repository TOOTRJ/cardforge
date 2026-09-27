import { z } from "zod";

// ---------------------------------------------------------------------------
// The corner of a card image OUTPUT (TODO 3.26, owner decisions 2026-09-27).
// The radius itself lives in lib/cards/card-corner.ts; this is the choice.
//
//   "round"  — the card's rounded corner cut into the PNG's alpha (every
//              display bake, and the download modal's default).
//   "square" — the full rectangle, opaque, the corner outside the arc in the
//              card's border colour (lib/frames/square-corners.ts — the
//              border black, #101015 on a ring): print (the PDF card and
//              sheets, the Pro deck export's PDF and ZIP) and the modal's
//              Square choice.
//
// /api/cards/[id]/png reads it from `?corners=`. A request that names none
// gets SQUARE — the bytes it always got (a deck-export tab loaded before
// 3.26, a bookmarked or external link) — so only callers that ask for the
// rounded card receive one: the download modal requests corners=round
// explicitly (share surfaces use /og, which serves the round bake), and the
// deck export appends corners=square anyway. Shared by the route, the modal
// and the export (client-safe).
// ---------------------------------------------------------------------------

export const CARD_CORNERS = ["round", "square"] as const;
export type CardCorners = (typeof CARD_CORNERS)[number];

/** What the png route serves when the request names no (or an unknown)
 *  `corners`. */
export const PNG_API_DEFAULT_CORNERS: CardCorners = "square";

const cornersParam = z.enum(CARD_CORNERS);

/** The png route's `corners` query value → the corner it serves. */
export function parseCornersParam(value: string | null | undefined): CardCorners {
  const parsed = cornersParam.safeParse(value);
  return parsed.success ? parsed.data : PNG_API_DEFAULT_CORNERS;
}

/** A card's PNG download URL, naming its corner explicitly. */
export function cardPngHref(
  cardId: string,
  opts: { preset: "hd" | "default"; corners: CardCorners },
): string {
  return `/api/cards/${cardId}/png?preset=${opts.preset}&corners=${opts.corners}`;
}
