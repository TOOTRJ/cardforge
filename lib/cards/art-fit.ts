// ---------------------------------------------------------------------------
// The automatic fit of a picture to a face's art window (TODO 3b.18).
//
// Both renderers draw a face's art `object-fit: cover` in its window, at
// `object-position: focalX% focalY%`, then `scale(s)` about that point
// (lib/cards/art-positioner-window.ts names the window). So the stored
// `scale` is a zoom RELATIVE TO COVER: at 1 the picture exactly fills the
// window on one axis and overflows on the other; under 1 it is smaller than
// the window on at least one axis and empty space shows on the card.
//
// The fit (owner 2026-10-09): keep FILLING the window — never bands, never a
// fill behind the picture — and show the best part of it, starting on the
// CENTRE. That is zoom 1 at focal (0.5, 0.5) for every window and every
// picture: the numbers a new picture has always been given. A detected
// subject may move the focal later; that is why the rule lives in this ONE
// function and takes the window and the picture, and why every place a
// picture lands (upload, paste, a real card's art, an import, an AI picture,
// a remix) and every re-fit on a frame, kind, colour or face change asks it
// instead of writing the three numbers.
//
// "Untouched" is read from the stored numbers, never guessed and never a
// second flag to keep in step: a picture is on its automatic fit exactly
// when its position EQUALS the fit for its window (isArtFitted). Anything
// else was set by hand — a drag, a nudge, a zoom — and is never replaced:
// 3.23's carry (lib/cards/art-framing.ts) keeps what the maker framed. A
// stored card therefore counts as hand-set unless its numbers are exactly
// the fit, and a card whose numbers ARE the fit is re-fitted to the same
// numbers: nothing stored changes behind an owner's back.
//
// Pure maths; no renderer reads this file.
// ---------------------------------------------------------------------------

import type { Size } from "@/lib/cards/art-framing";
import type { ArtPosition } from "@/types/card";

/** The box a face's art is drawn in (an ArtWindow's own px, or any box of
 *  the same aspect). */
export type FitWindow = { width: number; height: number };

/** The zoom at which a picture exactly covers its window — the renderers'
 *  `scale` is relative to it. Under it, empty space shows in the window. */
export const COVER_ZOOM = 1;

/** Stored positions are rounded to 4 places (art-framing.ts PRECISION); two
 *  positions closer than this bake the same picture. */
const SAME = 5e-5;

const usable = (box: FitWindow | Size | null | undefined): box is FitWindow =>
  Boolean(box && box.width > 0 && box.height > 0);

/**
 * The position a picture gets by itself in a window: it fills the window
 * (cover) and shows its centre.
 *
 * `window` and `natural` are what a better choice of the part to show will
 * read (a detected subject, TODO 3b.18's "later"); a picture or a window of
 * unknown size gets the same centred cover, which needs neither.
 */
export function fitArtToWindow(
  // eslint-disable-next-line @typescript-eslint/no-unused-vars -- the rule's inputs; see above
  window?: FitWindow | null,
  // eslint-disable-next-line @typescript-eslint/no-unused-vars
  natural?: Size | null,
): Required<ArtPosition> {
  return { focalX: 0.5, focalY: 0.5, scale: COVER_ZOOM };
}

/** A stored position with the renderers' defaults for the keys it leaves
 *  out (`{}` is a centred cover in both renderers). */
function numbersOf(position: ArtPosition | null | undefined): Required<ArtPosition> {
  return {
    focalX: position?.focalX ?? 0.5,
    focalY: position?.focalY ?? 0.5,
    scale: position?.scale ?? COVER_ZOOM,
  };
}

/** Whether two positions draw the same picture (a missing key is its
 *  default). */
export function sameArtPosition(
  a: ArtPosition | null | undefined,
  b: ArtPosition | null | undefined,
): boolean {
  const p = numbersOf(a);
  const q = numbersOf(b);
  return (
    Math.abs(p.focalX - q.focalX) < SAME &&
    Math.abs(p.focalY - q.focalY) < SAME &&
    Math.abs(p.scale - q.scale) < SAME
  );
}

/**
 * Whether a picture is on its automatic fit in `window` — "untouched". True
 * only when the numbers equal the fit; every other position was set by hand
 * and is never re-fitted.
 */
export function isArtFitted(
  position: ArtPosition | null | undefined,
  window?: FitWindow | null,
  natural?: Size | null,
): boolean {
  return sameArtPosition(position, fitArtToWindow(window, natural));
}

/** Whether the picture fills its window at this zoom (no empty space on the
 *  card). The renderers clamp the zoom to 0.5 – 4; anything under cover
 *  leaves the window part empty on at least one axis. */
export function artFillsWindow(position: ArtPosition | null | undefined): boolean {
  return numbersOf(position).scale >= COVER_ZOOM - SAME;
}

/**
 * The share of the picture's width and height the window shows at `scale`
 * (0–1 each; 1 = that whole side is in view). A 3 : 1 panorama on a saga's
 * 0.417 window shows 14 % of its width at the fit — filled, but a sliver:
 * the positioner says so. Null for an unknown size.
 */
export function visibleArtShare(
  window: FitWindow | null | undefined,
  natural: Size | null | undefined,
  scale: number = COVER_ZOOM,
): { x: number; y: number } | null {
  if (!usable(window) || !usable(natural)) return null;
  const cover = Math.max(window.width / natural.width, window.height / natural.height);
  const zoom = Number.isFinite(scale) && scale > 0 ? scale : COVER_ZOOM;
  return {
    x: Math.min(1, window.width / (natural.width * cover * zoom)),
    y: Math.min(1, window.height / (natural.height * cover * zoom)),
  };
}

/**
 * What a picture's position becomes when its window changes (another frame,
 * kind, colour or face body) while the picture stays:
 *
 *   untouched (on the old window's fit)  → the NEW window's fit;
 *   set by hand                          → `carry(position)`, 3.23's rule
 *                                          for that face, or the position
 *                                          itself where no carry applies.
 *
 * Returns `position` itself (the same object) when nothing changes, so a
 * caller writes only on a real change.
 */
export function refitArtForWindow({
  from,
  to,
  natural,
  position,
  carry,
}: {
  from: FitWindow | null | undefined;
  to: FitWindow | null | undefined;
  natural?: Size | null;
  position: ArtPosition;
  carry?: (position: ArtPosition) => ArtPosition;
}): ArtPosition {
  if (!isArtFitted(position, from, natural)) return carry ? carry(position) : position;
  const fitted = fitArtToWindow(to, natural);
  return sameArtPosition(fitted, position) ? position : fitted;
}
