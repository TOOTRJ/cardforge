import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";
import {
  CC_COMMIT,
  CC_TEMPLATES,
  COLORS,
  CORNER_RADIUS,
  compositeLayers,
  roundCorners,
  sourceFilesFor,
  toRgba8,
} from "@/scripts/lib/cc-frames.mjs";
import { FRAME_TEMPLATE_VALUES } from "@/types/card";

// ---------------------------------------------------------------------------
// The Card Conjurer importer's pure half (scripts/lib/cc-frames.mjs, frames
// plan 4.3). Contract: the recipe covers the nine M15-era templates × seven
// colours with real pack paths; blended frames go through CC's pinline mask
// and every substitution is written down; the pixel ops (mask compositing,
// rounded transparent corners, 8-bit rounding) behave; provenance matches
// the pinned commit; the build folder is never committed.
// ---------------------------------------------------------------------------

type Layer = { src: string; mask?: string };
type Def = { colors: Record<string, Layer[]>; plates?: Record<string, string>; notes: string[] };
const templates = CC_TEMPLATES as Record<string, Def>;

describe("Card Conjurer recipe", () => {
  it("covers the nine M15-era templates, all seven colours, with pack paths", () => {
    expect(Object.keys(templates).sort()).toEqual(
      ["m15", "m15artifact", "m15devoid", "m15land", "m15pw", "m15snow", "m15snowland", "m15token", "m15tokenartifact"],
    );
    for (const [template, def] of Object.entries(templates)) {
      expect(FRAME_TEMPLATE_VALUES as readonly string[]).toContain(template);
      expect(Object.keys(def.colors).sort()).toEqual([...COLORS].sort());
      for (const file of sourceFilesFor(def as never)) {
        expect(file, `${template}: ${file}`).toMatch(/^img\/frames\/[\w/]+\.(png|svg)$/);
      }
    }
  });

  it("blends coloured artifacts through the pinline mask; colourless is the plain silver frame", () => {
    for (const template of ["m15artifact", "m15tokenartifact"]) {
      const def = templates[template];
      expect(def.colors.c).toHaveLength(1);
      for (const k of ["w", "u", "b", "r", "g", "m"]) {
        expect(def.colors[k]).toHaveLength(2);
        expect(def.colors[k][1].mask, `${template}/${k}`).toMatch(/pinline\.(png|svg)$/);
      }
    }
  });

  it("writes down every colourless substitution", () => {
    for (const template of ["m15land", "m15snow", "m15devoid", "m15pw", "m15token"]) {
      expect(templates[template].notes.join(" "), template).toMatch(/colourless/);
    }
    // The token layout mismatch must travel with the frames until 4.4 fixes the profile.
    expect(templates.m15token.notes.join(" ")).toMatch(/re-measured/);
  });

  it("lists layers, masks and plates once each", () => {
    const files = sourceFilesFor(templates.m15artifact as never);
    expect(files).toContain("img/frames/m15/new/pinline.png");
    expect(files).toContain("img/frames/m15/regular/m15PTA.png");
    expect(new Set(files).size).toBe(files.length);
  });
});

describe("pixel operations", () => {
  const px = (r: number, g: number, b: number, a: number) => [r, g, b, a];

  it("shows an upper layer only through its mask's luminance", () => {
    // 2×1: red base; blue overlay through a mask white at x=0, black at x=1.
    const base = { data: new Uint8Array([...px(255, 0, 0, 255), ...px(255, 0, 0, 255)]) };
    const blue = {
      data: new Uint8Array([...px(0, 0, 255, 255), ...px(0, 0, 255, 255)]),
      mask: new Uint8Array([...px(255, 255, 255, 255), ...px(0, 0, 0, 255)]),
    };
    const out = toRgba8(compositeLayers([base, blue], 2, 1));
    expect([...out.subarray(0, 4)]).toEqual([0, 0, 255, 255]);
    expect([...out.subarray(4, 8)]).toEqual([255, 0, 0, 255]);
  });

  it("blends a half-visible layer and rounds (not truncates) to 8 bits", () => {
    const base = { data: new Uint8Array(px(0, 0, 0, 255)) };
    const grey = { data: new Uint8Array(px(255, 255, 255, 255)), mask: new Uint8Array(px(128, 128, 128, 255)) };
    const out = toRgba8(compositeLayers([base, grey], 1, 1));
    // 255 × 128/255 = 128 exactly after rounding.
    expect(out[0]).toBe(128);
    expect(out[3]).toBe(255);
  });

  it("makes the corners transparent and leaves the body opaque", () => {
    const w = 100;
    const h = 140;
    const acc = new Float32Array(w * h * 4).fill(1);
    roundCorners(acc, w, h, 10);
    const alpha = (x: number, y: number) => acc[(y * w + x) * 4 + 3];
    expect(alpha(0, 0)).toBe(0);
    expect(alpha(w - 1, h - 1)).toBe(0);
    expect(alpha(50, 70)).toBe(1);
    expect(alpha(10, 10)).toBe(1);
    expect(alpha(0, 70)).toBe(1); // straight edge, not a corner
    expect(CORNER_RADIUS).toBe(39); // matches the existing masters (2.6 % of 1500)
  });
});

describe("provenance and hygiene", () => {
  it("records the pinned commit and the recipe for every imported template", () => {
    const provenance = JSON.parse(readFileSync("lib/cards/frame-sources.json", "utf8"));
    for (const template of Object.keys(templates)) {
      expect(provenance[template]?.source, template).toBe("cardconjurer");
      expect(provenance[template].commit).toBe(CC_COMMIT);
      expect(Object.keys(provenance[template].colors).sort()).toEqual([...COLORS].sort());
    }
  });

  it("never commits the build folder", () => {
    expect(readFileSync(".gitignore", "utf8")).toMatch(/^\/\.frames-build\/$/m);
  });
});
