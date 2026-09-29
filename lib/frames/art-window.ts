// ---------------------------------------------------------------------------
// Art-window coverage (TODO 7.6). A frame master is opaque except where the
// art shows through, and the renderers paint the art only inside the
// profile's art slot (lib/render/card-image.tsx; the preview's twin). A
// see-through pixel of the window that the slot doesn't cover shows the card
// root's #101015 instead of art — the hairlines and strips the Card
// Conjurer audit found (2026-09-25).
//
// The check, for every slot a profile paints — `artSlot`, and a second
// face's own `secondFace.artSlot`, which the renderers rotate in place by
// the face's `rotation` (a 90° / 270° slot's pixel box swaps its sides
// about its centre): flood-fill the master's see-through pixels
// (α < ART_WINDOW_ALPHA_MAX, 4-connected) from the slot's centre, and the
// slot must cover the fill's bounding box with ≥ ART_WINDOW_OVERSCAN_PCT of
// the card to spare on every side. Where the window runs to the card's own
// edge (an edge-to-edge treatment) the slot need only reach that edge — art
// past the card is nowhere; the edge itself is 7.7's contract
// (lib/frames/edge-contract.ts).
//
// See-through frames (TODO 4.17: `underFrameArt` — the colourless M15 and
// token masters, every devoid one) are asserted differently: the art runs
// under the whole frame there, so it is the under-frame rect, not the art
// slot, that must cover the window — and every pixel the see-through frame
// lets ≥ 2 % through (α < SEE_THROUGH_FRAME_ALPHA_MAX, anywhere on the card
// but the corner cut) — with the same overscan. (The exact crop still sits
// in the art slot; the frame's opaque window border hides the seam.)
//
// This module imports only the import-free lib/cards/card-corner.ts, with an
// explicit .ts specifier, like edge-contract.ts: scripts/import-cc-frames.mjs
// loads it through Node's type stripping and runs the same check on every
// master it builds, after the 2010→1500 downscale has anti-aliased the
// window edge. CI fetches the bucket masters (scripts/frames-fetch.mjs), so
// tests/unit/render/art-window-coverage.test.ts checks every template ×
// colour master there.
// ---------------------------------------------------------------------------

import { cardCornerRadiusPx } from "../cards/card-corner.ts";

/** "See-through" for the window's flood fill: α < 16 (of 255). */
export const ART_WINDOW_ALPHA_MAX = 16;
/** The cover must overscan the window by ≥ 0.05 % of the card on each side
 *  (0.75 px across, 1.05 px down a 1500 × 2100 master). */
export const ART_WINDOW_OVERSCAN_PCT = 0.05;
/** A see-through frame's body: every pixel that lets ≥ 2 % of what is under
 *  it through (α < 250) must have art under it. */
export const SEE_THROUGH_FRAME_ALPHA_MAX = 250;

/** A rectangle in card percent — a profile's art slot (structurally
 *  lib/cards/template-layout.ts's Rect). */
export type ArtWindowRect = { topPct: number; leftPct: number; widthPct: number; heightPct: number };

/** One art slot a profile paints: where, and how its face turns it. */
export type ArtWindowSlot = {
  /** "artSlot" or "secondFace.artSlot" — for the messages. */
  name: string;
  rect: ArtWindowRect;
  /** The face's rotation, in place about the slot's centre (0 for the
   *  front face). */
  rotation?: 0 | 90 | 180 | 270;
  /** A see-through master (4.17): the art also covers this rect UNDER the
   *  whole frame, and it — not `rect` — must cover the window and the
   *  see-through body. */
  underFrame?: ArtWindowRect | null;
};

/** The art slots a profile paints on one master: its `artSlot` (with the
 *  master's under-frame rect — `underFrameArtRect(profile, key)` — when the
 *  master is see-through) and a second face's own `secondFace.artSlot`. */
export function artWindowSlotsOf(
  profile: {
    artSlot: ArtWindowRect;
    secondFace?: { rotation: 0 | 90 | 180 | 270; artSlot?: ArtWindowRect };
  },
  underFrame: ArtWindowRect | null,
): ArtWindowSlot[] {
  const slots: ArtWindowSlot[] = [{ name: "artSlot", rect: profile.artSlot, rotation: 0, underFrame }];
  const second = profile.secondFace;
  if (second?.artSlot) slots.push({ name: "secondFace.artSlot", rect: second.artSlot, rotation: second.rotation });
  return slots;
}

/** A box in master pixels: x0/y0 inclusive, x1/y1 exclusive (pixel x covers
 *  [x, x + 1)). */
export type PixelBox = { x0: number; y0: number; x1: number; y1: number };

/** The pixel box a slot covers on a `width × height` master, after its
 *  in-place rotation. */
export function slotPixelBox(rect: ArtWindowRect, rotation: number, width: number, height: number): PixelBox {
  const cx = ((rect.leftPct + rect.widthPct / 2) / 100) * width;
  const cy = ((rect.topPct + rect.heightPct / 2) / 100) * height;
  let w = (rect.widthPct / 100) * width;
  let h = (rect.heightPct / 100) * height;
  if (rotation === 90 || rotation === 270) [w, h] = [h, w];
  return { x0: cx - w / 2, x1: cx + w / 2, y0: cy - h / 2, y1: cy + h / 2 };
}

/**
 * The see-through region (α < `alphaMax`, 4-connected) that contains the
 * pixel (x, y) of a straight-RGBA master: its bounding box and pixel count,
 * or null when that pixel itself is not see-through.
 */
export function seeThroughWindow(
  rgba: Uint8Array | Uint8ClampedArray,
  width: number,
  height: number,
  x: number,
  y: number,
  alphaMax = ART_WINDOW_ALPHA_MAX,
): (PixelBox & { pixels: number }) | null {
  if (x < 0 || y < 0 || x >= width || y >= height) return null;
  if (rgba[(y * width + x) * 4 + 3] >= alphaMax) return null;
  const seen = new Uint8Array(width * height);
  const stack = new Int32Array(width * height);
  let top = 0;
  stack[top++] = y * width + x;
  seen[y * width + x] = 1;
  let x0 = x;
  let x1 = x;
  let y0 = y;
  let y1 = y;
  let pixels = 0;
  const push = (j: number) => {
    if (!seen[j] && rgba[j * 4 + 3] < alphaMax) {
      seen[j] = 1;
      stack[top++] = j;
    }
  };
  while (top > 0) {
    const i = stack[--top];
    const px = i % width;
    const py = (i - px) / width;
    pixels += 1;
    if (px < x0) x0 = px;
    if (px > x1) x1 = px;
    if (py < y0) y0 = py;
    if (py > y1) y1 = py;
    if (px > 0) push(i - 1);
    if (px < width - 1) push(i + 1);
    if (py > 0) push(i - width);
    if (py < height - 1) push(i + width);
  }
  return { x0, x1: x1 + 1, y0, y1: y1 + 1, pixels };
}

/**
 * Every pixel of a master with α < `alphaMax`, anywhere on the card but
 * the one card corner's cut (lib/cards/card-corner.ts: pixels whose centre
 * lies past −0.5 px of the arc, where the mask thins the alpha): their
 * bounding box and count, or null when there are none.
 */
export function seeThroughBody(
  rgba: Uint8Array | Uint8ClampedArray,
  width: number,
  height: number,
  alphaMax = SEE_THROUGH_FRAME_ALPHA_MAX,
): (PixelBox & { pixels: number }) | null {
  const r = cardCornerRadiusPx(width, height);
  let x0 = width;
  let x1 = -1;
  let y0 = height;
  let y1 = -1;
  let pixels = 0;
  for (let y = 0; y < height; y += 1) {
    // The corner distance exactly as applyCardCornerMask measures it.
    const cy = y < r ? r - y - 0.5 : y >= height - r ? y - (height - r) + 0.5 : 0;
    for (let x = 0; x < width; x += 1) {
      if (rgba[(y * width + x) * 4 + 3] >= alphaMax) continue;
      const cx = x < r ? r - x - 0.5 : x >= width - r ? x - (width - r) + 0.5 : 0;
      if (cx > 0 && cy > 0 && Math.sqrt(cx * cx + cy * cy) - r > -0.5) continue;
      pixels += 1;
      if (x < x0) x0 = x;
      if (x > x1) x1 = x;
      if (y < y0) y0 = y;
      if (y > y1) y1 = y;
    }
  }
  return pixels ? { x0, x1: x1 + 1, y0, y1: y1 + 1, pixels } : null;
}

const fmt = (n: number) => (Math.round(n * 100) / 100).toString();

/** How `cover` misses covering `box` with the overscan (clamped to the
 *  card: a side where `box` reaches the card's edge only needs the cover to
 *  reach it too). Empty = covered. */
function coverMisses(cover: PixelBox, box: PixelBox, width: number, height: number): string[] {
  const overX = (ART_WINDOW_OVERSCAN_PCT / 100) * width;
  const overY = (ART_WINDOW_OVERSCAN_PCT / 100) * height;
  const need = {
    left: Math.max(0, box.x0 - overX),
    right: Math.min(width, box.x1 + overX),
    top: Math.max(0, box.y0 - overY),
    bottom: Math.min(height, box.y1 + overY),
  };
  const misses: string[] = [];
  if (cover.x0 > need.left) misses.push(`left ${fmt(cover.x0)} > ${fmt(need.left)}`);
  if (cover.x1 < need.right) misses.push(`right ${fmt(cover.x1)} < ${fmt(need.right)}`);
  if (cover.y0 > need.top) misses.push(`top ${fmt(cover.y0)} > ${fmt(need.top)}`);
  if (cover.y1 < need.bottom) misses.push(`bottom ${fmt(cover.y1)} < ${fmt(need.bottom)}`);
  return misses;
}

const describeBox = (b: PixelBox) => `${fmt(b.x0)}–${fmt(b.x1)} × ${fmt(b.y0)}–${fmt(b.y1)} px`;

/**
 * Every way a master's art windows escape the art that fills them — empty
 * when each slot (or, on a see-through master, its under-frame rect)
 * covers its window, and the see-through body, with the overscan to spare.
 * Build `slots` with artWindowSlotsOf.
 */
export function artWindowViolations(
  rgba: Uint8Array | Uint8ClampedArray,
  width: number,
  height: number,
  slots: readonly ArtWindowSlot[],
): string[] {
  const out: string[] = [];
  const spare = `with ${ART_WINDOW_OVERSCAN_PCT} % to spare`;
  for (const slot of slots) {
    const box = slotPixelBox(slot.rect, slot.rotation ?? 0, width, height);
    // The pixel under the slot's centre (1e-6 absorbs the % → px float error).
    const cx = Math.min(width - 1, Math.max(0, Math.floor((box.x0 + box.x1) / 2 + 1e-6)));
    const cy = Math.min(height - 1, Math.max(0, Math.floor((box.y0 + box.y1) / 2 + 1e-6)));
    const win = seeThroughWindow(rgba, width, height, cx, cy);
    if (!win) {
      const a = rgba[(cy * width + cx) * 4 + 3];
      out.push(`${slot.name}: the frame is α ${a} at the slot's centre (${cx},${cy}) — no see-through window there`);
      continue;
    }
    const cover = slot.underFrame ? slotPixelBox(slot.underFrame, 0, width, height) : box;
    const by = slot.underFrame ? "the under-frame art" : "the slot";
    const misses = coverMisses(cover, win, width, height);
    if (misses.length) {
      out.push(
        `${slot.name}: ${by} ${describeBox(cover)} doesn't cover the window ${describeBox(win)} ` +
          `(${win.pixels} px, α < ${ART_WINDOW_ALPHA_MAX}) ${spare}: ${misses.join(", ")}`,
      );
    }
    if (slot.underFrame) {
      const body = seeThroughBody(rgba, width, height);
      const bodyMisses = body ? coverMisses(cover, body, width, height) : [];
      if (body && bodyMisses.length) {
        out.push(
          `${slot.name}: the under-frame art ${describeBox(cover)} doesn't cover the see-through frame ` +
            `${describeBox(body)} (${body.pixels} px, α < ${SEE_THROUGH_FRAME_ALPHA_MAX}) ${spare}: ${bodyMisses.join(", ")}`,
        );
      }
    }
  }
  return out;
}

/**
 * Template × colour masters whose art windows escape their art today, and
 * the TODO items that fix each (measured 2026-09-29 on every git master
 * and every bucket master at the manifest's sha256; px on a 1500 × 2100
 * master, 2100 × 1500 for the landscape split and battle). The test asserts
 * they STILL fail (it.fails), so fixing one turns it red until it is struck
 * from this list — never loosen the check instead.
 */
export const ART_WINDOW_KNOWN_FAILURES: Readonly<
  Record<string, { keys: "all" | readonly string[]; todo: readonly string[]; why: string }>
> = {
  // The Card Conjurer M15 family: CC's window is 1 px wider on each side
  // and 1.4 / 1.6 px taller than the inherited artSlot 7.8/11.4/84.4×44.0.
  m15: {
    keys: "all",
    todo: ["4.4", "4.17a"],
    why:
      "w/u/b/r/g/m: window 116–1384 × 238–1165 vs slot 117–1383 × 239.4–1163.4 — a 1–1.6 px hairline on every side " +
      "(4.4 (2): artSlot = CC artBounds 7.67/11.29/84.76×44.29); c: see-through, as m15devoid (4.17a)",
  },
  m15artifact: { keys: "all", todo: ["4.4"], why: "the M15 hairline, 1–1.6 px on every side (4.4 (2): CC artBounds)" },
  m15land: { keys: "all", todo: ["4.4"], why: "the M15 hairline, 1–1.6 px on every side (4.4 (2): CC artBounds)" },
  m15snow: { keys: "all", todo: ["4.4"], why: "the M15 hairline, 1–1.6 px on every side (4.4 (2): CC artBounds)" },
  m15snowland: { keys: "all", todo: ["4.4"], why: "the M15 hairline, 1–1.6 px on every side (4.4 (2): CC artBounds)" },
  // See-through masters (4.17): UNDER_FRAME_RECT 4/4/92×92 starts at 84 px
  // down, but the see-through body runs from the border's inner edge at
  // 59 px — a 25 px band above the title bar (and 1–2 px down each side)
  // shows #101015 through a frame that is α 7–89 there.
  m15devoid: {
    keys: "all",
    todo: ["4.17a"],
    why: "see-through body 58–1443 × 59–1938 vs under-frame art 60–1440 × 84–2016: a 25 px dark band above the title bar",
  },
  m15token: {
    keys: ["c"],
    todo: ["4.17a"],
    why: "c: see-through body 59–1441 × 59–1949 vs under-frame art 60–1440 × 84–2016: a 25 px dark band above the title bar",
  },
  m15tokentext: {
    keys: ["c"],
    todo: ["4.17a"],
    why: "c: see-through body 59–1441 × 59–1949 vs under-frame art 60–1440 × 84–2016: a 25 px dark band above the title bar",
  },
  m15tokenartifact: {
    keys: ["w", "u", "b", "r", "g", "m"],
    todo: ["4.53"],
    why: "the artifact-dress window ends at 1709 px, exactly the slot's bottom: no overscan (4.53 (e): CC artBounds)",
  },
  m15fullartland: {
    keys: "all",
    todo: ["4.39"],
    why: "slot top 2.81 % = 59.01 px vs the window from 60 px: 0.99 px of overscan, 1.05 needed",
  },
  m15textless: {
    keys: "all",
    todo: ["4.35"],
    why: "window 118–1379 × 239–1935 vs slot 115.5–1375.5 × 237.3–1932: 3.5 px right and 3 px bottom (4.35 (2): re-source)",
  },
  m15textlessland: {
    keys: "all",
    todo: ["4.35"],
    why: "window 118–1379 × 239–1935 vs slot 115.5–1375.5 × 237.3–1932: 3.5 px right and 3 px bottom (4.35 (2): re-source)",
  },
  // The MSE layout templates — 4.21 re-sources all six from Card Conjurer.
  split: {
    keys: "all",
    todo: ["4.21"],
    why: "both windows start at 200–202 px, the slots at 220.5: a 1.2 % H strip on each half (4.21's interim fix: art top 14.7 → 13.4)",
  },
  saga: {
    keys: "all",
    todo: ["4.21"],
    why: "window ≈ 725–1382 × 234–1760 vs slot 751.5–1380 × 237.3–1759.8: 1.5 px at the divider, a hairline along the top to x 715, 1–4 px elsewhere",
  },
  flip: { keys: "all", todo: ["4.21"], why: "window ≈ 113–1384 × 647–1394 vs slot 115.5–1380 × 651–1390.2: 2–5 px on every side" },
  adventure: {
    keys: "all",
    todo: ["4.21"],
    why: "window 125–1379 × 240–1163 vs slot 117–1383 × 239.4–1163.4: 0.6 / 0.4 px of overscan top and bottom, 1.05 needed",
  },
  aftermath: {
    keys: "all",
    todo: ["4.21"],
    why: "top window ends at 1383 px (1384 on one colour), the slot at 1383; the sideways window ends 0.4 px inside its rotated slot",
  },
  battle: { keys: "all", todo: ["4.21"], why: "borderless PNG: the window runs into the transparent ring, the whole card (7.7; 4.21's interim: full-bleed artSlot)" },
  // Transparent rings and bands (7.7's known failures) the window leaks into,
  // and the showcase windows cut wider than their slots.
  lotr: { keys: "all", todo: ["4.35", "4.11"], why: "the ring 9.8–90.5 × 11.24–55.62 % vs slot 14–86 × 13–58 % (4.35 A8 / 4.11 re-measure)" },
  lotrscroll: { keys: "all", todo: ["4.35"], why: "borderless scroll PNG: the window runs into the transparent ring, the whole card (4.35)" },
  avatar: { keys: "all", todo: ["4.35"], why: "the window runs into the transparent outer band: 0–1500 × 0–1160 (4.35 A8)" },
  bloomburrow: { keys: "all", todo: ["4.35"], why: "the window runs into the transparent sides: 0–1500 × 236–1182 (4.35 A8)" },
  bloomanime: { keys: "all", todo: ["4.35"], why: "transparent outer ring: the window is the whole card, the slot inset 2.5/3.5/93×92 (4.35)" },
  tarkirghostfire: { keys: "all", todo: ["4.35"], why: "transparent outer ring: the window is the whole card (4.35)" },
  tarkirdraconic: {
    keys: "all",
    todo: ["4.11"],
    why: "the see-through gaps between the dragon ornaments run to 67–1449 px, 68–84 px past the slot 135–1365 (4.11 re-measure)",
  },
  expeditionland: {
    keys: ["u", "b", "r", "g"],
    todo: ["4.35", "4.11"],
    why: "b/g: no ring, the window is the whole card (4.35 (3)); u/r: the arch's apex at 239 px vs slot top 241.5 (4.11 re-source)",
  },
  extendedart: { keys: ["m"], todo: ["4.7"], why: "m: the window starts at 250 px, the slot at 249.9: 0.1 px of overscan, 1.05 needed (4.7: CC extended)" },
  modern: { keys: "all", todo: ["4.10"], why: "window bottom 1163–1164 px vs slot 1163.4: 0.4 px of overscan to 0.6 px exposed (4.10: CC 8th)" },
  modernland: { keys: "all", todo: ["4.10"], why: "window bottom 1164 px vs slot 1163.4: 0.6 px exposed (4.10: CC 8th)" },
  alphatoken: { keys: "all", todo: ["4.54"], why: "window 162–1339 × 187–1295 vs slot 150–1350 × 189–1291.5: 2 px top, 3.5 px bottom (4.54 retires it)" },
};

export function isKnownArtWindowFailure(template: string, key: string): boolean {
  const entry = ART_WINDOW_KNOWN_FAILURES[template];
  return Boolean(entry && (entry.keys === "all" || entry.keys.includes(key)));
}
