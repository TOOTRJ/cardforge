import { STATION } from "@/lib/cards/station";
import type { FrameProfile, Rect } from "@/lib/cards/template-layout";

// ---------------------------------------------------------------------------
// The regions a parity case is compared in (TODO 3.11) — the profile's own
// slots, as fractions of the card, so a region means the same thing in both
// renderers and on every template:
//
//   title   the name band           cost    the cost's end of that band
//   type    the type band           symbol  the set symbol's end of it
//   art     the art window          rules   the rules box
//   stat    the P/T, loyalty or defense plate (grown: the plate overhangs)
//   footer  the artist / collector / © band along the bottom edge
//   strip   a modal face's flipside strip
//   tiers   the station frame's box with its badges and plate
//   second.* / page.*   an UNTURNED second face (split's right half) and the
//           adventure page
//
// A turned second face (flip, aftermath) and every piece without a slot (a
// crown, the holofoil stamp, the saga's rail, a rider) are held by the
// whole-card tiles instead (tests/parity/compare.ts worstTile).
// ---------------------------------------------------------------------------

/** A region as fractions (0–1) of the card's width and height. */
export type ParityRegion = { name: string; x: number; y: number; w: number; h: number };

function of(name: string, rect: Rect, grow = 0): ParityRegion {
  const x = Math.max(0, rect.leftPct / 100 - grow);
  const y = Math.max(0, rect.topPct / 100 - grow);
  const right = Math.min(1, (rect.leftPct + rect.widthPct) / 100 + grow);
  const bottom = Math.min(1, (rect.topPct + rect.heightPct) / 100 + grow);
  return { name, x, y, w: right - x, h: bottom - y };
}

/** The right-hand part of a band (the cost row, the set symbol). */
function endOf(name: string, rect: Rect, share: number): ParityRegion {
  const band = of(name, rect);
  return { ...band, x: band.x + band.w * (1 - share), w: band.w * share };
}

/** The named regions of a profile (the card's own slots only). */
export function parityRegions(profile: FrameProfile): ParityRegion[] {
  const out: ParityRegion[] = [
    of("title", profile.title.rect),
    profile.costRect ? of("cost", profile.costRect) : endOf("cost", profile.title.rect, 0.3),
    of("art", profile.artSlot),
    of("type", profile.type.rect),
    profile.symbolRect ? of("symbol", profile.symbolRect, 0.004) : endOf("symbol", profile.type.rect, 0.12),
    of("rules", profile.rules.rect),
  ];
  // The station frame's box (TODO 4.27a): the tier washes with the badges
  // on its left pinline and the plate past its right one — wider than the
  // rules slot, which holds the text alone.
  if (profile.tiers) {
    const { box, badge, plate } = STATION;
    const left = badge.cx - badge.rRing;
    out.push({ name: "tiers", x: left / 1500, y: box.top / 2100, w: (plate.x1 - left) / 1500, h: (box.bottom - box.top) / 2100 });
  }
  const stat = profile.pt ?? profile.loyalty ?? profile.defense;
  if (stat) out.push(of("stat", stat.rect, 0.012));
  // The bottom band: the footer, the collector line, the brand mark and a
  // © slot all sit in the last 7.5 % of a portrait card (a landscape card's
  // is its bottom 10 %); a profile's own footer rect names it more tightly
  // but leaves the mark out.
  const landscape = profile.orientation === "landscape";
  out.push({ name: "footer", x: 0.04, y: landscape ? 0.9 : 0.925, w: 0.92, h: landscape ? 0.085 : 0.065 });
  if (profile.flipside) {
    out.push(of("strip", profile.flipside.keepOut));
  }
  if (profile.secondFace && profile.secondFace.rotation === 0) {
    out.push(of("second.title", profile.secondFace.title.rect));
    out.push(of("second.type", profile.secondFace.type.rect));
    out.push(of("second.rules", profile.secondFace.rules.rect));
    if (profile.secondFace.artSlot) out.push(of("second.art", profile.secondFace.artSlot));
  }
  if (profile.adventure) {
    out.push(of("page.title", profile.adventure.title.rect));
    out.push(of("page.rules", profile.adventure.rules.rect));
  }
  // A slot a profile leaves empty (a textless frame's zero-height rules
  // box) is nothing to compare.
  return out.filter((r) => r.w > 0.01 && r.h > 0.005);
}
