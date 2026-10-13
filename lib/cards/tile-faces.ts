import { isLandscapeFrame } from "@/lib/cards/card-orientation";
import { isStoredRenderUrl } from "@/lib/cards/render-cdn";

// ---------------------------------------------------------------------------
// Which cards a tile shows as TWO-FACED (TODO 5.15, owner 2026-10-12): the
// ones with a back PICTURE — a stored bake of the back beside the front's
// (cards.rendered_back_thumb_url, written only for a back with a body of its
// own: lib/cards/faces.ts bakedBackOf, TODO 5.3). ONE answer for the tile's
// "2 faces" button (BakedCardThumbnail), the list views' text mark
// (TwoFacesMark) and the deck pop-up's Front / Back switch.
//
// An older two-faced card with no back picture shows NOTHING (the owner's
// choice over a mark), and so does a card whose render pointers an edit has
// just cleared: for those seconds its tile is the live front, with no button
// — there is no back picture to turn to until the new bake lands.
//
// Only our own bakes count (isStoredRenderUrl); only a portrait pair turns
// (every double-faced body is portrait).
// ---------------------------------------------------------------------------

/** The render pointers a tile reads, as the queries hand them over. */
export type TileRenderPointers = {
  rendered_image_url?: string | null;
  rendered_thumb_url?: string | null;
  rendered_back_thumb_url?: string | null;
  frame_style?: unknown;
};

/** The back face's tile-sized WebP when the tile may turn to it, else null:
 *  beside a stored front bake AND its thumb, on a portrait frame. */
export function tileBackThumbOf(card: TileRenderPointers): string | null {
  if (!isStoredRenderUrl(card.rendered_image_url)) return null;
  if (!isStoredRenderUrl(card.rendered_thumb_url)) return null;
  if (!isStoredRenderUrl(card.rendered_back_thumb_url)) return null;
  if (isLandscapeFrame(card.frame_style)) return null;
  return card.rendered_back_thumb_url;
}

/** True when a tile, a list row or a deck row shows the card as two-faced. */
export function hasBackPicture(card: TileRenderPointers): boolean {
  return tileBackThumbOf(card) !== null;
}
