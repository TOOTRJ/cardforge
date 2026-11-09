import { describe, expect, it } from "vitest";
import {
  cleanGlyph,
  fitGlyph,
  GLYPH_OF_DISC,
  GLYPH_PX,
  glyphLegibility,
  glyphMask,
  paintPip,
  passesLegibility,
  PIP_PX,
} from "@/lib/tools/pip-forge/glyph";
import { maskBounds, type RgbaImage } from "@/lib/tools/set-symbol/cutout";
import { inkFor, luminanceOf, normaliseHex, PIP_INK_DARK, PIP_INK_LIGHT, wheelPlace } from "@/lib/tools/pip-forge/model";

// ---------------------------------------------------------------------------
// Pip Forge's glyph pipeline (lib/tools/pip-forge/glyph.ts): FLUX's
// black-on-white drawing → a glyph that reads at 16 and 24 px → the pip on
// our own disc. Synthetic drawings stand in for FLUX's.
// ---------------------------------------------------------------------------

/** A white canvas with black ink where `ink` says (2 × 2 supersampled). */
function draw(size: number, ink: (x: number, y: number) => boolean): RgbaImage {
  const data = new Uint8ClampedArray(size * size * 4);
  for (let y = 0; y < size; y += 1) {
    for (let x = 0; x < size; x += 1) {
      let cover = 0;
      for (let s = 0; s < 4; s += 1) if (ink(x + (s % 2) * 0.5 + 0.25, y + Math.floor(s / 2) * 0.5 + 0.25)) cover += 1;
      const v = 255 - Math.round((cover / 4) * 255);
      const i = (y * size + x) * 4;
      data[i] = v;
      data[i + 1] = v;
      data[i + 2] = v;
      data[i + 3] = 255;
    }
  }
  return { width: size, height: size, data };
}

const S = 512;
const C = S / 2;
const r = (x: number, y: number) => Math.hypot(x - C, y - C);
const bold = (x: number, y: number) => Math.abs(r(x, y) - 140) < 28;
const hairline = (x: number, y: number) =>
  (Math.abs(x - C) < 3 && Math.abs(y - C) < 150) || (Math.abs(y - C) < 3 && Math.abs(x - C) < 150);
const medium = (x: number, y: number) => Math.abs(r(x, y) - 150) < 12;
/** A solid disc with a bar and a cross-bar cut out — FLUX's "badge". */
const badge = (x: number, y: number) =>
  r(x, y) < 200 && !(Math.abs(x - C) < 30 && Math.abs(y - C) < 110) && !(Math.abs(y - C + 50) < 25 && Math.abs(x - C) < 90);

function alphaShare(img: RgbaImage): number {
  let on = 0;
  for (let p = 3; p < img.data.length; p += 4) if (img.data[p] >= 128) on += 1;
  return on / (img.width * img.height);
}

describe("glyphMask", () => {
  it("keys the white away everywhere — a ring's hole is a hole", () => {
    const mask = glyphMask(draw(S, bold))!;
    expect(mask.data[C * S + C]).toBe(0);
    expect(mask.data[C * S + (C + 140)]).toBe(255);
  });

  it("turns a solid badge inside out: the glyph is what was cut into it", () => {
    const mask = glyphMask(draw(S, badge))!;
    // The centre of the vertical bar was a hole in the badge: now ink.
    expect(mask.data[C * S + C]).toBeGreaterThanOrEqual(128);
    // The badge's body is gone.
    expect(mask.data[(C + 150) * S + C]).toBe(0);
    const box = maskBounds(mask)!;
    expect(box.width).toBeLessThan(200);
  });

  it("gives up on a blank page or a page of specks", () => {
    expect(glyphMask(draw(S, () => false))).toBeNull();
    const specks = (x: number, y: number) => Math.hypot(((x - 100) % 40) - 20, ((y - 100) % 40) - 20) < 4 && x > 100 && y > 100 && x < 412 && y < 412;
    expect(glyphMask(draw(S, specks))).toBeNull();
  });

  it("fills holes too small to survive at card size", () => {
    const pinhole = (x: number, y: number) => r(x, y) < 150 && Math.hypot(x - C - 60, y - C) >= 4;
    const mask = glyphMask(draw(S, pinhole))!;
    expect(mask.data[C * S + C + 60]).toBe(255);
  });
});

describe("fitGlyph", () => {
  it("sets the glyph's longer side at GLYPH_OF_DISC of the square, centred, black", () => {
    const img = draw(S, (x, y) => Math.abs(x - 150) < 40 && Math.abs(y - 300) < 100);
    const glyph = fitGlyph(img, glyphMask(img)!)!;
    expect(glyph.width).toBe(GLYPH_PX);
    const box = maskBounds({
      width: glyph.width,
      height: glyph.height,
      data: Uint8Array.from({ length: glyph.width * glyph.height }, (_, p) => glyph.data[p * 4 + 3]),
    })!;
    expect(Math.abs(box.height - GLYPH_OF_DISC * GLYPH_PX)).toBeLessThanOrEqual(3);
    expect(Math.abs(box.y + box.height / 2 - GLYPH_PX / 2)).toBeLessThanOrEqual(2);
    expect(Math.abs(box.x + box.width / 2 - GLYPH_PX / 2)).toBeLessThanOrEqual(2);
    const p = ((GLYPH_PX / 2) * GLYPH_PX + GLYPH_PX / 2) * 4;
    expect([glyph.data[p], glyph.data[p + 1], glyph.data[p + 2]]).toEqual([0, 0, 0]);
  });
});

describe("cleanGlyph — the legibility gate", () => {
  it("passes a bold shape as drawn", () => {
    const clean = cleanGlyph(draw(S, bold))!;
    expect(clean.passed).toBe(true);
    expect(clean.thickened).toBe(0);
    expect(passesLegibility(clean.legibility)).toBe(true);
  });

  it("thickens a medium stroke until it reads", () => {
    const img = draw(S, medium);
    const asDrawn = glyphLegibility(fitGlyph(img, glyphMask(img)!)!);
    expect(passesLegibility(asDrawn)).toBe(false);
    const clean = cleanGlyph(img)!;
    expect(clean.passed).toBe(true);
    expect(clean.thickened).toBeGreaterThan(0);
  });

  it("refuses hairlines that no thickening saves", () => {
    const clean = cleanGlyph(draw(S, hairline))!;
    expect(clean.passed).toBe(false);
  });

  it("reads the badge's cut-out glyph", () => {
    expect(cleanGlyph(draw(S, badge))!.passed).toBe(true);
  });
});

describe("paintPip", () => {
  const glyph = cleanGlyph(draw(S, bold))!.glyph;

  it("is the custom-pip format: PIP_PX square, a disc edge to edge, clear corners", () => {
    const pip = paintPip(glyph, "#e8c27a");
    expect([pip.width, pip.height]).toEqual([PIP_PX, PIP_PX]);
    expect(pip.data[3]).toBe(0);
    const edge = ((PIP_PX / 2) * PIP_PX + 1) * 4;
    expect(pip.data[edge + 3]).toBeGreaterThan(200);
  });

  it("fills the disc in its colour and the glyph in the ink with more contrast", () => {
    const pip = paintPip(glyph, "#e8c27a");
    const centre = ((PIP_PX / 2) * PIP_PX + PIP_PX / 2) * 4;
    expect([pip.data[centre], pip.data[centre + 1], pip.data[centre + 2]]).toEqual([0xe8, 0xc2, 0x7a]);
    // The ring's middle: radius 140 of its 168 outer edge, the outer edge at
    // half the glyph's side.
    const ring = ((PIP_PX / 2) * PIP_PX + PIP_PX / 2 + Math.round((140 / 168) * ((GLYPH_OF_DISC * PIP_PX) / 2))) * 4;
    expect(pip.data[ring]).toBeLessThan(60);
    const dark = paintPip(glyph, "#2a2240");
    expect(dark.data[ring]).toBeGreaterThan(200);
  });

  it("covers about the glyph's share and no more", () => {
    expect(alphaShare(paintPip(glyph, "#ffffff"))).toBeGreaterThan(0.75);
  });
});

describe("the disc's colours", () => {
  it("normalises colours and refuses anything else", () => {
    expect(normaliseHex("#ABC")).toBe("#aabbcc");
    expect(normaliseHex(" #E8C27A ")).toBe("#e8c27a");
    expect(normaliseHex("red")).toBeNull();
    expect(normaliseHex("#12345")).toBeNull();
  });

  it("picks the ink with the higher contrast", () => {
    expect(inkFor("#f0f2c0")).toBe(PIP_INK_DARK);
    expect(inkFor("#4a3f63")).toBe(PIP_INK_LIGHT);
    expect(luminanceOf("#ffffff")).toBeCloseTo(1);
  });
});

describe("wheelPlace — the six-colour wheel", () => {
  it("puts the new colour in its gap: neighbours are allies, two away enemies, across the opposite", () => {
    expect(wheelPlace("GW")).toEqual({
      order: ["W", "U", "B", "R", "G", "X"],
      allies: ["G", "W"],
      enemies: ["R", "U"],
      opposite: "B",
    });
    expect(wheelPlace("UB")).toMatchObject({ allies: ["U", "B"], enemies: ["W", "R"], opposite: "G" });
  });

  it("names each of the five exactly once", () => {
    for (const gap of ["WU", "UB", "BR", "RG", "GW"] as const) {
      const place = wheelPlace(gap);
      expect([...place.allies, ...place.enemies, place.opposite].sort()).toEqual(["B", "G", "R", "U", "W"]);
    }
  });
});

describe("glyphMask — shapes with holes that are NOT badges", () => {
  it("keeps a skull's eyes as holes (its silhouette isn't a circle)", () => {
    const skull = (x: number, y: number) => {
      if (Math.hypot(x - C + 45, y - C + 10) < 30 || Math.hypot(x - C - 45, y - C + 10) < 30) return false;
      return r(x, y) < 140 || (Math.abs(x - C) < 70 && y > C && y < C + 170);
    };
    const mask = glyphMask(draw(S, skull))!;
    expect(mask.data[(C - 10) * S + C - 45]).toBe(0);
    expect(mask.data[(C + 60) * S + C]).toBe(255);
  });

  it("keeps a bold ring a ring (its hole is most of it)", () => {
    const mask = glyphMask(draw(S, bold))!;
    expect(mask.data[C * S + C]).toBe(0);
    expect(mask.data[C * S + C + 140]).toBe(255);
  });

  it("keeps a THICK ring a ring (one round hole is never a badge's glyph)", () => {
    const thick = (x: number, y: number) => r(x, y) < 160 && r(x, y) >= 70;
    const mask = glyphMask(draw(S, thick))!;
    expect(mask.data[C * S + C]).toBe(0);
    expect(mask.data[C * S + C + 120]).toBe(255);
  });

  it("keeps an orb with a highlight an orb", () => {
    const orb = (x: number, y: number) => r(x, y) < 160 && Math.hypot(x - C + 60, y - C + 60) >= 35;
    const mask = glyphMask(draw(S, orb))!;
    expect(mask.data[(C + 60) * S + C + 60]).toBe(255);
    expect(mask.data[(C - 60) * S + C - 60]).toBe(0);
  });
});
