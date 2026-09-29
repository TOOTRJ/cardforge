import { readFileSync } from "node:fs";
import path from "node:path";
import { describe, expect, it } from "vitest";
import {
  CARD_CORNER_CSS,
  CARD_CORNER_OF_SHORT_SIDE,
  applyCardCornerMask,
  cardCornerRadiusPx,
  squareCardCorners,
} from "@/lib/cards/card-corner";
import { roundCornersRgba8 } from "@/scripts/lib/cc-frames.mjs";

// ---------------------------------------------------------------------------
// TODO 3.26 — ONE card corner radius: 4.3 % of the card's SHORT side, shared
// by the CSS clip, the bake's corner mask and the Card Conjurer importer.
// These tests pin the constant, the mask's formula (1 px anti-aliasing,
// alpha only) and keep app/globals.css in step with CARD_CORNER_CSS.
// ---------------------------------------------------------------------------

/** The importer's original full-image scan (scripts/lib/cc-frames.mjs
 *  roundCornersRgba8 before it delegated), kept as the reference the
 *  corner-box-only mask must reproduce exactly. */
function referenceMask(buf: Uint8Array, width: number, height: number, r: number) {
  for (let y = 0; y < height; y += 1) {
    for (let x = 0; x < width; x += 1) {
      const cx = x < r ? r - x - 0.5 : x >= width - r ? x - (width - r) + 0.5 : 0;
      const cy = y < r ? r - y - 0.5 : y >= height - r ? y - (height - r) + 0.5 : 0;
      if (cx === 0 || cy === 0) continue;
      const d = Math.sqrt(cx * cx + cy * cy) - r;
      if (d <= -0.5) continue;
      const k = d >= 0.5 ? 0 : 0.5 - d;
      const o = (y * width + x) * 4 + 3;
      buf[o] = Math.round(buf[o] * k);
    }
  }
}

/** A deterministic, non-uniform RGBA image (so a wrong channel shows). */
function noise(width: number, height: number): Uint8Array {
  const buf = new Uint8Array(width * height * 4);
  let s = 0x2545f491;
  for (let i = 0; i < buf.length; i += 1) {
    s ^= s << 13;
    s ^= s >>> 17;
    s ^= s << 5;
    buf[i] = s & 0xff;
  }
  return buf;
}

const alphaAt = (buf: Uint8Array, width: number, x: number, y: number) => buf[(y * width + x) * 4 + 3];

describe("the constant", () => {
  it("is 4.3 % of the short side: 64.5 px at HD in portrait AND landscape", () => {
    expect(CARD_CORNER_OF_SHORT_SIDE).toBe(0.043);
    expect(cardCornerRadiusPx(1500, 2100)).toBe(64.5);
    expect(cardCornerRadiusPx(2100, 1500)).toBe(64.5);
    expect(cardCornerRadiusPx(750, 1050)).toBe(32.25);
    expect(cardCornerRadiusPx(1050, 750)).toBe(32.25);
    expect(cardCornerRadiusPx(600, 840)).toBeCloseTo(25.8, 10);
  });

  it("is never rounded (Math.round would give 65 at HD)", () => {
    const r = cardCornerRadiusPx(1500, 2100);
    expect(Number.isInteger(r)).toBe(false);
    expect(r).not.toBe(Math.round(r));
    expect(cardCornerRadiusPx(421, 590)).toBeCloseTo(18.103, 10);
  });
});

describe("applyCardCornerMask", () => {
  it("clears the corner pixel and anti-aliases the arc: α(60, 0) = 0.875 → 223 at r = 64.5", () => {
    const w = 1500;
    const h = 2100;
    const buf = new Uint8Array(w * h * 4).fill(255);
    applyCardCornerMask(buf, w, h);
    // cx = 64.5 − 60 − 0.5 = 4, cy = 64, d = √4112 − 64.5 ≈ −0.375 → k 0.875.
    expect(alphaAt(buf, w, 60, 0)).toBe(223);
    expect(alphaAt(buf, w, 0, 0)).toBe(0);
    expect(alphaAt(buf, w, 63, 0)).toBe(253); // the first near-opaque pixel on row 0
    expect(alphaAt(buf, w, 64, 0)).toBe(255); // cx = 0: on the straight edge
    expect(alphaAt(buf, w, 0, 64)).toBe(255);
    expect(alphaAt(buf, w, 750, 0)).toBe(255);
    expect(alphaAt(buf, w, 750, 1050)).toBe(255);
    // Fully inside the arc: untouched.
    expect(alphaAt(buf, w, 30, 30)).toBe(255);
  });

  it("cuts all four corners symmetrically, in portrait and landscape", () => {
    for (const [w, h] of [
      [1500, 2100],
      [2100, 1500],
    ]) {
      const buf = new Uint8Array(w * h * 4).fill(255);
      applyCardCornerMask(buf, w, h);
      for (let y = 0; y < 66; y += 1) {
        for (let x = 0; x < 66; x += 1) {
          const a = alphaAt(buf, w, x, y);
          expect(alphaAt(buf, w, w - 1 - x, y)).toBe(a);
          expect(alphaAt(buf, w, x, h - 1 - y)).toBe(a);
          expect(alphaAt(buf, w, w - 1 - x, h - 1 - y)).toBe(a);
          expect(alphaAt(buf, w, y, x)).toBe(a); // circular: the arc is its own transpose
        }
      }
      // Landscape uses the SAME radius (the short side), not 4.3 % of 2100.
      expect(alphaAt(buf, w, 60, 0)).toBe(223);
      expect(alphaAt(buf, w, 64, 0)).toBe(255);
    }
  });

  it("scales alpha only — RGB is untouched everywhere", () => {
    const w = 150;
    const h = 210;
    const before = noise(w, h);
    const buf = before.slice();
    applyCardCornerMask(buf, w, h);
    let changed = 0;
    // One assertion over the whole buffer, not one per pixel: 126k expect()
    // calls timed out under CI load (TODO 7.6 added bucket-frame work beside it).
    const rgbMoved: number[] = [];
    for (let i = 0; i < buf.length; i += 4) {
      if (buf[i] !== before[i] || buf[i + 1] !== before[i + 1] || buf[i + 2] !== before[i + 2]) rgbMoved.push(i / 4);
      if (buf[i + 3] !== before[i + 3]) changed += 1;
    }
    expect(rgbMoved).toEqual([]);
    expect(changed).toBeGreaterThan(0);
  });

  it("matches the importer's full-image scan exactly (fractional, integer and oversized radii)", () => {
    for (const [w, h, r] of [
      [150, 210, cardCornerRadiusPx(150, 210)], // 6.45
      [210, 150, cardCornerRadiusPx(210, 150)],
      [60, 84, 8],
      [100, 140, 10.3],
      [40, 56, 30], // over half the short side: boxes overlap
      [33, 47, 0.4],
    ] as const) {
      const expected = noise(w, h);
      referenceMask(expected, w, h, r);
      const actual = noise(w, h);
      applyCardCornerMask(actual, w, h, r);
      expect(Buffer.from(actual).equals(Buffer.from(expected)), `${w}×${h} r=${r}`).toBe(true);
    }
  });

  it("works on a Uint8ClampedArray (canvas / Satori raw pixels) and ignores a non-positive radius", () => {
    const w = 20;
    const h = 28;
    const clamped = new Uint8ClampedArray(w * h * 4).fill(255);
    applyCardCornerMask(clamped, w, h, 4);
    expect(clamped[3]).toBe(0);
    const untouched = new Uint8Array(w * h * 4).fill(255);
    applyCardCornerMask(untouched, w, h, 0);
    applyCardCornerMask(untouched, w, h, -3);
    expect(untouched.every((v) => v === 255)).toBe(true);
  });

  it("is what the Card Conjurer importer cuts with (roundCornersRgba8 delegates)", () => {
    const w = 150;
    const h = 210;
    const a = noise(w, h);
    const b = noise(w, h);
    roundCornersRgba8(Buffer.from(a.buffer), w, h, 6.45);
    applyCardCornerMask(b, w, h, 6.45);
    expect(Buffer.from(a).equals(Buffer.from(b))).toBe(true);
  });
});

describe("CSS twin — app/globals.css", () => {
  const css = readFileSync(path.join(process.cwd(), "app/globals.css"), "utf8");
  /** The first `border-radius` inside the rule for `selector`. */
  const radiusOf = (selector: string) => {
    const escaped = selector.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
    const rule = new RegExp(`(?:^|\\n)${escaped}\\s*\\{([^}]*)\\}`).exec(css);
    expect(rule, `${selector} rule`).not.toBeNull();
    const radius = /border-radius:\s*([^;]+);/.exec(rule![1]);
    expect(radius, `${selector} border-radius`).not.toBeNull();
    return radius![1].trim();
  };
  const pcts = (value: string) => value.split("/").map((part) => Number.parseFloat(part));

  it("draws the constant: portrait and glare = CARD_CORNER_CSS.portrait, landscape = .landscape", () => {
    expect(radiusOf(".card-corners")).toBe(CARD_CORNER_CSS.portrait);
    expect(radiusOf(".card-corners-landscape")).toBe(CARD_CORNER_CSS.landscape);
    expect(radiusOf(".card-hover-glare")).toBe(CARD_CORNER_CSS.portrait);
  });

  it("CARD_CORNER_CSS is circular on 5:7 and 7:5 boxes: 4.3 % of the short side, the long side's % swapped", () => {
    const [ph, pv] = pcts(CARD_CORNER_CSS.portrait);
    const [lh, lv] = pcts(CARD_CORNER_CSS.landscape);
    expect(ph).toBeCloseTo(CARD_CORNER_OF_SHORT_SIDE * 100, 10);
    expect(lv).toBeCloseTo(CARD_CORNER_OF_SHORT_SIDE * 100, 10);
    // The long side is 7/5 of the short side, so its percentage is 5/7.
    expect(Math.abs(pv - (ph * 5) / 7)).toBeLessThan(0.0005);
    expect(Math.abs(lh - (lv * 5) / 7)).toBeLessThan(0.0005);
    // On a 300 px wide portrait tile: 12.9 px on both axes.
    expect((ph / 100) * 300).toBeCloseTo((pv / 100) * 420, 2);
    expect((lh / 100) * 420).toBeCloseTo((lv / 100) * 300, 2);
  });
});

// A square output is the round card squared again (3.26 review): the ONE
// function the bake's square mode and a free Square download both run.
describe("squareCardCorners", () => {
  const W = 300;
  const H = 420;
  /** An opaque card of `rgb`, cut round. */
  const roundCard = (rgb: readonly number[]) => {
    const buf = new Uint8Array(W * H * 4);
    for (let i = 0; i < buf.length; i += 4) buf.set([rgb[0], rgb[1], rgb[2], 255], i);
    applyCardCornerMask(buf, W, H);
    return buf;
  };
  const at = (buf: Uint8Array, x: number, y: number) => [...buf.subarray((y * W + x) * 4, (y * W + x) * 4 + 4)];

  it("composites each corner over its fill — the fill outside the arc, a blend on the ramp — and leaves the card", () => {
    const buf = roundCard([200, 100, 50]);
    const before = Uint8Array.from(buf);
    squareCardCorners(buf, W, H, [[0, 0, 0], [16, 16, 21], [0, 0, 0], [0, 0, 0]]);
    expect(at(buf, 0, 0)).toEqual([0, 0, 0, 255]);
    expect(at(buf, W - 1, 0)).toEqual([16, 16, 21, 255]);
    // A ramp pixel: α a over black → RGB · a, opaque.
    const ramp = (() => {
      for (let x = 0; x < 13; x += 1) {
        const a = before[(0 * W + x) * 4 + 3];
        if (a > 0 && a < 255) return { x, a };
      }
      throw new Error("no ramp pixel on row 0");
    })();
    expect(at(buf, ramp.x, 0)).toEqual([Math.round((200 * ramp.a) / 255), Math.round((100 * ramp.a) / 255), Math.round((50 * ramp.a) / 255), 255]);
    // Every pixel is opaque; nothing the mask kept whole moved.
    // One assertion each over the whole buffer (per-pixel expect() calls
    // timed out at 5 s under CI load).
    const seeThrough: number[] = [];
    const moved: number[] = [];
    for (let i = 0; i < buf.length; i += 4) {
      if (buf[i + 3] !== 255) seeThrough.push(i / 4);
      if (before[i + 3] === 255 && (buf[i] !== before[i] || buf[i + 1] !== before[i + 1] || buf[i + 2] !== before[i + 2])) moved.push(i / 4);
    }
    expect(seeThrough).toEqual([]);
    expect(moved).toEqual([]);
  });

  it("a null corner is only made opaque again: the RGB the mask kept under the cut comes back", () => {
    const buf = roundCard([40, 160, 200]);
    squareCardCorners(buf, W, H, [null, [0, 0, 0], null, [0, 0, 0]]);
    expect(at(buf, 0, 0)).toEqual([40, 160, 200, 255]);
    expect(at(buf, 0, H - 1)).toEqual([40, 160, 200, 255]);
    expect(at(buf, W - 1, H - 1)).toEqual([0, 0, 0, 255]);
  });
});
