import { execFileSync } from "node:child_process";
import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";
import {
  CC_COMMIT,
  CC_DEFERRED,
  CC_TEMPLATES,
  COLORS,
  CORNER_RADIUS,
  SHIELD_BOX,
  builtColors,
  compositeLayers,
  cutThroughMask,
  describeLayer,
  roundCorners,
  roundCornersRgba8,
  sourceFilesFor,
  toRgba8,
} from "@/scripts/lib/cc-frames.mjs";
import { FRAME_TEMPLATE_VALUES } from "@/types/card";
import manifestJson from "@/lib/frames/frame-manifest.json";
import { frameUrl, setFrameStorageForTests, type FrameManifest } from "@/lib/frames/frame-url";

// ---------------------------------------------------------------------------
// The Card Conjurer importer's pure half (scripts/lib/cc-frames.mjs, frames
// plan 4.3). Contract: the recipe covers the nine M15-era templates, 4.32's
// borderless pair and 4.39's full-art basics × seven colours with real pack
// paths; blended frames go through CC's pinline mask and every substitution
// is written down; the pixel ops (mask compositing, inverted masks, rounded
// transparent corners, 8-bit rounding) behave; provenance matches the
// pinned commit; the build folder is never committed.
// ---------------------------------------------------------------------------

type Layer = { src: string; mask?: string; invert?: boolean; opacity?: number };
type Def = {
  colors: Record<string, Layer[]>;
  plates?: Record<string, string>;
  symbols?: Record<string, string>;
  shield?: { mask: string; box: typeof SHIELD_BOX };
  excluded?: Record<string, string>;
  pack?: string;
  transforms?: string;
  notes: string[];
};
const templates = CC_TEMPLATES as Record<string, Def>;

describe("Card Conjurer recipe", () => {
  it("covers the M15-era, borderless and full-art-basic templates — every colour built or excluded with a reason — with pack paths", () => {
    expect(Object.keys(templates).sort()).toEqual([
      "fullartland",
      "m15",
      "m15artifact",
      "m15borderless",
      "m15borderlessartifact",
      "m15devoid",
      "m15fullartland",
      "m15land",
      "m15pw",
      "m15snow",
      "m15snowland",
      "m15token",
      "m15tokenartifact",
    ]);
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

  it("imports the see-through frames now that art runs under the frame (4.17, owner decision)", () => {
    expect(builtColors(templates.m15 as never)).toContain("c");
    expect(templates.m15.colors.c[0].src).toBe("img/frames/m15/new/c.png");
    expect(templates.m15devoid.colors.u[0].src).toMatch(/m15DevoidFrameU\.png$/);
    expect(Object.keys(CC_DEFERRED as Record<string, string>)).toEqual([]);
  });

  it("builds the colourless creature token as a see-through composite of CC's silver token frame", () => {
    const layers = (templates.m15token.colors.c as Array<{ src: string; mask?: string; opacity?: number }>);
    expect(layers.every((l) => l.src.endsWith("token/m15/textless/a.png"))).toBe(true);
    // Frame and type bar translucent (art shows through); border, title and window pinline opaque.
    expect(layers.find((l) => l.mask?.endsWith("frame.svg"))?.opacity).toBeLessThan(0.5);
    expect(layers.find((l) => l.mask?.endsWith("m15MaskTitle.png"))?.opacity).toBeUndefined();
    expect(layers.find((l) => l.mask?.endsWith("pinline.svg"))?.opacity).toBeUndefined();
  });

  it("writes down every colourless substitution", () => {
    for (const template of [
      "m15land", "m15snow", "m15pw", "m15token", "m15devoid",
      "m15borderless", "m15borderlessartifact", "m15fullartland", "fullartland",
    ]) {
      expect(templates[template].notes.join(" "), template).toMatch(/colourless/);
    }
    expect(templates.m15pw.notes.join(" ")).toMatch(/loyalty shield/);
  });

  it("cuts the planeswalker shield out through CC's loyalty mask (owner review 2026-09-25)", () => {
    expect(templates.m15pw.shield).toEqual({ mask: "img/frames/planeswalker/maskLoyalty.png", box: SHIELD_BOX });
    expect(sourceFilesFor(templates.m15pw as never)).toContain("img/frames/planeswalker/maskLoyalty.png");
    // CC's mask covers x 1197–1430, y 1844–1991 on the 1500×2100 master.
    expect(SHIELD_BOX.x).toBeLessThanOrEqual(1197);
    expect(SHIELD_BOX.y).toBeLessThanOrEqual(1844);
    expect(SHIELD_BOX.x + SHIELD_BOX.width).toBeGreaterThan(1430);
    expect(SHIELD_BOX.y + SHIELD_BOX.height).toBeGreaterThan(1991);
    expect(Object.entries(templates).filter(([, d]) => d.shield).map(([t]) => t)).toEqual(["m15pw"]);
  });

  it("imports 'Borderless (Alt)' 1:1 per colour, colourless from C, artifacts from A, the pack's plates (4.32)", () => {
    const frame = (k: string) => `img/frames/m15/borderless/m15GenericShowcaseFrame${k}.png`;
    const plain = templates.m15borderless;
    for (const k of ["w", "u", "b", "r", "g", "m"]) expect(plain.colors[k]).toEqual([{ src: frame(k.toUpperCase()) }]);
    expect(plain.colors.c).toEqual([{ src: frame("C") }]);
    // CC's L is 4.34's land frame, never a colour of this template.
    expect(sourceFilesFor(plain as never).some((f) => f.endsWith("FrameL.png"))).toBe(false);
    // The pack's own "Colorless Power/Toughness" plate is pt/l.png.
    expect(plain.plates?.c).toBe("img/frames/m15/borderless/pt/l.png");
    expect(plain.plates?.w).toBe("img/frames/m15/borderless/pt/w.png");
    const artifact = templates.m15borderlessartifact;
    expect(artifact.colors.c).toEqual([{ src: frame("A") }]);
    expect(artifact.plates?.c).toBe("img/frames/m15/borderless/pt/a.png");
    // A coloured borderless artifact wears the colour frame (no frame body
    // to keep from the artifact frame; its Border matches every colour's).
    for (const k of ["w", "u", "b", "r", "g", "m"]) {
      expect(artifact.colors[k]).toEqual(plain.colors[k]);
      expect(artifact.plates?.[k]).toBe(plain.plates?.[k]);
    }
    for (const def of [plain, artifact]) expect(def.pack).toMatch(/^packBorderless[.]js/);
  });

  it("builds both full-art basics from 'Fullart Basics (2022)': bordered whole, borderless without the Border mask (4.39)", () => {
    const bordered = templates.m15fullartland;
    const borderless = templates.fullartland;
    const border = "img/frames/textless/2022/maskBorder.png";
    for (const k of ["w", "u", "b", "r", "g", "m"]) {
      expect(bordered.colors[k]).toEqual([{ src: `img/frames/textless/2022/${k}.png` }]);
      // The same composite with the ring erased (owner decision 4.35(a)).
      expect(borderless.colors[k]).toEqual([{ src: `img/frames/textless/2022/${k}.png`, mask: border, invert: true }]);
    }
    // Wastes wears CC's "Colorless Frame".
    expect(bordered.colors.c[0].src).toBe("img/frames/textless/2022/l.png");
    expect(borderless.colors.c[0].src).toBe("img/frames/textless/2022/l.png");
    // The 168 px symbol discs, one per basic colour — no multicolour basic.
    for (const def of [bordered, borderless]) {
      expect(def.symbols).toEqual({
        w: "img/frames/textless/2022/sw.png",
        u: "img/frames/textless/2022/su.png",
        b: "img/frames/textless/2022/sb.png",
        r: "img/frames/textless/2022/sr.png",
        g: "img/frames/textless/2022/sg.png",
        c: "img/frames/textless/2022/sc.png",
      });
      expect(def.plates).toBeUndefined();
      expect(def.pack).toMatch(/^packTextlessBasics2022[.]js/);
      expect(sourceFilesFor(def as never)).toContain("img/frames/textless/2022/sc.png");
    }
    expect(describeLayer(borderless.colors.w[0])).toBe(`img/frames/textless/2022/w.png outside ${border}`);
  });

  it("describes layers the way provenance prints them", () => {
    expect(describeLayer({ src: "a.png" })).toBe("a.png");
    expect(describeLayer({ src: "a.png", mask: "m.png" })).toBe("a.png through m.png");
    expect(describeLayer({ src: "a.png", mask: "m.png", opacity: 0.35 })).toBe("a.png through m.png at 35%");
    expect(describeLayer({ src: "a.png", mask: "m.png", invert: true })).toBe("a.png outside m.png");
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

  it("an inverted mask keeps the layer everywhere EXCEPT the mask (a borderless key drops the Border)", () => {
    // 3×1 opaque grey frame; the mask is opaque at x=0, 40 % at x=1, clear at x=2.
    const frame = {
      data: new Uint8Array([...px(90, 90, 90, 255), ...px(90, 90, 90, 255), ...px(90, 90, 90, 255)]),
      mask: new Uint8Array([...px(0, 0, 0, 255), ...px(0, 0, 0, 102), ...px(0, 0, 0, 0)]),
      invert: true,
    };
    const out = toRgba8(compositeLayers([frame], 3, 1));
    expect(out[3]).toBe(0); // inside the mask: erased
    expect(out[7]).toBe(153); // 255 × (1 − 102/255)
    expect([...out.subarray(8, 12)]).toEqual([90, 90, 90, 255]); // outside: untouched
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

  it("crops a box and keeps only what the mask's alpha covers, colour untouched", () => {
    // 3×2 image, every pixel opaque grey 100; the mask is opaque at (1,0),
    // half at (2,1), clear elsewhere.
    const buf = Buffer.alloc(3 * 2 * 4);
    for (let i = 0; i < buf.length; i += 4) buf.set([100, 100, 100, 255], i);
    const mask = Buffer.alloc(3 * 2 * 4);
    mask[(0 * 3 + 1) * 4 + 3] = 255;
    mask[(1 * 3 + 2) * 4 + 3] = 128;
    const out = cutThroughMask(buf, mask, 3, { x: 1, y: 0, width: 2, height: 2 });
    expect(out.length).toBe(2 * 2 * 4);
    expect([...out.subarray(0, 4)]).toEqual([100, 100, 100, 255]); // (1,0)
    expect(out[4 + 3]).toBe(0); // (2,0)
    expect(out[8 + 3]).toBe(0); // (1,1)
    expect([...out.subarray(12, 16)]).toEqual([100, 100, 100, 128]); // (2,1)
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

describe("published to the frames bucket", () => {
  const manifest = manifestJson as FrameManifest;
  /** Every file a template's recipe writes, with its expected size. */
  const outputsOf = (template: string, def: Def): Array<[string, number, number]> => {
    const out: Array<[string, number, number]> = builtColors(def as never).map((k) => [`${template}/${k}.png`, 1500, 2100]);
    const plateSize: [number, number] = template.startsWith("m15borderless") ? [274, 140] : [0, 0];
    for (const k of Object.keys(def.plates ?? {})) out.push([`${template}/pt/${k}.png`, ...plateSize]);
    for (const k of Object.keys(def.symbols ?? {})) out.push([`${template}/symbol/${k}.png`, 168, 168]);
    if (def.shield) for (const k of builtColors(def as never)) out.push([`${template}/loyalty/${k}.png`, def.shield.box.width, def.shield.box.height]);
    return out;
  };

  it("lists every master, plate, symbol disc and shield the recipe writes — PNG and WebP, at the right size", () => {
    for (const [template, def] of Object.entries(templates)) {
      for (const [key, width, height] of outputsOf(template, def)) {
        for (const variant of [key, key.replace(/\.png$/, ".webp")]) {
          const entry = manifest.files[variant];
          expect(entry, `${variant} is not in the manifest`).toBeDefined();
          if (width) expect([entry.width, entry.height], variant).toEqual([width, height]);
        }
      }
    }
  });

  it("resolves the 4.32 / 4.39 frames to content-addressed bucket objects, never /frames (git)", () => {
    const restore = setFrameStorageForTests({ origin: "https://bucket.example/frames" });
    try {
      for (const template of ["m15borderless", "m15borderlessartifact", "m15fullartland", "fullartland"]) {
        for (const [key] of outputsOf(template, templates[template])) {
          for (const variant of [key, key.replace(/\.png$/, ".webp")]) {
            const { hash } = manifest.files[variant];
            const dot = variant.lastIndexOf(".");
            expect(frameUrl(`/frames/${variant}`)).toBe(
              `https://bucket.example/frames/${variant.slice(0, dot)}.${hash}${variant.slice(dot)}`,
            );
          }
        }
      }
      // A basic land has no multicolour disc: nothing is published for it.
      expect(manifest.files["fullartland/symbol/m.png"]).toBeUndefined();
      expect(frameUrl("/frames/fullartland/symbol/m.png")).toBe("/frames/fullartland/symbol/m.png");
    } finally {
      restore();
    }
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
    expect(provenance.m15devoid.source).toBe("cardconjurer");
    // The later runs name their pack and what was done to its pixels.
    for (const template of ["m15borderless", "m15borderlessartifact", "m15fullartland", "fullartland"]) {
      expect(provenance[template].pack, template).toBe(templates[template].pack);
      expect(provenance[template].transforms, template).toMatch(/no resample/);
      expect(provenance[template].sourceFiles, template).toEqual(sourceFilesFor(templates[template] as never));
    }
    expect(Object.keys(provenance.fullartland.symbols).sort()).toEqual(["b", "c", "g", "output", "r", "u", "w"]);
    expect(provenance.fullartland.colors.w).toEqual([
      "img/frames/textless/2022/w.png outside img/frames/textless/2022/maskBorder.png",
    ]);
  });

  it("never commits the build folder", () => {
    expect(readFileSync(".gitignore", "utf8")).toMatch(/^\/\.frames-build\/$/m);
    // 2026-09-25: a `git add -A` on a branch cut before the ignore rule
    // committed 182 Card Conjurer masters; CI must fail if that ever recurs.
    const tracked = execFileSync("git", ["ls-files", "--", ".frames-build"], { encoding: "utf8" }).trim();
    expect(tracked).toBe("");
  });
});
