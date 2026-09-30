import { execFileSync } from "node:child_process";
import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";
import {
  CC_COMMIT,
  CC_DEFERRED,
  CC_TEMPLATES,
  COLORS,
  CORNER_RADIUS,
  PW_COLOURLESS_RIM_GAIN,
  PW_GOLD_FACE,
  SHIELD_BOX,
  TOKEN_REGULAR_RECUT,
  TOKEN_TEXTLESS_RECUT,
  builtColors,
  compositeLayers,
  cutThroughMask,
  describeLayer,
  recutBand,
  roundCorners,
  roundCornersRgba8,
  sourceFilesFor,
  toRgba8,
} from "@/scripts/lib/cc-frames.mjs";
import { FRAME_TEMPLATE_VALUES } from "@/types/card";
import { applyCardCornerMask, cardCornerRadiusPx } from "@/lib/cards/card-corner";
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

type Layer = {
  src: string;
  mask?: string;
  invert?: boolean;
  opacity?: number;
  gain?: number;
  recolour?: boolean;
  lumaRamp?: readonly number[];
};
type Def = {
  colors: Record<string, Layer[]>;
  plates?: Record<string, string>;
  symbols?: Record<string, string>;
  shield?: { mask: string; box: typeof SHIELD_BOX };
  recut?: { fromY: number; toY: number; shift: number; blend: number; blendBottom?: number };
  excluded?: Record<string, string>;
  pack?: string;
  transforms?: string;
  notes: string[];
};
const templates = CC_TEMPLATES as Record<string, Def>;
/** The re-cut templates (TODO 4.49): each pair has its own band. */
const TEXTLESS_TOKENS = ["m15token", "m15tokenartifact"];
const TEXT_BOX_TOKENS = ["m15tokentext", "m15tokenartifacttext"];

describe("Card Conjurer recipe", () => {
  it("covers the M15-era, borderless and full-art-basic templates — every colour built or excluded with a reason — with pack paths", () => {
    expect(Object.keys(templates).sort()).toEqual([
      "fullartland",
      "m15",
      "m15artifact",
      "m15borderless",
      "m15borderlessartifact",
      "m15borderlesspw",
      "m15borderlesspwtall",
      "m15devoid",
      "m15fullartland",
      "m15land",
      "m15pw",
      "m15snow",
      "m15snowland",
      "m15token",
      "m15tokenartifact",
      "m15tokenartifacttext",
      "m15tokentext",
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

  it("sources the text-box tokens from CC's 'Regular (Bordered M15)' pack, re-cut onto the prints (TODO 4.49 (b))", () => {
    for (const template of TEXT_BOX_TOKENS) {
      const def = templates[template];
      expect(def.recut, template).toBe(TOKEN_REGULAR_RECUT);
      for (const k of COLORS) {
        for (const l of def.colors[k]) expect(l.src, `${template}/${k}`).toMatch(/^img\/frames\/token\/m15\/regular\/[wubrgma]\.png$/);
      }
      // The lower band 64 px down (3.05 %H): the prints end the art ~64 px
      // below CC's master and print the pill and box as much lower.
      expect(def.recut, template).toEqual({ fromY: 1240, toY: 1560, shift: 64, blend: 24 });
      expect(def.pack).toBe("packTokenRegularM15.js 'Regular (Bordered M15)'");
      expect(def.transforms).toMatch(/re-cut: rows 1240–1559 .* moved down 64 px/);
      // Both seams over 24 rows: the textless tokens' 2-row bottom seam
      // (blendBottom) is theirs alone.
      expect(def.transforms).toMatch(/each seam cross-faded over 24 rows/);
    }
    // No other template is re-cut by this band: the textless tokens have
    // their own (TOKEN_TEXTLESS_RECUT, the next test), the rest none.
    for (const [template, def] of Object.entries(templates)) {
      if (TEXT_BOX_TOKENS.includes(template)) continue;
      if (TEXTLESS_TOKENS.includes(template)) expect(def.recut, template).toBe(TOKEN_TEXTLESS_RECUT);
      else expect(def.recut, template).toBeUndefined();
    }
    // The colourless text-box token is see-through like m15token's, its box
    // too (BFZ #2 / OGW #1 Eldrazi Scion); border, title and pinline opaque.
    const c = templates.m15tokentext.colors.c;
    expect(c.every((l) => l.src.endsWith("token/m15/regular/a.png"))).toBe(true);
    expect(c.find((l) => l.mask?.endsWith("frame.svg"))?.opacity).toBe(0.35);
    expect(c.find((l) => l.mask?.endsWith("tokenMaskRegularType.png"))?.opacity).toBe(0.8);
    expect(c.find((l) => l.mask?.endsWith("tokenMaskRegularRules.png"))?.opacity).toBe(0.8);
    for (const opaque of ["m15MaskBorder.png", "m15MaskTitle.png", "pinline.svg"]) {
      expect(c.find((l) => l.mask?.endsWith(opaque))?.opacity, opaque).toBeUndefined();
    }
    // A coloured artifact keeps the SILVER box (TC16 #9, TC18 #8): the box
    // is the artifact frame's, the colour through title, type and pinline.
    const u = templates.m15tokenartifacttext.colors.u;
    expect(u.map((l) => [l.src.split("/").pop(), l.mask?.split("/").pop()])).toEqual([
      ["a.png", "m15MaskBorder.png"],
      ["a.png", "frame.svg"],
      ["a.png", "tokenMaskRegularRules.png"],
      ["u.png", "m15MaskTitle.png"],
      ["u.png", "tokenMaskRegularType.png"],
      ["u.png", "pinline.svg"],
    ]);
    expect(templates.m15tokenartifacttext.colors.c).toEqual([{ src: "img/frames/token/m15/regular/a.png" }]);
  });

  it("re-cuts the textless tokens onto the prints: window edge, pill and shadow 8 px down (TODO 4.49, owner decision 2026-09-29)", () => {
    // The fifteen textless pins print CC's window edge, type pill and the
    // pill's shadow 8.2 px lower on average; the title, the texture under
    // the pill and the border where CC draws them. Rows 1640 (the window's
    // straight sides) to 1856 (the shadow's last row; the texture starts at
    // 1857) move 8 px, the top seam cross-faded over 24 rows, the bottom one
    // over only the shadow's last 2 rows, so the pill keeps its lower edge.
    expect(TOKEN_TEXTLESS_RECUT).toEqual({ fromY: 1640, toY: 1857, shift: 8, blend: 24, blendBottom: 2 });
    for (const template of TEXTLESS_TOKENS) {
      const def = templates[template];
      expect(def.recut, template).toBe(TOKEN_TEXTLESS_RECUT);
      expect(def.pack, template).toBe("packTokenTextlessM15.js 'Textless (Bordered M15)'");
      expect(def.transforms, template).toMatch(/re-cut: rows 1640–1856 .* moved down 8 px/);
      expect(def.transforms, template).toMatch(/no resample/);
      // Every colour is still a composite of the textless pack's pixels.
      for (const k of COLORS) for (const l of def.colors[k]) expect(l.src, `${template}/${k}`).toMatch(/^img\/frames\/token\/m15\/textless\/[wubrgma]\.png$/);
    }
    // No other template is re-cut by this band: the text-box tokens keep
    // their own (TOKEN_REGULAR_RECUT, the test above: no blendBottom, the
    // bottom seam over `blend` rows), the rest none.
    for (const [template, def] of Object.entries(templates)) {
      if (TEXTLESS_TOKENS.includes(template)) continue;
      if (TEXT_BOX_TOKENS.includes(template)) expect(def.recut, template).toBe(TOKEN_REGULAR_RECUT);
      else expect(def.recut, template).toBeUndefined();
    }
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
      "m15land", "m15snow", "m15pw", "m15token", "m15tokentext", "m15devoid",
      "m15borderless", "m15borderlessartifact", "m15fullartland", "fullartland",
      "m15borderlesspw", "m15borderlesspwtall",
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
    expect(Object.entries(templates).filter(([, d]) => d.shield).map(([t]) => t)).toEqual([
      "m15pw",
      "m15borderlesspw",
      "m15borderlesspwtall",
    ]);
  });

  it("imports the borderless planeswalkers 1:1 per colour, with the same shield cut (4.33)", () => {
    const regular = templates.m15borderlesspw;
    const tall = templates.m15borderlesspwtall;
    for (const k of ["w", "u", "b", "r", "g"]) {
      expect(regular.colors[k]).toEqual([{ src: `img/frames/planeswalker/borderless/${k}.png` }]);
      expect(tall.colors[k]).toEqual([{ src: `img/frames/planeswalker/tallBorderless/${k}.png` }]);
    }
    // The regular pack has no colourless frame: its 'Artifact Frame', the
    // rim lifted to opaque (the tall pack's own Colorless rim is α 1).
    expect(regular.colors.c).toEqual([{ src: "img/frames/planeswalker/borderless/a.png", gain: PW_COLOURLESS_RIM_GAIN }]);
    expect(PW_COLOURLESS_RIM_GAIN).toBeCloseTo(255 / 234, 12);
    expect(tall.colors.c).toEqual([{ src: "img/frames/planeswalker/tallBorderless/c.png" }]);
    for (const def of [regular, tall]) {
      expect(def.shield).toEqual({ mask: "img/frames/planeswalker/maskLoyalty.png", box: SHIELD_BOX });
      expect(def.plates).toBeUndefined();
      // Neither pack's Land frame, nor the tall pack's white-rimmed Artifact.
      expect(sourceFilesFor(def as never).some((f) => /\/(l|tallBorderless\/a)\.png$/.test(f))).toBe(false);
      expect(def.notes.join(" ")).toMatch(/colourless/);
    }
    expect(regular.pack).toMatch(/^packPlaneswalkerBorderless[.]js/);
    expect(tall.pack).toMatch(/^packPlaneswalkerTallBorderless[.]js/);
    expect(describeLayer(regular.colors.c[0])).toBe(
      "img/frames/planeswalker/borderless/a.png with its alpha ×1.0897 (clamped at 1)",
    );
  });

  it("builds the gold walker's faces from the pack's white frame over its m frame — matched to the prints (4.33 round 15)", () => {
    const title = "img/frames/planeswalker/regular/planeswalkerMaskTitle.png";
    const face = { recolour: true, opacity: 0.9, lumaRamp: [235, 250] };
    expect(PW_GOLD_FACE).toEqual({ opacity: 0.9, lumaRamp: [235, 250] });
    expect(templates.m15borderlesspw.colors.m).toEqual([
      { src: "img/frames/planeswalker/borderless/m.png" },
      { src: "img/frames/planeswalker/borderless/w.png", mask: title, ...face },
      { src: "img/frames/planeswalker/borderless/w.png", mask: "img/frames/planeswalker/regular/planeswalkerMaskType.png", ...face },
    ]);
    // The tall pack's own masters and its own Type mask (packPlaneswalkerTallBorderless.js).
    expect(templates.m15borderlesspwtall.colors.m).toEqual([
      { src: "img/frames/planeswalker/tallBorderless/m.png" },
      { src: "img/frames/planeswalker/tallBorderless/w.png", mask: title, ...face },
      { src: "img/frames/planeswalker/tallBorderless/w.png", mask: "img/frames/planeswalker/tall/planeswalkerTallMaskType.png", ...face },
    ]);
    for (const template of ["m15borderlesspw", "m15borderlesspwtall"]) {
      expect(templates[template].notes.join(" "), template).toMatch(/gold \(m\) = MATCHED TO THE PRINTS/);
      expect(sourceFilesFor(templates[template] as never)).toContain(title);
    }
    expect(describeLayer(templates.m15borderlesspw.colors.m[1])).toBe(
      `img/frames/planeswalker/borderless/w.png through ${title} recolouring the layers below (their alpha kept) at 90%, weighted by its own luminance from 235 (0) to 250 (full)`,
    );
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
    expect(describeLayer({ src: "a.png", mask: "m.png", recolour: true, opacity: 0.9, lumaRamp: [235, 250] })).toBe(
      "a.png through m.png recolouring the layers below (their alpha kept) at 90%, weighted by its own luminance from 235 (0) to 250 (full)",
    );
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

  describe("recutBand (TODO 4.49's re-cuts: the textless and the text-box tokens)", () => {
    /** A 1-px-wide column of rows, each row's red = its index, alpha 255
     *  (rows ≥ 256 would overflow: callers keep H ≤ 200). */
    const column = (h: number, alphaAt?: (y: number) => number) => {
      const buf = Buffer.alloc(h * 4);
      for (let y = 0; y < h; y += 1) buf.set([y, 0, 0, alphaAt ? alphaAt(y) : 255], y * 4);
      return buf;
    };
    const red = (buf: Buffer, y: number) => buf[y * 4];

    it("moves the band down, repeats the rows above it into the gap and keeps everything below", () => {
      const out = recutBand(column(40), 1, 40, { fromY: 10, toY: 20, shift: 5, blend: 0 });
      // Above the band: untouched.
      for (let y = 0; y < 10; y += 1) expect(red(out, y), `row ${y}`).toBe(y);
      // The opened rows repeat the 5 rows above the band; the band (rows
      // 10–19) follows, 5 rows lower.
      expect(Array.from({ length: 15 }, (_, i) => red(out, 10 + i))).toEqual([
        5, 6, 7, 8, 9, 10, 11, 12, 13, 14, 15, 16, 17, 18, 19,
      ]);
      // Below the moved band: untouched — the rows it now covers (20–24)
      // are gone.
      for (let y = 25; y < 40; y += 1) expect(red(out, y), `row ${y}`).toBe(y);
    });

    it("cross-fades each seam, premultiplied: the top over `blend` rows, the bottom over `blendBottom` (default `blend`)", () => {
      const out = recutBand(column(60), 1, 60, { fromY: 20, toY: 30, shift: 10, blend: 3 });
      // Top seam: row 20 + i mixes the original row (weight 1 − t) and the
      // repeated one (row 10 + i, weight t), t = (i + 1) / 4.
      expect([20, 21, 22].map((y) => red(out, y))).toEqual([
        Math.round(20 * 0.75 + 10 * 0.25),
        Math.round(21 * 0.5 + 11 * 0.5),
        Math.round(22 * 0.25 + 12 * 0.75),
      ]);
      expect(red(out, 23)).toBe(13);
      // Bottom seam (rows 37–39): the moved row into the original one.
      expect([37, 38, 39].map((y) => red(out, y))).toEqual([
        Math.round(27 * 0.75 + 37 * 0.25),
        Math.round(28 * 0.5 + 38 * 0.5),
        Math.round(29 * 0.25 + 39 * 0.75),
      ]);
      expect(red(out, 40)).toBe(40);
    });

    it("cuts the bottom seam hard with blendBottom 0 — the textless token's pill keeps its lower edge", () => {
      const out = recutBand(column(60), 1, 60, { fromY: 20, toY: 30, shift: 10, blend: 3, blendBottom: 0 });
      // The top still fades…
      expect(red(out, 20)).toBe(Math.round(20 * 0.75 + 10 * 0.25));
      // …the moved band runs whole to its last row, and the original rows
      // resume on the next one.
      expect([36, 37, 38, 39, 40].map((y) => red(out, y))).toEqual([26, 27, 28, 29, 40]);
    });

    it("blends colour by alpha, so a transparent row adds no colour", () => {
      // Rows 0–9 transparent black, rows ≥ 10 opaque: the top seam at 10
      // mixes opaque row 10 with transparent row 5 → its own red, half alpha.
      const src = column(40, (y) => (y < 10 ? 0 : 255));
      for (let y = 0; y < 10; y += 1) src[y * 4] = 0;
      const out = recutBand(src, 1, 40, { fromY: 10, toY: 20, shift: 5, blend: 1 });
      expect([out[40], out[43]]).toEqual([10, 128]);
    });

    it("refuses a band that doesn't fit, or seams that overlap", () => {
      expect(() => recutBand(column(40), 1, 40, { fromY: 10, toY: 38, shift: 5, blend: 0 })).toThrow(/bad band/);
      expect(() => recutBand(column(40), 1, 40, { fromY: 2, toY: 20, shift: 5, blend: 0 })).toThrow(/bad band/);
      expect(() => recutBand(column(40), 1, 40, { fromY: 10, toY: 20, shift: 5, blend: 12, blendBottom: 12 })).toThrow(/bad band/);
      expect(() => recutBand(column(40), 1, 40, { fromY: 10, toY: 20, shift: 5, blend: 0, blendBottom: -1 })).toThrow(/bad band/);
    });

    it("never touches the source buffer", () => {
      const src = column(40);
      const copy = Buffer.from(src);
      recutBand(src, 1, 40, { fromY: 10, toY: 20, shift: 5, blend: 2 });
      expect(src.equals(copy)).toBe(true);
    });
  });

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
    expect(out[7]).toBe(153); // 255 − 102 (an opaque frame: the same as 255 × (1 − 102/255))
    expect([...out.subarray(8, 12)]).toEqual([90, 90, 90, 255]); // outside: untouched
  });

  it("erases the Border's anti-aliased inner edge completely — no hairline over the art (2026-09-26)", () => {
    // A row across the ring's inner edge as Card Conjurer's 2022 basics draw
    // it: the frame's alpha on the edge IS the ring's coverage (the mask's
    // alpha; the art window beyond is clear), then a bar that reaches into
    // the ring, and one of its rim pixels half over the ring's edge.
    //   x   0 ring · 1–2 ring edge (242, 13 — x 59 / 1439 on the masters) ·
    //       3 clear art · 4 bar across the edge · 5 bar rim over the edge
    const frameA = [255, 242, 13, 0, 255, 220];
    const maskA = [255, 242, 13, 0, 102, 19];
    const frame = {
      data: new Uint8Array(frameA.flatMap((a, x) => (x === 5 ? px(228, 230, 230, a) : px(0, 0, 0, a)))),
      mask: new Uint8Array(maskA.flatMap((a) => px(0, 0, 0, a))),
      invert: true,
    };
    const out = toRgba8(compositeLayers([frame], 6, 1));
    const alpha = (x: number) => out[x * 4 + 3];
    // alpha × (1 − mask alpha) left 12 and 12 here: a 1 px line of ≈5 % black.
    expect([alpha(0), alpha(1), alpha(2), alpha(3)]).toEqual([0, 0, 0, 0]);
    // The bar keeps what the ring doesn't cover, colour untouched.
    expect(alpha(4)).toBe(153);
    expect([...out.subarray(20, 24)]).toEqual([228, 230, 230, 201]);
  });

  it("lifts a see-through layer's alpha by its gain, clamped at 1 (4.33's colourless walker rim)", () => {
    // 3×1: the rim (α 234), a bar (α 191), clear art (α 0).
    const frame = {
      data: new Uint8Array([...px(197, 203, 217, 234), ...px(190, 190, 190, 191), ...px(0, 0, 0, 0)]),
      gain: 255 / 234,
    };
    const out = toRgba8(compositeLayers([frame], 3, 1));
    expect([...out.subarray(0, 4)]).toEqual([197, 203, 217, 255]);
    expect(out[7]).toBe(208); // 191 × 255/234
    expect(out[11]).toBe(0);
    // Above 234 it clamps (a join with the black bar, α 242).
    const join = toRgba8(compositeLayers([{ data: new Uint8Array(px(116, 120, 128, 242)), gain: 255 / 234 }], 1, 1));
    expect(join[3]).toBe(255);
  });

  it("recolours without touching the alpha, weighted by mask × opacity × the layer's own luminance ramp (4.33's gold walker)", () => {
    // 5×1 over a tan base (α 255 ×3, then a see-through face α 217, then clear):
    // a white ground (luma 251: full weight 0.9), a grey vein (luma 230: none),
    // a mid pixel (luma 241: 0.4 × 0.9), the see-through face (as opaque as
    // the base: full weight), clear art (nothing to recolour).
    const tan = [205, 182, 125];
    const base = {
      data: new Uint8Array([
        ...px(tan[0], tan[1], tan[2], 255), ...px(tan[0], tan[1], tan[2], 255), ...px(tan[0], tan[1], tan[2], 255),
        ...px(tan[0], tan[1], tan[2], 217), ...px(0, 0, 0, 0),
      ]),
    };
    const white = {
      data: new Uint8Array([
        ...px(251, 251, 251, 255), ...px(230, 230, 230, 255), ...px(241, 241, 241, 255),
        ...px(251, 251, 251, 217), ...px(251, 251, 251, 255),
      ]),
      mask: new Uint8Array([...px(0, 0, 0, 255), ...px(0, 0, 0, 255), ...px(0, 0, 0, 255), ...px(0, 0, 0, 255), ...px(0, 0, 0, 255)]),
      recolour: true,
      opacity: 0.9,
      lumaRamp: [235, 250],
    };
    const out = toRgba8(compositeLayers([base, white], 5, 1));
    const at = (x: number) => [...out.subarray(x * 4, x * 4 + 4)];
    expect(at(0)).toEqual([246, 244, 238, 255]); // tan × 0.1 + 251 × 0.9
    expect(at(1)).toEqual([...tan, 255]);
    expect(at(2)).toEqual([218, 203, 167, 255]); // tan × 0.64 + 241 × 0.36
    // The see-through face keeps α 217 — recoloured, never made more opaque.
    expect(at(3)).toEqual([246, 244, 238, 217]);
    expect(at(4)).toEqual([0, 0, 0, 0]);
    // Outside its mask it does nothing.
    const masked = toRgba8(compositeLayers([base, { ...white, mask: new Uint8Array(20) }], 5, 1));
    expect([...masked.subarray(0, 4)]).toEqual([...tan, 255]);
    // It needs something below it.
    expect(() => compositeLayers([white], 5, 1)).toThrow(/needs a layer below/);
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
  });

  it("cuts the masters at the one card corner: 4.3 % of the short side, 64.5 px, never rounded (TODO 3.26)", () => {
    // 39 px (Math.round(1500 × 0.026)) before 3.26; Math.round would give 65.
    expect(CORNER_RADIUS).toBe(64.5);
    expect(CORNER_RADIUS).toBe(cardCornerRadiusPx(1500, 2100));
    // The importer's 8-bit cut IS the bake's mask: same pixels.
    const w = 150;
    const h = 210;
    const a = Buffer.alloc(w * h * 4, 255);
    const b = Buffer.alloc(w * h * 4, 255);
    roundCornersRgba8(a, w, h, 6.45);
    applyCardCornerMask(b, w, h);
    expect(a.equals(b)).toBe(true);
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
      for (const template of [
        "m15borderless", "m15borderlessartifact", "m15fullartland", "fullartland", "m15borderlesspw", "m15borderlesspwtall",
      ]) {
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
      // Every master was cut at the one card corner (TODO 3.26's re-import).
      expect(provenance[template].output, template).toBe(`1500x2100, corners rounded to ${CORNER_RADIUS}px, webp q90`);
      expect(provenance[template].output, template).toContain("64.5px");
      expect(Object.keys(provenance[template].colors).sort()).toEqual([...COLORS].sort());
    }
    expect(provenance.m15devoid.source).toBe("cardconjurer");
    // The later runs name their pack and what was done to its pixels.
    for (const template of [
      "m15borderless", "m15borderlessartifact", "m15fullartland", "fullartland", "m15tokentext", "m15tokenartifacttext",
      "m15borderlesspw", "m15borderlesspwtall",
    ]) {
      expect(provenance[template].pack, template).toBe(templates[template].pack);
      expect(provenance[template].transforms, template).toMatch(/no resample/);
      expect(provenance[template].sourceFiles, template).toEqual(sourceFilesFor(templates[template] as never));
    }
    expect(Object.keys(provenance.fullartland.symbols).sort()).toEqual(["b", "c", "g", "output", "r", "u", "w"]);
    expect(provenance.fullartland.colors.w).toEqual([
      "img/frames/textless/2022/w.png outside img/frames/textless/2022/maskBorder.png",
    ]);
    // The text-box tokens record their re-cut (TODO 4.49 (b)).
    for (const template of TEXT_BOX_TOKENS) {
      expect(provenance[template].recut, template).toEqual(TOKEN_REGULAR_RECUT);
    }
    // The textless tokens record their re-cut (TODO 4.49), its pack and what
    // it did to the pixels.
    for (const template of TEXTLESS_TOKENS) {
      expect(provenance[template].recut, template).toEqual(TOKEN_TEXTLESS_RECUT);
      expect(provenance[template].pack, template).toBe(templates[template].pack);
      expect(provenance[template].transforms, template).toBe(templates[template].transforms);
      expect(provenance[template].notes, template).toEqual(templates[template].notes);
    }
    expect(provenance.m15.recut).toBeUndefined();
  });

  it("never commits the build folder", () => {
    expect(readFileSync(".gitignore", "utf8")).toMatch(/^\/\.frames-build\/$/m);
    // 2026-09-25: a `git add -A` on a branch cut before the ignore rule
    // committed 182 Card Conjurer masters; CI must fail if that ever recurs.
    const tracked = execFileSync("git", ["ls-files", "--", ".frames-build"], { encoding: "utf8" }).trim();
    expect(tracked).toBe("");
  });
});
