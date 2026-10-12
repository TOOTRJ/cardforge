import { readFileSync, readdirSync, statSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import {
  ART_ZOOM_MAX,
  COVER_ZOOM,
  artFillsWindow,
  canZoomArtOut,
  fitArtToWindow,
  isArtFitted,
  refitArtForWindow,
  sameArtPosition,
  stepArtZoom,
  visibleArtShare,
} from "@/lib/cards/art-fit";
import { carryArtFraming, planTreatmentSwitch, visibleArtCentre } from "@/lib/cards/art-framing";
import { artPositionerWindows } from "@/lib/cards/art-positioner-window";
import { getFrameProfile } from "@/lib/cards/template-layout";
import { FRAME_TEMPLATE_VALUES, type ArtPosition } from "@/types/card";

// ---------------------------------------------------------------------------
// The automatic fit (TODO 3b.18): a picture fills its face's art window and
// shows its centre; "untouched" is the numbers being the fit; a hand-set
// position is never re-fitted, only carried as 3.23 carries it.
// ---------------------------------------------------------------------------

const PICTURES = {
  "3:1 panorama": { width: 2400, height: 800 },
  "1:3 banner": { width: 800, height: 2400 },
  "4:3": { width: 1600, height: 1200 },
};

/** Every window the creator's positioners show: each template's front, its
 *  inline second half and (for a double-faced front body) its default back —
 *  on a coloured master and on the colourless one (a see-through master's
 *  own window). */
function everyWindow() {
  const out: Array<{ name: string; width: number; height: number }> = [];
  for (const template of FRAME_TEMPLATE_VALUES) {
    for (const colour of ["white", "colorless"] as const) {
      const windows = artPositionerWindows({
        frameStyle: { template },
        colorIdentity: [colour],
        cardType: "creature",
      });
      for (const [face, w] of Object.entries(windows)) {
        if (w) out.push({ name: `${template}/${colour}/${face}`, width: w.width, height: w.height });
      }
    }
  }
  return out;
}

/** The renderers' placement on one axis: the picture coordinate (0–1) drawn
 *  at window point `q` (card-preview.tsx ArtImage / card-image.tsx). */
function drawn(S: number, D: number, f: number, s: number, q: number) {
  return (f * S + (q - f * S) / s - (S - D) * f) / D;
}
function crop(window: { width: number; height: number }, natural: { width: number; height: number }, p: Required<ArtPosition>) {
  const c = Math.max(window.width / natural.width, window.height / natural.height);
  const [dw, dh] = [natural.width * c, natural.height * c];
  return {
    left: drawn(window.width, dw, p.focalX, p.scale, 0),
    right: drawn(window.width, dw, p.focalX, p.scale, window.width),
    top: drawn(window.height, dh, p.focalY, p.scale, 0),
    bottom: drawn(window.height, dh, p.focalY, p.scale, window.height),
  };
}

describe("fitArtToWindow", () => {
  it("fills every window with every picture and shows its centre — no empty space, nothing off-centre", () => {
    const windows = everyWindow();
    // Every template, both masters, at least the fronts.
    expect(windows.length).toBeGreaterThanOrEqual(FRAME_TEMPLATE_VALUES.length * 2);
    for (const window of windows) {
      for (const [label, natural] of Object.entries(PICTURES)) {
        const fit = fitArtToWindow(window, natural);
        const c = crop(window, natural, fit);
        const where = `${window.name} × ${label}`;
        // Filled: the window's four edges are inside the picture.
        expect(c.left, where).toBeGreaterThanOrEqual(-1e-9);
        expect(c.top, where).toBeGreaterThanOrEqual(-1e-9);
        expect(c.right, where).toBeLessThanOrEqual(1 + 1e-9);
        expect(c.bottom, where).toBeLessThanOrEqual(1 + 1e-9);
        // Cover, not more: one axis shows the whole side.
        expect(Math.max(c.right - c.left, c.bottom - c.top), where).toBeCloseTo(1, 9);
        // Centred.
        const centre = visibleArtCentre(window, natural, fit);
        expect(centre.x, where).toBeCloseTo(0.5, 9);
        expect(centre.y, where).toBeCloseTo(0.5, 9);
      }
    }
  });

  it("is the position a new picture has always had: no stored card means something else", () => {
    expect(fitArtToWindow()).toEqual({ focalX: 0.5, focalY: 0.5, scale: 1 });
    expect(fitArtToWindow({ width: 636, height: 1526 }, PICTURES["3:1 panorama"])).toEqual({
      focalX: 0.5,
      focalY: 0.5,
      scale: 1,
    });
    expect(COVER_ZOOM).toBe(1);
  });
});

describe("untouched is read from the numbers", () => {
  const saga = { width: 636, height: 1526 };
  it("the fit, with or without its keys, is untouched", () => {
    expect(isArtFitted({ focalX: 0.5, focalY: 0.5, scale: 1 }, saga)).toBe(true);
    // A row saved with no position draws as a centred cover in both renderers.
    expect(isArtFitted({}, saga)).toBe(true);
    expect(isArtFitted({ focalX: 0.5 }, saga)).toBe(true);
    expect(isArtFitted(null, saga)).toBe(true);
  });

  it("anything else was set by hand: a nudge, a zoom, either axis", () => {
    expect(isArtFitted({ focalX: 0.51, focalY: 0.5, scale: 1 }, saga)).toBe(false);
    expect(isArtFitted({ focalX: 0.5, focalY: 0.4999, scale: 1 }, saga)).toBe(false);
    expect(isArtFitted({ focalX: 0.5, focalY: 0.5, scale: 1.05 }, saga)).toBe(false);
    expect(isArtFitted({ focalX: 0.5, focalY: 0.5, scale: 0.95 }, saga)).toBe(false);
    expect(isArtFitted({ scale: 2 }, saga)).toBe(false);
  });

  it("sameArtPosition compares what is drawn", () => {
    expect(sameArtPosition({}, { focalX: 0.5, focalY: 0.5, scale: 1 })).toBe(true);
    expect(sameArtPosition({ focalX: 0.2 }, { focalX: 0.2, focalY: 0.5, scale: 1 })).toBe(true);
    expect(sameArtPosition({ focalX: 0.2 }, { focalX: 0.2001 })).toBe(false);
  });
});

describe("empty space", () => {
  it("a zoom under 100 % never fills the window; 100 % and over always does", () => {
    expect(artFillsWindow({ scale: 1 })).toBe(true);
    expect(artFillsWindow({})).toBe(true);
    expect(artFillsWindow({ scale: 4 })).toBe(true);
    expect(artFillsWindow({ scale: 0.95 })).toBe(false);
    expect(artFillsWindow({ scale: 0.5 })).toBe(false);
    // The maths behind it: under cover, the axis the picture exactly spanned
    // at 100 % is shorter than the window — on every window and picture.
    for (const window of everyWindow().slice(0, 40)) {
      for (const natural of Object.values(PICTURES)) {
        const c = crop(window, natural, { focalX: 0.5, focalY: 0.5, scale: 0.95 });
        expect(Math.max(c.right - c.left, c.bottom - c.top)).toBeGreaterThan(1);
      }
    }
  });

  it("says how much of a picture a fitted window shows (the owner's panorama on a saga: 14 % of its width)", () => {
    const share = visibleArtShare({ width: 636, height: 1526 }, PICTURES["3:1 panorama"])!;
    expect(share.x).toBeCloseTo(0.1389, 3);
    expect(share.y).toBe(1);
    const tall = visibleArtShare({ width: 1271, height: 931 }, PICTURES["1:3 banner"])!;
    expect(tall.x).toBe(1);
    expect(tall.y).toBeCloseTo(0.2442, 3);
    expect(visibleArtShare({ width: 636, height: 1526 }, null)).toBeNull();
  });
});

describe("a window change", () => {
  const natural = PICTURES["3:1 panorama"];
  const m15 = getFrameProfile("m15");
  const saga = getFrameProfile("saga");

  it("an untouched picture stays on the fit: the SAME object back, so nothing is written", () => {
    for (const position of [{ focalX: 0.5, focalY: 0.5, scale: 1 }, {} as ArtPosition]) {
      expect(refitArtForWindow({ from: { width: 1271, height: 931 }, to: { width: 636, height: 1526 }, natural, position })).toBe(position);
      expect(planTreatmentSwitch({ from: m15, to: saga, finish: "regular", natural, position })).toEqual({});
    }
  });

  it("a hand-set picture is carried exactly as 3.23 carries it — never re-fitted", () => {
    const position = { focalX: 0.2864, focalY: 0.7266, scale: 1.3 };
    const carried = carryArtFraming({ from: m15, to: saga, natural, position });
    expect(planTreatmentSwitch({ from: m15, to: saga, finish: "regular", natural, position }).position).toEqual(carried);
    expect(carried).not.toEqual(fitArtToWindow());
    // The same part of the picture is still under the window's centre.
    const px = (p: typeof m15) => ({ width: (p.artSlot.widthPct / 100) * 1500, height: (p.artSlot.heightPct / 100) * 2100 });
    const before = visibleArtCentre(px(m15), natural, position);
    const after = visibleArtCentre(px(saga), natural, carried);
    expect(after.x).toBeCloseTo(before.x, 3);
    expect(after.y).toBeCloseTo(before.y, 3);
    // …and a hand-set zoom below 100 % is the maker's too.
    const small = { focalX: 0.5, focalY: 0.5, scale: 0.7 };
    expect(planTreatmentSwitch({ from: m15, to: saga, finish: "regular", natural, position: small }).position ?? small).toMatchObject({
      scale: 0.7,
    });
  });

  it("with no carry for the face (a second half, a back), a hand-set position is left exactly as it is", () => {
    const position = { focalX: 0.1, focalY: 0.9, scale: 2 };
    expect(refitArtForWindow({ from: { width: 900, height: 600 }, to: { width: 1500, height: 555 }, natural, position })).toBe(position);
  });
});

// ---------------------------------------------------------------------------
// A zoom-out stops at 100 % (owner 2026-10-12). A creator rule: the
// validator, the database and the renderers keep 0.5 – 4.
// ---------------------------------------------------------------------------
describe("the zoom floor", () => {
  const STEP = 0.05;

  it("a zoom-out never goes under 100 %, from anywhere at or above it", () => {
    expect(stepArtZoom(1, -STEP)).toBe(1);
    expect(stepArtZoom(1.05, -STEP)).toBe(1);
    expect(stepArtZoom(1.03, -STEP)).toBe(1);
    expect(stepArtZoom(1.5, -STEP)).toBe(1.45);
    expect(stepArtZoom(4, -STEP)).toBe(3.95);
    for (let zoom = ART_ZOOM_MAX, i = 0; i < 200; i++) {
      zoom = stepArtZoom(zoom, -STEP);
      expect(zoom).toBeGreaterThanOrEqual(COVER_ZOOM);
      if (i === 199) expect(zoom).toBe(COVER_ZOOM);
    }
  });

  it("a stored zoom under 100 % never goes lower, goes up step by step, and never comes back under", () => {
    expect(stepArtZoom(0.7, -STEP)).toBe(0.7);
    expect(stepArtZoom(0.5, -STEP)).toBe(0.5);
    expect(stepArtZoom(0.7, STEP)).toBe(0.75);
    // 70 → 75 → … → 100 → 105, then every step down ends on 100.
    let zoom = 0.7;
    const seen = [];
    for (let i = 0; i < 7; i++) {
      zoom = stepArtZoom(zoom, STEP);
      seen.push(zoom);
      // Where it stands is its floor now.
      expect(stepArtZoom(zoom, -STEP)).toBe(Math.min(zoom, 1));
    }
    expect(seen).toEqual([0.75, 0.8, 0.85, 0.9, 0.95, 1, 1.05]);
    expect(stepArtZoom(1.05, -STEP)).toBe(1);
    expect(stepArtZoom(1, -STEP)).toBe(1);
    // Off the grid: 97 % → 102 % → 100 %.
    expect(stepArtZoom(0.97, STEP)).toBe(1.02);
    expect(stepArtZoom(1.02, -STEP)).toBe(1);
  });

  it("the top of the range is the renderers', and a zoom that is not a number reads as the fit", () => {
    expect(stepArtZoom(3.98, STEP)).toBe(ART_ZOOM_MAX);
    expect(stepArtZoom(ART_ZOOM_MAX, STEP)).toBe(ART_ZOOM_MAX);
    expect(stepArtZoom(Number.NaN, STEP)).toBe(1.05);
  });

  it("the − control has something to do only above 100 %", () => {
    expect(canZoomArtOut(1.05)).toBe(true);
    expect(canZoomArtOut(1)).toBe(false);
    expect(canZoomArtOut(0.7)).toBe(false);
    expect(canZoomArtOut(0.5)).toBe(false);
  });

  it("no automatic step makes a zoom: the carry keeps the maker's on every pair of frames, and the fit is cover", () => {
    // 3.23's carry is the only automatic path that writes a hand-set
    // picture's position; a landing (upload, import, AI, a real card's art)
    // writes the fit. So a picture at or above 100 % is never taken under
    // it by a frame change, however much larger the new window is.
    expect(fitArtToWindow().scale).toBe(COVER_ZOOM);
    const templates = FRAME_TEMPLATE_VALUES.map((t) => getFrameProfile(t));
    let pairs = 0;
    for (const from of templates) {
      for (const to of templates) {
        for (const natural of Object.values(PICTURES)) {
          for (const scale of [1, 1.05, 1.3, 4]) {
            const carried = carryArtFraming({ from, to, natural, position: { focalX: 0.2, focalY: 0.8, scale } });
            expect(carried.scale ?? 1).toBe(scale);
            pairs++;
          }
        }
      }
    }
    expect(pairs).toBeGreaterThan(1000);
    // A STORED zoom under 100 % is the maker's and is carried as it is —
    // not made, and not lowered.
    const small = carryArtFraming({ from: getFrameProfile("m15"), to: getFrameProfile("saga"), natural: PICTURES["4:3"], position: { focalX: 0.5, focalY: 0.5, scale: 0.7 } });
    expect(small.scale).toBe(0.7);
  });
});

describe("one rule", () => {
  it("no other file writes the three numbers of a fresh picture", () => {
    // Where a literal remains it is a READ fallback for a stored row with no
    // position (the renderers' own default), never a picture landing.
    const ALLOWED = new Set(["lib/cards/art-fit.ts", "lib/creator/card-fields.ts"]);
    const offenders: string[] = [];
    // The three numbers in ONE object literal, in any order and spelling
    // (`scale: 1.0`, the keys reordered or spread over lines).
    const fresh = (text: string) =>
      (text.match(/\{[^{}]*\}/g) ?? []).filter(
        (literal) =>
          /\bfocalX: 0\.50*(?![\d.])/.test(literal) &&
          /\bfocalY: 0\.50*(?![\d.])/.test(literal) &&
          /\bscale: 1(\.0+)?(?![\d.])/.test(literal),
      );
    const walk = (dir: string) => {
      for (const name of readdirSync(dir)) {
        const path = join(dir, name);
        if (statSync(path).isDirectory()) walk(path);
        else if (/\.(ts|tsx)$/.test(name)) {
          const text = readFileSync(path, "utf8").replace(/\s+/g, " ");
          if (fresh(text).length > 0 && !ALLOWED.has(path)) offenders.push(path);
        }
      }
    };
    for (const root of ["lib", "components", "app"]) walk(root);
    expect(offenders).toEqual([]);
    // card-fields keeps exactly its two read fallbacks.
    const fields = readFileSync("lib/creator/card-fields.ts", "utf8").replace(/\s+/g, " ");
    expect(fresh(fields).length).toBe(2);
    // The guard reads what it is meant to.
    expect(fresh("x = { scale: 1.0, focalX: 0.5, focalY: 0.50 };").length).toBe(1);
    expect(fresh("x = { focalX: 0.5, focalY: 0.5, scale: 1.3 }; y = { focalX: 0.51, focalY: 0.5, scale: 1 };").length).toBe(0);
  });
});
