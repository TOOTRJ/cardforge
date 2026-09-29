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
// Translucent frame parts (α < SEE_THROUGH_FRAME_ALPHA_MAX: a text box or
// type bar the art is meant to show through) are held to the same art: each
// 4-connected translucent region with a pixel inside the slot must lie
// inside it, give or take TRANSLUCENT_RIM_PCT (a window's or a bar's
// anti-aliased rim). One that runs on past the slot shows the art through
// part of it and #101015 through the rest — a hard seam across the text box
// (nyx at 81.2 %, fullart's last 31 px, m15pw/c's sides and type bar).
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
/** How far a translucent region the art shows through may run past the art
 *  that fills it — its anti-aliased rim: 0.2 % of the card (3 px across,
 *  4.2 px down a 1500 × 2100 master). Every rim measured on 2026-09-29 is
 *  ≤ 2 px; every seam ≥ 13.5 px. */
export const TRANSLUCENT_RIM_PCT = 0.2;

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
 * 1 for every pixel of a master with α < `alphaMax`, anywhere on the card
 * but the one card corner's cut (lib/cards/card-corner.ts: pixels whose
 * centre lies past −0.5 px of the arc, where the mask thins the alpha — the
 * corner distance exactly as applyCardCornerMask measures it, in the same
 * four corner boxes).
 */
function translucentMask(rgba: Uint8Array | Uint8ClampedArray, width: number, height: number, alphaMax: number): Uint8Array {
  const mask = new Uint8Array(width * height);
  for (let i = 0; i < mask.length; i += 1) if (rgba[i * 4 + 3] < alphaMax) mask[i] = 1;
  const r = cardCornerRadiusPx(width, height);
  const nearX = Math.min(Math.ceil(r), width);
  const farX = Math.max(nearX, Math.ceil(width - r));
  const nearY = Math.min(Math.ceil(r), height);
  const farY = Math.max(nearY, Math.ceil(height - r));
  const cut = (y0: number, y1: number, x0: number, x1: number) => {
    for (let y = y0; y < y1; y += 1) {
      const cy = y < r ? r - y - 0.5 : y >= height - r ? y - (height - r) + 0.5 : 0;
      for (let x = x0; x < x1; x += 1) {
        const cx = x < r ? r - x - 0.5 : x >= width - r ? x - (width - r) + 0.5 : 0;
        if (cx > 0 && cy > 0 && Math.sqrt(cx * cx + cy * cy) - r > -0.5) mask[y * width + x] = 0;
      }
    }
  };
  cut(0, nearY, 0, nearX);
  cut(0, nearY, farX, width);
  cut(farY, height, 0, nearX);
  cut(farY, height, farX, width);
  return mask;
}

/**
 * Every pixel of a master with α < `alphaMax`, anywhere on the card but
 * the one card corner's cut (translucentMask): their bounding box and
 * count, or null when there are none.
 */
export function seeThroughBody(
  rgba: Uint8Array | Uint8ClampedArray,
  width: number,
  height: number,
  alphaMax = SEE_THROUGH_FRAME_ALPHA_MAX,
): (PixelBox & { pixels: number }) | null {
  const mask = translucentMask(rgba, width, height, alphaMax);
  let x0 = width;
  let x1 = -1;
  let y0 = height;
  let y1 = -1;
  let pixels = 0;
  for (let y = 0; y < height; y += 1) {
    for (let x = 0; x < width; x += 1) {
      if (!mask[y * width + x]) continue;
      pixels += 1;
      if (x < x0) x0 = x;
      if (x > x1) x1 = x;
      if (y < y0) y0 = y;
      if (y > y1) y1 = y;
    }
  }
  return pixels ? { x0, x1: x1 + 1, y0, y1: y1 + 1, pixels } : null;
}

/** A translucent region: its bounding box, pixel count, and whether it
 *  holds the `seed` pixel translucentRegionsUnder was given. */
export type TranslucentRegion = PixelBox & { pixels: number; seeded: boolean };

/**
 * The translucent regions (α < `alphaMax`, 4-connected, the corner cut left
 * out) that have a pixel whose centre lies inside `box` — each one's
 * bounding box over the whole card and its pixel count: the frame parts the
 * art in `box` shows through (its window among them: the region holding
 * `seed`, the slot's centre, comes first, `seeded`).
 */
export function translucentRegionsUnder(
  rgba: Uint8Array | Uint8ClampedArray,
  width: number,
  height: number,
  box: PixelBox,
  alphaMax = SEE_THROUGH_FRAME_ALPHA_MAX,
  seed?: { x: number; y: number },
): TranslucentRegion[] {
  // mask: 1 = translucent and not yet visited; a fill clears what it visits.
  const mask = translucentMask(rgba, width, height, alphaMax);
  const stack = new Int32Array(width * height);
  const fill = (start: number, seeded: boolean): TranslucentRegion => {
    let top = 0;
    stack[top++] = start;
    mask[start] = 0;
    let x0 = width;
    let x1 = -1;
    let y0 = height;
    let y1 = -1;
    let pixels = 0;
    while (top > 0) {
      const i = stack[--top];
      const px = i % width;
      const py = (i - px) / width;
      pixels += 1;
      if (px < x0) x0 = px;
      if (px > x1) x1 = px;
      if (py < y0) y0 = py;
      if (py > y1) y1 = py;
      if (px > 0 && mask[i - 1]) {
        mask[i - 1] = 0;
        stack[top++] = i - 1;
      }
      if (px < width - 1 && mask[i + 1]) {
        mask[i + 1] = 0;
        stack[top++] = i + 1;
      }
      if (py > 0 && mask[i - width]) {
        mask[i - width] = 0;
        stack[top++] = i - width;
      }
      if (py < height - 1 && mask[i + width]) {
        mask[i + width] = 0;
        stack[top++] = i + width;
      }
    }
    return { x0, x1: x1 + 1, y0, y1: y1 + 1, pixels, seeded };
  };
  const regions: TranslucentRegion[] = [];
  if (seed && seed.x >= 0 && seed.y >= 0 && seed.x < width && seed.y < height && mask[seed.y * width + seed.x]) {
    regions.push(fill(seed.y * width + seed.x, true));
  }
  // Pixel x's centre x + 0.5 lies in [box.x0, box.x1).
  const xa = Math.max(0, Math.ceil(box.x0 - 0.5));
  const xb = Math.min(width, Math.ceil(box.x1 - 0.5));
  const ya = Math.max(0, Math.ceil(box.y0 - 0.5));
  const yb = Math.min(height, Math.ceil(box.y1 - 0.5));
  for (let y = ya; y < yb; y += 1) {
    for (let x = xa; x < xb; x += 1) if (mask[y * width + x]) regions.push(fill(y * width + x, false));
  }
  return regions;
}

const fmt = (n: number) => (Math.round(n * 100) / 100).toString();

/** How `cover` misses covering `box` with the overscan (clamped to the
 *  card: a side where `box` reaches the card's edge only needs the cover to
 *  reach it too), and the worst shortfall in px. Empty = covered. */
function coverMisses(cover: PixelBox, box: PixelBox, width: number, height: number): { misses: string[]; missPx: number } {
  const overX = (ART_WINDOW_OVERSCAN_PCT / 100) * width;
  const overY = (ART_WINDOW_OVERSCAN_PCT / 100) * height;
  const need = {
    left: Math.max(0, box.x0 - overX),
    right: Math.min(width, box.x1 + overX),
    top: Math.max(0, box.y0 - overY),
    bottom: Math.min(height, box.y1 + overY),
  };
  const misses: string[] = [];
  let missPx = 0;
  const miss = (text: string, by: number) => {
    misses.push(text);
    missPx = Math.max(missPx, by);
  };
  if (cover.x0 > need.left) miss(`left ${fmt(cover.x0)} > ${fmt(need.left)}`, cover.x0 - need.left);
  if (cover.x1 < need.right) miss(`right ${fmt(cover.x1)} < ${fmt(need.right)}`, need.right - cover.x1);
  if (cover.y0 > need.top) miss(`top ${fmt(cover.y0)} > ${fmt(need.top)}`, cover.y0 - need.top);
  if (cover.y1 < need.bottom) miss(`bottom ${fmt(cover.y1)} < ${fmt(need.bottom)}`, need.bottom - cover.y1);
  return { misses, missPx };
}

/** How far a translucent `region` runs past `cover` beyond the rim — on a
 *  side where it also runs past `beyond` (the window it holds) beyond the
 *  rim — and the worst overrun in px. Empty = inside. */
function regionMisses(
  cover: PixelBox,
  region: PixelBox,
  width: number,
  height: number,
  beyond: PixelBox | null,
): { misses: string[]; missPx: number } {
  const rimX = (TRANSLUCENT_RIM_PCT / 100) * width;
  const rimY = (TRANSLUCENT_RIM_PCT / 100) * height;
  const b = beyond ?? { x0: Infinity, x1: -Infinity, y0: Infinity, y1: -Infinity };
  const misses: string[] = [];
  let missPx = 0;
  for (const [side, past, pastWindow, rim] of [
    ["left", cover.x0 - region.x0, b.x0 - region.x0, rimX],
    ["right", region.x1 - cover.x1, region.x1 - b.x1, rimX],
    ["top", cover.y0 - region.y0, b.y0 - region.y0, rimY],
    ["bottom", region.y1 - cover.y1, region.y1 - b.y1, rimY],
  ] as const) {
    if (past > rim && pastWindow > rim) {
      misses.push(`${side} ${fmt(past)} px`);
      missPx = Math.max(missPx, past);
    }
  }
  return { misses, missPx };
}

const describeBox = (b: PixelBox) => `${fmt(b.x0)}–${fmt(b.x1)} × ${fmt(b.y0)}–${fmt(b.y1)} px`;

/** One way a master's art windows escape their art: the message, and how
 *  far (px) the worst side misses — Infinity when the slot's centre has no
 *  window at all. */
export type ArtWindowFinding = { message: string; missPx: number };

/**
 * Every way a master's art windows escape the art that fills them — empty
 * when each slot (or, on a see-through master, its under-frame rect)
 * covers its window, and the see-through body, with the overscan to spare,
 * and every translucent region the slot's art shows through stays inside
 * it. Build `slots` with artWindowSlotsOf.
 */
export function artWindowFindings(
  rgba: Uint8Array | Uint8ClampedArray,
  width: number,
  height: number,
  slots: readonly ArtWindowSlot[],
): ArtWindowFinding[] {
  const out: ArtWindowFinding[] = [];
  const spare = `with ${ART_WINDOW_OVERSCAN_PCT} % to spare`;
  for (const slot of slots) {
    const box = slotPixelBox(slot.rect, slot.rotation ?? 0, width, height);
    // The pixel under the slot's centre (1e-6 absorbs the % → px float error).
    const cx = Math.min(width - 1, Math.max(0, Math.floor((box.x0 + box.x1) / 2 + 1e-6)));
    const cy = Math.min(height - 1, Math.max(0, Math.floor((box.y0 + box.y1) / 2 + 1e-6)));
    const win = seeThroughWindow(rgba, width, height, cx, cy);
    if (!win) {
      const a = rgba[(cy * width + cx) * 4 + 3];
      out.push({ message: `${slot.name}: the frame is α ${a} at the slot's centre (${cx},${cy}) — no see-through window there`, missPx: Infinity });
      continue;
    }
    const cover = slot.underFrame ? slotPixelBox(slot.underFrame, 0, width, height) : box;
    const by = slot.underFrame ? "the under-frame art" : "the slot";
    const windowMiss = coverMisses(cover, win, width, height);
    if (windowMiss.misses.length) {
      out.push({
        message:
          `${slot.name}: ${by} ${describeBox(cover)} doesn't cover the window ${describeBox(win)} ` +
          `(${win.pixels} px, α < ${ART_WINDOW_ALPHA_MAX}) ${spare}: ${windowMiss.misses.join(", ")}`,
        missPx: windowMiss.missPx,
      });
    }
    if (slot.underFrame) {
      const body = seeThroughBody(rgba, width, height);
      const bodyMisses = body ? coverMisses(cover, body, width, height) : null;
      if (body && bodyMisses?.misses.length) {
        out.push({
          message:
            `${slot.name}: the under-frame art ${describeBox(cover)} doesn't cover the see-through frame ` +
            `${describeBox(body)} (${body.pixels} px, α < ${SEE_THROUGH_FRAME_ALPHA_MAX}) ${spare}: ${bodyMisses.misses.join(", ")}`,
          missPx: bodyMisses.missPx,
        });
      }
      // Every pixel α < 250 is the body's: the regions below are inside it.
      continue;
    }
    // The window's own region (the one holding the slot's centre) is the
    // window check's up to its rim: only what runs on past the window too.
    for (const region of translucentRegionsUnder(rgba, width, height, cover, SEE_THROUGH_FRAME_ALPHA_MAX, { x: cx, y: cy })) {
      const past = regionMisses(cover, region, width, height, region.seeded ? win : null);
      if (past.misses.length) {
        out.push({
          message:
            `${slot.name}: a translucent part of the frame ${describeBox(region)} (${region.pixels} px, ` +
            `α < ${SEE_THROUGH_FRAME_ALPHA_MAX}) runs past ${by} ${describeBox(cover)} by more than ` +
            `${TRANSLUCENT_RIM_PCT} % — art through part of it, #101015 through the rest: ${past.misses.join(", ")}`,
          missPx: past.missPx,
        });
      }
    }
  }
  return out;
}

/** artWindowFindings' messages — empty when every art window is covered. */
export function artWindowViolations(
  rgba: Uint8Array | Uint8ClampedArray,
  width: number,
  height: number,
  slots: readonly ArtWindowSlot[],
): string[] {
  return artWindowFindings(rgba, width, height, slots).map((f) => f.message);
}

/** A known failure: the master keys it covers, the TODO items that fix it,
 *  why, and how far its worst finding may miss (px — artWindowFindings'
 *  missPx; one bound, or one per key). */
export type ArtWindowKnownFailure = {
  keys: "all" | readonly string[];
  todo: readonly string[];
  why: string;
  maxMissPx: number | Readonly<Record<string, number>>;
};

/**
 * Template × colour masters whose art windows escape their art today, and
 * the TODO items that fix each (measured 2026-09-29 on every git master
 * and every bucket master at the manifest's sha256; px on a 1500 × 2100
 * master, 2100 × 1500 for the landscape split and battle). The test asserts
 * each one STILL fails, and by no more than `maxMissPx` (today's worst miss
 * rounded up to the next half pixel, +0.1 px) — so fixing one turns it red
 * until it is struck from this list, and a master that gets worse behind
 * its entry turns it red too. Never loosen the check instead.
 */
export const ART_WINDOW_KNOWN_FAILURES: Readonly<Record<string, ArtWindowKnownFailure>> = {
  // The Card Conjurer M15 family: CC's window is 1 px wider on each side
  // and 1.4 / 1.6 px taller than the inherited artSlot 7.8/11.4/84.4×44.0.
  m15: {
    keys: "all",
    todo: ["4.4", "4.17a"],
    why:
      "w/u/b/r/g/m: window 116–1384 × 238–1165 vs slot 117–1383 × 239.4–1163.4 — a 1–1.6 px hairline on every side " +
      "(4.4 (2): artSlot = CC artBounds 7.67/11.29/84.76×44.29); c: see-through, as m15devoid (4.17a)",
    maxMissPx: { w: 3, u: 3, b: 3, r: 3, g: 3, m: 3, c: 26.5 },
  },
  m15artifact: { keys: "all", todo: ["4.4"], why: "the M15 hairline, 1–1.6 px on every side (4.4 (2): CC artBounds)", maxMissPx: 3 },
  m15land: { keys: "all", todo: ["4.4"], why: "the M15 hairline, 1–1.6 px on every side (4.4 (2): CC artBounds)", maxMissPx: 3 },
  m15snow: { keys: "all", todo: ["4.4"], why: "the M15 hairline, 1–1.6 px on every side (4.4 (2): CC artBounds)", maxMissPx: 3 },
  m15snowland: { keys: "all", todo: ["4.4"], why: "the M15 hairline, 1–1.6 px on every side (4.4 (2): CC artBounds)", maxMissPx: 3 },
  // See-through masters (4.17): UNDER_FRAME_RECT 4/4/92×92 starts at 84 px
  // down, but the see-through body runs from the border's inner edge at
  // 59 px — a 25 px band above the title bar (and 1–2 px down each side)
  // shows #101015 through a frame that is α 7–89 there.
  m15devoid: {
    keys: "all",
    todo: ["4.17a"],
    why: "see-through body 58–1443 × 59–1938 vs under-frame art 60–1440 × 84–2016: a 25 px dark band above the title bar",
    maxMissPx: { w: 2, u: 2, b: 2, r: 2, g: 2, m: 2, c: 26.5 },
  },
  m15token: {
    keys: ["c"],
    todo: ["4.17a"],
    why: "c: see-through body 59–1441 × 59–1949 vs under-frame art 60–1440 × 84–2016: a 25 px dark band above the title bar",
    maxMissPx: 26.5,
  },
  m15tokentext: {
    keys: ["c"],
    todo: ["4.17a"],
    why: "c: see-through body 59–1441 × 59–1949 vs under-frame art 60–1440 × 84–2016: a 25 px dark band above the title bar",
    maxMissPx: 26.5,
  },
  m15tokenartifact: {
    keys: ["w", "u", "b", "r", "g", "m"],
    todo: ["4.53"],
    why: "the artifact-dress window ends at 1709 px, exactly the slot's bottom: no overscan (4.53 (e): CC artBounds)",
    maxMissPx: 1.5,
  },
  m15fullartland: {
    keys: "all",
    todo: ["4.39"],
    why: "slot top 2.81 % = 59.01 px vs the window from 60 px: 0.99 px of overscan, 1.05 needed",
    maxMissPx: 0.5,
  },
  m15textless: {
    keys: "all",
    todo: ["4.35"],
    why: "window 118–1379 × 239–1935 vs slot 115.5–1375.5 × 237.3–1932: 3.5 px right and 3 px bottom (4.35 (2): re-source)",
    maxMissPx: 4.5,
  },
  m15textlessland: {
    keys: "all",
    todo: ["4.35"],
    why: "window 118–1379 × 239–1935 vs slot 115.5–1375.5 × 237.3–1932: 3.5 px right and 3 px bottom (4.35 (2): re-source)",
    maxMissPx: 4.5,
  },
  // The MSE layout templates — 4.21 re-sources all six from Card Conjurer.
  split: {
    keys: "all",
    todo: ["4.21"],
    why: "both windows start at 200–202 px, the slots at 220.5: a 1.2 % H strip on each half (4.21's interim fix: art top 14.7 → 13.4)",
    maxMissPx: 21.5,
  },
  saga: {
    keys: "all",
    todo: ["4.21"],
    why: "window ≈ 725–1382 × 234–1760 vs slot 751.5–1380 × 237.3–1759.8: 1.5 px at the divider, a hairline along the top to x 715, 1–4 px elsewhere",
    maxMissPx: { w: 28.5, u: 26.5, b: 37.5, r: 26.5, g: 27.5, c: 27.5, m: 27.5 },
  },
  flip: { keys: "all", todo: ["4.21"], why: "window ≈ 113–1384 × 647–1394 vs slot 115.5–1380 × 651–1390.2: 2–5 px on every side", maxMissPx: 6 },
  adventure: {
    keys: "all",
    todo: ["4.21"],
    why: "window 125–1379 × 240–1163 vs slot 117–1383 × 239.4–1163.4: 0.6 / 0.4 px of overscan top and bottom, 1.05 needed",
    maxMissPx: 1,
  },
  aftermath: {
    keys: "all",
    todo: ["4.21"],
    why: "top window ends at 1383 px (1384 on one colour), the slot at 1383; the sideways window ends 0.4 px inside its rotated slot",
    maxMissPx: 2,
  },
  battle: { keys: "all", todo: ["4.21"], why: "borderless PNG: the window runs into the transparent ring, the whole card (7.7; 4.21's interim: full-bleed artSlot)", maxMissPx: 642.5 },
  // Transparent rings and bands (7.7's known failures) the window leaks into,
  // and the showcase windows cut wider than their slots.
  lotr: { keys: "all", todo: ["4.35", "4.11"], why: "the ring 9.8–90.5 × 11.24–55.62 % vs slot 14–86 × 13–58 % (4.35 A8 / 4.11 re-measure)", maxMissPx: 69 },
  lotrscroll: { keys: "all", todo: ["4.35"], why: "borderless scroll PNG: the window runs into the transparent ring, the whole card (4.35)", maxMissPx: 914 },
  avatar: { keys: "all", todo: ["4.35"], why: "the window runs into the transparent outer band: 0–1500 × 0–1160 (4.35 A8)", maxMissPx: 90.5 },
  bloomburrow: { keys: "all", todo: ["4.35"], why: "the window runs into the transparent sides: 0–1500 × 236–1182 (4.35 A8)", maxMissPx: 90.5 },
  bloomanime: { keys: "all", todo: ["4.35"], why: "transparent outer ring: the window is the whole card, the slot inset 2.5/3.5/93×92 (4.35)", maxMissPx: 116 },
  tarkirghostfire: { keys: "all", todo: ["4.35"], why: "transparent outer ring: the window is the whole card (4.35)", maxMissPx: 116 },
  tarkirdraconic: {
    keys: "all",
    todo: ["4.11"],
    why: "the see-through gaps between the dragon ornaments run to 67–1449 px, 68–84 px past the slot 135–1365 (4.11 re-measure)",
    maxMissPx: 87.5,
  },
  expeditionland: {
    keys: ["u", "b", "r", "g"],
    todo: ["4.35", "4.11"],
    why: "b/g: no ring, the window is the whole card (4.35 (3)); u/r: the arch's apex at 239 px vs slot top 241.5 (4.11 re-source)",
    maxMissPx: { u: 4, r: 4, b: 389, g: 389 },
  },
  extendedart: { keys: ["m"], todo: ["4.7"], why: "m: the window starts at 250 px, the slot at 249.9: 0.1 px of overscan, 1.05 needed (4.7: CC extended)", maxMissPx: 1.5 },
  modern: { keys: "all", todo: ["4.10"], why: "window bottom 1163–1164 px vs slot 1163.4: 0.4 px of overscan to 0.6 px exposed (4.10: CC 8th)", maxMissPx: 2 },
  modernland: { keys: "all", todo: ["4.10"], why: "window bottom 1164 px vs slot 1163.4: 0.6 px exposed (4.10: CC 8th)", maxMissPx: 2 },
  alphatoken: { keys: "all", todo: ["4.54"], why: "window 162–1339 × 187–1295 vs slot 150–1350 × 189–1291.5: 2 px top, 3.5 px bottom (4.54 retires it)", maxMissPx: 5 },
  // Translucent frame parts the art only partly shows through (the region
  // rule above; 4.17b): a hard seam where the art slot ends.
  nyx: {
    keys: "all",
    todo: ["4.17b"],
    why: "the translucent text box 110–1391 × 1319–1946 (α ≈ 135) runs 240.8 px past the slot's bottom at 1705.2 (81.2 %): art through its top, #101015 through the rest",
    maxMissPx: 241,
  },
  fullart: {
    keys: "all",
    todo: ["4.17b"],
    why: "the translucent text box ends at 1945–1946 px, the slot at 1915.2 (91.2 %): a 30–31 px #101015 strip along its bottom",
    maxMissPx: 31,
  },
  m15pw: {
    keys: ["c"],
    todo: ["4.17b"],
    why: "c: CC's colourless planeswalker is see-through like m15/c (α ≈ 180), but has no under-frame art: the body 60–1440 × 60–1932 runs 40–148 px past the slot and the type bar 87–1413 13.5 / 16.5 px past its sides",
    maxMissPx: { c: 148 },
  },
};

export function isKnownArtWindowFailure(template: string, key: string): boolean {
  const entry = ART_WINDOW_KNOWN_FAILURES[template];
  return Boolean(entry && (entry.keys === "all" || entry.keys.includes(key)));
}

/**
 * One master's findings held to the known-failure table. `fails` — what
 * fails it: every finding of a master the table doesn't list; for a listed
 * one, a worst miss past its `maxMissPx` (a master that got worse behind its
 * entry). `fixed` — a listed master with no finding left: strike its entry
 * (the test fails on it; the importer only says so).
 */
export function artWindowVerdict(
  template: string,
  key: string,
  findings: readonly ArtWindowFinding[],
): { fails: string[]; fixed: boolean } {
  if (!isKnownArtWindowFailure(template, key)) return { fails: findings.map((f) => f.message), fixed: false };
  if (!findings.length) return { fails: [], fixed: true };
  const bound = ART_WINDOW_KNOWN_FAILURES[template].maxMissPx;
  const max = typeof bound === "number" ? bound : bound[key];
  if (max === undefined) return { fails: [`known failure without a maxMissPx for ${key}`], fixed: false };
  const worst = Math.max(...findings.map((f) => f.missPx));
  if (worst <= max) return { fails: [], fixed: false };
  return {
    fails: [`worse than its known failure (${ART_WINDOW_KNOWN_FAILURES[template].todo.join(", ")}): misses by ${fmt(worst)} px > ${max}: ${findings.map((f) => f.message).join(" | ")}`],
    fixed: false,
  };
}
