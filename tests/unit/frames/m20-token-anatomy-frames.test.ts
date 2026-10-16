import { createHash } from "node:crypto";
import fs from "node:fs";
import path from "node:path";
import sharp from "sharp";
import { describe, expect, it } from "vitest";
import manifestJson from "@/lib/frames/frame-manifest.json";
import {
  BORDERLESS_CROWN,
  CC_OVERLAY_BANDS,
  CC_TEMPLATES,
  M20_PAIR_TYPE_TINT,
  M20_PAIR_WHITE_PILL_GAIN,
  compositeFinish,
  describeFinish,
  M20_TOKEN_CROWN_BAND,
  M20_TOKEN_PILL_HOLE,
  describeLayer,
  m20TokenCrownFindings,
  m20TokenCrownLayers,
} from "@/scripts/lib/cc-frames.mjs";
import { PAIR_RAMPS, TWO_COLOR_PAIRS } from "@/scripts/lib/pair-ramp.mjs";
import { M20_TOKEN_CROWN, getFrameProfile } from "@/lib/cards/template-layout";
import { FRAME_TEMPLATE_VALUES } from "@/types/card";

// ---------------------------------------------------------------------------
// TODO 4.48's last pieces, the files: the full-art token's crown band
// (CC_OVERLAY_BANDS.m20tokencrown — CC's floating crown and its outline at
// the borderless bounds) and the six templates' ten pair masters each (the
// two colour masters lerped across PAIR_RAMPS.m20Token; on the plain
// templates CC's grey 'Land Frame' type pill tinted to the prints). Built by
// scripts/import-cc-frames.mjs into the DEV bucket (never git). The published
// pixels are checked when a local copy at the manifest's sha256 is on disk
// (FRAMES_BUILD_DIR, else .frames-build; CI fetches them).
// ---------------------------------------------------------------------------

type Entry = { sha256: string; width: number; height: number };
const files = (manifestJson as { files: Record<string, Entry> }).files;
const BUILD = process.env.FRAMES_BUILD_DIR ? path.resolve(process.env.FRAMES_BUILD_DIR) : path.join(process.cwd(), ".frames-build");
const provenance = JSON.parse(fs.readFileSync("lib/cards/frame-sources.json", "utf8")) as Record<
  string,
  { colors: Record<string, string[]>; kind?: string; notes: string[]; sourceFiles: string[] }
>;
const TEMPLATES = ["m20token", "m20tokentext", "m20tokentall", "m20tokenartifact", "m20tokenartifacttext", "m20tokenartifacttall"] as const;
const PLAIN = TEMPLATES.slice(0, 3);
const crowns = "img/frames/m15/crowns";
/** A recipe, typed loosely (cc-frames.mjs is untyped JS). */
const tpl = (t: string) => (CC_TEMPLATES as unknown as Record<string, { colors: Record<string, Array<Record<string, unknown>>>; finish: Array<{ colors?: string[] }> }>)[t];

function real(rel: string): Buffer | null {
  const file = path.join(BUILD, rel);
  if (!files[rel] || !fs.existsSync(file)) return null;
  const bytes = fs.readFileSync(file);
  return createHash("sha256").update(bytes).digest("hex") === files[rel].sha256 ? bytes : null;
}
const raw = async (buf: Buffer) => sharp(buf).ensureAlpha().raw().toBuffer();

describe("the full-art token crown band's recipe", () => {
  it("builds the slot's keys: the colours, gold, CC's grey C and silver A crowns, the ten pairs", () => {
    expect([...M20_TOKEN_CROWN_BAND.keys]).toEqual(["w", "u", "b", "r", "g", "m", "c", "a", ...TWO_COLOR_PAIRS]);
    expect(CC_OVERLAY_BANDS.m20tokencrown.keys).toEqual(M20_TOKEN_CROWN_BAND.keys);
    expect([...M20_TOKEN_CROWN.keys]).toEqual([...M20_TOKEN_CROWN_BAND.keys]);
    expect(() => m20TokenCrownLayers("wu-h")).toThrow();
    expect(() => m20TokenCrownLayers("l")).toThrow();
  });

  it("is CC's floating crown over its outline at the borderless bounds, 1:1, nothing erased or covered", () => {
    expect(M20_TOKEN_CROWN_BAND.compositeSize).toEqual({ width: 1500, height: 2100 });
    expect(M20_TOKEN_CROWN_BAND.rows).toBe(260);
    expect(M20_TOKEN_CROWN_BAND.crown).toEqual(BORDERLESS_CROWN.crown);
    expect(M20_TOKEN_CROWN_BAND.outline).toEqual(BORDERLESS_CROWN.outline);
    expect(m20TokenCrownLayers("u")).toEqual([
      { src: `${crowns}/m15CrownFloatingOutline.png`, at: { leftPct: 2.8, topPct: 1.72, widthPct: 94.4, heightPct: 10.62 } },
      { src: `${crowns}/m15CrownUFloating.png`, at: { leftPct: 3.07, topPct: 1.91, widthPct: 93.87, heightPct: 10.24 } },
    ]);
    expect(m20TokenCrownLayers("a")[1].src).toBe(`${crowns}/m15CrownAFloating.png`);
    expect(m20TokenCrownLayers("c")[1].src).toBe(`${crowns}/m15CrownCFloating.png`);
    // A pair: the first colour's crown on the left, the second's on the
    // right, across the token's own split.
    expect(m20TokenCrownLayers("rg")[1]).toEqual({
      src: `${crowns}/m15CrownRFloating.png`,
      right: `${crowns}/m15CrownGFloating.png`,
      ramp: [40, 60],
      at: { leftPct: 3.07, topPct: 1.91, widthPct: 93.87, heightPct: 10.24 },
    });
    for (const key of M20_TOKEN_CROWN_BAND.keys) for (const l of m20TokenCrownLayers(key)) expect(l).not.toHaveProperty("erase");
    expect(CC_OVERLAY_BANDS.m20tokencrown.layers).toBe(m20TokenCrownLayers);
    expect(CC_OVERLAY_BANDS.m20tokencrown.findings).toBe(m20TokenCrownFindings);
  });

  it("finds the band's extent, the outline's peak and anything over the name pill's interior", () => {
    const W = 1500;
    const H = 300;
    const buf = Buffer.alloc(W * H * 4);
    const paint = (x: number, y: number, rgba: [number, number, number, number]) => buf.set(rgba, (y * W + x) * 4);
    paint(750, 36, [40, 40, 40, 255]);
    paint(100, 258, [0, 0, 0, 10]);
    expect(m20TokenCrownFindings(buf, W, H, 260)).toMatchObject({ lastAlphaRow: 258, peakRow: 36, holeMaxAlpha: 0, failures: [] });
    paint(M20_TOKEN_PILL_HOLE.x0 + 5, M20_TOKEN_PILL_HOLE.y0 + 5, [255, 255, 255, 1]);
    expect(m20TokenCrownFindings(buf, W, H, 260).failures).toEqual(["α 1 over the name pill's interior"]);
    paint(100, 260, [0, 0, 0, 10]);
    expect(m20TokenCrownFindings(buf, W, H, 260).failures).toHaveLength(2);
  });
});

describe("the slot the full-art token profiles draw (M20_TOKEN_CROWN)", () => {
  it("stretches the 1500 × 260 band over rows 0–259 of the card, a Legendary TOKEN's crown", () => {
    expect(M20_TOKEN_CROWN.rect).toEqual({ topPct: 0, leftPct: 0, widthPct: 100, heightPct: (260 / 2100) * 100 });
    expect(M20_TOKEN_CROWN.assetPathTemplate).toBe("/frames/m20tokencrown/{key}.png");
    expect(M20_TOKEN_CROWN).toMatchObject({ anatomy: "crown", tokens: true });
  });

  it("is on the six full-art token entries only — the artifact ones map c → a — with the split pairs and the colourless plate", () => {
    for (const t of PLAIN) {
      expect(getFrameProfile(t).overlays, t).toEqual([M20_TOKEN_CROWN]);
    }
    for (const t of TEMPLATES.slice(3)) {
      expect(getFrameProfile(t).overlays, t).toEqual([{ ...M20_TOKEN_CROWN, keyMap: { c: "a" } }]);
    }
    for (const t of TEMPLATES) {
      expect(getFrameProfile(t).twoColorMasters, t).toEqual(["split"]);
      expect(getFrameProfile(t).twoColorPlate, t).toBe("c");
    }
    for (const t of FRAME_TEMPLATE_VALUES) {
      if ((TEMPLATES as readonly string[]).includes(t)) continue;
      const profile = getFrameProfile(t);
      for (const slot of profile.overlays ?? []) {
        expect(slot.assetPathTemplate, t).not.toContain("m20tokencrown");
        if (slot.anatomy === "crown") expect(slot.tokens, t).toBeUndefined();
      }
      expect(profile.twoColorPlate, t).toBeUndefined();
    }
  });
});

describe("the pair masters' recipe", () => {
  it("lerps the two colour masters whole across the token's split, then CC's grey L type pill (plain); the silver A frame and the split pinline (artifact)", () => {
    expect(PAIR_RAMPS.m20Token).toEqual([40, 60]);
    expect(tpl("m20tokentext").colors.gw).toEqual([
      { src: "img/frames/token/short/tokenFrameGShort.png", right: "img/frames/token/short/tokenFrameWShort.png", ramp: [40, 60] },
      { src: "img/frames/token/short/tokenFrameLShort.png", mask: "img/frames/token/short/m15MaskTypeShort.png", replace: true },
    ]);
    expect(tpl("m20token").colors.rg[0]).toMatchObject({ src: "img/frames/token/textless/tokenFrameRTextless.png", right: "img/frames/token/textless/tokenFrameGTextless.png" });
    expect(tpl("m20tokenartifacttall").colors.wu).toEqual([
      { src: "img/frames/token/tall/tokenFrameATall.png" },
      { src: "img/frames/token/tall/tokenFrameWTall.png", right: "img/frames/token/tall/tokenFrameUTall.png", ramp: [40, 60], mask: "img/frames/m15/regular/m15MaskPinline.png" },
    ]);
    for (const t of TEMPLATES) {
      expect(Object.keys(tpl(t).colors).sort(), t).toEqual([..."wubrgcm".split(""), ...TWO_COLOR_PAIRS].sort());
    }
    // The grey pill's tint is the plain templates' pairs' alone.
    expect(M20_PAIR_TYPE_TINT).toMatchObject({ op: "tint", rgb: [184, 178, 180], opacity: 0.65, colors: [...TWO_COLOR_PAIRS] });
    for (const t of PLAIN) expect(tpl(t).finish.filter((f) => (f as { op?: string }).op === "tint" && f.colors?.includes("gw")), t).toHaveLength(1);
    for (const t of TEMPLATES.slice(3)) expect(tpl(t).finish.filter((f) => (f as { op?: string }).op === "tint" && f.colors?.includes("gw")), t).toHaveLength(0);
  });
});

describe("the white half's tone (rampGain, owner Round 69)", () => {
  it("multiplies one side of the ramp, fading across it, on the translucent pixels only", () => {
    const W = 100;
    const buf = Buffer.alloc(W * 4);
    for (let x = 0; x < W; x += 1) buf.set([200, 200, 200, x < 90 ? 230 : 255], x * 4);
    const mask = Buffer.alloc(W * 4, 255);
    const f = { op: "rampGain", gain: [0.5, 0.5, 0.25], side: "right", ramp: [40, 60], alphaFull: 230, alphaNone: 244, mask: "m" };
    const out = compositeFinish(buf, W, 1, [f], { m: mask });
    const at = (x: number) => [...out.subarray(x * 4, x * 4 + 4)];
    expect(at(10)).toEqual([200, 200, 200, 230]); // the left side: untouched
    expect(at(50)).toEqual([148, 148, 121, 230]); // the ramp's middle (50.5 %W: a share of 0.525)
    expect(at(80)).toEqual([100, 100, 50, 230]); // the right side: the gain
    expect(at(95)).toEqual([200, 200, 200, 255]); // an opaque rim: untouched
    expect(describeFinish({ ...f, colors: ["gw"] } as never)).toMatch(/gain × 0\.5 \/ 0\.5 \/ 0\.25 on the right side of the 40→60 %W ramp/);
    expect([...M20_PAIR_WHITE_PILL_GAIN]).toEqual([0.495, 0.493, 0.475]);
  });
});

describe("published to the frames bucket", () => {
  it("lists every band key and every pair master, PNG and WebP, with their provenance", () => {
    for (const key of M20_TOKEN_CROWN_BAND.keys) {
      for (const ext of ["png", "webp"]) {
        const entry = files[`m20tokencrown/${key}.${ext}`];
        expect(entry, `m20tokencrown/${key}.${ext}`).toBeDefined();
        expect([entry.width, entry.height]).toEqual([1500, 260]);
      }
      expect(provenance.m20tokencrown.colors[key]).toEqual(m20TokenCrownLayers(key).map(describeLayer));
    }
    expect(provenance.m20tokencrown.kind).toBe("overlay");
    for (const t of TEMPLATES) {
      for (const pair of TWO_COLOR_PAIRS) {
        for (const ext of ["png", "webp"]) {
          const entry = files[`${t}/${pair}.${ext}`];
          expect(entry, `${t}/${pair}.${ext}`).toBeDefined();
          expect([entry.width, entry.height]).toEqual([1500, 2100]);
        }
        expect(provenance[t].colors[pair], `${t}/${pair}`).toBeDefined();
      }
    }
  });

  const bandsAvailable = M20_TOKEN_CROWN_BAND.keys.every((k) => real(`m20tokencrown/${k}.png`) !== null);
  it.skipIf(!bandsAvailable)("the published bands leave the name pill's interior clear, their WebPs' alpha the PNGs'", async () => {
    for (const key of M20_TOKEN_CROWN_BAND.keys) {
      const png = await raw(real(`m20tokencrown/${key}.png`)!);
      const h = M20_TOKEN_PILL_HOLE;
      let maxA = 0;
      for (let y = h.y0; y < h.y1; y += 1) for (let x = h.x0; x < h.x1; x += 1) maxA = Math.max(maxA, png[(y * 1500 + x) * 4 + 3]);
      expect(maxA, key).toBe(0);
      const webp = path.join(BUILD, `m20tokencrown/${key}.webp`);
      if (fs.existsSync(webp)) {
        const a = await sharp(real(`m20tokencrown/${key}.png`)!).ensureAlpha().extractChannel(3).raw().toBuffer();
        const b = await sharp(webp).ensureAlpha().extractChannel(3).raw().toBuffer();
        expect(a.equals(b), key).toBe(true);
      }
    }
  });

  const pairsAvailable = TEMPLATES.every((t) => ["w", "u", "g", "gw", "wu"].every((k) => real(`${t}/${k}.png`) !== null));
  it.skipIf(!pairsAvailable)("a pair master is its two monos lerped across 40→60 %W — outside the plain templates' type pill — and that pill the prints' grey", async () => {
    for (const t of TEMPLATES) {
      const [a, b, p] = await Promise.all([raw(real(`${t}/g.png`)!), raw(real(`${t}/w.png`)!), raw(real(`${t}/gw.png`)!)]);
      // Columns left of 40 %W are the first colour's, right of 60 %W the
      // second's (the alpha too); the pill rows on the plain templates are
      // left out (CC's grey pill there).
      const pill = t === "m20token" ? [1700, 1850] : t === "m20tokentext" ? [1400, 1550] : t === "m20tokentall" ? [1165, 1315] : null;
      let worst = 0;
      for (let y = 0; y < 2100; y += 7) {
        if (pill && !(t.includes("artifact")) && y >= pill[0] && y < pill[1]) continue;
        for (const [x, side] of [[300, a], [500, a], [1000, b], [1200, b]] as const) {
          // The white half of the name pill is toned (owner Round 69): below.
          if (!t.includes("artifact") && side === b && y >= 100 && y < 222) continue;
          const o = (y * 1500 + x) * 4;
          // (A fully clear pixel's colour is no colour: the lerp is premultiplied.)
          if (p[o + 3] === 0 && side[o + 3] === 0) continue;
          for (let c = 0; c < 4; c += 1) worst = Math.max(worst, Math.abs(p[o + c] - side[o + c]));
        }
      }
      expect(worst, t).toBeLessThanOrEqual(1);
      if (!t.includes("artifact")) {
        // The type pill's flat interior: the prints' neutral grey 193/187/187.
        const y = (pill![0] + pill![1]) >> 1;
        for (const x of [400, 1100]) {
          const o = (y * 1500 + x) * 4;
          const off = [193, 187, 187].map((v, c) => Math.abs(p[o + c] - v));
          expect(Math.max(...off), `${t} pill at ${x}: ${[p[o], p[o + 1], p[o + 2]]}`).toBeLessThanOrEqual(2);
          expect(p[o + 3], `${t} pill at ${x}`).toBe(255);
        }
      }
    }
  });

  // Owner Round 69: the white half of a white pair's name pill is toned to
  // print's metal — the median of 17 white-pair prints, rgb 109/109/105,
  // read the same way (the pill's interior rows 110–212 on the white side,
  // the darker 60 %, over black); the black half and every non-white pair's
  // pill are the monos' lerp, the artifact templates' slate untouched.
  const whiteAvailable = PLAIN.every((t) => ["wu", "wb", "rw", "gw", "bg", "w", "b", "g"].every((k) => real(`${t}/${k}.png`) !== null));
  it.skipIf(!whiteAvailable)("a white pair's name pill: its white half toned to print's metal, everything else the lerp", async () => {
    const lum = (p: number[]) => 0.2126 * p[0] + 0.7152 * p[1] + 0.0722 * p[2];
    const read = async (buf: Buffer, x0: number) => {
      const { data } = await sharp(buf).flatten({ background: "#000" }).removeAlpha().extract({ left: x0, top: 110, width: 300, height: 102 }).raw().toBuffer({ resolveWithObject: true });
      const px: number[][] = [];
      for (let i = 0; i < data.length; i += 3) px.push([data[i], data[i + 1], data[i + 2]]);
      px.sort((p, q) => lum(p) - lum(q));
      const keep = px.slice(0, Math.floor(px.length * 0.6));
      return [0, 1, 2].map((c) => keep.map((p) => p[c]).sort((p, q) => p - q)[keep.length >> 1]);
    };
    for (const t of PLAIN) {
      for (const [pair, x0] of [["wu", 150], ["wb", 150], ["rw", 1050], ["gw", 1050]] as const) {
        const got = await read(real(`${t}/${pair}.png`)!, x0);
        expect(Math.max(...got.map((v, c) => Math.abs(v - [109, 109, 105][c]))), `${t}/${pair}: ${got}`).toBeLessThanOrEqual(2);
      }
      // The black half of a white pair, and a non-white pair, keep the lerp.
      const [wb, b, bg, g] = await Promise.all(["wb", "b", "bg", "g"].map(async (k) => raw(real(`${t}/${k}.png`)!)));
      let worst = 0;
      for (let y = 104; y < 218; y += 3) for (const x of [1100, 1300]) {
        const o = (y * 1500 + x) * 4;
        for (let c = 0; c < 4; c += 1) worst = Math.max(worst, Math.abs(wb[o + c] - b[o + c]), Math.abs(bg[o + c] - g[o + c]));
      }
      expect(worst, t).toBeLessThanOrEqual(1);
    }
  });
});
