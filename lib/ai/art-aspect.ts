// ---------------------------------------------------------------------------
// The shape of an AI card picture: the art window of the frame it lands on
// (TODO 4.48b, owner round 14 / 14b).
//
// Every AI card picture used to be asked for as "card" → aspectRatio "4:3"
// whatever the frame. FLUX.2 [flex] (the gateway's default image model) has
// no aspect-ratio input — it takes `width` / `height` and answers its
// default 1024 × 1024 otherwise (help.bfl.ai, "What aspect ratios and output
// dimensions are supported?") — so every picture on production is in fact
// SQUARE (measured 2026-10-21). A portrait window (a full-art token, the
// borderless frame, a walker, the full-art basics) and a tall saga window
// therefore cut most of a square picture away; the M15 window (1.37 : 1)
// cut a quarter of it.
//
// This module names the picture a frame wants, from the same sources both
// renderers read (lib/cards/art-positioner-window.ts's rule — never a second
// table): the face's art window, `artLayersFor(profile, master, true).slot`
// — where the art runs UNDER the frame as one picture (m15pw/c, the station
// pair) that slot is the under-frame rect itself.
//
// THE PIXEL BUDGET stays what a picture costs today: FLUX.2 is priced per
// megapixel, and BFL's megapixel is 1024 × 1024 — the default every picture
// is generated at now. A shape at or under that area costs the first
// megapixel's price, as today; more pixels (the HD bake's window is 1266 ×
// 924 on M15) would cost more, so the budget is never raised here. The
// landing still goes through fitArtToWindow() (TODO 3b.18): the picture
// fills its window, centred, whatever its exact shape.
//
// Pure maths; no renderer reads this file.
// ---------------------------------------------------------------------------

import { frameMasterKey, type FrameTypeInfo } from "@/components/cards/frame-layer";
import type { FrameAnatomyStyle } from "@/lib/cards/anatomy";
import { rectPx } from "@/lib/cards/art-framing";
import { normalizeFrameTemplate } from "@/lib/cards/card-display";
import { backBodyOf } from "@/lib/cards/faces";
import { artLayersFor, getFrameProfile } from "@/lib/cards/template-layout";
import type { CardBackFace, ColorIdentity } from "@/types/card";

/** What a picture's shape is read from: the frame a face draws on, and what
 *  picks its master (a colourless m15 card paints the see-through master,
 *  whose art runs under the whole frame). */
export type ArtFace = {
  template?: string | null;
  colorIdentity?: readonly ColorIdentity[] | readonly string[] | null;
  cardType?: string | null;
  supertype?: string | null;
  cost?: string | null;
  style?: FrameAnatomyStyle | null;
};

/** One generated picture's shape. */
export type ArtShape = {
  /** The window's own width ÷ height. */
  windowAspect: number;
  /** The px asked of the model: multiples of ART_PX_STEP, at most
   *  ART_PIXEL_BUDGET in area. */
  width: number;
  height: number;
  /** The nearest of ASPECT_RATIOS — for a model that takes only a ratio
   *  (an AI_IMAGE_MODEL override); FLUX.2 is sent width × height. */
  aspectRatio: `${number}:${number}`;
};

/** Today's picture, 1024 × 1024: BFL's own definition of one megapixel and
 *  the first-megapixel price. A shape never asks for more. */
export const ART_PIXEL_BUDGET = 1024 * 1024;

/** FLUX.2 sizes are multiples of 16 px (help.bfl.ai). */
export const ART_PX_STEP = 16;

/** The AI SDK's Black Forest Labs provider takes 256 – 1920 px a side for
 *  the FLUX.2 models (its `width` / `height` provider options). */
export const ART_PX_MIN = 256;
export const ART_PX_MAX = 1920;

/** The ratios a ratio-only model is offered, widest first: the common
 *  image-model ratios inside 3 : 7 – 7 : 3, the range the AI SDK's FLUX
 *  ratio input accepts (21 : 9 and 9 : 21 its ends); the saga's 0.417
 *  window lands on 9 : 21, the aftermath's 2.70 on 21 : 9. */
export const ASPECT_RATIOS = [
  "21:9",
  "16:9",
  "3:2",
  "4:3",
  "1:1",
  "3:4",
  "2:3",
  "9:16",
  "9:21",
] as const satisfies readonly `${number}:${number}`[];

const ratioValue = (ratio: string) => {
  const [w, h] = ratio.split(":").map(Number);
  return w / h;
};

/** How far (on a log scale, ≈ a share) a picture's shape may miss its
 *  window's: 1 % — the cover fit then trims at most ~1 % of one side. */
export const ASPECT_SLACK = 0.01;

/** The widest shape a size inside the side limits and the budget can take
 *  (1920 × 544 ≈ 3.5 : 1, and its tall twin). */
const MAX_SIZE_ASPECT = ART_PX_MAX / (Math.floor(ART_PIXEL_BUDGET / ART_PX_MAX / ART_PX_STEP) * ART_PX_STEP);

/** The width ÷ height of the box a face's picture is drawn in. */
export function artWindowAspect(face: ArtFace): number {
  const template = normalizeFrameTemplate(face.template ?? null);
  const profile = getFrameProfile(template);
  const type: FrameTypeInfo = {
    cardType: face.cardType ?? null,
    supertype: face.supertype ?? null,
    cost: face.cost ?? null,
  };
  const master = frameMasterKey(
    profile,
    (face.colorIdentity ?? null) as readonly ColorIdentity[] | null,
    type,
    face.style ?? null,
  );
  // With art. Where the picture runs under the frame as ONE picture (m15pw/c,
  // the station pair) the slot IS the under-frame rect; a see-through master
  // with a window of its own (m15/c, devoid) crops the window and the
  // under-frame layer from the same picture SEPARATELY, each a cover fit —
  // the window is the sharp, opaque view, so the picture takes its shape
  // (the creator's positioner reads the same box: faceArtWindow).
  const { slot } = artLayersFor(profile, master, true);
  const box = rectPx(slot, profile);
  return box.width / box.height;
}

/** The nearest ratio-only answer (measured on a log scale, so 2 : 1 and
 *  1 : 2 are equally far from square). */
export function nearestAspectRatio(aspect: number): (typeof ASPECT_RATIOS)[number] {
  let best: (typeof ASPECT_RATIOS)[number] = "1:1";
  let bestDistance = Infinity;
  for (const ratio of ASPECT_RATIOS) {
    const distance = Math.abs(Math.log(ratioValue(ratio) / aspect));
    if (distance < bestDistance) {
      best = ratio;
      bestDistance = distance;
    }
  }
  return best;
}

/**
 * The px a picture of `aspect` is asked for: on the 16 px grid, inside
 * 256 – 1920 a side, no larger in area than ART_PIXEL_BUDGET, and the
 * largest such size within ASPECT_SLACK of the window's shape. A shape the
 * side limits can't reach (past ≈ 3.5 : 1 — no frame's window is) is asked
 * at that end; the window then crops what is left.
 */
export function artShapeForAspect(aspect: number): ArtShape {
  const wanted = Number.isFinite(aspect) && aspect > 0 ? aspect : 1;
  // FLUX.2 takes any shape (help.bfl.ai); the side limits bound it at about
  // 1 : 4 and 4 : 1 inside the budget, so a far shape is asked at that end.
  const target = Math.min(MAX_SIZE_ASPECT, Math.max(1 / MAX_SIZE_ASPECT, wanted));
  // Every grid size within the budget whose shape is within ASPECT_SLACK of
  // the window's: the LARGEST of them (the most picture for the price);
  // where none is that close (never, on this grid), the closest shape.
  let width = 0;
  let height = 0;
  let closest = { width: 1024, height: 1024, distance: Infinity };
  for (let h = ART_PX_MIN; h <= ART_PX_MAX; h += ART_PX_STEP) {
    const wMax = Math.min(ART_PX_MAX, Math.floor(ART_PIXEL_BUDGET / h / ART_PX_STEP) * ART_PX_STEP);
    // The widths either side of the target shape at this height.
    const below = Math.floor((target * h) / ART_PX_STEP) * ART_PX_STEP;
    for (const w of [below, below + ART_PX_STEP]) {
      if (w < ART_PX_MIN || w > wMax) continue;
      const distance = Math.abs(Math.log(w / h / target));
      if (distance < closest.distance) closest = { width: w, height: h, distance };
      if (distance <= ASPECT_SLACK && w * h > width * height) {
        width = w;
        height = h;
      }
    }
  }
  if (width === 0) ({ width, height } = closest);
  return { windowAspect: wanted, width, height, aspectRatio: nearestAspectRatio(wanted) };
}

/** The picture a face on its frame wants. */
export function artShapeForFace(face: ArtFace): ArtShape {
  return artShapeForAspect(artWindowAspect(face));
}

/**
 * The picture a double-faced card's BACK wants: its own body and colour
 * (lib/cards/faces.ts backBodyOf) — a back with no body is drawn on the
 * front's frame, so it wants the front's.
 */
export function artShapeForBackFace(front: ArtFace, back: CardBackFace | null | undefined): ArtShape {
  const body = back
    ? backBodyOf({ frameStyle: { template: normalizeFrameTemplate(front.template ?? null) }, backFace: back })
    : null;
  if (!body || !back) return artShapeForFace(front);
  return artShapeForFace({
    template: body.template,
    colorIdentity: body.colorIdentity ?? front.colorIdentity,
    cardType: back.card_type ?? null,
    supertype: back.supertype ?? null,
    cost: back.cost ?? null,
  });
}
