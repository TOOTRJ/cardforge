// ---------------------------------------------------------------------------
// The art window a face's art is cropped to — for the creator's art
// positioner (TODO 3b.13).
//
// Both renderers draw a face's art `object-fit: cover` in ONE box per face,
// at `object-position: focalX% focalY%`, then `scale(s)` about that point
// (components/cards/card-preview.tsx ArtImage, lib/render/card-image.tsx).
// The stored numbers therefore only mean something against that box's
// ASPECT: the same focal on a 1.37 window and on a 0.41 one crops different
// parts of the picture. The positioner used to be a fixed 5:4 surface, so it
// showed a crop no card has. This module names the box for every face, from
// the same sources the renderers read — never a second table:
//
//   front        artLayersFor(profile, frameMasterKey(…), true).slot — the
//                profile's artSlot, or a see-through master's own window
//                slot (m15pw/c: the under-frame rect, one picture).
//   second face  profile.secondFace.artSlot (split's right half, aftermath's
//                sideways bottom window). The renderers lay the art in that
//                UNTURNED box and then rotate the box, so the positioner
//                shows the art upright in the same box.
//   back face    a double-faced card's back on its own body and colour
//                (lib/cards/faces.ts backPreviewData), then as a front.
//
// Display only: nothing here feeds a renderer, and no stored position
// changes meaning.
// ---------------------------------------------------------------------------

import type { CardPreviewData } from "@/components/cards/card-preview";
import { frameMasterKey } from "@/components/cards/frame-layer";
import { cardCanvasPx, type Size } from "@/lib/cards/art-framing";
import { normalizeFrameTemplate } from "@/lib/cards/card-display";
import { backBodyOf, backPreviewData } from "@/lib/cards/faces";
import { resolveFrameProfile } from "@/lib/cards/profile-override";
import { artLayersFor, type FrameProfile, type Rect } from "@/lib/cards/template-layout";
import type { ColorIdentity } from "@/types/card";

/** The box one face's art is drawn in. */
export type ArtWindow = {
  /** The frame the face draws on, and the master it paints (the window of a
   *  see-through master can differ from its coloured siblings'). */
  template: string;
  masterKey: string;
  /** The box on the card, in card percents — for a turned second face the
   *  box BEFORE the turn (the art is laid out in it upright). */
  rect: Rect;
  /** Degrees the renderers turn the box in place (a second face's). */
  rotation: number;
  /** The box on the HD canvas (1500 × 2100, landscape 2100 × 1500). */
  width: number;
  height: number;
  /** width ÷ height — what the positioner's surface must have. */
  aspect: number;
};

function windowOf(
  profile: Pick<FrameProfile, "orientation">,
  rect: Rect,
  rest: Pick<ArtWindow, "template" | "masterKey" | "rotation">,
): ArtWindow {
  const card = cardCanvasPx(profile);
  const width = (rect.widthPct / 100) * card.width;
  const height = (rect.heightPct / 100) * card.height;
  return { ...rest, rect, width, height, aspect: width / height };
}

function profileOf(card: CardPreviewData) {
  const template = normalizeFrameTemplate(card.frameStyle?.template, card);
  return { template, profile: resolveFrameProfile(template, card.profileOverrides) };
}

/** The window the card's OWN art is drawn in (its front; a back face handed
 *  over as its own card — backPreviewData — reads the same way). It is the
 *  window the art gets once there is art: an empty slot is sized for it. */
export function faceArtWindow(card: CardPreviewData): ArtWindow {
  const { template, profile } = profileOf(card);
  const masterKey = frameMasterKey(
    profile,
    card.colorIdentity as ColorIdentity[] | undefined,
    card,
    card.frameStyle,
  );
  return windowOf(profile, artLayersFor(profile, masterKey, true).slot, { template, masterKey, rotation: 0 });
}

/** The inline second face's own art window (split, aftermath), or null when
 *  the frame has none (flip and adventure share the front's art). */
export function secondFaceArtWindow(card: CardPreviewData): ArtWindow | null {
  const { template, profile } = profileOf(card);
  const second = profile.secondFace;
  if (!second?.artSlot) return null;
  return windowOf(profile, second.artSlot, {
    template,
    masterKey: faceArtWindow(card).masterKey,
    rotation: second.rotation ?? 0,
  });
}

/** A double-faced card's back window: its own body and colour. Null for a
 *  card with no back body (a legacy back draws on the front's frame, so its
 *  window is the front's). */
export function backFaceArtWindow(card: CardPreviewData): ArtWindow | null {
  if (!backBodyOf(card)) return null;
  const back = backPreviewData(card);
  return back ? faceArtWindow({ ...back, profileOverrides: card.profileOverrides }) : null;
}

/** Every art window the creator's positioners show for a card. */
export function artPositionerWindows(card: CardPreviewData): {
  front: ArtWindow;
  second: ArtWindow | null;
  back: ArtWindow | null;
} {
  return {
    front: faceArtWindow(card),
    second: secondFaceArtWindow(card),
    back: backFaceArtWindow(card),
  };
}

// ---------------------------------------------------------------------------
// The positioner's surface.
// ---------------------------------------------------------------------------

/** The surface the positioner had before 3b.13: 5:4 for every frame. Kept
 *  for the drift table in the unit test. */
export const LEGACY_POSITIONER_ASPECT = 5 / 4;

/** The tallest the surface grows, in CSS px: a portrait window (a saga's
 *  0.41 side window, a full-art token) is fitted to this height and centred
 *  rather than running the panel off the screen. */
export const POSITIONER_MAX_HEIGHT_PX = 440;

/** The surface's CSS box for a window: as wide as its column lets it, never
 *  taller than `maxHeight`, always the window's aspect. */
export function positionerSurfaceStyle(
  aspect: number,
  maxHeight: number = POSITIONER_MAX_HEIGHT_PX,
): { aspectRatio: string; width: string } {
  const a = Number.isFinite(aspect) && aspect > 0 ? aspect : LEGACY_POSITIONER_ASPECT;
  return {
    aspectRatio: `${round4(a)} / 1`,
    width: `min(100%, ${Math.round(maxHeight * a)}px)`,
  };
}

/** "1266 × 924" — the smallest picture that fills the window sharp at HD. */
export function recommendedArtSize(window: Pick<ArtWindow, "width" | "height">): Size {
  return { width: Math.round(window.width), height: Math.round(window.height) };
}

const round4 = (v: number) => Math.round(v * 1e4) / 1e4;

/** The HD card is 1500 px across 2.5 in. */
export const HD_PPI = 600;
/** Under this the positioner says the picture may print soft. The item's
 *  bar is 300 ppi (TODO 3b.13 / 1.18); the line sits a little under it so
 *  Scryfall's own 626 × 457 crop on the classic window it was cut for (295)
 *  — the best art an import has — is not warned about on every import. */
export const SOFT_PRINT_PPI = 290;

/**
 * How sharp a picture is in its window: the picture's own px per printed
 * inch once it is fitted (cover) and zoomed — 600 means one picture px per
 * HD px. A 626 × 457 Scryfall crop on the borderless window (1500 × 1937)
 * is scaled 4.24×: 142 ppi. Null for an unknown picture size.
 */
export function artPrintPpi(
  window: Pick<ArtWindow, "width" | "height">,
  natural: Size | null | undefined,
  scale: number,
): number | null {
  if (!natural || natural.width <= 0 || natural.height <= 0) return null;
  const cover = Math.max(window.width / natural.width, window.height / natural.height);
  const zoom = Number.isFinite(scale) && scale > 0 ? scale : 1;
  return Math.round(HD_PPI / (cover * zoom));
}

// ---------------------------------------------------------------------------
// The drag: how far the picture moves on screen per unit of focal.
// ---------------------------------------------------------------------------

/**
 * One axis of the renderers' placement, as the positioner needs it: a point
 * of the picture drawn in a window `box` long, the covered picture `covered`
 * long, at zoom `scale`, sits at `f·box + (p − covered·f)·scale` — so one
 * unit of focal moves it by `box − covered·scale`. Returns the px a grabbed
 * point travels per unit of focal, SIGNED (negative: the picture moves
 * against the focal, the usual case of a picture larger than its window;
 * positive when it is zoomed out smaller than the window), or 0 when no
 * focal moves it on this axis.
 */
export function focalTravelPx(box: number, covered: number, scale: number): number {
  const travel = box - covered * scale;
  return Math.abs(travel) < 0.5 ? 0 : travel;
}

/** Both axes for a picture of `natural` size in a `box`-sized surface. */
export function focalTravel(box: Size, natural: Size, scale: number): { x: number; y: number } {
  if (natural.width <= 0 || natural.height <= 0) return { x: 0, y: 0 };
  const cover = Math.max(box.width / natural.width, box.height / natural.height);
  return {
    x: focalTravelPx(box.width, natural.width * cover, scale),
    y: focalTravelPx(box.height, natural.height * cover, scale),
  };
}
