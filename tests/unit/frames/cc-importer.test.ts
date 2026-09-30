import { execFileSync } from "node:child_process";
import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";
import {
  CC_COMMIT,
  CC_DEFERRED,
  CC_TEMPLATES,
  COLORS,
  CORNER_RADIUS,
  EMBLEM_NAME_PILL_TONE,
  EMBLEM_RAY_BRIDGE,
  EMBLEM_SILVER_TONE,
  EMBLEM_TEXT_BOX_TONE,
  EMBLEM_TONES,
  EMBLEM_TYPE_PILL_TONE,
  SHIELD_BOX,
  TOKEN_REGULAR_RECUT,
  TOKEN_TEXTLESS_RECUT,
  applyTone,
  bridgeRayTip,
  builtColors,
  compositeLayers,
  cutThroughMask,
  describeLayer,
  gainAt,
  recutBand,
  roundCorners,
  roundCornersRgba8,
  silverGainAt,
  sourceFilesFor,
  toRgba8,
  toneRegion,
  toneSilver,
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

type Layer = { src: string; mask?: string; invert?: boolean; opacity?: number };
type Def = {
  colors: Record<string, Layer[]>;
  plates?: Record<string, string>;
  symbols?: Record<string, string>;
  shield?: { mask: string; box: typeof SHIELD_BOX };
  recut?: { fromY: number; toY: number; shift: number; blend: number; blendBottom?: number };
  bridge?: typeof EMBLEM_RAY_BRIDGE;
  tones?: readonly object[];
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
      "emblem",
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

  // TODO 4.52: the emblem is CC's one 'Planeswalker Emblems' master, 1:1 — no
  // re-cut (its bars, box and spark sit within 3 px of TFDN #24 / #25, TBLB
  // #30, TDSK #17, TFRA #16) — for every colour key: an emblem is colourless
  // (CR 114) and each key keeps a master.
  it("builds the emblem from CC's one emblem master, the same file for every key (TODO 4.52)", () => {
    const def = templates.emblem;
    // No re-cut: its touches are the ray's bridge and the tones, below.
    expect(def.recut).toBeUndefined();
    expect(def.bridge).toBe(EMBLEM_RAY_BRIDGE);
    expect(def.plates).toBeUndefined();
    expect(def.pack).toBe("packEmblem.js 'Planeswalker Emblems'");
    for (const k of COLORS) {
      expect(def.colors[k], k).toEqual([{ src: "img/frames/token/emblem/frame.png" }]);
    }
    expect(sourceFilesFor(def as never)).toEqual(["img/frames/token/emblem/frame.png"]);
    expect(def.transforms).toMatch(/1:1 \(no resample\)/);
  });

  // Owner evidence 2026-09-29: the name pill read luma 94–97 against the
  // prints' 54–60. CC's pack draws frame.png alone (no darkening layer), and
  // its pill is a light gradient: the recipe tones the pill's body onto the
  // prints, and the provenance says how.
  it("tones the emblem's name pill onto the prints: its body only, inside the outline, opaque (4.52)", () => {
    const def = templates.emblem;
    expect(def.tones).toBe(EMBLEM_TONES);
    expect(EMBLEM_TONES[0]).toBe(EMBLEM_NAME_PILL_TONE);
    expect("keepAlpha" in EMBLEM_NAME_PILL_TONE).toBe(false);
    // Under CC's top highlight (105–110), above its lower lip (211–216).
    expect([EMBLEM_NAME_PILL_TONE.fromY, EMBLEM_NAME_PILL_TONE.toY]).toEqual([111, 211]);
    expect(EMBLEM_NAME_PILL_TONE.seed).toEqual({ x: 750, y: 160 });
    // Darker everywhere, least at the centre and the ends, as fitted.
    for (const [, g] of EMBLEM_NAME_PILL_TONE.gain) {
      expect(g).toBeGreaterThan(0.5);
      expect(g).toBeLessThan(0.85);
    }
    expect(def.transforms).toMatch(/the name pill's body \(rows 111–210/);
    expect(def.notes.some((n) => /name pill's body is toned onto the prints/.test(n))).toBe(true);
    // No other template tones or bridges anything.
    for (const [template, other] of Object.entries(templates)) {
      if (template === "emblem") continue;
      expect(other.tones, template).toBeUndefined();
      expect(other.bridge, template).toBeUndefined();
    }
  });

  // Owner decision 2026-09-29 (round 12): the silver, the type pill and the
  // text box read 10–45 luma lighter than the six prints; toned with gains
  // fitted on them — a gain, so CC's highlights and shading stay.
  it("tones the emblem's silver, type pill and text box onto the prints, keeping the tail's alpha (4.52)", () => {
    expect(EMBLEM_TONES).toEqual([EMBLEM_NAME_PILL_TONE, EMBLEM_SILVER_TONE, EMBLEM_TYPE_PILL_TONE, EMBLEM_TEXT_BOX_TONE]);
    const s = EMBLEM_SILVER_TONE;
    // From the name bar's shadow (233) to the type bar's rim (1407) whole;
    // beside the bars from the strip above the name bar to the box's foot.
    expect([s.fromY, s.bodyFromY, s.bodyToY, s.toY, s.stopLuma]).toEqual([60, 233, 1407, 1946, 170]);
    expect(s.gain).toHaveLength(s.rows.length);
    for (const row of s.gain) expect(row).toHaveLength(s.d.length);
    // The strip above the name bar keeps CC's tone (first row 1); every
    // other gain darkens, none below 0.6 (the prints' darkest band, at the
    // sides half-way down).
    expect(s.gain[0]).toEqual([1, 1, 1]);
    for (const g of s.gain.slice(1).flat()) {
      expect(g).toBeGreaterThanOrEqual(0.6);
      expect(g).toBeLessThan(1);
    }
    // The type pill (238 → the prints' 219–228) and the box (237 → 226–232):
    // one gain each, the tail's alpha kept, CC's rims and highlights outside.
    expect(EMBLEM_TYPE_PILL_TONE).toMatchObject({ fromY: 1429, toY: 1530, gain: [[0, 0.94]], keepAlpha: true });
    expect(EMBLEM_TEXT_BOX_TONE).toMatchObject({ fromY: 1556, toY: 1938, minLuma: 215, gain: [[0, 0.96]], keepAlpha: true });
    const def = templates.emblem;
    expect(def.transforms).toMatch(/the silver \(rows 233–1406 but for the spark's pure-white tail and glow/);
    expect(def.transforms).toMatch(/the type pill's body \(rows 1429–1529\) × 0\.94 and the text box \(rows 1556–1937, inside its light rim\) × 0\.96, alpha kept/);
    expect(def.notes.some((n) => /EMBLEM_SILVER_TONE.*EMBLEM_TYPE_PILL_TONE.*EMBLEM_TEXT_BOX_TONE/.test(n))).toBe(true);
  });

  // Owner decision 2026-09-29 (round 12, "exact slot + frame bridged over the
  // tip"): the art window stays Scryfall's art_crop box (from 250.4 px), and
  // the frame closes over the centre ray's top instead of holding CC's black
  // shadow there — the ray ends at 251, the first row the art covers whole.
  it("bridges the spark's centre ray over above the art window (4.52)", () => {
    expect(EMBLEM_RAY_BRIDGE).toEqual({
      fromY: 233,
      toY: 251,
      x0: 723,
      x1: 780,
      anchors: [720, 780],
      fadeRows: 5,
      radius: 4,
      fadePow: 2,
      edgeRows: [255, 301],
    });
    // From the name bar's shadow down; the tip on the first row the art
    // window (250.4 px) covers whole.
    expect(EMBLEM_RAY_BRIDGE.toY).toBe(Math.ceil(250.4));
    expect(templates.emblem.transforms).toMatch(/the spark's centre ray bridged over \(rows 233–250, columns 723–779/);
    expect(templates.emblem.notes.some((n) => /closes over the top of the spark's centre ray \(EMBLEM_RAY_BRIDGE/.test(n))).toBe(true);
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

  describe("toneRegion (4.52: the emblem's name pill onto the prints)", () => {
    /** A W × H image: a grey (luma `fill`) region ringed by a black outline
     *  at x 1 / W − 2 and y 1 / H − 2, silver (200) outside it, alpha 240
     *  inside the ring. */
    const pill = (w: number, h: number, fill = 100) => {
      const buf = Buffer.alloc(w * h * 4);
      for (let y = 0; y < h; y += 1) {
        for (let x = 0; x < w; x += 1) {
          const ring = x === 1 || x === w - 2 || y === 1 || y === h - 2;
          const inside = x > 1 && x < w - 2 && y > 1 && y < h - 2;
          const v = ring ? 0 : inside ? fill : 200;
          buf.set([v, v, v, inside ? 240 : 255], (y * w + x) * 4);
        }
      }
      return buf;
    };
    const at = (buf: Buffer, w: number, x: number, y: number) => Array.from(buf.subarray((y * w + x) * 4, (y * w + x) * 4 + 4));

    it("multiplies the outlined region's colour by the gain at |x − centreX|, and makes it opaque", () => {
      const w = 12;
      const h = 8;
      const out = toneRegion(pill(w, h), w, h, {
        seed: { x: 6, y: 4 },
        fromY: 0,
        toY: h,
        minLuma: 30,
        centreX: 6,
        gain: [
          [0, 0.5],
          [4, 0.9],
        ],
      });
      // At the centre ×0.5; 2 px out halfway along the knots, ×0.7; 4 px
      // and past it held at ×0.9.
      expect(at(out, w, 6, 4)).toEqual([50, 50, 50, 255]);
      expect(at(out, w, 4, 3)).toEqual([70, 70, 70, 255]);
      expect(at(out, w, 8, 5)).toEqual([70, 70, 70, 255]);
      expect(at(out, w, 2, 2)).toEqual([90, 90, 90, 255]);
      // The outline and the silver outside it: untouched.
      expect(at(out, w, 1, 4)).toEqual([0, 0, 0, 255]);
      expect(at(out, w, 0, 4)).toEqual([200, 200, 200, 255]);
      expect(at(out, w, 6, 0)).toEqual([200, 200, 200, 255]);
    });

    it("stays inside its rows and never leaks past a closed outline", () => {
      const w = 12;
      const h = 8;
      const src = pill(w, h);
      const out = toneRegion(src, w, h, {
        seed: { x: 6, y: 4 },
        fromY: 3,
        toY: 5,
        minLuma: 30,
        centreX: 6,
        gain: [[0, 0.5]],
      });
      for (let y = 0; y < h; y += 1) {
        for (let x = 0; x < w; x += 1) {
          const toned = y >= 3 && y < 5 && x > 1 && x < w - 2;
          expect(at(out, w, x, y), `${x},${y}`).toEqual(toned ? [50, 50, 50, 255] : at(src, w, x, y));
        }
      }
    });

    it("leaks through a gap in the outline — the outline is the region's only bound", () => {
      const w = 12;
      const h = 8;
      const src = pill(w, h);
      // Open the ring at (1, 4): the silver beside it (x 0, rows 2–5, which
      // the ring's rows 1 and 6 close off) joins the region.
      src.set([100, 100, 100, 255], (4 * w + 1) * 4);
      const out = toneRegion(src, w, h, { seed: { x: 6, y: 4 }, fromY: 0, toY: h, minLuma: 30, centreX: 6, gain: [[0, 0.5]] });
      expect(at(out, w, 0, 2)).toEqual([100, 100, 100, 255]);
      expect(at(out, w, 0, 0)).toEqual([200, 200, 200, 255]);
    });

    it("refuses a seed outside the region or its rows, and bad knots; never touches the source", () => {
      const w = 12;
      const h = 8;
      const src = pill(w, h);
      const copy = Buffer.from(src);
      const tone = { seed: { x: 6, y: 4 }, fromY: 0, toY: h, minLuma: 30, centreX: 6, gain: [[0, 0.5]] as [number, number][] };
      expect(() => toneRegion(src, w, h, { ...tone, seed: { x: 1, y: 4 } })).toThrow(/darker than luma 30/);
      expect(() => toneRegion(src, w, h, { ...tone, fromY: 5 })).toThrow(/bad tone/);
      expect(() => toneRegion(src, w, h, { ...tone, toY: h + 1 })).toThrow(/bad tone/);
      expect(() => toneRegion(src, w, h, { ...tone, gain: [] })).toThrow(/bad tone/);
      expect(() => toneRegion(src, w, h, { ...tone, gain: [[4, 0.5], [0, 0.6]] })).toThrow(/bad tone/);
      toneRegion(src, w, h, tone);
      expect(src.equals(copy)).toBe(true);
    });

    it("keeps each pixel's own alpha with keepAlpha (the type pill and the box: the spark's tail stays translucent)", () => {
      const w = 12;
      const h = 8;
      const out = toneRegion(pill(w, h), w, h, {
        seed: { x: 6, y: 4 },
        fromY: 0,
        toY: h,
        minLuma: 30,
        centreX: 6,
        gain: [[0, 0.5]],
        keepAlpha: true,
      });
      expect(at(out, w, 6, 4)).toEqual([50, 50, 50, 240]);
      expect(at(out, w, 2, 2)).toEqual([50, 50, 50, 240]);
      expect(at(out, w, 0, 4)).toEqual([200, 200, 200, 255]);
    });

    it("gainAt is piecewise-linear and held past the end knots", () => {
      const knots: [number, number][] = [
        [10, 0.4],
        [20, 0.8],
        [40, 0.6],
      ];
      expect(gainAt(knots, 0)).toBe(0.4);
      expect(gainAt(knots, 15)).toBeCloseTo(0.6, 12);
      expect(gainAt(knots, 30)).toBeCloseTo(0.7, 12);
      expect(gainAt(knots, 99)).toBe(0.6);
    });
  });

  describe("toneSilver (4.52: the emblem's silver onto the prints)", () => {
    // 20 × 12: rows 2–3 and 8–9 carry a "bar" — a light rim (luma 200) at
    // x 5–14 with a dark pixel inside it at x 8 — and silver (150) beside it;
    // every other row is silver.
    const W = 20;
    const H = 12;
    const image = () => {
      const buf = Buffer.alloc(W * H * 4);
      for (let y = 0; y < H; y += 1) {
        for (let x = 0; x < W; x += 1) {
          const bar = (y === 2 || y === 3 || y === 8 || y === 9) && x >= 5 && x <= 14;
          const v = bar ? (x === 8 ? 50 : 200) : 150;
          buf.set([v, v, v, 255], (y * W + x) * 4);
        }
      }
      return buf;
    };
    const at = (buf: Buffer, x: number, y: number) => Array.from(buf.subarray((y * W + x) * 4, (y * W + x) * 4 + 4));
    const spec = {
      fromY: 1,
      bodyFromY: 4,
      bodyToY: 8,
      toY: 11,
      stopLuma: 170,
      centreX: 9.5,
      d: [0, 10],
      rows: [0, 12],
      gain: [
        [0.5, 0.5],
        [0.5, 0.5],
      ],
    };

    it("tones the body rows whole and, beside the bars, each row from either edge up to the bar's rim", () => {
      const out = toneSilver(image(), W, H, spec);
      for (let x = 0; x < W; x += 1) {
        // Outside [fromY, toY): untouched.
        expect(at(out, x, 0), `x ${x} row 0`).toEqual([150, 150, 150, 255]);
        expect(at(out, x, 11), `x ${x} row 11`).toEqual([150, 150, 150, 255]);
        // A row with no rim (row 1, the strip above a bar) is toned whole.
        expect(at(out, x, 1), `x ${x} row 1`).toEqual([75, 75, 75, 255]);
        // The body rows: whole.
        for (const y of [4, 5, 6, 7]) expect(at(out, x, y), `x ${x} row ${y}`).toEqual([75, 75, 75, 255]);
        // Beside a bar: the silver up to the rim; the rim and what it holds
        // (the dark pixel at x 8, past the rim) keep their colour.
        for (const y of [2, 3, 8, 9]) {
          const want = x < 5 || x > 14 ? 75 : x === 8 ? 50 : 200;
          expect(at(out, x, y)[0], `x ${x} row ${y}`).toBe(want);
        }
        expect(at(out, x, 10), `x ${x} row 10`).toEqual([75, 75, 75, 255]);
      }
    });

    it("leaves the spark's tail and glow (translucent pure white) and clear pixels as drawn; tones a translucent edge", () => {
      const src = image();
      src.set([255, 255, 255, 204], (5 * W + 3) * 4); // the tail
      src.set([254, 255, 255, 204], (5 * W + 4) * 4); // not pure white: an edge
      src.set([120, 120, 120, 90], (5 * W + 5) * 4); // an anti-aliased edge
      src.set([7, 7, 7, 0], (5 * W + 6) * 4); // clear
      const out = toneSilver(src, W, H, spec);
      expect(at(out, 3, 5)).toEqual([255, 255, 255, 204]);
      expect(at(out, 4, 5)).toEqual([127, 128, 128, 204]);
      expect(at(out, 5, 5)).toEqual([60, 60, 60, 90]);
      expect(at(out, 6, 5)).toEqual([7, 7, 7, 0]);
    });

    it("multiplies by a gain bilinear in the distance from centreX and the row, held past the outer knots", () => {
      const g = { d: [10, 20], rows: [100, 200], gain: [[0.2, 0.4], [0.6, 1]] };
      expect(silverGainAt(g, 0, 0)).toBeCloseTo(0.2, 12);
      expect(silverGainAt(g, 15, 100)).toBeCloseTo(0.3, 12);
      expect(silverGainAt(g, 10, 150)).toBeCloseTo(0.4, 12);
      expect(silverGainAt(g, 15, 150)).toBeCloseTo(0.55, 12);
      expect(silverGainAt(g, 99, 999)).toBeCloseTo(1, 12);
      // One knot on an axis: held everywhere.
      expect(silverGainAt({ d: [0], rows: [0, 10], gain: [[0.5], [0.7]] }, 50, 5)).toBeCloseTo(0.6, 12);
      // The recipe's own: 1 above the name bar, darkest at the sides half-way down.
      expect(silverGainAt(EMBLEM_SILVER_TONE, 0, 60)).toBe(1);
      expect(silverGainAt(EMBLEM_SILVER_TONE, 700, 900)).toBeCloseTo(0.6, 12);
    });

    it("refuses bad rows or knots; never touches the source; applyTone picks it for a silver spec", () => {
      const src = image();
      const copy = Buffer.from(src);
      expect(() => toneSilver(src, W, H, { ...spec, bodyFromY: 9 })).toThrow(/bad tone/);
      expect(() => toneSilver(src, W, H, { ...spec, toY: H + 1 })).toThrow(/bad tone/);
      expect(() => toneSilver(src, W, H, { ...spec, d: [10, 0] })).toThrow(/bad tone/);
      expect(() => toneSilver(src, W, H, { ...spec, gain: [[0.5, 0.5]] })).toThrow(/bad tone/);
      expect(() => toneSilver(src, W, H, { ...spec, gain: [[0.5], [0.5]] })).toThrow(/bad tone/);
      const out = toneSilver(src, W, H, spec);
      expect(src.equals(copy)).toBe(true);
      expect(applyTone(src, W, H, spec).equals(out)).toBe(true);
      const region = { seed: { x: 2, y: 5 }, fromY: 4, toY: 8, minLuma: 100, centreX: 9.5, gain: [[0, 0.5]] as [number, number][] };
      expect(applyTone(src, W, H, region).equals(toneRegion(src, W, H, region))).toBe(true);
    });
  });

  describe("bridgeRayTip (4.52: the emblem's spark ray bridged over)", () => {
    // 60 × 60 of silver (180) with a bar's shadow (50) on rows 10–12; a ray
    // clear (α 0) from row 4 down at x 25–34, a light bevel (190) and a
    // highlight line (230, x 21) on its left, and on its right a dark
    // outline (100) at x 35–38 and a step (140) at x 39 into the silver.
    const W = 60;
    const H = 60;
    const image = () => {
      const buf = Buffer.alloc(W * H * 4);
      for (let y = 0; y < H; y += 1) {
        for (let x = 0; x < W; x += 1) {
          let v = 180;
          let a = 255;
          if (y >= 10 && y <= 12) v = 50;
          else if (y > 12 && x === 21) v = 230;
          else if (y > 12 && x >= 22 && x <= 24) v = 190;
          else if (y > 12 && x >= 35 && x <= 38) v = 100;
          else if (y > 12 && x === 39) v = 140;
          if (y >= 4 && x >= 25 && x <= 34) {
            v = 0;
            a = 0;
          }
          buf.set([v, v, v, a], (y * W + x) * 4);
        }
      }
      return buf;
    };
    const at = (buf: Buffer, x: number, y: number) => Array.from(buf.subarray((y * W + x) * 4, (y * W + x) * 4 + 4));
    const spec = { fromY: 4, toY: 20, x0: 22, x1: 45, anchors: [20, 45], fadeRows: 3, radius: 2, fadePow: 2, edgeRows: [25, 40] };

    it("closes the frame over the ray above toY: opaque, the bar's shadow and the silver joined across", () => {
      const out = bridgeRayTip(image(), W, H, spec);
      // Rows 4–9 are out of the tip's reach (10 px): the blend alone closes them.
      for (let y = 4; y < 20; y += 1) for (let x = 22; x < 45; x += 1) expect(at(out, x, y)[3], `${x},${y}`).toBe(255);
      // The shadow runs on unbroken; above and under it, clear of the tip,
      // the silver.
      for (let x = 22; x < 45; x += 1) {
        expect(at(out, x, 5), `x ${x}`).toEqual([180, 180, 180, 255]);
        expect(at(out, x, 11), `x ${x}`).toEqual([50, 50, 50, 255]);
        expect(at(out, x, 13)[0], `x ${x}`).toBe(180);
      }
    });

    it("draws the tip with the ray's own right-edge profile, dark on the right, lightening to the left", () => {
      const out = bridgeRayTip(image(), W, H, spec);
      // Right corner: the outline's colour (100), as down the right edge.
      expect(at(out, 34, 19)[0]).toBe(100);
      // The profile by distance above the tip (2–4 px outline, the step at 5,
      // silver from 6), mixed towards the silver by (4.5 / 10)² in the middle.
      const f = (4.5 / 10) ** 2;
      const mid = (w: number) => Math.round(100 * (1 - w) + 180 * w);
      expect([19, 17, 15, 14, 13].map((y) => at(out, 30, y)[0])).toEqual([mid(f), mid(f), mid(0.25 + 0.75 * f), mid(0.75 + 0.25 * f), 180]);
      // The left corner is lighter than the right one.
      expect(at(out, 26, 19)[0]).toBeGreaterThan(at(out, 33, 19)[0] + 40);
      // Left of the ray, the frame's own bevel (190) fades back in over the
      // last fadeRows rows, over the anchors' silver (180): none of it at
      // row 16, (19.5 − 17) / 3 of it at row 19.
      expect(at(out, 23, 16)[0]).toBe(180);
      expect(at(out, 23, 19)[0]).toBe(Math.round(180 + (190 - 180) * (2.5 / 3)));
    });

    it("keeps the cut-out below toY, rounds its top corners and never touches the source", () => {
      const src = image();
      const copy = Buffer.from(src);
      const out = bridgeRayTip(src, W, H, spec);
      expect(src.equals(copy)).toBe(true);
      // The ray's middle below toY: still clear.
      for (let x = 27; x <= 32; x += 1) expect(at(out, x, 20)[3], `x ${x}`).toBe(0);
      // Its top corners: partly covered, anti-aliased; the left one in the
      // bevel's light, the right one in the outline.
      expect(at(out, 25, 20)[3]).toBeGreaterThan(0);
      expect(at(out, 25, 20)[3]).toBeLessThan(255);
      expect(at(out, 25, 20)[0]).toBeGreaterThan(170);
      expect(at(out, 34, 20)[0]).toBeLessThan(110);
      // Rows past the corners: exactly the source.
      for (let y = 23; y < H; y += 1) for (let x = 0; x < W; x += 1) expect(at(out, x, y), `${x},${y}`).toEqual(at(src, x, y));
      // Outside the window: exactly the source.
      for (let y = 0; y < 4; y += 1) for (let x = 0; x < W; x += 1) expect(at(out, x, y), `${x},${y}`).toEqual(at(src, x, y));
      for (let y = 4; y < 23; y += 1) {
        for (const x of [0, 19, 20, 21, 45, 59]) expect(at(out, x, y), `${x},${y}`).toEqual(at(src, x, y));
      }
    });

    it("refuses a bad bridge or a row with no clear ray", () => {
      const src = image();
      expect(() => bridgeRayTip(src, W, H, { ...spec, anchors: [23, 45] })).toThrow(/bad bridge/);
      expect(() => bridgeRayTip(src, W, H, { ...spec, edgeRows: [15, 40] })).toThrow(/bad bridge/);
      expect(() => bridgeRayTip(src, W, H, { ...spec, fadeRows: 0 })).toThrow(/bad bridge/);
      const noRay = image();
      for (let y = 0; y < H; y += 1) for (let x = 25; x <= 34; x += 1) noRay[(y * W + x) * 4 + 3] = 255;
      expect(() => bridgeRayTip(noRay, W, H, spec)).toThrow(/no clear ray/);
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
      // Every master was cut at the one card corner (TODO 3.26's re-import).
      expect(provenance[template].output, template).toBe(`1500x2100, corners rounded to ${CORNER_RADIUS}px, webp q90`);
      expect(provenance[template].output, template).toContain("64.5px");
      expect(Object.keys(provenance[template].colors).sort()).toEqual([...COLORS].sort());
    }
    expect(provenance.m15devoid.source).toBe("cardconjurer");
    // The later runs name their pack and what was done to its pixels.
    for (const template of ["m15borderless", "m15borderlessartifact", "m15fullartland", "fullartland", "m15tokentext", "m15tokenartifacttext"]) {
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
    // The emblem records its ray bridge, its tones and what they did to the
    // pixels (4.52).
    expect(provenance.emblem.recut).toBeUndefined();
    expect(provenance.emblem.bridge).toEqual(EMBLEM_RAY_BRIDGE);
    expect(provenance.emblem.tones).toEqual(EMBLEM_TONES);
    expect(provenance.emblem.transforms).toBe(templates.emblem.transforms);
    expect(provenance.emblem.notes).toEqual(templates.emblem.notes);
    expect(provenance.m15.tones).toBeUndefined();
    expect(provenance.m15.bridge).toBeUndefined();
  });

  it("never commits the build folder", () => {
    expect(readFileSync(".gitignore", "utf8")).toMatch(/^\/\.frames-build\/$/m);
    // 2026-09-25: a `git add -A` on a branch cut before the ignore rule
    // committed 182 Card Conjurer masters; CI must fail if that ever recurs.
    const tracked = execFileSync("git", ["ls-files", "--", ".frames-build"], { encoding: "utf8" }).trim();
    expect(tracked).toBe("");
  });
});
