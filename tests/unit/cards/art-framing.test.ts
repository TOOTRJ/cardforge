import { describe, expect, it } from "vitest";
import {
  cardCanvasPx,
  carryArtFraming,
  finishAvailableOn,
  planTreatmentSwitch,
  positionForCentre,
  rectPx,
  visibleArtCentre,
} from "@/lib/cards/art-framing";
import { artReachesCardEdge, getFrameProfile } from "@/lib/cards/template-layout";
import { FRAME_TEMPLATE_VALUES } from "@/types/card";

// ---------------------------------------------------------------------------
// Art framing survives a treatment switch (TODO 3.23). Both renderers draw
// the art object-fit: cover in the window at object-position focal%, then
// scale(s) about the focal point; the visible centre is the image point under
// the window's centre. A switch keeps it.
// ---------------------------------------------------------------------------

const m15 = getFrameProfile("m15");
const fullBleed = getFrameProfile("fullartland"); // 0/0/100/100, aspect 0.714
const saga = getFrameProfile("saga"); // a tall 0.41 window
const art = { width: 1600, height: 1200 }; // a landscape picture

/** An independent model of the renderers' CSS: where image point (u, v)
 *  lands in a window, in px from its top-left. */
function drawnAt(slot: { width: number; height: number }, pos: { focalX: number; focalY: number; scale: number }, u: number, v: number) {
  const c = Math.max(slot.width / art.width, slot.height / art.height);
  const dw = art.width * c;
  const dh = art.height * c;
  const ox = (slot.width - dw) * pos.focalX;
  const oy = (slot.height - dh) * pos.focalY;
  const px = ox + u * dw;
  const py = oy + v * dh;
  const fx = pos.focalX * slot.width;
  const fy = pos.focalY * slot.height;
  return { x: fx + (px - fx) * pos.scale, y: fy + (py - fy) * pos.scale };
}

describe("visibleArtCentre", () => {
  it("is the picture's centre for a centred position on any window", () => {
    for (const p of [m15, fullBleed, saga]) {
      const c = visibleArtCentre(rectPx(p.artSlot, p), art, { focalX: 0.5, focalY: 0.5, scale: 1.7 });
      expect(c.x).toBeCloseTo(0.5, 12);
      expect(c.y).toBeCloseTo(0.5, 12);
    }
  });

  it("matches the renderers' CSS: the point it names lands on the window's centre", () => {
    const slot = rectPx(m15.artSlot, m15);
    const pos = { focalX: 0.2, focalY: 0.8, scale: 1.4 };
    const c = visibleArtCentre(slot, art, pos);
    const at = drawnAt(slot, pos, c.x, c.y);
    expect(at.x).toBeCloseTo(slot.width / 2, 6);
    expect(at.y).toBeCloseTo(slot.height / 2, 6);
  });
});

describe("carryArtFraming", () => {
  it("keeps the visible centre across an M15 window → full-bleed switch, at the same zoom", () => {
    const pos = { focalX: 0.2, focalY: 0.35, scale: 1.5 };
    const before = visibleArtCentre(rectPx(m15.artSlot, m15), art, pos);
    const next = carryArtFraming({ from: m15, to: fullBleed, natural: art, position: pos });
    expect(next.scale).toBe(1.5);
    const after = visibleArtCentre(rectPx(fullBleed.artSlot, fullBleed), art, next);
    expect(after.x).toBeCloseTo(before.x, 3);
    expect(after.y).toBeCloseTo(before.y, 3);
    // The raw numbers had to change: reusing them re-crops the picture.
    const reused = visibleArtCentre(rectPx(fullBleed.artSlot, fullBleed), art, pos);
    expect(Math.abs(reused.x - before.x)).toBeGreaterThan(0.02);
  });

  it("round-trips back to the original framing", () => {
    const pos = { focalX: 0.3, focalY: 0.6, scale: 1.25 };
    const there = carryArtFraming({ from: m15, to: fullBleed, natural: art, position: pos });
    const back = carryArtFraming({ from: fullBleed, to: m15, natural: art, position: there });
    expect(back.focalX).toBeCloseTo(0.3, 3);
    expect(back.focalY).toBeCloseTo(0.6, 3);
    expect(back.scale).toBe(1.25);
  });

  it("carries onto a tall saga window too", () => {
    const pos = { focalX: 0.7, focalY: 0.5, scale: 2 };
    const before = visibleArtCentre(rectPx(m15.artSlot, m15), art, pos);
    const next = carryArtFraming({ from: m15, to: saga, natural: art, position: pos });
    const after = visibleArtCentre(rectPx(saga.artSlot, saga), art, next);
    expect(after.x).toBeCloseTo(before.x, 3);
    expect(after.y).toBeCloseTo(before.y, 3);
  });

  it("leaves a centred position, a same-aspect window and unknown art alone", () => {
    const centred = { focalX: 0.5, focalY: 0.5, scale: 1 };
    expect(carryArtFraming({ from: m15, to: fullBleed, natural: art, position: centred })).toEqual(centred);
    const pos = { focalX: 0.1, focalY: 0.9, scale: 1.3 };
    // m15artifact shares M15's window: the same object comes back.
    expect(carryArtFraming({ from: m15, to: getFrameProfile("m15artifact"), natural: art, position: pos })).toBe(pos);
    expect(carryArtFraming({ from: m15, to: fullBleed, natural: null, position: pos })).toBe(pos);
  });

  it("stops at the picture's edge when the centre can't be reached", () => {
    // The left edge of a very wide picture in the tall saga window shows a
    // point (u ≈ 0.05) the wide M15 window can't centre: the focal clamps
    // to 0 — the picture's edge — like the positioner's pan.
    const wide = { width: 4000, height: 1000 };
    const from = { focalX: 0, focalY: 0.5, scale: 1 };
    const u = visibleArtCentre(rectPx(saga.artSlot, saga), wide, from).x;
    expect(u).toBeCloseTo(314.25 / 6090, 3);
    const next = carryArtFraming({ from: saga, to: m15, natural: wide, position: from });
    expect(next).toEqual({ focalX: 0, focalY: 0.5, scale: 1 });
    const p = positionForCentre({ width: 100, height: 100 }, { width: 100, height: 100 }, { x: 0.9, y: 0.2 }, 1);
    // A square picture in a square window at zoom 1 cannot pan: centred.
    expect(p).toEqual({ focalX: 0.5, focalY: 0.5, scale: 1 });
  });

  it("measures landscape frames on the rotated canvas", () => {
    expect(cardCanvasPx(getFrameProfile("battle"))).toEqual({ width: 2100, height: 1500 });
    expect(cardCanvasPx(m15)).toEqual({ width: 1500, height: 2100 });
  });
});

describe("the Etched finish on edge-to-edge frames", () => {
  it("is hidden only where the art reaches the card's edge (fullartland today)", () => {
    const edge = FRAME_TEMPLATE_VALUES.filter((t) => artReachesCardEdge(getFrameProfile(t)));
    expect(edge).toEqual(["fullartland"]);
    expect(finishAvailableOn(fullBleed, "etched")).toBe(false);
    expect(finishAvailableOn(fullBleed, "foil")).toBe(true);
    expect(finishAvailableOn(m15, "etched")).toBe(true);
    // 4.32's borderless slot (art to three edges over the bottom bar).
    expect(finishAvailableOn({ artSlot: { topPct: 0, leftPct: 0, widthPct: 100, heightPct: 92.24 } }, "etched")).toBe(false);
  });

  it("is dropped by a switch onto such a frame, with the framing carried in the same plan", () => {
    const pos = { focalX: 0.25, focalY: 0.5, scale: 1 };
    const plan = planTreatmentSwitch({ from: m15, to: fullBleed, finish: "etched", natural: art, position: pos });
    expect(plan.finish).toBe("regular");
    expect(plan.position).toBeDefined();
    expect(planTreatmentSwitch({ from: fullBleed, to: m15, finish: "etched", natural: null, position: pos })).toEqual({});
    expect(planTreatmentSwitch({ from: m15, to: fullBleed, finish: "foil", natural: null, position: pos })).toEqual({});
  });
});
