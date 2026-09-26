// ---------------------------------------------------------------------------
// Art framing across a treatment switch (TODO 3.23, with 3b.13).
//
// A card's art position is relative to its frame's art window: both
// renderers draw the art `object-fit: cover` in the window, at
// `object-position: focalX% focalY%`, then `scale(s)` about that same focal
// point (components/cards/card-preview.tsx ArtImage, lib/render/card-image.tsx
// — the same CSS in both). So when a card moves between a 1.37 M15 window and
// a 0.77 full-bleed slot, the SAME numbers crop a different part of the
// picture: an off-centre subject slides out of frame.
//
// This module keeps what the user framed: the image point under the window's
// centre (the "visible centre") is carried to the new window, at the same
// zoom. A centred position (0.5, 0.5) carries to itself on every window, and
// windows of the same aspect never change the numbers. It is pure maths;
// the creator applies it when the user changes the frame.
// ---------------------------------------------------------------------------

import { artReachesCardEdge, type FrameProfile, type Rect } from "@/lib/cards/template-layout";
import type { ArtPosition, CardFinish } from "@/types/card";

export type Size = { width: number; height: number };

/** The renderers' clamps (card-preview.tsx / card-image.tsx). */
const SCALE_MIN = 0.5;
const SCALE_MAX = 4;
/** Rounded like the art positioner's writes — enough for a sub-pixel
 *  match at 1500 px and stable across repeated switches. */
const PRECISION = 1e4;

const clamp = (v: number, lo: number, hi: number) => Math.min(hi, Math.max(lo, v));
const round = (v: number) => Math.round(v * PRECISION) / PRECISION;

/** The HD canvas a profile renders on (portrait 1500 × 2100, landscape
 *  2100 × 1500) — the rects are percent of it. */
export function cardCanvasPx(profile: Pick<FrameProfile, "orientation">): Size {
  return profile.orientation === "landscape" ? { width: 2100, height: 1500 } : { width: 1500, height: 2100 };
}

/** A rect's size in px on the profile's HD canvas. */
export function rectPx(rect: Rect, profile: Pick<FrameProfile, "orientation">): Size {
  const card = cardCanvasPx(profile);
  return { width: (rect.widthPct / 100) * card.width, height: (rect.heightPct / 100) * card.height };
}

/** One axis of the renderers' art placement: window length `S`, the
 *  covered image length `D`, focal `f` (0–1) and zoom `s`. Returns the image
 *  coordinate (0–1) under the window's centre. */
function centreOnAxis(S: number, D: number, f: number, s: number): number {
  // object-position puts the image's left edge at (S − D)·f; scale(s) about
  // the focal point f·S maps a drawn point q back to f·S + (q − f·S)/s.
  const drawn = f * S + (S / 2 - f * S) / s;
  return (drawn - (S - D) * f) / D;
}

/** The inverse: the focal (0–1) that puts image coordinate `u` under the
 *  window's centre at zoom `s`, or null when no focal moves it (the image
 *  exactly spans the window on this axis at this zoom). */
function focalOnAxis(S: number, D: number, u: number, s: number): number | null {
  const denom = D - S / s;
  if (Math.abs(denom) < 1e-9 * Math.max(S, D)) return null;
  return (u * D - (0.5 * S) / s) / denom;
}

function coverSize(slot: Size, natural: Size): Size {
  const c = Math.max(slot.width / natural.width, slot.height / natural.height);
  return { width: natural.width * c, height: natural.height * c };
}

/** The image point (0–1 on each axis) under the centre of a `slot`-sized
 *  window for an image of `natural` size at `position`. */
export function visibleArtCentre(slot: Size, natural: Size, position: ArtPosition): { x: number; y: number } {
  const d = coverSize(slot, natural);
  const s = clamp(position.scale ?? 1, SCALE_MIN, SCALE_MAX);
  return {
    x: centreOnAxis(slot.width, d.width, clamp(position.focalX ?? 0.5, 0, 1), s),
    y: centreOnAxis(slot.height, d.height, clamp(position.focalY ?? 0.5, 0, 1), s),
  };
}

/** The position that puts image point `centre` under the window's centre at
 *  zoom `scale` (clamped to the focal range: past it the picture's edge
 *  stops the pan, as it does in the art positioner). */
export function positionForCentre(
  slot: Size,
  natural: Size,
  centre: { x: number; y: number },
  scale: number,
): ArtPosition {
  const d = coverSize(slot, natural);
  const s = clamp(scale, SCALE_MIN, SCALE_MAX);
  const fx = focalOnAxis(slot.width, d.width, centre.x, s);
  const fy = focalOnAxis(slot.height, d.height, centre.y, s);
  return {
    focalX: round(clamp(fx ?? 0.5, 0, 1)),
    focalY: round(clamp(fy ?? 0.5, 0, 1)),
    scale: round(s),
  };
}

/**
 * Carry a card's art framing from one frame's art window to another's
 * (TODO 3.23): the same image point stays under the window's centre, at the
 * same zoom. Returns `position` itself when the windows share an aspect
 * (nothing to re-frame) or the art's size is unknown.
 */
export function carryArtFraming({
  from,
  to,
  natural,
  position,
}: {
  from: Pick<FrameProfile, "artSlot" | "orientation">;
  to: Pick<FrameProfile, "artSlot" | "orientation">;
  natural: Size | null | undefined;
  position: ArtPosition;
}): ArtPosition {
  if (!natural || natural.width <= 0 || natural.height <= 0) return position;
  const a = rectPx(from.artSlot, from);
  const b = rectPx(to.artSlot, to);
  if (Math.abs(a.width / a.height - b.width / b.height) < 1e-6) return position;
  const centre = visibleArtCentre(a, natural, position);
  return positionForCentre(b, natural, centre, position.scale ?? 1);
}

/**
 * What the creator changes when the user moves a card to another frame:
 * the art framing carried to the new window (carryArtFraming), and a finish
 * the new frame can't show dropped — Etched masks by the frame's luminance
 * and all but vanishes on an edge-to-edge treatment (artReachesCardEdge)
 * until the etched frame treatment (4.28). Only the keys that change are
 * returned.
 */
export function planTreatmentSwitch({
  from,
  to,
  finish,
  natural,
  position,
}: {
  from: Pick<FrameProfile, "artSlot" | "orientation">;
  to: Pick<FrameProfile, "artSlot" | "orientation">;
  finish: CardFinish | null | undefined;
  natural: Size | null | undefined;
  position: ArtPosition | null | undefined;
}): { position?: ArtPosition; finish?: CardFinish } {
  const out: { position?: ArtPosition; finish?: CardFinish } = {};
  if (finish === "etched" && !finishAvailableOn(to, finish)) out.finish = "regular";
  if (position) {
    const carried = carryArtFraming({ from, to, natural, position });
    if (carried !== position) out.position = carried;
  }
  return out;
}

/** Whether a frame can show a finish (TODO 3.23): Etched is hidden on
 *  edge-to-edge treatments until 4.28. */
export function finishAvailableOn(
  profile: Pick<FrameProfile, "artSlot">,
  finish: CardFinish | null | undefined,
): boolean {
  return !(finish === "etched" && artReachesCardEdge(profile));
}
