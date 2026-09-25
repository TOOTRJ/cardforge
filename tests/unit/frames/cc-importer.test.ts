import { execFileSync } from "node:child_process";
import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";
import {
  CC_COMMIT,
  CC_DEFERRED,
  CC_TEMPLATES,
  COLORS,
  CORNER_RADIUS,
  builtColors,
  compositeLayers,
  roundCorners,
  roundCornersRgba8,
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
type Def = { colors: Record<string, Layer[]>; plates?: Record<string, string>; excluded?: Record<string, string>; notes: string[] };
const templates = CC_TEMPLATES as Record<string, Def>;

describe("Card Conjurer recipe", () => {
  it("covers the M15-era templates — every colour built or excluded with a reason — with pack paths", () => {
    expect(Object.keys(templates).sort()).toEqual(
      ["m15", "m15artifact", "m15land", "m15pw", "m15snow", "m15snowland", "m15token", "m15tokenartifact"],
    );
    for (const [template, def] of Object.entries(templates)) {
      expect(FRAME_TEMPLATE_VALUES as readonly string[]).toContain(template);
      const covered = [...builtColors(def as never), ...Object.keys(def.excluded ?? {})].sort();
      expect(covered, template).toEqual([...COLORS].sort());
      for (const file of sourceFilesFor(def as never)) {
        expect(file, `${template}: ${file}`).toMatch(/^img\/frames\/[\w/]+\.(png|svg)$/);
      }
    }
  });

  it("builds coloured artifacts with CC's recipe: artifact frame + border, colour interior (TODO 4.16)", () => {
    // m15artifact: a.png through border + frame, then the colour through
    // rules, title, type, pinline (CC's draw order). Inverted before 2026-09-25.
    const m15 = templates.m15artifact.colors.u;
    expect(m15.map((l) => [l.src.split("/").pop(), l.mask?.split("/").pop()])).toEqual([
      ["a.png", "border.png"],
      ["a.png", "frame.png"],
      ["u.png", "rules.png"],
      ["u.png", "title.png"],
      ["u.png", "type.png"],
      ["u.png", "pinline.png"],
    ]);
    // Textless tokens have no rules box: title, type, pinline only.
    const token = templates.m15tokenartifact.colors.r;
    expect(token.slice(2).map((l) => l.mask?.split("/").pop())).toEqual([
      "m15MaskTitle.png",
      "tokenMaskTextlessType.png",
      "pinline.svg",
    ]);
    expect(templates.m15artifact.colors.c).toHaveLength(1);
    expect(templates.m15tokenartifact.colors.c).toHaveLength(1);
  });

  it("sources tokens from CC's textless bordered pack (its geometry matches M15TOKEN)", () => {
    for (const layer of templates.m15token.colors.w) expect(layer.src).toMatch(/^img\/frames\/token\/m15\/textless\//);
  });

  it("defers see-through frames until art can run under the frame (4.17)", () => {
    expect(templates.m15.excluded?.c).toMatch(/see-through/);
    expect(builtColors(templates.m15 as never)).not.toContain("c");
    expect((CC_DEFERRED as Record<string, string>).m15devoid).toMatch(/see-through/);
  });

  it("writes down every colourless substitution", () => {
    for (const template of ["m15land", "m15snow", "m15pw", "m15token"]) {
      expect(templates[template].notes.join(" "), template).toMatch(/colourless/);
    }
    // The planeswalker's painted shield must travel with the frames until 4.4 drops our plate.
    expect(templates.m15pw.notes.join(" ")).toMatch(/loyalty shield/);
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

  it("shows an upper layer only through its mask's ALPHA — mask colour is irrelevant (CC's source-in)", () => {
    // 2×1: red base; blue overlay through a mask that is opaque RED at x=0
    // (like CC's title mask) and transparent at x=1.
    const base = { data: new Uint8Array([...px(255, 0, 0, 255), ...px(255, 0, 0, 255)]) };
    const blue = {
      data: new Uint8Array([...px(0, 0, 255, 255), ...px(0, 0, 255, 255)]),
      mask: new Uint8Array([...px(255, 0, 0, 255), ...px(0, 0, 0, 0)]),
    };
    const out = toRgba8(compositeLayers([base, blue], 2, 1));
    expect([...out.subarray(0, 4)]).toEqual([0, 0, 255, 255]);
    expect([...out.subarray(4, 8)]).toEqual([255, 0, 0, 255]);
  });

  it("blends a half-visible layer and rounds (not truncates) to 8 bits", () => {
    const base = { data: new Uint8Array(px(0, 0, 0, 255)) };
    const grey = { data: new Uint8Array(px(255, 255, 255, 255)), mask: new Uint8Array(px(0, 255, 0, 128)) };
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

  it("rounds corners on 8-bit RGBA after the final downscale", () => {
    const w = 60;
    const h = 84;
    const buf = Buffer.alloc(w * h * 4, 255);
    roundCornersRgba8(buf, w, h, 8);
    expect(buf[3]).toBe(0);
    expect(buf[((h - 1) * w + (w - 1)) * 4 + 3]).toBe(0);
    expect(buf[(42 * w + 30) * 4 + 3]).toBe(255);
  });
});

describe("provenance and hygiene", () => {
  it("records the pinned commit and the recipe for every imported template", () => {
    const provenance = JSON.parse(readFileSync("lib/cards/frame-sources.json", "utf8"));
    expect(Object.keys(provenance).sort()).toEqual(Object.keys(templates).sort());
    for (const template of Object.keys(templates)) {
      expect(provenance[template]?.source, template).toBe("cardconjurer");
      expect(provenance[template].commit).toBe(CC_COMMIT);
      expect(Object.keys(provenance[template].colors).sort()).toEqual([...COLORS].sort());
    }
    expect(provenance.m15.excluded.c).toMatch(/see-through/);
  });

  it("never commits the build folder", () => {
    expect(readFileSync(".gitignore", "utf8")).toMatch(/^\/\.frames-build\/$/m);
    // 2026-09-25: a `git add -A` on a branch cut before the ignore rule
    // committed 182 Card Conjurer masters; CI must fail if that ever recurs.
    const tracked = execFileSync("git", ["ls-files", "--", ".frames-build"], { encoding: "utf8" }).trim();
    expect(tracked).toBe("");
  });
});
