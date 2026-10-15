import { createHash } from "node:crypto";
import fs from "node:fs";
import path from "node:path";
import sharp from "sharp";
import { describe, expect, it } from "vitest";
import { CC_TEMPLATES, EXTENDED, extendedFrameFile, sourceFilesFor } from "../../../scripts/lib/cc-frames.mjs";
import { artReachesCardEdge, getFrameProfile, underFrameArtRect, underFrameArtSlot } from "@/lib/cards/template-layout";
import { EDGE_CONTRACTS } from "@/lib/frames/edge-contract";
import manifestJson from "@/lib/frames/frame-manifest.json";

// ---------------------------------------------------------------------------
// TODO 4.7 / 4.35 / 4.42 (owner Q6, 2026-10-13; layout v58): `extendedart`
// re-sourced from Card Conjurer's accurate 'Extended Art Frames' pack and the
// textless pair from its 'Magic Fest Promos' — the recipe (whole files, the
// colourless dresses), the profiles that ride the new masters, the edge
// contract and, where the published masters are on disk (FRAMES_BUILD_DIR,
// else .frames-build; CI fetches them), their pixels.
// ---------------------------------------------------------------------------

type Layer = { src: string; mask?: string };
const templates = CC_TEMPLATES as unknown as Record<string, { colors: Record<string, Layer[]>; plates?: unknown }>;
const BUILD = process.env.FRAMES_BUILD_DIR ? path.resolve(process.env.FRAMES_BUILD_DIR) : path.join(process.cwd(), ".frames-build");
type Entry = { sha256: string };
const MANIFEST = (manifestJson as { files: Record<string, Entry> }).files;

function published(rel: string): Buffer | null {
  const file = path.join(BUILD, rel);
  if (!MANIFEST[rel] || !fs.existsSync(file)) return null;
  const bytes = fs.readFileSync(file);
  return createHash("sha256").update(bytes).digest("hex") === MANIFEST[rel].sha256 ? bytes : null;
}

describe("the extended-art recipe", () => {
  it("is the pack's whole file per key — no border added — with the see-through `c` and the artifact `a`", () => {
    const def = templates.extendedart;
    expect(Object.keys(def.colors).sort()).toEqual(["a", "b", "c", "g", "m", "r", "u", "w"]);
    for (const [key, layers] of Object.entries(def.colors)) {
      expect(layers, key).toEqual([{ src: `${EXTENDED}/${key}.png` }]);
    }
    expect(def.plates).toBeUndefined();
    expect(EXTENDED).toBe("img/frames/m15/new/extended");
  });

  it("its land dress (owner Round 63): the pack's land frames whole — the grey `l` for colourless, `l<k>`, the gold `lm`", () => {
    const def = templates.extendedartland;
    expect(Object.keys(def.colors).sort()).toEqual(["b", "c", "g", "m", "r", "u", "w"]);
    expect(def.colors.c).toEqual([{ src: `${EXTENDED}/l.png` }]);
    for (const key of ["w", "u", "b", "r", "g", "m"]) expect(def.colors[key], key).toEqual([{ src: `${EXTENDED}/l${key}.png` }]);
    expect(def.plates).toBeUndefined();
  });

  it("names the pack's other files by letter for the dresses that build on it (Vehicle, lands)", () => {
    expect(extendedFrameFile("v")).toBe(`${EXTENDED}/v.png`);
    expect(extendedFrameFile("l")).toBe(`${EXTENDED}/l.png`);
    expect(extendedFrameFile("gl")).toBe(`${EXTENDED}/lg.png`);
  });

  it("the textless pair: Magic Fest Promos whole, the spell's colourless the silver rim, the land's the brown one", () => {
    for (const template of ["m15textless", "m15textlessland"]) {
      const def = templates[template];
      expect(Object.keys(def.colors).sort(), template).toEqual(["b", "c", "g", "m", "r", "u", "w"]);
      for (const key of ["w", "u", "b", "r", "g", "m"]) expect(def.colors[key], `${template}/${key}`).toEqual([{ src: `img/frames/textless/magicFest/${key}.png` }]);
    }
    expect(templates.m15textless.colors.c).toEqual([{ src: "img/frames/textless/magicFest/a.png" }]);
    expect(templates.m15textlessland.colors.c).toEqual([{ src: "img/frames/textless/magicFest/l.png" }]);
    for (const template of ["extendedart", "m15textless", "m15textlessland"]) {
      for (const file of sourceFilesFor(templates[template] as never)) expect(file).toMatch(/^img\/frames\/(m15\/new\/extended|textless\/magicFest)\/[a-z]+\.png$/);
    }
  });
});

describe("the profiles on the new masters", () => {
  it("extendedart: CC's window to the side edges, the m15 entry's slots, white type ink", () => {
    const p = getFrameProfile("extendedart");
    const m15 = getFrameProfile("m15");
    expect(p.artSlot).toEqual({ topPct: 8.39, leftPct: 0, widthPct: 100, heightPct: 54.37 });
    for (const slot of ["title", "rules", "footer", "pt"] as const) expect(p[slot], slot).toEqual(m15[slot]);
    expect(p.costDy).toBe(m15.costDy);
    expect({ ...p.type, colorHex: m15.type.colorHex }).toEqual(m15.type);
    expect(p.type.colorHex).toBe("#ffffff");
    expect(p.brandMark).toBeUndefined();
    // Not an edge-to-edge treatment: its window reaches the side edges only.
    expect(artReachesCardEdge(p)).toBe(false);
  });

  it("extendedart: a colourless artifact paints the silver `a`, any other colourless card the see-through `c` with the art under it", () => {
    const p = getFrameProfile("extendedart");
    expect(p.artifactMasterKeys).toEqual({ c: "a" });
    expect(underFrameArtRect(p, "c")).toEqual({ topPct: 2.7, leftPct: 0, widthPct: 100, heightPct: 93.3 });
    expect(underFrameArtSlot(p, "c")).toEqual(underFrameArtRect(p, "c"));
    for (const key of ["a", "w", "m"]) expect(underFrameArtRect(p, key), key).toBeNull();
  });

  it("extendedartland: extendedart's slots, no cost, M15LAND's title band, no see-through or artifact master, the same crown band", () => {
    const land = getFrameProfile("extendedartland");
    const spell = getFrameProfile("extendedart");
    expect(land.artSlot).toEqual(spell.artSlot);
    expect(land.type).toEqual(spell.type);
    expect(land.rules).toEqual(spell.rules);
    expect(land.setSymbolKeyline).toBe(spell.setSymbolKeyline);
    expect(land.hideCost).toBe(true);
    expect(land.title).toEqual(getFrameProfile("m15land").title);
    expect(land.underFrameArt).toBeUndefined();
    expect(land.artifactMasterKeys).toBeUndefined();
    expect(land.overlays).toEqual(spell.overlays);
    expect(land.twoColorMasters).toBeUndefined();
    expect(artReachesCardEdge(land)).toBe(false);
  });

  it("the textless pair: textless (no type line, no rules), a white name, CC's art window", () => {
    for (const template of ["m15textless", "m15textlessland"]) {
      const p = getFrameProfile(template);
      expect(p.textless, template).toBe(true);
      expect(p.textlessTypeLine, template).toBeUndefined();
      expect(p.title.colorHex, template).toBe("#ffffff");
      expect(p.artSlot, template).toEqual({ topPct: 4.96, leftPct: 6.2, widthPct: 87.6, heightPct: 86.47 });
      expect(p.symbolRect, template).toBeUndefined();
    }
    expect(getFrameProfile("m15textlessland").hideCost).toBe(true);
    expect(getFrameProfile("m15textless").hideCost).toBeUndefined();
  });

  it("the edge contracts: extended art's sides are art between its bars; the textless pair is black-bordered", () => {
    expect(EDGE_CONTRACTS.extendedart).toEqual({
      top: { kind: "border" },
      right: { kind: "art", except: [[0, 11.3], [59.2, 100]] },
      bottom: { kind: "border" },
      left: { kind: "art", except: [[0, 11.3], [59.2, 100]] },
    });
    expect(EDGE_CONTRACTS.extendedartland).toEqual(EDGE_CONTRACTS.extendedart);
    for (const t of ["m15textless", "m15textlessland"]) for (const edge of Object.values(EDGE_CONTRACTS[t])) expect(edge, t).toEqual({ kind: "border" });
  });

  it("the masters left git: no public/frames folder for the three", () => {
    for (const t of ["extendedart", "m15textless", "m15textlessland"]) {
      expect(fs.existsSync(path.join(process.cwd(), "public", "frames", t)), t).toBe(false);
      for (const key of ["w", "u", "b", "r", "g", "c", "m"]) {
        expect(MANIFEST[`${t}/${key}.png`], `${t}/${key}.png`).toBeDefined();
        expect(MANIFEST[`${t}/${key}.webp`], `${t}/${key}.webp`).toBeDefined();
      }
    }
    expect(fs.existsSync(path.join(process.cwd(), "public", "frames", "extendedartland"))).toBe(false);
    for (const key of ["w", "u", "b", "r", "g", "c", "m"]) {
      expect(MANIFEST[`extendedartland/${key}.png`], key).toBeDefined();
      expect(MANIFEST[`extendedartland/${key}.webp`], key).toBeDefined();
    }
    expect(MANIFEST["extendedart/a.png"]).toBeDefined();
    expect(MANIFEST["extendedart/a.webp"]).toBeDefined();
  });
});

const masters = [
  ...["w", "c", "a"].map((key) => [`extendedart/${key}`, published(`extendedart/${key}.png`)] as const),
  // The land dress (owner Round 63): the grey land frame, a colour's, gold.
  ...["c", "u", "m"].map((key) => [`extendedartland/${key}`, published(`extendedartland/${key}.png`)] as const),
];
describe.skipIf(masters.some(([, buf]) => buf === null))("the published extended-art masters (set FRAMES_BUILD_DIR if skipped)", () => {
  it.each(masters)("%s: clear at the side edges between the bars, opaque above and below; the WebP's alpha is the PNG's", async (key, buf) => {
    const { data, info } = await sharp(buf!).ensureAlpha().raw().toBuffer({ resolveWithObject: true });
    expect([info.width, info.height]).toEqual([1500, 2100]);
    const alpha = (x: number, y: number) => data[(y * info.width + x) * 4 + 3];
    for (const x of [0, 10, 1489, 1499]) {
      for (const y of [260, 600, 1000, 1200]) expect(alpha(x, y), `${key} ${x},${y}`).toBe(0);
      for (const y of [120, 1400, 1800]) expect(alpha(x, y), `${key} ${x},${y}`).toBe(255);
    }
    // (frames-fetch brings the PNGs only: the WebP is checked where the
    // importer's own build is.)
    const webp = published(`${key}.webp`);
    if (!webp) return;
    const w = await sharp(webp).ensureAlpha().raw().toBuffer();
    let diff = 0;
    for (let i = 3; i < data.length; i += 4) diff = Math.max(diff, Math.abs(data[i] - w[i]));
    expect(diff, `${key} WebP alpha`).toBeLessThanOrEqual(2);
  });
});
