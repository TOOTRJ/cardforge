// ---------------------------------------------------------------------------
// Face tabs, part 2 (TODO 5.14): where each PART of a one-picture two-part
// card sits on that picture.
//
// A split, aftermath, adventure or flip card is ONE picture with both parts
// on it, so the creator shows its single live preview and marks the part
// the selected tab edits with an outline (components/creator/
// part-outline.tsx). The boxes come from the frame profile both renderers
// draw from — never a second set of numbers:
//
//   second part   `profile.secondFace` (split's right half, aftermath's
//                 sideways half, flip's upside-down side): the union of its
//                 name, type line, rules, P/T plate and art window, each
//                 turned in place as the renderers turn it (unturnedRect);
//                 `profile.adventure`: the spell's name, type line and page.
//   first part    the union of the front's own name, type line, rules and
//                 P/T plate — and its art window, except where the two
//                 parts share ONE picture that belongs to neither (flip:
//                 the art sits between the two sides).
//
// An adventure's creature is the whole card but the spell's page, so its
// box holds that page too: the outline says "the card", the spell's says
// "this page".
//
// Pure: no React. A creator overlay only — nothing here is read by the
// bake, the OG image or the parity harness.
// ---------------------------------------------------------------------------

import { unturnedRect, type FrameProfile, type Rect } from "@/lib/cards/template-layout";

export type PartRects = { front: Rect; back: Rect };

/** Air between a part's slots and its outline, in % of the card's width. */
const PAD_PCT_OF_WIDTH = 1.2;

function union(rects: readonly Rect[]): Rect {
  const left = Math.min(...rects.map((r) => r.leftPct));
  const top = Math.min(...rects.map((r) => r.topPct));
  const right = Math.max(...rects.map((r) => r.leftPct + r.widthPct));
  const bottom = Math.max(...rects.map((r) => r.topPct + r.heightPct));
  return { leftPct: left, topPct: top, widthPct: right - left, heightPct: bottom - top };
}

/** Grown by the outline's air and kept on the card. */
function padded(rect: Rect, aspect: number): Rect {
  const padX = PAD_PCT_OF_WIDTH;
  // The same px down as across: a % of the height is `aspect` times shorter.
  const padY = PAD_PCT_OF_WIDTH / aspect;
  const left = Math.max(0.5, rect.leftPct - padX);
  const top = Math.max(0.5 / aspect, rect.topPct - padY);
  const right = Math.min(99.5, rect.leftPct + rect.widthPct + padX);
  const bottom = Math.min(100 - 0.5 / aspect, rect.topPct + rect.heightPct + padY);
  return { leftPct: left, topPct: top, widthPct: right - left, heightPct: bottom - top };
}

const statBox = (slot: { rect: Rect; plateRect?: Rect } | undefined): Rect[] =>
  slot ? [slot.plateRect ?? slot.rect] : [];

/** The two parts' boxes on the card (percent of its width / height), or
 *  null for a frame that paints no second part. */
export function partOutlineRects(profile: FrameProfile): PartRects | null {
  // Height over width, as the renderers' `aspect` (a landscape split: 5/7).
  const aspect = profile.orientation === "landscape" ? 5 / 7 : 7 / 5;
  const second = profile.secondFace;
  const adventure = profile.adventure;
  if (!second && !adventure) return null;

  const frontSlots: Rect[] = [profile.title.rect, profile.type.rect, profile.rules.rect, ...statBox(profile.pt)];
  // One picture that belongs to neither part (flip) stays outside both.
  const sharedArt = Boolean(second) && !second?.artSlot;
  if (!sharedArt) frontSlots.push(profile.artSlot);

  let backSlots: Rect[];
  if (second) {
    const turn = (rect: Rect) => unturnedRect(rect, second.rotation, aspect);
    backSlots = [second.title.rect, second.type.rect, second.rules.rect, ...statBox(second.pt)].map(turn);
    if (second.artSlot) backSlots.push(turn(second.artSlot));
  } else {
    backSlots = [adventure!.title.rect, adventure!.type.rect, adventure!.rules.rect];
  }
  return { front: padded(union(frontSlots), aspect), back: padded(union(backSlots), aspect) };
}

/** True when the frame gives its second part a picture of its own (split's
 *  right half, aftermath's sideways half). An adventure's spell and a flip
 *  card's other side have none: their tab never asks for artwork. */
export function secondPartHasOwnArt(profile: FrameProfile): boolean {
  return Boolean(profile.secondFace?.artSlot);
}
