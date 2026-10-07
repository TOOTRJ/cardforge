import { execFileSync } from "node:child_process";
import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";
import {
  BORDERLESS_TINT_POINT,
  BORDERLESS_TITLE_TO_TYPE_DY,
  CC_COMMIT,
  CC_DEFERRED,
  CC_OVERLAY_BANDS,
  CC_RIDERS,
  CC_TEMPLATES,
  COLORS,
  CORNER_RADIUS,
  EMBLEM_NAME_PILL_TONE,
  EMBLEM_RAY_BRIDGE,
  EMBLEM_SILVER_TONE,
  EMBLEM_TEXT_BOX_TONE,
  EMBLEM_TONES,
  EMBLEM_TYPE_PILL_TONE,
  FLIP_LOWER_RECUT,
  HOLO_STAMP_NOTCHES,
  FLIP_PT_BOUNDS,
  FLIP_PT_BOXES,
  FLIP_PT_MASKS,
  PW_COLOURLESS_RIM_GAIN,
  PW_GOLD_FACE,
  SAGA_CHAPTER_PIECES,
  SAGA_MASK_INPUTS,
  SHIELD_BOX,
  M20_ARTIFACT_NAME_SLATE,
  M20_ARTIFACT_SOLID_NAME_PILL,
  M20_ARTIFACT_TYPE_TINT,
  M20_COLOURLESS_TYPE_TINT,
  M20_TOKEN_SOLID_TYPE_PILL,
  M20_TOKEN_TEXTLESS_RECUT,
  TINTED_BOX_STRUCTURE,
  TOKEN_REGULAR_RECUT,
  TOKEN_TEXTLESS_RECUT,
  applyTone,
  borderlessLandLayers,
  boundsPx,
  bridgeRayTip,
  builtColors,
  compositeFinish,
  compositeLayers,
  cutThroughMask,
  describeFinish,
  describeLayer,
  describePtCut,
  gainAt,
  finishFor,
  flatPixelAt,
  recutBand,
  recutBlockUp,
  retintStructure,
  roundCorners,
  roundCornersRgba8,
  shiftRows,
  silverGainAt,
  sourceFilesFor,
  toRgba8,
  toneRegion,
  toneSilver,
  stripRiderKeys,
} from "@/scripts/lib/cc-frames.mjs";
import { FRAME_TEMPLATE_VALUES } from "@/types/card";
import { TWO_COLOR_PAIRS } from "@/lib/cards/frame-reference-registry";
import { getFrameProfile, M20_TOKEN_TEXTLESS_RECUT_PX } from "@/lib/cards/template-layout";
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
  replace?: boolean;
  dy?: number;
  retint?: { from: number[]; tintOf: { src: string; x: number; y: number } };
  gain?: number;
  recolour?: boolean;
  lumaRamp?: readonly number[];
};
type Finish =
  | { op: "opaque"; mask: string; colors?: string[] }
  | { op: "tint"; mask: string; rgb: [number, number, number]; opacity: number; alphaFull: number; alphaNone: number; colors?: string[] };
type Def = {
  colors: Record<string, Layer[]>;
  pieces?: Record<string, string>;
  maskInputs?: Record<string, string>;
  finish?: Finish[];
  plates?: Record<string, string>;
  symbols?: Record<string, string>;
  shield?: { mask: string; box: typeof SHIELD_BOX };
  strip?: { mask: string; box: { x: number; y: number; width: number; height: number }; erode: number; keys: readonly string[]; extra?: Record<string, string> };
  ptCut?: {
    image: Record<string, string>;
    bounds: typeof FLIP_PT_BOUNDS;
    masks: Record<string, string>;
    boxes: Record<string, { x: number; y: number; width: number; height: number }>;
  };
  recut?: { fromY: number; toY: number; shift: number; blend: number; blendBottom?: number };
  recutUp?: typeof FLIP_LOWER_RECUT;
  bridge?: typeof EMBLEM_RAY_BRIDGE;
  tones?: readonly object[] | ((key: string) => readonly object[]);
  excluded?: Record<string, string>;
  pack?: string;
  transforms?: string;
  notes: string[];
};
const templates = CC_TEMPLATES as Record<string, Def>;
/** The re-cut templates (TODO 4.49): each pair has its own band. */
const TEXTLESS_TOKENS = ["m15token", "m15tokenartifact"];
const TEXT_BOX_TOKENS = ["m15tokentext", "m15tokenartifacttext"];
/** The two-colour pair masters a template's profile declares (TODO 4.6b,
 *  FrameProfile.twoColorMasters): gold-split `<pair>`, hybrid `<pair>-h` —
 *  the importer must build exactly those, besides the seven colours. */
const pairKeysOf = (template: string): string[] =>
  (getFrameProfile(template).twoColorMasters ?? []).flatMap((dress) =>
    TWO_COLOR_PAIRS.map((pair) => (dress === "hybrid" ? `${pair}-h` : pair)),
  );
/** The full-art tokens' textless height (TODO 4.48): its own band. */
const M20_TEXTLESS_TOKENS = ["m20token", "m20tokenartifact"];
const M20_TOKENS = ["m20token", "m20tokentext", "m20tokentall", "m20tokenartifact", "m20tokenartifacttext", "m20tokenartifacttall"];
/** The recut each template has, if any. */
const recutOf = (template: string) =>
  TEXTLESS_TOKENS.includes(template)
    ? TOKEN_TEXTLESS_RECUT
    : TEXT_BOX_TOKENS.includes(template)
      ? TOKEN_REGULAR_RECUT
      : M20_TEXTLESS_TOKENS.includes(template)
        ? M20_TOKEN_TEXTLESS_RECUT
        : undefined;

describe("Card Conjurer recipe", () => {
  it("covers the M15-era, borderless and full-art-basic templates — every colour built or excluded with a reason — with pack paths", () => {
    expect(Object.keys(templates).sort()).toEqual([
      "adventure",
      "aftermath",
      "emblem",
      "flip",
      "fullartland",
      "m15",
      "m15artifact",
      "m15borderless",
      "m15borderlessartifact",
      "m15borderlessland",
      "m15borderlesspw",
      "m15borderlesspwtall",
      "m15devoid",
      // The transform bodies (TODO 5.1a; tests/unit/frames/dfc-importer.test.ts).
      "m15dfcback",
      "m15dfcbackleft",
      "m15dfcfront",
      "m15dfclandback",
      "m15dfclandfront",
      "m15fullartland",
      "m15land",
      // The modal bodies (TODO 5.1b; tests/unit/frames/mdfc-importer.test.ts).
      "m15mdfcback",
      "m15mdfcfront",
      "m15mdfclandback",
      "m15mdfclandfront",
      "m15pw",
      "m15snow",
      "m15snowland",
      "m15token",
      "m15tokenartifact",
      "m15tokenartifacttext",
      "m15tokentext",
      "m20token",
      "m20tokenartifact",
      "m20tokenartifacttall",
      "m20tokenartifacttext",
      "m20tokentall",
      "m20tokentext",
      // The saga (TODO 4.21c; its own describe below).
      "saga",
    ]);
    for (const [template, def] of Object.entries(templates)) {
      expect(FRAME_TEMPLATE_VALUES as readonly string[]).toContain(template);
      const covered = [...builtColors(def as never), ...Object.keys(def.excluded ?? {})].sort();
      // A template whose crown is baked into its masters (4.6f) builds the
      // crowned twin of every master it paints.
      // …and a template that dresses its colourless artifact as `a`
      // (FrameProfile.artifactMasterKeys, the transform bodies, 5.1a) builds
      // that master too.
      const dressed = getFrameProfile(template).artifactMasterKeys?.c === "a" ? ["a"] : [];
      const plain = [...COLORS, ...pairKeysOf(template), ...dressed];
      const crowned = getFrameProfile(template).crownMasters ? plain.map((k) => `${k}-legendary`) : [];
      expect(covered, template).toEqual([...plain, ...crowned].sort());
      for (const file of sourceFilesFor(def as never)) {
        // CC's img/black.png is the erased strip under the floating crown (4.6f).
        expect(file, `${template}: ${file}`).toMatch(/^img\/(frames\/[\w/]+|black)\.(png|svg)$/);
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
    // No other template tones or bridges anything — but the transform backs'
    // per-key tone pass (TODO 5.1a, tests/unit/frames/dfc-importer.test.ts).
    for (const [template, other] of Object.entries(templates)) {
      if (template === "emblem") continue;
      if (!["m15dfcback", "m15dfcbackleft", "m15dfclandback", "m15mdfcback", "m15mdfclandback"].includes(template)) expect(other.tones, template).toBeUndefined();
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
    for (const row of s.gain) expect(row).toHaveLength(s.dx.length);
    // The strip above the name bar keeps CC's tone (first row 1); every
    // other gain within the fit's bounds, 0.45 (the right rail half-way
    // down, the darkest silver on the prints) to 1.2 (the right half beside
    // the spark, lit brighter than CC's).
    expect(s.gain[0]).toEqual(s.dx.map(() => 1));
    for (const g of s.gain.slice(1).flat()) {
      expect(g).toBeGreaterThanOrEqual(0.45);
      expect(g).toBeLessThanOrEqual(1.2);
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

  // Owner decision 2026-09-29 (round 12b, "fit each side separately"): the
  // prints' silver is lit unevenly — beside the spark's base 113–122 on the
  // left and 178–187 on the right, where round 12's gain, by distance from
  // the centre, darkened both halves alike (137 and 157).
  it("fits the emblem's silver on each side separately, joined across the centre without a seam (4.52, round 12b)", () => {
    const s = EMBLEM_SILVER_TONE;
    // Signed knots: five a side, the innermost at ±100 px.
    expect(s).not.toHaveProperty("d");
    expect(s.dx.filter((v) => v < 0)).toHaveLength(5);
    expect(s.dx.filter((v) => v > 0)).toHaveLength(5);
    expect([Math.max(...s.dx.filter((v) => v < 0)), Math.min(...s.dx.filter((v) => v > 0))]).toEqual([-100, 100]);
    // The halves differ where the prints do: beside the spark's base (x 330–
    // 510 and 990–1170, rows 1230–1370) the right is lit far brighter; the
    // right rail (x ≈ 1420) is the darkest silver on the card, the left one
    // is not.
    const at = (x: number, y: number) => silverGainAt(s, x - s.centreX, y);
    for (const y of [1250, 1300, 1350]) expect(at(1080, y) - at(420, y), `row ${y}`).toBeGreaterThan(0.2);
    for (const y of [900, 1000, 1100]) expect(at(80, y) - at(1420, y), `row ${y}`).toBeGreaterThan(0.2);
    // Smooth: no seam at the centre line, and no step anywhere — the gain
    // moves < 0.005 between any two neighbouring pixels (bilinear knots).
    // Exactly, knot by knot: bilinear, the gain's slope along a row is a
    // blend of its two knot rows' slopes (and down a column, of its two knot
    // columns'), and it is flat past the outer knots — so every knot-to-knot
    // slope under 0.005 per px bounds every pixel's step, including a steep
    // ramp between two close knots that falls between the sampled pixels
    // below.
    for (let j = 0; j < s.rows.length; j += 1) {
      for (let i = 0; i < s.dx.length; i += 1) {
        if (i > 0) {
          const across = Math.abs(s.gain[j][i] - s.gain[j][i - 1]) / (s.dx[i] - s.dx[i - 1]);
          expect(across, `across, row ${s.rows[j]}, dx ${s.dx[i - 1]}…${s.dx[i]}`).toBeLessThan(0.005);
        }
        if (j > 0) {
          const down = Math.abs(s.gain[j][i] - s.gain[j - 1][i]) / (s.rows[j] - s.rows[j - 1]);
          expect(down, `down, dx ${s.dx[i]}, rows ${s.rows[j - 1]}…${s.rows[j]}`).toBeLessThan(0.005);
        }
      }
    }
    for (let y = 60; y < 1946; y += 7) {
      expect(Math.abs(at(749, y) - at(750, y)), `centre, row ${y}`).toBeLessThan(0.005);
      for (let x = 0; x < 1499; x += 13) {
        expect(Math.abs(at(x + 1, y) - at(x, y)), `(${x}, ${y}) across`).toBeLessThan(0.005);
        expect(Math.abs(at(x, y + 1) - at(x, y)), `(${x}, ${y}) down`).toBeLessThan(0.005);
      }
    }
    expect(templates.emblem.transforms).toMatch(/a gain bilinear in the signed offset from x 749\.5 — each half fitted on its own side of the prints, the centre segment joining them — and the row \(12 × 10 knots, 0\.45–1\.2\)/);
    expect(templates.emblem.notes.some((n) => /fitted on each side separately \(owner decision 2026-09-29, round 12b\)/.test(n))).toBe(true);
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
    // No other template is re-cut by this band: the textless tokens and the
    // full-art textless tokens have their own (the tests below), the rest
    // none.
    for (const [template, def] of Object.entries(templates)) expect(def.recut, template).toBe(recutOf(template));
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
    // bottom seam over `blend` rows), the full-art textless tokens theirs,
    // the rest none.
    for (const [template, def] of Object.entries(templates)) expect(def.recut, template).toBe(recutOf(template));
  });

  it("builds the full-art tokens from CC's 'Textless' / 'Short' / 'Tall' token packs, the artifact ones their own templates (TODO 4.48 / 4.50)", () => {
    const H = { m20token: "textless", m20tokentext: "short", m20tokentall: "tall" } as const;
    for (const [template, dir] of Object.entries(H)) {
      const Hn = { textless: "Textless", short: "Short", tall: "Tall" }[dir];
      const def = templates[template];
      // One layer per colour: the pack's own master; `c` its frameC.
      for (const k of ["w", "u", "b", "r", "g", "m"]) {
        expect(def.colors[k], `${template}/${k}`).toEqual([{ src: `img/frames/token/${dir}/tokenFrame${k.toUpperCase()}${Hn}.png` }]);
      }
      expect(def.colors.c).toEqual([{ src: `img/frames/token/${dir}/frameC.png` }]);
      // The artifact template: the silver master whole, the colour through
      // the pack's Pinline mask only (the pills stay silver: not 4.16's
      // m15artifact recipe, whose colour takes the title, type and box).
      const art = templates[`${template.replace("m20token", "m20tokenartifact")}`];
      expect(art.colors.c).toEqual([{ src: `img/frames/token/${dir}/tokenFrameA${Hn}.png` }]);
      const pinline = {
        textless: "img/frames/token/tokenMaskTextlessPinline.png",
        short: "img/frames/token/short/m15MaskPinlineSuperShort.png",
        tall: "img/frames/m15/regular/m15MaskPinline.png",
      }[dir];
      for (const k of ["w", "u", "b", "r", "g", "m"]) {
        expect(art.colors[k], `${template} artifact/${k}`).toEqual([
          { src: `img/frames/token/${dir}/tokenFrameA${Hn}.png` },
          { src: `img/frames/token/${dir}/tokenFrame${k.toUpperCase()}${Hn}.png`, mask: pinline },
        ]);
      }
      for (const t of [template, `${template.replace("m20token", "m20tokenartifact")}`]) {
        expect(templates[t].pack, t).toMatch(new RegExp(`packToken${Hn}-1\\.js`));
        // No plates of their own: M15's (m15/pt) and M15 artifact's.
        expect(templates[t].plates, t).toBeUndefined();
      }
    }
    // CC's 'Regular' pack (type pill at 64 %H) matches no print: never used.
    for (const t of M20_TOKENS) {
      for (const f of sourceFilesFor(templates[t] as never)) expect(f, t).not.toMatch(/token\/regular\//);
    }
  });

  it("re-cuts only the full-art textless masters' type pill 5 px down onto the prints (TODO 4.48, measure first)", () => {
    // Held to the profile's own constant (the art slot and the bands ride it).
    expect(M20_TOKEN_TEXTLESS_RECUT.shift).toBe(M20_TOKEN_TEXTLESS_RECUT_PX);
    expect(M20_TOKEN_TEXTLESS_RECUT).toEqual({ fromY: 1687, toY: 1845, shift: 5, blend: 0, blendBottom: 0 });
    for (const template of M20_TEXTLESS_TOKENS) {
      const def = templates[template];
      expect(def.recut, template).toBe(M20_TOKEN_TEXTLESS_RECUT);
      expect(def.transforms).toMatch(/rows 1687–1844 \(the type pill with its glow and bottom rim\) moved down 5 px/);
      expect(def.notes.join(" ")).toMatch(/re-cut onto the prints \(TODO 4\.48/);
    }
    // The regular and tall packs sit on the prints as drawn (±1 px).
    for (const template of ["m20tokentext", "m20tokentall", "m20tokenartifacttext", "m20tokenartifacttall"]) {
      expect(templates[template].recut, template).toBeUndefined();
    }
    // The band moves as one piece; the rows it opens repeat the rows above
    // it (the clear window and the black ring), and nothing below 1850 moves.
    const W = 4;
    const H = 2100;
    const buf = Buffer.alloc(W * H * 4);
    for (let y = 0; y < H; y += 1) for (let x = 0; x < W; x += 1) buf[(y * W + x) * 4 + 3] = y % 251;
    const out = recutBand(buf, W, H, M20_TOKEN_TEXTLESS_RECUT);
    const a = (b: Buffer, y: number) => b[y * W * 4 + 3];
    for (let y = 0; y < 1687; y += 1) expect(a(out, y), `${y}`).toBe(a(buf, y));
    for (let y = 1687; y < 1692; y += 1) expect(a(out, y), `${y}`).toBe(a(buf, y - 5));
    for (let y = 1692; y < 1850; y += 1) expect(a(out, y), `${y}`).toBe(a(buf, y - 5));
    for (let y = 1850; y < H; y += 1) expect(a(out, y), `${y}`).toBe(a(buf, y));
  });

  it("darkens the colourless and artifact type pills to the prints and makes every full-art token's type pill solid; the artifact name pill slate, then solid (owner decisions 2026-09-29, round 14)", () => {
    const TYPE = {
      m20token: "img/frames/token/tokenMaskTextlessType.png",
      m20tokentext: "img/frames/token/short/m15MaskTypeShort.png",
      m20tokentall: "img/frames/m15/regular/m15MaskType.png",
    } as const;
    const TITLE = "img/frames/m15/regular/m15MaskTitle.png";
    for (const [plain, typeMask] of Object.entries(TYPE)) {
      const artifact = plain.replace("m20token", "m20tokenartifact");
      // The plain template: the colourless (`c`) pill darkened (that colour
      // only), then the pill solid through the pack's own Type mask. The
      // tint goes FIRST: it weighs CC's alpha, which "opaque" sets to 255.
      expect(templates[plain].finish, plain).toEqual([
        { ...M20_COLOURLESS_TYPE_TINT, mask: typeMask },
        { op: "opaque", mask: typeMask },
      ]);
      expect(finishFor(templates[plain] as never, "c"), plain).toEqual(templates[plain].finish);
      // The five coloured pills (and the gold one) keep CC's colour: solid only.
      for (const k of ["w", "u", "b", "r", "g", "m"]) {
        expect(finishFor(templates[plain] as never, k), `${plain} ${k}`).toEqual([{ op: "opaque", mask: typeMask }]);
      }
      // The artifact template: its silver type pill darkened in EVERY colour
      // (a coloured artifact token keeps the silver pill), then solid; the
      // slate through M15's Title mask (the three packs' name pill), then
      // that pill solid too.
      expect(templates[artifact].finish, artifact).toEqual([
        { ...M20_ARTIFACT_TYPE_TINT, mask: typeMask },
        { op: "opaque", mask: typeMask },
        { ...M20_ARTIFACT_NAME_SLATE, mask: TITLE },
        { op: "opaque", mask: TITLE },
      ]);
      for (const k of COLORS) expect(finishFor(templates[artifact] as never, k), `${artifact} ${k}`).toEqual(templates[artifact].finish);
      for (const t of [plain, artifact]) {
        // The masks are source files (provenance lists them), and the
        // transforms and notes say what was composited, before the re-cut.
        for (const f of templates[t].finish!) expect(sourceFilesFor(templates[t] as never), t).toContain(f.mask);
        expect(templates[t].transforms, t).toContain(`PipGlyph composites over the flattened pixels: ${templates[t].finish!.map(describeFinish).join("; ")}`);
        expect(templates[t].notes.join(" "), t).toMatch(/the type pill SOLID/);
        expect(templates[t].notes.join(" "), t).toMatch(/type pill darkened to the prints \(owner decision round 14/);
      }
      expect(templates[artifact].notes.join(" ")).toMatch(/name pill darkened to the prints' slate/);
      expect(templates[artifact].notes.join(" ")).toMatch(/the name pill SOLID \(owner decision round 14/);
      expect(templates[plain].notes.join(" ")).not.toMatch(/slate/);
    }
    expect(M20_TOKEN_SOLID_TYPE_PILL).toEqual({ op: "opaque" });
    expect(M20_ARTIFACT_SOLID_NAME_PILL).toEqual({ op: "opaque" });
    expect(M20_ARTIFACT_NAME_SLATE).toEqual({ op: "tint", rgb: [30, 40, 48], opacity: 0.65, alphaFull: 230, alphaNone: 244 });
    // Round 14's print fits (the prints' median behind the type line).
    expect(M20_COLOURLESS_TYPE_TINT).toEqual({ op: "tint", rgb: [164, 149, 143], opacity: 0.65, alphaFull: 168, alphaNone: 186, colors: ["c"] });
    expect(M20_ARTIFACT_TYPE_TINT).toEqual({ op: "tint", rgb: [151, 170, 181], opacity: 0.65, alphaFull: 205, alphaNone: 216 });
    // Provenance says which colour a composite is limited to.
    expect(describeFinish({ ...M20_COLOURLESS_TYPE_TINT, mask: "m" } as never)).toMatch(/\(colour c only\)$/);
    expect(describeFinish({ ...M20_ARTIFACT_TYPE_TINT, mask: "m" } as never)).not.toMatch(/only/);
    // No other template composites anything of its own.
    for (const [t, def] of Object.entries(templates)) if (!M20_TOKENS.includes(t)) expect(def.finish, t).toBeUndefined();
    for (const [t, def] of Object.entries(templates)) if (!M20_TOKENS.includes(t)) expect(finishFor(def as never, "c"), t).toEqual([]);
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
      "m15borderless", "m15borderlessartifact", "m15borderlessland", "m15fullartland", "fullartland",
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
    // CC's L is 4.34's land frame, never a COLOUR of this template — only
    // the hybrid pairs' grey bars (4.6f) read it.
    for (const [key, layers] of Object.entries(plain.colors)) {
      if (key.includes("-h")) continue;
      expect(layers.some((l) => l.src.endsWith("FrameL.png")), key).toBe(false);
    }
    expect(plain.colors["wu-h"][0].src).toMatch(/FrameL\.png$/);
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

  it("builds the borderless land from the same pack: the colour frame, its title bar moved onto the type bar, the tinted box, the pinline on top (4.34)", () => {
    const frame = (k: string) => `img/frames/m15/borderless/m15GenericShowcaseFrame${k}.png`;
    const land = templates.m15borderlessland;
    const layers = (letter: string, box = letter, pinline = letter) => [
      { src: frame(letter) },
      { src: frame(letter), mask: "img/frames/m15/regular/m15MaskType.png", replace: true, dy: 1081 },
      {
        src: "img/frames/m15/genericShowcase/m15GenericShowcaseFrameL.png",
        mask: "img/frames/m15/regular/m15MaskRules.png",
        replace: true,
        retint: { from: [154, 154, 154], tintOf: { src: frame(box), x: 750, y: 160 } },
      },
      { src: frame(pinline), mask: "img/frames/m15/genericShowcase/m15GenericShowcaseMaskPinline.png" },
    ];
    // Each colour dresses its title bar, type bar and box in its own tint
    // (the prints), m is the gold three-and-more-colour land.
    for (const k of ["w", "u", "b", "r", "g", "m"]) expect(land.colors[k], k).toEqual(layers(k.toUpperCase()));
    // Colourless is CC's 'Land Frame' L, never the see-through spells' C.
    expect(land.colors.c).toEqual(layers("L"));
    expect(sourceFilesFor(land as never).some((f) => f.endsWith("FrameC.png"))).toBe(false);
    // The recipe is one function of three letters: 4.6's pair masters pass
    // the grey L bars and a letter pair.
    expect(borderlessLandLayers({ frame: "l", box: "w", pinline: "u" })).toEqual(layers("L", "W", "U"));
    expect(BORDERLESS_TITLE_TO_TYPE_DY).toBe(1081);
    expect(BORDERLESS_TINT_POINT).toEqual({ x: 750, y: 160 });
    expect(TINTED_BOX_STRUCTURE).toMatchObject({ from: [154, 154, 154], flatAt: { x: 750, y: 1600 } });
    // Masters only: a land creature prints on m15borderless's plates.
    expect(land.plates).toBeUndefined();
    expect(land.pack).toMatch(/^packBorderless[.]js .*packGenericShowcase[.]js/);
    expect(land.transforms).toMatch(/no resample/);
    expect(describeLayer(land.colors.u[1])).toBe(
      `${frame("U")} moved down 1081 px replacing through img/frames/m15/regular/m15MaskType.png`,
    );
    expect(describeLayer(land.colors.u[2])).toBe(
      `img/frames/m15/genericShowcase/m15GenericShowcaseFrameL.png re-tinted from 154,154,154 to the tint of ${frame("U")} at (750, 160) replacing through img/frames/m15/regular/m15MaskRules.png`,
    );
    // The tint source is a file the import fetches.
    expect(sourceFilesFor(land as never)).toContain(frame("U"));
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

// TODO 4.21a (layout v38): flip, adventure and aftermath from Card Conjurer's
// own packs, and flip's two P/T plates cut per creature half.
describe("the portrait layouts (4.21a)", () => {
  const TRIO = ["adventure", "aftermath", "flip"];

  it("copies each colour 1:1 from its own pack (flip's lower half re-cut since v39); the packs' missing colourless keys are named stand-ins", () => {
    for (const template of TRIO) {
      const def = templates[template];
      expect(Object.keys(def.colors).sort(), template).toEqual([...COLORS].sort());
      for (const key of COLORS) {
        // One layer, the pack's own file: no mask, no blend, no band re-cut.
        expect(def.colors[key], `${template}/${key}`).toHaveLength(1);
        expect(def.colors[key][0].mask, `${template}/${key}`).toBeUndefined();
      }
      expect(def.recut, template).toBeUndefined();
      expect(def.finish, template).toBeUndefined();
      if (template === "flip") {
        expect(def.recutUp, template).toBe(FLIP_LOWER_RECUT);
        expect(def.transforms, template).toMatch(/^native 1500x2100, no resample; the lower half re-cut onto the prints/);
      } else {
        expect(def.recutUp, template).toBeUndefined();
        expect(def.transforms, template).toMatch(/^native 1500x2100, pixels copied 1:1 \(no resample\)/);
      }
    }
    // Flip has a colourless frame of its own (the see-through one); the
    // adventure and aftermath packs have none — CC's artifact frame stands in.
    expect(templates.flip.colors.c[0].src).toBe("img/frames/m15/flip/c.png");
    expect(templates.adventure.colors.c[0].src).toBe("img/frames/adventure/regular/a.png");
    expect(templates.aftermath.colors.c[0].src).toBe("img/frames/m15/aftermath/a.png");
    for (const template of ["adventure", "aftermath"]) {
      expect(templates[template].notes.join(" "), template).toMatch(/RENDER STAND-IN only/);
      expect(templates[template].notes.join(" "), template).toMatch(/never offered/);
    }
    expect(templates.aftermath.notes.join(" ")).toMatch(/needs TODO 4\.26/);
  });

  it("cuts flip's two plates out of the pack's one image, each into the box the FLIP profile draws it in", () => {
    const cut = templates.flip.ptCut!;
    // packFlip.js: `bounds` of the '<Colour> Power/Toughness' frames, and
    // its masks2 ('Top PT' / 'Bottom PT').
    expect(FLIP_PT_BOUNDS).toEqual({ x: 0.0374, y: 0.2277, width: 0.9067, height: 0.4762 });
    expect(FLIP_PT_MASKS).toEqual({ top: "img/frames/topHalfSharp.svg", bottom: "img/frames/bottomHalfSharp.svg" });
    expect(cut.bounds).toBe(FLIP_PT_BOUNDS);
    expect(cut.masks).toBe(FLIP_PT_MASKS);
    expect(cut.boxes).toBe(FLIP_PT_BOXES);
    // The image is 1360x1000: drawn at its bounds it is 1:1 on the card.
    expect(boundsPx(FLIP_PT_BOUNDS, 1500, 2100)).toEqual({ x: 56, y: 478, width: 1360, height: 1000 });
    expect(Object.keys(cut.image).sort()).toEqual([...COLORS].sort());
    for (const key of COLORS) expect(cut.image[key], key).toBe(`img/frames/m15/flip/${key}pt.png`);
    // Each box lies in its own half (the masks cut the card at its middle
    // row), so a plate never carries a sliver of the other.
    expect(Object.keys(FLIP_PT_BOXES)).toEqual(["top", "bottom"]);
    expect(FLIP_PT_BOXES.top.y + FLIP_PT_BOXES.top.height).toBeLessThanOrEqual(1050);
    expect(FLIP_PT_BOXES.bottom.y).toBeGreaterThanOrEqual(1050);
    // The FLIP profile's plateRects ARE these boxes, in percent — the plate
    // is drawn where it was cut from (move one without the other and the
    // plate lands off the master's bar).
    const pct = (b: { x: number; y: number; width: number; height: number }) => ({
      topPct: b.y / 21,
      leftPct: b.x / 15,
      widthPct: b.width / 15,
      heightPct: b.height / 21,
    });
    const flip = getFrameProfile("flip");
    expect(flip.pt!.plateRect).toEqual(pct(FLIP_PT_BOXES.top));
    expect(flip.secondFace!.pt!.plateRect).toEqual(pct(FLIP_PT_BOXES.bottom));
    expect(flip.pt!.plateAssetPathTemplate).toBe("/frames/flip/pt/{color}-top.png");
    expect(flip.secondFace!.pt!.plateAssetPathTemplate).toBe("/frames/flip/pt/{color}-bottom.png");
    // The published plates are the boxes' native size, every colour, PNG
    // and WebP.
    const files = (manifestJson as FrameManifest).files as Record<string, { width: number; height: number }>;
    for (const key of COLORS) {
      for (const half of ["top", "bottom"] as const) {
        for (const ext of ["png", "webp"]) {
          const entry = files[`flip/pt/${key}-${half}.${ext}`];
          expect(entry, `flip/pt/${key}-${half}.${ext}`).toBeDefined();
          expect([entry.width, entry.height], `flip/pt/${key}-${half}.${ext}`).toEqual([FLIP_PT_BOXES[half].width, FLIP_PT_BOXES[half].height]);
        }
      }
    }
    // Sources and provenance name the plate images and both masks.
    for (const src of [...Object.values(cut.image), ...Object.values(cut.masks)]) {
      expect(sourceFilesFor(templates.flip as never), src).toContain(src);
    }
    const provenance = JSON.parse(readFileSync("lib/cards/frame-sources.json", "utf8"));
    expect(provenance.flip.ptCut).toEqual(describePtCut(cut as never, 1500, 2100));
    expect(provenance.flip.ptCut.drawnAt).toBe("1360x1000 at (56, 478) of the 1500x2100 card");
    // No other template cuts plates this way.
    expect(Object.entries(templates).filter(([, d]) => d.ptCut).map(([t]) => t)).toEqual(["flip"]);
    expect(provenance.adventure.ptCut).toBeUndefined();
    expect(provenance.aftermath.ptCut).toBeUndefined();
  });

  // Layout v39 (owner decision round 22, 2026-10-02): the lower half moved
  // onto C18 #134 and CM2 #71 in two pieces (the window's inner line and the
  // bar's dark top band 7 px, the bar's bottom and the text box's top edge
  // 5 px), split inside the bar's bevel plateau. Against the pack's bounds:
  // packFlip.js draws the upside-down type bar (type2) at 63.43–68.86 %H
  // (1332–1446 px), its text box (rules2) at 70.1–82.1 (1472–1724) and the
  // bottom plate's box at 1321–1481; the re-cut reaches rows 1283–1499.
  it("re-cuts flip's lower half onto the prints in two pieces, split inside the bar's bevel, inside the pack's own bands (layout v39)", () => {
    expect(FLIP_LOWER_RECUT).toEqual({ fromY: 1290, splitY: 1340, toY: 1500, shiftTop: -7, shiftBottom: -5, blendTop: 24, blendSplit: 3, blendBottom: 24 });
    const r = FLIP_LOWER_RECUT;
    const type2 = { top: 0.6343 * 2100, bottom: 0.6886 * 2100 };
    const rules2 = { top: 0.701 * 2100, bottom: 0.821 * 2100 };
    // The top piece starts inside the window (above the pack's type bar by
    // more than the blend) and the split lies in the bar's dark top band
    // (its outline from 1332, its face from 1344 on CC's master), so each
    // piece carries a whole edge: the top one the window's line and the
    // band's top, the bottom one the face, the bottom outline and the box's
    // edge — the split's two duplicated rows are the bevel's flat plateau
    // (CC rows 1337–1342).
    expect(r.fromY + r.shiftTop + r.blendTop).toBeLessThan(1310);
    expect(r.splitY).toBeGreaterThan(type2.top);
    expect(r.splitY - 2).toBeGreaterThanOrEqual(1337);
    expect(r.splitY - 1).toBeLessThanOrEqual(1342);
    expect(r.splitY + r.shiftTop + r.blendSplit).toBeLessThanOrEqual(1337);
    // The bottom piece ends inside the text box's paper (past its top edge
    // by more than the blend) and before the pack's rules box ends.
    expect(r.toY - r.blendBottom).toBeGreaterThan(rules2.top);
    expect(r.toY).toBeLessThan(rules2.bottom);
    // The bar lands on the prints: CC's face 1344–1449 → 1339–1444, its line
    // 1317–1320 → 1310–1313 (the prints' 1339–1444 and 1311–1313).
    expect([1344 + r.shiftBottom, 1449 + r.shiftBottom]).toEqual([1339, 1444]);
    expect([1317 + r.shiftTop, 1320 + r.shiftTop]).toEqual([1310, 1313]);
    // The art slot follows the window's new bottom (1310) with 7.6's spare,
    // the rules rect the paper's new first row (1472 + shiftBottom).
    const flip = getFrameProfile("flip");
    expect((flip.artSlot.topPct + flip.artSlot.heightPct) * 21 - (1317 + r.shiftTop)).toBeCloseTo(2.08, 1);
    expect(flip.secondFace!.rules.rect.topPct * 21).toBeCloseTo(1472 + r.shiftBottom, 0);
    // The plates are not touched: the same boxes, cut from the same image.
    expect(templates.flip.ptCut!.boxes).toBe(FLIP_PT_BOXES);
    // Provenance records it.
    const provenance = JSON.parse(readFileSync("lib/cards/frame-sources.json", "utf8"));
    expect(provenance.flip.recutUp).toEqual(FLIP_LOWER_RECUT);
    expect(provenance.flip.transforms).toMatch(/rows 1290–1339 .* moved up 7 px and rows 1340–1499 .* moved up 5 px/);
    expect(provenance.flip.notes.join(" ")).toMatch(/lower half re-cut onto the prints/);
    expect(provenance.adventure.recutUp).toBeUndefined();
    expect(provenance.aftermath.recutUp).toBeUndefined();
  });
});

// The saga (TODO 4.21c = 3.7): the pack's own frames copied 1:1, the land
// saga as the colourless key, the rail's two bitmaps published as pieces and
// the pack's masks RECORDED for the two-colour saga's pair masters (4.6f) —
// never published.
describe("the saga (4.21c)", () => {
  const saga = templates.saga;
  const files = (manifestJson as FrameManifest).files as Record<string, { width: number; height: number; bytes: number }>;
  const provenance = () => JSON.parse(readFileSync("lib/cards/frame-sources.json", "utf8")).saga;

  it("copies w u b r g m 1:1 from the pack's sagaFrame<K> and builds the colourless key from its Land Frame", () => {
    expect(Object.keys(saga.colors).sort()).toEqual([...COLORS].sort());
    for (const key of COLORS) {
      // One layer, the pack's own file: no mask, no blend, no re-cut.
      expect(saga.colors[key], key).toHaveLength(1);
      expect(saga.colors[key][0].mask, key).toBeUndefined();
      const want = key === "c" ? "img/frames/saga/regular/l.png" : `img/frames/saga/regular/sagaFrame${key.toUpperCase()}.png`;
      expect(saga.colors[key][0].src, key).toBe(want);
    }
    // The pack's 'Artifact Frame' is not built (no profile key paints it),
    // and nothing is excluded: every key is the pack's.
    expect(Object.values(saga.colors).flat().map((l) => l.src)).not.toContain("img/frames/saga/regular/sagaFrameA.png");
    expect(saga.excluded).toBeUndefined();
    expect(saga.recut).toBeUndefined();
    expect(saga.recutUp).toBeUndefined();
    expect(saga.finish).toBeUndefined();
    expect(saga.plates).toBeUndefined();
    expect(saga.transforms).toMatch(/^native 1500x2100, pixels copied 1:1 \(no resample\)/);
    expect(saga.pack).toMatch(/^packSagaRegular\.js 'Regular Frames'/);
    expect(saga.notes.join(" ")).toMatch(/colourless = CC's 'Land Frame'/);
    expect(saga.notes.join(" ")).toMatch(/MH2 #259 Urza's Saga/);
    // The masters are published at the card's size, PNG and WebP, and git
    // holds none of them (Card Conjurer-derived frames never enter the repo).
    for (const key of COLORS) {
      for (const ext of ["png", "webp"]) {
        const entry = files[`saga/${key}.${ext}`];
        expect(entry, `saga/${key}.${ext}`).toBeDefined();
        expect([entry.width, entry.height], `saga/${key}.${ext}`).toEqual([1500, 2100]);
      }
    }
    const tracked = execFileSync("git", ["ls-files", "public/frames/saga"], { encoding: "utf8" }).trim();
    expect(tracked).toBe("");
  });

  it("publishes the rail's badge and divider at native size, at the paths the SAGA profile draws", () => {
    expect(saga.pieces).toBe(SAGA_CHAPTER_PIECES);
    expect(SAGA_CHAPTER_PIECES).toEqual({
      "chapter/badge": "img/frames/saga/sagaChapter.png",
      "chapter/divider": "img/frames/saga/sagaDivider.png",
    });
    const chapters = getFrameProfile("saga").chapters!;
    // The profile names exactly the published objects…
    expect([chapters.badge.assetPath, chapters.divider.assetPath].sort()).toEqual(
      Object.keys(SAGA_CHAPTER_PIECES).map((name) => `/frames/saga/${name}.png`).sort(),
    );
    // …draws the badge at its native size (118 × 132 of 1500 × 2100)…
    expect([files["saga/chapter/badge.png"].width, files["saga/chapter/badge.png"].height]).toEqual([118, 132]);
    expect(Math.round(chapters.badge.widthPct * 15)).toBe(118);
    expect(Math.round(chapters.badge.heightPct * 21)).toBe(132);
    // …and the divider at the pack's 592 px width, 6 px tall (versionSaga.js
    // draws the 9 px bitmap at 0.0029 of the card's height).
    expect([files["saga/chapter/divider.png"].width, files["saga/chapter/divider.png"].height]).toEqual([592, 9]);
    expect(Math.round(chapters.divider.widthPct * 15)).toBe(592);
    expect(Math.round(chapters.divider.heightPct * 21)).toBe(6);
    for (const name of Object.keys(SAGA_CHAPTER_PIECES)) {
      expect(files[`saga/${name}.webp`], name).toBeDefined();
      // frameUrl resolves both (the preview's WebP, the bake's PNG).
      expect(frameUrl(`/frames/saga/${name}.png`)).toContain(`saga/${name}.`);
    }
    // No other template publishes pieces this way.
    expect(Object.entries(templates).filter(([, d]) => d.pieces).map(([t]) => t)).toEqual(["saga"]);
  });

  it("records the pack's nine masks as inputs for the pair masters and never publishes one", () => {
    expect(saga.maskInputs).toBe(SAGA_MASK_INPUTS);
    // packSagaRegular.js `masks`, by the pack's own names.
    expect(SAGA_MASK_INPUTS).toEqual({
      Pinline: "img/frames/saga/sagaMaskPinline.png",
      Title: "img/frames/m15/regular/m15MaskTitle.png",
      Type: "img/frames/saga/sagaMaskType.png",
      Frame: "img/frames/saga/sagaMaskFrame.png",
      Banner: "img/frames/saga/sagaMaskBanner.png",
      "Banner (Right)": "img/frames/saga/sagaMaskBannerRight.png",
      Text: "img/frames/saga/sagaMaskText.png",
      "Text (Right)": "img/frames/saga/sagaMaskTextRight.png",
      Border: "img/frames/saga/sagaMaskBorder.png",
    });
    // Fetched with the masters (so a fresh cache holds them)…
    const sources = sourceFilesFor(saga as never);
    for (const src of [...Object.values(SAGA_MASK_INPUTS), ...Object.values(SAGA_CHAPTER_PIECES)]) expect(sources, src).toContain(src);
    // …listed in provenance…
    const p = provenance();
    expect(p.maskInputs).toMatchObject(SAGA_MASK_INPUTS);
    expect(p.maskInputs.output).toMatch(/^not published/);
    expect(p.pieces).toMatchObject(SAGA_CHAPTER_PIECES);
    expect(p.colors.c).toEqual(["img/frames/saga/regular/l.png"]);
    expect(p.commit).toBe(CC_COMMIT);
    // …and no saga object but the seven masters and the two pieces exists:
    // no mask, no pair master (those are TODO 4.6f's).
    const published = Object.keys(files).filter((k) => k.startsWith("saga/")).sort();
    const want = [...COLORS.map((k) => `saga/${k}`), "saga/chapter/badge", "saga/chapter/divider"].flatMap((k) => [`${k}.png`, `${k}.webp`]).sort();
    expect(published).toEqual(want);
    expect(published.some((k) => /mask/i.test(k))).toBe(false);
    // No other template records masks this way.
    expect(Object.entries(templates).filter(([, d]) => d.maskInputs).map(([t]) => t)).toEqual(["saga"]);
  });
});

describe("pixel operations", () => {
  const px = (r: number, g: number, b: number, a: number) => [r, g, b, a];

  describe("compositeFinish (the full-art tokens' composites, owner decisions 2026-09-29)", () => {
    /** One row of pixels and a mask over it. */
    const row = (pixels: number[][]) => Buffer.from(pixels.flat());
    const maskOf = (alphas: number[]) => Buffer.from(alphas.flatMap((a) => [255, 0, 0, a]));

    it("'opaque': a pixel the mask covers keeps its colour and becomes opaque; a partial mask adds its share", () => {
      // CC's interior (α 204), the colourless one (166), the outline (255),
      // a pixel outside the mask, one on the mask's anti-aliased edge.
      const buf = row([px(243, 241, 232, 204), px(209, 209, 209, 166), px(0, 0, 0, 255), px(10, 20, 30, 0), px(243, 241, 232, 204)]);
      const out = compositeFinish(buf, 5, 1, [{ op: "opaque", mask: "type" }], { type: maskOf([255, 255, 255, 0, 128]) });
      expect([...out]).toEqual([
        ...px(243, 241, 232, 255),
        ...px(209, 209, 209, 255),
        ...px(0, 0, 0, 255),
        ...px(10, 20, 30, 0),
        ...px(243, 241, 232, Math.round(204 + 51 * (128 / 255))),
      ]);
      // Pure: the input is untouched.
      expect(buf[3]).toBe(204);
    });

    it("'tint': the slate goes source-over CC's translucent silver only — its interior fully, the rims not at all", () => {
      const slate = { ...M20_ARTIFACT_NAME_SLATE, mask: "title" } as const;
      // CC's pill: its middle (77), its end (246), both α 230; a rim pixel
      // (α 246) and one half-way (α 237); one outside the mask.
      const buf = row([px(77, 77, 77, 230), px(246, 246, 246, 230), px(246, 246, 246, 246), px(240, 240, 240, 237), px(77, 77, 77, 230)]);
      const out = compositeFinish(buf, 5, 1, [slate], { title: maskOf([255, 255, 255, 255, 0]) });
      const over = (c: number, s: number, a: number, t: number) => {
        const outA = t + (a / 255) * (1 - t);
        return Math.round((s * t + c * (a / 255) * (1 - t)) / outA);
      };
      const at = (i: number) => [...out.subarray(i * 4, i * 4 + 4)];
      expect(at(0)).toEqual([over(77, 30, 230, 0.65), over(77, 40, 230, 0.65), over(77, 48, 230, 0.65), Math.round((0.65 + (230 / 255) * 0.35) * 255)]);
      expect(at(1)[0]).toBe(over(246, 30, 230, 0.65));
      // The rim keeps CC's pixel; the half-way pixel takes half the weight.
      expect(at(2)).toEqual(px(246, 246, 246, 246));
      expect(at(3)[0]).toBe(over(240, 30, 237, 0.65 * 0.5));
      expect(at(4)).toEqual(px(77, 77, 77, 230));
    });

    it("the slate puts the prints' luminance behind the name on CC's silver, lighter towards the caps", () => {
      // CC's tokenFrameA pill (α 230): ~77 at its middle, a median of ~110
      // behind the name (x 420–1080 × y 135–190 px), 246 at the caps. On
      // mid-grey art.
      const lum = (p: number[]) => 0.299 * p[0] + 0.587 * p[1] + 0.114 * p[2];
      const linear = (v: number) => (v / 255 <= 0.04045 ? v / 255 / 12.92 : ((v / 255 + 0.055) / 1.055) ** 2.4);
      const whiteContrast = (p: number[]) => 1.05 / (0.2126 * linear(p[0]) + 0.7152 * linear(p[1]) + 0.0722 * linear(p[2]) + 0.05);
      const onArt = (p: number[]) => [0, 1, 2].map((c) => p[c] * (p[3] / 255) + 118 * (1 - p[3] / 255));
      const slate = { ...M20_ARTIFACT_NAME_SLATE, mask: "title" } as const;
      const tint = (v: number) =>
        onArt([...compositeFinish(row([px(v, v, v, 230)]), 1, 1, [slate], { title: maskOf([255]) })]);
      // Behind the name, the prints' slate: luminance 54–71 and white ink
      // 9–11 : 1 (16 M20+ artifact prints; CC's silver pill there was
      // 102–137, 3.5–5.7 : 1).
      const behind = tint(110);
      expect(lum(behind)).toBeGreaterThanOrEqual(54);
      expect(lum(behind)).toBeLessThanOrEqual(71);
      expect(whiteContrast(behind)).toBeGreaterThanOrEqual(9);
      expect(whiteContrast(behind)).toBeLessThanOrEqual(11.5);
      // Blue-grey, as printed (the prints' 59 / 64 / 67).
      expect(behind[2]).toBeGreaterThan(behind[0]);
      // Darker still at the pill's middle; the caps stay lighter, as printed
      // (the prints' ~130–150; CC's 246).
      expect(lum(tint(77))).toBeLessThan(lum(behind));
      expect(lum(tint(246))).toBeGreaterThan(95);
      expect(lum(tint(246))).toBeLessThan(150);
    });

    it("round 14: the type tints put CC's flat pill interiors on the prints' median; the bevel, outline and rim keep CC's pixels", () => {
      const lum = (p: number[]) => 0.299 * p[0] + 0.587 * p[1] + 0.114 * p[2];
      /** One pixel through the pill's own finish (tint, then opaque). */
      const pill = (tint: typeof M20_COLOURLESS_TYPE_TINT | typeof M20_ARTIFACT_TYPE_TINT, p: number[]) => [
        ...compositeFinish(row([p]), 1, 1, [{ ...tint, mask: "type" }, { op: "opaque", mask: "type" }], { type: maskOf([255]) }),
      ];
      // Colourless: frameC's interior (a flat 209 at α 166) → the median of
      // 4 M20+ colourless prints (TEOE #1, TCMM #1, TMH3 #38, TFDN #26:
      // rgb 176/165/160, luminance 167; 157–180). CC's was 209.
      const c = pill(M20_COLOURLESS_TYPE_TINT, px(209, 209, 209, 166));
      expect(c).toEqual(px(176, 165, 160, 255));
      expect(lum(c)).toBeGreaterThanOrEqual(157);
      expect(lum(c)).toBeLessThanOrEqual(180);
      // Artifact: tokenFrameA's interior (rgb 181/197/203 at α 204) → the
      // median of 16 M20+ artifact prints (rgb 160/178/188, luminance 174;
      // 160–190). CC's was 193.
      const a = pill(M20_ARTIFACT_TYPE_TINT, px(181, 197, 203, 204));
      expect(a).toEqual(px(160, 178, 188, 255));
      expect(lum(a)).toBeGreaterThanOrEqual(160);
      expect(lum(a)).toBeLessThanOrEqual(190);
      // Steel, as printed: blue above red.
      expect(a[2]).toBeGreaterThan(a[0]);
      // CC's bevel (its light top rows, its dark left / bottom rows), the
      // black outline: only made solid, never tinted — as the prints keep a
      // lighter top bevel and a darker bottom one around the flat interior.
      for (const [tint, bevel] of [
        [M20_COLOURLESS_TYPE_TINT, [px(214, 214, 214, 190), px(110, 110, 110, 211), px(189, 189, 189, 241), px(0, 0, 0, 255)]],
        [M20_ARTIFACT_TYPE_TINT, [px(191, 199, 202, 247), px(103, 111, 115, 231), px(109, 117, 120, 242), px(145, 158, 163, 216), px(0, 0, 0, 255)]],
      ] as const) {
        for (const p of bevel) expect(pill(tint, [...p]), `${tint.rgb} ${p}`).toEqual([p[0], p[1], p[2], 255]);
      }
    });

    it("round 14: the artifact name pill is solid — the slate's α ≈ 246 made 255, its tone kept inside the prints' range", () => {
      const lum = (p: number[]) => 0.299 * p[0] + 0.587 * p[1] + 0.114 * p[2];
      const linear = (v: number) => (v / 255 <= 0.04045 ? v / 255 / 12.92 : ((v / 255 + 0.055) / 1.055) ** 2.4);
      const whiteContrast = (p: number[]) => 1.05 / (0.2126 * linear(p[0]) + 0.7152 * linear(p[1]) + 0.0722 * linear(p[2]) + 0.05);
      const name = (finish: object[], v: number) =>
        [...compositeFinish(row([px(v, v, v, 230)]), 1, 1, finish as never, { title: maskOf([255]) })];
      const slate = { ...M20_ARTIFACT_NAME_SLATE, mask: "title" };
      const solid = { ...M20_ARTIFACT_SOLID_NAME_PILL, mask: "title" };
      // Before round 14 the slate left CC's silver at α ≈ 246 (the art
      // showed through); now every covered pixel is opaque…
      expect(name([slate], 110)[3]).toBe(Math.round((0.65 + (230 / 255) * 0.35) * 255));
      const behind = name([slate, solid], 110);
      expect(behind[3]).toBe(255);
      // …in the same colour: behind the name still the prints' slate
      // (luminance 54–71, white ink 9–11.5 : 1; 16 M20+ artifact prints).
      expect(behind.slice(0, 3)).toEqual(name([slate], 110).slice(0, 3));
      expect(lum(behind)).toBeGreaterThanOrEqual(54);
      expect(lum(behind)).toBeLessThanOrEqual(71);
      expect(whiteContrast(behind)).toBeGreaterThanOrEqual(9);
      expect(whiteContrast(behind)).toBeLessThanOrEqual(11.5);
    });

    it("refuses an unknown op or a missing mask", () => {
      const buf = row([px(1, 2, 3, 4)]);
      expect(() => compositeFinish(buf, 1, 1, [{ op: "opaque", mask: "x" }], {})).toThrow(/no 1x1 mask for x/);
      expect(() => compositeFinish(buf, 1, 1, [{ op: "blur", mask: "x" } as never], { x: maskOf([255]) })).toThrow(/unknown op/);
      expect(() => describeFinish({ op: "blur" } as never)).toThrow(/unknown op/);
    });
  });

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

  describe("recutBlockUp (layout v39: the flip masters' lower half, two pieces up)", () => {
    const column = (h: number, alphaAt?: (y: number) => number) => {
      const buf = Buffer.alloc(h * 4);
      for (let y = 0; y < h; y += 1) buf.set([y, 0, 0, alphaAt ? alphaAt(y) : 255], y * 4);
      return buf;
    };
    const red = (buf: Buffer, y: number) => buf[y * 4];
    const rows = (buf: Buffer, from: number, to: number) => Array.from({ length: to - from }, (_, i) => red(buf, from + i));

    it("moves the top piece further up than the bottom one, repeats the bottom piece's first rows between them and the rows under the block below it", () => {
      // Rows 20–39 up 4 (→ 16–35), rows 40–79 up 2 (→ 38–77); hard cuts.
      const out = recutBlockUp(column(100), 1, 100, { fromY: 20, splitY: 40, toY: 80, shiftTop: -4, shiftBottom: -2, blendTop: 0, blendSplit: 0, blendBottom: 0 });
      for (let y = 0; y < 16; y += 1) expect(red(out, y), `row ${y}`).toBe(y);
      expect(rows(out, 16, 36)).toEqual(Array.from({ length: 20 }, (_, i) => 20 + i));
      // The two rows the moves open (36, 37) repeat the bottom piece's first
      // rows before it (38, 39 → the rows just above splitY), then the
      // bottom piece runs 2 rows higher…
      expect(rows(out, 36, 40)).toEqual([38, 39, 40, 41]);
      expect(rows(out, 40, 78)).toEqual(Array.from({ length: 38 }, (_, i) => 42 + i));
      // …and the rows it leaves (78, 79) repeat the rows under the block.
      expect(rows(out, 78, 80)).toEqual([80, 81]);
      for (let y = 80; y < 100; y += 1) expect(red(out, y), `row ${y}`).toBe(y);
    });

    it("cross-fades the three seams, premultiplied: the top from the original rows, the split from the top piece's continuation, the bottom into the original rows", () => {
      const out = recutBlockUp(column(100), 1, 100, { fromY: 20, splitY: 40, toY: 80, shiftTop: -4, shiftBottom: -2, blendTop: 3, blendSplit: 2, blendBottom: 3 });
      // Top seam (rows 16–18): original (1 − t) into moved (row + 4), t = (i + 1) / 4.
      expect(rows(out, 16, 19)).toEqual([Math.round(16 * 0.75 + 20 * 0.25), Math.round(17 * 0.5 + 21 * 0.5), Math.round(18 * 0.25 + 22 * 0.75)]);
      expect(red(out, 19)).toBe(23);
      // Split seam (rows 36–37): the top piece's continuation (row + 4) into
      // the bottom piece (row + 2), t = (i + 1) / 3.
      expect(rows(out, 36, 38)).toEqual([Math.round(40 * (2 / 3) + 38 * (1 / 3)), Math.round(41 * (1 / 3) + 39 * (2 / 3))]);
      expect(red(out, 38)).toBe(40);
      // Bottom seam (rows 77–79): moved (row + 2) into the original.
      expect(rows(out, 77, 80)).toEqual([Math.round(79 * 0.75 + 77 * 0.25), Math.round(80 * 0.5 + 78 * 0.5), Math.round(81 * 0.25 + 79 * 0.75)]);
      expect(red(out, 80)).toBe(80);
    });

    it("blends colour by alpha, so a clear window row adds no colour at the top seam", () => {
      const src = column(100, (y) => (y < 30 ? 0 : 255));
      for (let y = 0; y < 30; y += 1) src[y * 4] = 0;
      const out = recutBlockUp(src, 1, 100, { fromY: 20, splitY: 40, toY: 80, shiftTop: -4, shiftBottom: -2, blendTop: 1, blendSplit: 0, blendBottom: 0 });
      // Row 16 mixes clear row 16 with clear row 20: still clear.
      expect(out[16 * 4 + 3]).toBe(0);
      // Row 26 (hard, inside the piece) = row 30: the first opaque row.
      expect([out[26 * 4], out[26 * 4 + 3]]).toEqual([30, 255]);
    });

    it("refuses a block that doesn't fit, pieces the wrong way round, or seams that overlap", () => {
      const ok = { fromY: 20, splitY: 40, toY: 80, shiftTop: -4, shiftBottom: -2, blendTop: 3, blendSplit: 2, blendBottom: 3 };
      expect(() => recutBlockUp(column(100), 1, 100, { ...ok, fromY: 2 })).toThrow(/bad block/);
      expect(() => recutBlockUp(column(100), 1, 100, { ...ok, toY: 99 })).toThrow(/bad block/);
      expect(() => recutBlockUp(column(100), 1, 100, { ...ok, shiftTop: -2, shiftBottom: -4 })).toThrow(/bad block/);
      expect(() => recutBlockUp(column(100), 1, 100, { ...ok, shiftTop: 4 })).toThrow(/bad block/);
      expect(() => recutBlockUp(column(100), 1, 100, { ...ok, splitY: 20 })).toThrow(/bad block/);
      expect(() => recutBlockUp(column(100), 1, 100, { ...ok, blendTop: 30 })).toThrow(/bad block/);
      expect(() => recutBlockUp(column(100), 1, 100, { ...ok, blendBottom: -1 })).toThrow(/bad block/);
    });

    it("never touches the source buffer, and the recipe fits a 1500×2100 master", () => {
      const src = column(100);
      const copy = Buffer.from(src);
      recutBlockUp(src, 1, 100, { fromY: 20, splitY: 40, toY: 80, shiftTop: -4, shiftBottom: -2, blendTop: 3, blendSplit: 2, blendBottom: 3 });
      expect(src.equals(copy)).toBe(true);
      expect(() => recutBlockUp(Buffer.alloc(2100 * 4), 1, 2100, FLIP_LOWER_RECUT)).not.toThrow();
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
      dx: [-10, 10],
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

    it("multiplies by a gain bilinear in the signed offset from centreX and the row, held past the outer knots", () => {
      const g = { dx: [10, 20], rows: [100, 200], gain: [[0.2, 0.4], [0.6, 1]] };
      expect(silverGainAt(g, 0, 0)).toBeCloseTo(0.2, 12);
      expect(silverGainAt(g, 15, 100)).toBeCloseTo(0.3, 12);
      expect(silverGainAt(g, 10, 150)).toBeCloseTo(0.4, 12);
      expect(silverGainAt(g, 15, 150)).toBeCloseTo(0.55, 12);
      expect(silverGainAt(g, 99, 999)).toBeCloseTo(1, 12);
      // Signed: the left of the centre is its own side, not a mirror of the
      // right (round 12b); between the halves' inner knots the gain runs
      // straight across the centre.
      const sides = { dx: [-20, -10, 10, 20], rows: [0], gain: [[0.4, 0.5, 0.9, 1]] };
      expect(silverGainAt(sides, -15, 0)).toBeCloseTo(0.45, 12);
      expect(silverGainAt(sides, 15, 0)).toBeCloseTo(0.95, 12);
      expect(silverGainAt(sides, 0, 0)).toBeCloseTo(0.7, 12);
      expect(silverGainAt(sides, -5, 0)).toBeCloseTo(0.6, 12);
      expect(silverGainAt(sides, -99, 0)).toBeCloseTo(0.4, 12);
      expect(silverGainAt(sides, 99, 0)).toBeCloseTo(1, 12);
      // One knot on an axis: held everywhere.
      expect(silverGainAt({ dx: [0], rows: [0, 10], gain: [[0.5], [0.7]] }, 50, 5)).toBeCloseTo(0.6, 12);
      // The recipe's own: 1 above the name bar; half-way down, the right rail
      // darkest (0.45), the left one not.
      expect(silverGainAt(EMBLEM_SILVER_TONE, 0, 60)).toBe(1);
      expect(silverGainAt(EMBLEM_SILVER_TONE, 700, 900)).toBeCloseTo(0.45, 12);
      expect(silverGainAt(EMBLEM_SILVER_TONE, -700, 900)).toBeCloseTo(0.68, 12);
    });

    it("tones each half by its own knots, with no step across the centre", () => {
      // Uniform silver (150), the left half's gain 0.5, the right's 1, the
      // centre segment [-2, 2] between them.
      const flat = Buffer.alloc(W * H * 4);
      for (let i = 0; i < W * H; i += 1) flat.set([150, 150, 150, 255], i * 4);
      const out = toneSilver(flat, W, H, { ...spec, dx: [-2, 2], rows: [0], gain: [[0.5, 1]] });
      const row = Array.from({ length: W }, (_, x) => at(out, x, 5)[0]);
      // x − 9.5: −9.5 … −2.5 → 75; 2.5 … 10.5 → 150; −1.5 … 1.5 between.
      expect(row.slice(0, 8)).toEqual(Array(8).fill(75));
      expect(row.slice(12)).toEqual(Array(8).fill(150));
      expect(row.slice(8, 12)).toEqual([84, 103, 122, 141]);
      for (let x = 1; x < W; x += 1) expect(row[x] - row[x - 1], `x ${x}`).toBeGreaterThanOrEqual(0);
    });

    it("refuses bad rows or knots; never touches the source; applyTone picks it for a silver spec", () => {
      const src = image();
      const copy = Buffer.from(src);
      expect(() => toneSilver(src, W, H, { ...spec, bodyFromY: 9 })).toThrow(/bad tone/);
      expect(() => toneSilver(src, W, H, { ...spec, toY: H + 1 })).toThrow(/bad tone/);
      expect(() => toneSilver(src, W, H, { ...spec, dx: [10, 0] })).toThrow(/bad tone/);
      // Round 12's recipe shape (distance knots `d`, mirrored halves) is refused.
      const unsigned: Record<string, unknown> = { ...spec, d: [0, 10] };
      delete unsigned.dx;
      expect(() => toneSilver(src, W, H, unsigned as unknown as typeof spec)).toThrow(/bad tone/);
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

  describe("the borderless land's operations (TODO 4.34)", () => {
    it("a replacing layer stands INSTEAD of what is under it through its mask, and blends on the mask's edge", () => {
      // 3×1: a dark α128 box (the pack's), a tinted α191 box replacing it
      // through a mask opaque at x=0, 50 % at x=1, clear at x=2.
      const dark = { data: new Uint8Array([...px(0, 0, 0, 128), ...px(0, 0, 0, 128), ...px(0, 0, 0, 128)]) };
      const tint = {
        data: new Uint8Array([...px(0, 117, 190, 191), ...px(0, 117, 190, 191), ...px(0, 117, 190, 191)]),
        mask: new Uint8Array([...px(0, 255, 0, 255), ...px(0, 255, 0, 128), ...px(0, 0, 0, 0)]),
        replace: true,
      };
      const out = toRgba8(compositeLayers([dark, tint], 3, 1));
      // Fully covered: the tint, not the tint over the dark box.
      expect([...out.subarray(0, 4)]).toEqual([0, 117, 190, 191]);
      // Half covered: a premultiplied mix — alpha halfway, colour by weight.
      const m = 128 / 255;
      const a = (128 / 255) * (1 - m) + (191 / 255) * m;
      expect(out[7]).toBe(Math.round(a * 255));
      expect(out[5]).toBe(Math.round((117 * (191 / 255) * m) / a));
      // Uncovered: the box below, untouched.
      expect([...out.subarray(8, 12)]).toEqual([0, 0, 0, 128]);
      // Drawn over (not replacing), the same layer would have darkened it.
      const over = toRgba8(compositeLayers([dark, { ...tint, replace: undefined }], 3, 1));
      expect(over[3]).toBeGreaterThan(191);
      expect(over[2]).toBeLessThan(190);
    });

    it("shiftRows moves every row down, opening transparent rows at the top", () => {
      // 1×5, red = row index.
      const col = Buffer.from([...px(10, 0, 0, 255), ...px(11, 0, 0, 255), ...px(12, 0, 0, 255), ...px(13, 0, 0, 255), ...px(14, 0, 0, 255)]);
      const out = shiftRows(col, 1, 5, 2);
      expect([...out].filter((_, i) => i % 4 === 0)).toEqual([0, 0, 10, 11, 12]);
      expect([out[3], out[7], out[11]]).toEqual([0, 0, 255]);
      expect(shiftRows(col, 1, 5, 0).equals(col)).toBe(true);
      expect(() => shiftRows(col, 1, 5, 5)).toThrow(/bad shift/);
      expect(() => shiftRows(col, 1, 5, 1.5)).toThrow(/bad shift/);
      expect(col[0]).toBe(10); // never touches the source
    });

    it("retintStructure maps a neutral structure's flat, lighter and darker pixels onto the new tint, alpha kept", () => {
      const from = [154, 154, 154];
      const to = [0, 117, 190];
      // flat · a bevel 35 % toward white · a shadow 2/3 toward black · white · black
      const lit = Math.round(154 + 0.35 * 101);
      const shade = Math.round(154 / 3);
      const buf = Buffer.from([
        ...px(154, 154, 154, 191),
        ...px(lit, lit, lit, 209),
        ...px(shade, shade, shade, 229),
        ...px(255, 255, 255, 235),
        ...px(0, 0, 0, 255),
      ]);
      const out = retintStructure(buf, from, to);
      expect([...out.subarray(0, 4)]).toEqual([0, 117, 190, 191]);
      // genericShowcase's own blue box bevel and shadow (89,165,213 α209 and
      // 0,39,63 α229), within rounding of the structure's 8 bits.
      const near = (got: number[], want: number[]) => got.forEach((v, c) => expect(Math.abs(v - want[c]), `${got} ≈ ${want}`).toBeLessThanOrEqual(1));
      near([...out.subarray(4, 7)], [89, 165, 213]);
      expect(out[7]).toBe(209);
      near([...out.subarray(8, 11)], [0, 39, 63]);
      expect([...out.subarray(12, 16)]).toEqual([255, 255, 255, 235]);
      expect([...out.subarray(16, 20)]).toEqual([0, 0, 0, 255]);
      expect(buf[0]).toBe(154); // never touches the source
      expect(() => retintStructure(buf, [0, 0, 0], to)).toThrow(/mid tone/);
    });

    it("flatPixelAt reads a flat region's value and refuses a point next to an edge", () => {
      const W = 7;
      const H = 7;
      const buf = Buffer.alloc(W * H * 4);
      for (let i = 0; i < W * H; i += 1) buf.set([166, 155, 133, 173], i * 4);
      expect(flatPixelAt(buf, W, H, { x: 3, y: 3 })).toEqual([166, 155, 133, 173]);
      buf.set([206, 200, 188, 202], (1 * W + 2) * 4); // a bevel pixel 2 rows up
      expect(() => flatPixelAt(buf, W, H, { x: 3, y: 3 })).toThrow(/not in a flat region/);
      expect(() => flatPixelAt(buf, W, H, { x: 1, y: 5 })).toThrow(/not in a flat region/);
    });
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
    // 6×1 over a tan base (α 255 ×3, then a see-through face α 217, then clear,
    // then α 217 again): a white ground (luma 251: full weight 0.9), a grey
    // vein (luma 230: none), a mid pixel (luma 241: 0.4 × 0.9), the
    // see-through face (as opaque as the base: full weight), clear art
    // (nothing to recolour), and an OPAQUE white over the see-through face
    // (full weight, and still the base's α 217 — the layer's alpha never
    // reaches the result).
    const tan = [205, 182, 125];
    const base = {
      data: new Uint8Array([
        ...px(tan[0], tan[1], tan[2], 255), ...px(tan[0], tan[1], tan[2], 255), ...px(tan[0], tan[1], tan[2], 255),
        ...px(tan[0], tan[1], tan[2], 217), ...px(0, 0, 0, 0), ...px(tan[0], tan[1], tan[2], 217),
      ]),
    };
    const white = {
      data: new Uint8Array([
        ...px(251, 251, 251, 255), ...px(230, 230, 230, 255), ...px(241, 241, 241, 255),
        ...px(251, 251, 251, 217), ...px(251, 251, 251, 255), ...px(251, 251, 251, 255),
      ]),
      mask: new Uint8Array([
        ...px(0, 0, 0, 255), ...px(0, 0, 0, 255), ...px(0, 0, 0, 255), ...px(0, 0, 0, 255), ...px(0, 0, 0, 255),
        ...px(0, 0, 0, 255),
      ]),
      recolour: true,
      opacity: 0.9,
      lumaRamp: [235, 250],
    };
    const out = toRgba8(compositeLayers([base, white], 6, 1));
    const at = (x: number) => [...out.subarray(x * 4, x * 4 + 4)];
    expect(at(0)).toEqual([246, 244, 238, 255]); // tan × 0.1 + 251 × 0.9
    expect(at(1)).toEqual([...tan, 255]);
    expect(at(2)).toEqual([218, 203, 167, 255]); // tan × 0.64 + 241 × 0.36
    // The see-through face keeps α 217 — recoloured, never made more opaque.
    expect(at(3)).toEqual([246, 244, 238, 217]);
    expect(at(4)).toEqual([0, 0, 0, 0]);
    // An opaque layer over it recolours it the same way and leaves its α 217.
    expect(at(5)).toEqual([246, 244, 238, 217]);
    // Outside its mask it does nothing.
    const masked = toRgba8(compositeLayers([base, { ...white, mask: new Uint8Array(24) }], 6, 1));
    expect([...masked.subarray(0, 4)]).toEqual([...tan, 255]);
    // It needs something below it.
    expect(() => compositeLayers([white], 6, 1)).toThrow(/needs a layer below/);
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
    // The modal strip riders (TODO 5.1c): the template's own keys and its extras, at the piece's box.
    if (def.strip) for (const k of stripRiderKeys(def.strip)) out.push([`${template}/strip/${k}.png`, def.strip.box.width, def.strip.box.height]);
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
        "m15borderless", "m15borderlessartifact", "m15borderlessland", "m15fullartland", "fullartland", "m15borderlesspw", "m15borderlesspwtall",
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
    // Every template, every overlay band (4.6a's crown; its own test:
    // tests/unit/frames/crown-band.test.ts), every rider set (5.1a's icon
    // glyphs: tests/unit/frames/dfc-importer.test.ts) and every notch folder
    // (4.9c: tests/unit/frames/holo-stamp-notch.test.ts).
    expect(Object.keys(provenance).sort()).toEqual(
      [...Object.keys(templates), ...Object.keys(CC_OVERLAY_BANDS), ...Object.keys(CC_RIDERS), ...Object.keys(HOLO_STAMP_NOTCHES)].sort(),
    );
    for (const template of Object.keys(templates)) {
      expect(provenance[template]?.source, template).toBe("cardconjurer");
      expect(provenance[template].commit).toBe(CC_COMMIT);
      // Every master was cut at the one card corner (TODO 3.26's re-import).
      expect(provenance[template].output, template).toBe(`1500x2100, corners rounded to ${CORNER_RADIUS}px, webp q90`);
      expect(provenance[template].output, template).toContain("64.5px");
      const plainKeys = [...COLORS, ...pairKeysOf(template), ...(getFrameProfile(template).artifactMasterKeys?.c === "a" ? ["a"] : [])];
      // A template whose crown is baked into its masters (4.6f) records a
      // crowned twin for every master it paints.
      const twins = getFrameProfile(template).crownMasters ? plainKeys.map((k) => `${k}-legendary`) : [];
      expect(Object.keys(provenance[template].colors).sort()).toEqual([...plainKeys, ...twins].sort());
    }
    expect(provenance.m15devoid.source).toBe("cardconjurer");
    // The later runs name their pack and what was done to its pixels.
    for (const template of [
      "m15borderless", "m15borderlessartifact", "m15borderlessland", "m15fullartland", "fullartland", "m15tokentext", "m15tokenartifacttext",
      "m15borderlesspw", "m15borderlesspwtall",
    ]) {
      expect(provenance[template].pack, template).toBe(templates[template].pack);
      expect(provenance[template].transforms, template).toMatch(/no resample/);
      expect(provenance[template].sourceFiles, template).toEqual(sourceFilesFor(templates[template] as never));
      // Every PipGlyph composite is on the record (the full-art tokens').
      expect(provenance[template].finish, template).toEqual(templates[template].finish?.map(describeFinish));
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
    // The borderless land records its composite layer by layer (4.34).
    expect(provenance.m15borderlessland.colors.c).toEqual(templates.m15borderlessland.colors.c.map((l) => describeLayer(l)));
    expect(provenance.m15borderlessland.notes).toEqual(templates.m15borderlessland.notes);
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
