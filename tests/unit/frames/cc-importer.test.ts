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
  M20_ARTIFACT_NAME_SLATE,
  M20_ARTIFACT_SOLID_NAME_PILL,
  M20_ARTIFACT_TYPE_TINT,
  M20_COLOURLESS_TYPE_TINT,
  M20_TOKEN_SOLID_TYPE_PILL,
  M20_TOKEN_TEXTLESS_RECUT,
  TOKEN_REGULAR_RECUT,
  TOKEN_TEXTLESS_RECUT,
  builtColors,
  compositeFinish,
  compositeLayers,
  cutThroughMask,
  describeFinish,
  describeLayer,
  finishFor,
  recutBand,
  roundCorners,
  roundCornersRgba8,
  sourceFilesFor,
  toRgba8,
} from "@/scripts/lib/cc-frames.mjs";
import { FRAME_TEMPLATE_VALUES } from "@/types/card";
import { M20_TOKEN_TEXTLESS_RECUT_PX } from "@/lib/cards/template-layout";
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
type Finish =
  | { op: "opaque"; mask: string; colors?: string[] }
  | { op: "tint"; mask: string; rgb: [number, number, number]; opacity: number; alphaFull: number; alphaNone: number; colors?: string[] };
type Def = {
  colors: Record<string, Layer[]>;
  finish?: Finish[];
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
      "m20token",
      "m20tokenartifact",
      "m20tokenartifacttall",
      "m20tokenartifacttext",
      "m20tokentall",
      "m20tokentext",
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
  });

  it("never commits the build folder", () => {
    expect(readFileSync(".gitignore", "utf8")).toMatch(/^\/\.frames-build\/$/m);
    // 2026-09-25: a `git add -A` on a branch cut before the ignore rule
    // committed 182 Card Conjurer masters; CI must fail if that ever recurs.
    const tracked = execFileSync("git", ["ls-files", "--", ".frames-build"], { encoding: "utf8" }).trim();
    expect(tracked).toBe("");
  });
});
