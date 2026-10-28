import { createHash } from "node:crypto";
import fs from "node:fs";
import path from "node:path";
import sharp from "sharp";
import { describe, expect, it } from "vitest";
import {
  CC_TEMPLATES,
  SNC_DECO,
  SNC_DECO_GOLD_CHROMA,
  SNC_DECO_PRINT_TONES,
  chromaRegionPlane,
  legendaryKey,
  sourceFilesFor,
  sourceTonesOf,
} from "../../../scripts/lib/cc-frames.mjs";
import {
  SNC_DECO_ARCH,
  SNC_DECO_ARCH_LIFT_PX,
  SNC_DECO_NOTCH_BOX,
  SNC_DECO_STAMP_FOLDERS,
  archLiftAt,
  buildBorderlessNotch,
  liftError,
} from "../../../scripts/lib/borderless-stamp.mjs";
import { frameAnatomyOf, resolveFrameOverlays } from "@/lib/cards/anatomy";
import { COLLECTOR_TEMPLATES } from "@/lib/cards/collector-line";
import { M15_FAMILY_TEMPLATES } from "@/lib/cards/m15-family";
import { PLATE_INK } from "@/lib/cards/plate-ink";
import {
  M15_COLLECTOR,
  SNCARTDECO_ART_SLOT,
  SNCARTDECO_HOLO_STAMP,
  SNCARTDECO_HOLO_STAMP_OVAL,
  SNCARTDECO_UNDER_RECT,
  artLayersFor,
  getFrameProfile,
} from "@/lib/cards/template-layout";
import { EDGE_CONTRACTS, EDGE_CONTRACT_KNOWN_FAILURES, edgeContractFor } from "@/lib/frames/edge-contract";
import { ART_WINDOW_KNOWN_FAILURES } from "@/lib/frames/art-window";
import { SQUARE_CORNERS, squareCornerKind } from "@/lib/frames/square-corners";
import { BORDER_PENDING_TEMPLATES } from "@/lib/scryfall/frame-signatures";
import { NEVER_NORMALISE } from "../../../scripts/lib/frame-corners.mjs";
import { FRAME_ERA_LABELS, FRAME_SET_ERA, FRAME_SET_LABELS, FRAME_TEMPLATE_LABELS, FRAME_TEMPLATE_SET } from "@/types/card";
import manifestJson from "@/lib/frames/frame-manifest.json";

// ---------------------------------------------------------------------------
// TODO 4.11 wave 2: the Streets of New Capenna ART DECO showcase
// (`sncartdeco`; SNC #296–340 and the gilded-foil twins #361–405) from Card
// Conjurer's 'Golden Age (SNC)' pack (1500 × 2100 native — Card Conjurer's
// 'Art Deco (SNC)' pack is the Golden Age cards' frame, #341–359) — a NEW
// template, an addition. The recipe (ONE gold master under every key and
// the pack's 'Legendary Frame' as every key's crowned twin), the tone rule's
// verdict (the gold and the plate's rim toned), its OVAL stamp notch (our own
// lift of the master's gold rim), the edges, the profile on the pack's own
// bars and, where the published objects are on disk at the manifest's
// sha256 (FRAMES_BUILD_DIR, .frames-build or .frames-cache; CI fetches
// them), their pixels.
// ---------------------------------------------------------------------------

type Layer = { src: string };
const def = (CC_TEMPLATES as unknown as Record<string, { colors: Record<string, Layer[]>; plates: Record<string, string> }>).sncartdeco;
type Entry = { sha256: string; width: number; height: number };
const MANIFEST = (manifestJson as { files: Record<string, Entry> }).files;
const DIRS = [
  ...(process.env.FRAMES_BUILD_DIR ? [path.resolve(process.env.FRAMES_BUILD_DIR)] : []),
  path.join(process.cwd(), ".frames-build"),
  path.join(process.cwd(), ".frames-cache"),
];
function published(rel: string): Buffer | null {
  if (!MANIFEST[rel]) return null;
  for (const dir of DIRS) {
    const file = path.join(dir, rel);
    if (!fs.existsSync(file)) continue;
    const bytes = fs.readFileSync(file);
    if (createHash("sha256").update(bytes).digest("hex") === MANIFEST[rel].sha256) return bytes;
  }
  return null;
}

const MASTER_KEYS = ["w", "u", "b", "r", "g", "c", "m"];

describe("the Art Deco recipe", () => {
  it("is the 'Golden Age (SNC)' pack's one gold frame under every key, its 'Legendary Frame' under every twin, its one plate", () => {
    expect(SNC_DECO).toBe("img/frames/snc/gilded");
    expect(Object.keys(def.colors).sort()).toEqual([...MASTER_KEYS, ...MASTER_KEYS.map(legendaryKey)].sort());
    for (const key of MASTER_KEYS) {
      expect(def.colors[key], key).toEqual([{ src: `${SNC_DECO}/m.png` }]);
      expect(def.colors[legendaryKey(key)], key).toEqual([{ src: `${SNC_DECO}/legendary/m.png` }]);
      expect(def.plates[key], key).toBe(`${SNC_DECO}/pt/m.png`);
    }
    // Never Card Conjurer's own mono-colour 'GildedColored' frames, nor its
    // 'Art Deco (SNC)' pack (the Golden Age cards' frame).
    expect(sourceFilesFor(def as never).sort()).toEqual([`${SNC_DECO}/legendary/m.png`, `${SNC_DECO}/m.png`, `${SNC_DECO}/pt/m.png`]);
  });

  it("tones the gold and the plate's rim onto print, each ≥ 9 levels off by the ring's rule, on the file's own gold", () => {
    for (const file of ["m.png", "legendary/m.png"]) {
      const t = sourceTonesOf(`${SNC_DECO}/${file}`) as { chroma: Record<string, unknown>; tones: Record<string, unknown> };
      expect(t.chroma, file).toEqual({ gold: SNC_DECO_GOLD_CHROMA });
      expect(t.tones, file).toEqual({ gold: SNC_DECO_PRINT_TONES.gold });
    }
    const pt = sourceTonesOf(`${SNC_DECO}/pt/m.png`) as { chroma: Record<string, unknown>; tones: Record<string, unknown> };
    expect(pt.tones).toEqual({ plateGold: SNC_DECO_PRINT_TONES.plateGold });
    for (const tone of Object.values(SNC_DECO_PRINT_TONES)) {
      expect(Math.max(...tone.from.map((v, i) => Math.abs(v - tone.to[i]))), JSON.stringify(tone)).toBeGreaterThanOrEqual(9);
    }
    expect(SNC_DECO_PRINT_TONES.gold).toEqual({ from: [181, 156, 71], to: [207, 180, 115] });
    expect(SNC_DECO_PRINT_TONES.plateGold).toEqual({ from: [176, 152, 68], to: [202, 164, 98] });
    // The region: the gold (chroma ≥ 45), never the dark bars or the brown
    // ornaments (chroma 31–33).
    const px = (rgb: number[]) => chromaRegionPlane(Buffer.from([...rgb, 255]), 1, 1, SNC_DECO_GOLD_CHROMA)[0];
    expect(px([181, 156, 71])).toBe(255);
    expect(px([47, 27, 15])).toBe(0);
    expect(px([20, 16, 24])).toBe(0);
  });
});

describe("the stamp notch: our own lift of the master's gold rim", () => {
  it("one piece per key over the plain master, its twin the same pixels where it reads; the profile's slot", () => {
    const folder = SNC_DECO_STAMP_FOLDERS.sncartdecoholostamp;
    expect(folder.keys).toEqual(Object.fromEntries(MASTER_KEYS.map((k) => [k, `sncartdeco/${k}`])));
    expect(folder.sharedBy).toEqual(Object.fromEntries(MASTER_KEYS.map((k) => [k, [`sncartdeco/${k}-legendary`]])));
    expect(folder.arch).toBe(SNC_DECO_ARCH);
    expect(SNCARTDECO_HOLO_STAMP.rect).toEqual({
      leftPct: (SNC_DECO_NOTCH_BOX.x / 1500) * 100,
      topPct: (SNC_DECO_NOTCH_BOX.y / 2100) * 100,
      widthPct: (SNC_DECO_NOTCH_BOX.width / 1500) * 100,
      heightPct: (SNC_DECO_NOTCH_BOX.height / 2100) * 100,
    });
    expect([...SNCARTDECO_HOLO_STAMP.keys].sort()).toEqual([...MASTER_KEYS].sort());
    expect(SNCARTDECO_HOLO_STAMP.anatomy === "holoStamp" && SNCARTDECO_HOLO_STAMP.stamp.shape).toBe("oval");
    expect(SNCARTDECO_HOLO_STAMP_OVAL).toEqual({ leftPct: (683 / 1500) * 100, topPct: (1924 / 2100) * 100, widthPct: (134 / 1500) * 100, heightPct: (64 / 2100) * 100 });
  });

  it("the printed arch: 35.3 px at the centre, rising from x 664 to x 836, its feet on the bar inside the box", () => {
    expect(SNC_DECO_ARCH_LIFT_PX[0]).toBe(35.3);
    expect(SNC_DECO_ARCH_LIFT_PX.at(-1)).toBe(0);
    for (let i = 1; i < SNC_DECO_ARCH_LIFT_PX.length; i += 1) expect(SNC_DECO_ARCH_LIFT_PX[i]).toBeLessThanOrEqual(SNC_DECO_ARCH_LIFT_PX[i - 1]);
    expect(archLiftAt(750, SNC_DECO_ARCH_LIFT_PX)).toBeCloseTo(35.3, 1);
    expect(archLiftAt(664, SNC_DECO_ARCH_LIFT_PX)).toBeLessThan(1.5);
    expect(archLiftAt(SNC_DECO_NOTCH_BOX.x - 1, SNC_DECO_ARCH_LIFT_PX)).toBe(0);
    expect(archLiftAt(SNC_DECO_NOTCH_BOX.x + SNC_DECO_NOTCH_BOX.width, SNC_DECO_ARCH_LIFT_PX)).toBe(0);
    // The box: from 2 px above the lifted outline (1934 − 35.3) to the rim's
    // last row, the black border's first row its foot.
    expect(SNC_DECO_ARCH.barTop).toBe(1950);
    expect(SNC_DECO_NOTCH_BOX.y).toBeLessThanOrEqual(Math.floor(1934 - 35.3));
    expect(SNC_DECO_NOTCH_BOX.y + SNC_DECO_NOTCH_BOX.height).toBe(SNC_DECO_ARCH.barTop);
  });
});

describe("the edges and corners", () => {
  it("the printed black border all round, the crowned twins too: on no pending list", () => {
    const border = { kind: "border" };
    expect(EDGE_CONTRACTS.sncartdeco).toEqual({ top: border, right: border, bottom: border, left: border });
    expect(edgeContractFor("sncartdeco", "w-legendary")).toBe(EDGE_CONTRACTS.sncartdeco);
    expect(EDGE_CONTRACT_KNOWN_FAILURES.sncartdeco).toBeUndefined();
    expect(ART_WINDOW_KNOWN_FAILURES.sncartdeco).toBeUndefined();
    expect(BORDER_PENDING_TEMPLATES.has("sncartdeco")).toBe(false);
    expect(NEVER_NORMALISE.test("sncartdeco")).toBe(false);
    expect(SQUARE_CORNERS.sncartdeco).toBeUndefined();
    expect(["tl", "tr", "bl", "br"].map((c) => squareCornerKind("sncartdeco", "m", c as never))).toEqual(["border", "border", "border", "border"]);
  });
});

describe("the profile rides the pack's own bars", () => {
  const p = getFrameProfile("sncartdeco");

  it("is a new showcase set of its own, Streets of New Capenna — Art Deco", () => {
    expect(FRAME_TEMPLATE_LABELS.sncartdeco).toBe("Art Deco");
    expect(FRAME_TEMPLATE_SET.sncartdeco).toBe("newcapenna");
    expect(FRAME_SET_LABELS.newcapenna).toBe("Streets of New Capenna");
    expect(FRAME_ERA_LABELS[FRAME_SET_ERA.newcapenna]).toBe("Showcase & Universes Beyond");
  });

  it("is an M15-era family member on the run's mean cost row, name and type line, white ink", () => {
    expect(M15_FAMILY_TEMPLATES).toContain("sncartdeco");
    expect(p.title.fit).toBe("measured");
    expect(p.type.fit).toBe("measured");
    // The CC M15 disc (70 px) 8 px lower and 1.5 px further right than the
    // CC-framed M15 row: the mean of the 90 printings.
    expect(p.costSizePct).toBeCloseTo(70 / 1500, 12);
    expect(p.costDy).toBeCloseTo(1.4 / 1500, 12);
    expect(p.costDx).toBeCloseTo(3.5 / 1500, 12);
    expect([p.title.colorHex, p.type.colorHex, p.rules.colorHex, p.pt?.colorHex]).toEqual(["#ffffff", "#ffffff", "#ffffff", "#ffffff"]);
    expect([p.title.shadowCss, p.type.shadowCss, p.rules.shadowCss]).toEqual([undefined, undefined, undefined]);
  });

  it("draws the art in the window and again under the translucent bars and box — two layers meeting on the gold", () => {
    expect(p.artSlot).toBe(SNCARTDECO_ART_SLOT);
    const px = (r: { leftPct: number; topPct: number; widthPct: number; heightPct: number }) =>
      [(r.leftPct / 100) * 1500, (r.topPct / 100) * 2100, ((r.leftPct + r.widthPct) / 100) * 1500, ((r.topPct + r.heightPct) / 100) * 2100].map((v) => Math.round(v * 1000) / 1000);
    expect(px(SNCARTDECO_ART_SLOT)).toEqual([119, 236, 1381, 1170]);
    expect(px(SNCARTDECO_UNDER_RECT)).toEqual([96, 77, 1404, 1936]);
    expect(p.underFrameArt).toEqual({ rect: SNCARTDECO_UNDER_RECT });
    for (const key of ["w", "m", "c", "m-legendary"]) expect(artLayersFor(p, key, true), key).toEqual({ slot: SNCARTDECO_ART_SLOT, under: SNCARTDECO_UNDER_RECT });
    expect(artLayersFor(p, "m", false)).toEqual({ slot: SNCARTDECO_ART_SLOT, under: null });
  });

  it("the pack's plate, the crown in the twins, the stamp and M15's collector line as opt-ins — no pair dress", () => {
    expect(p.pt?.plateAssetPathTemplate).toBe("/frames/sncartdeco/pt/{color}.png");
    expect(p.pt?.plateRect).toEqual({ topPct: (1857 / 2100) * 100, leftPct: (1156 / 1500) * 100, widthPct: (254 / 1500) * 100, heightPct: (134 / 2100) * 100 });
    expect(PLATE_INK["/frames/sncartdeco/pt/{color}.png"]).toBeDefined();
    expect(p.crownMasters).toBe(true);
    expect(p.overlays?.map((o) => o.anatomy)).toEqual(["holoStamp"]);
    expect(p.collector).toBe(M15_COLLECTOR);
    expect(COLLECTOR_TEMPLATES).toContain("sncartdeco");
    expect(p.twoColorMasters).toBeUndefined();
    expect(p.twoColorSplit).toBeUndefined();
    expect(frameAnatomyOf("sncartdeco")).toMatchObject({ crown: true, twoColor: [], collector: true, stamp: true });
    // "auto" is a rare or mythic on an oval frame, as the run prints it.
    const keysOf = (facts: Record<string, unknown>) =>
      resolveFrameOverlays(p, { template: "sncartdeco", crown: true, stamp: "auto" } as never, { colors: ["white", "blue", "black"], rarity: "rare", supertype: "Legendary", cardType: "creature", colorKey: "m", ...facts } as never).map((o) => `${o.anatomy}:${o.key}`);
    expect(keysOf({})).toEqual(["holoStamp:m"]);
    expect(keysOf({ rarity: "uncommon" })).toEqual([]);
  });
});

const masters = MASTER_KEYS.flatMap((k) => [`sncartdeco/${k}.png`, `sncartdeco/${k}-legendary.png`, `sncartdeco/pt/${k}.png`, `sncartdecoholostamp/${k}.png`]);
const available = masters.every((rel) => published(rel) !== null);

describe.skipIf(!available)("the published objects (set FRAMES_BUILD_DIR if skipped)", () => {
  it("one master, one twin, one plate and one notch piece under every key", () => {
    for (const folder of ["sncartdeco/{k}", "sncartdeco/{k}-legendary", "sncartdeco/pt/{k}", "sncartdecoholostamp/{k}"]) {
      const shas = new Set(MASTER_KEYS.map((k) => MANIFEST[`${folder.replace("{k}", k)}.png`].sha256));
      expect(shas.size, folder).toBe(1);
    }
  });

  it("sncartdeco: 1500 × 2100, the black border all round, the corners cut, the window clear, the bars translucent, the gold toned", async () => {
    const { data, info } = await sharp(published("sncartdeco/m.png")!).ensureAlpha().raw().toBuffer({ resolveWithObject: true });
    expect([info.width, info.height]).toEqual([1500, 2100]);
    const px = (x: number, y: number) => Array.from(data.subarray((y * 1500 + x) * 4, (y * 1500 + x) * 4 + 4));
    for (const [x, y] of [[750, 20], [20, 1050], [1480, 1050], [750, 2080], [750, 2000]]) {
      const [r, g, b, a] = px(x, y);
      expect(a, `(${x}, ${y})`).toBe(255);
      expect(r + g + b, `(${x}, ${y})`).toBe(0);
    }
    expect([px(0, 0)[3], px(1499, 0)[3], px(0, 2099)[3], px(1499, 2099)[3]]).toEqual([0, 0, 0, 0]);
    expect(px(750, 700)[3]).toBe(0);
    // The title bar and the text box: α 127 over the art.
    expect(px(750, 170)[3]).toBe(127);
    expect(px(750, 1600)[3]).toBe(127);
    // The gold (chroma ≥ 45) toned onto print's 207,180,115 (its median on
    // the master within 9 levels).
    const ch: number[][] = [[], [], []];
    for (let p = 0; p < 1500 * 2100; p += 1) {
      const o = p * 4;
      if (data[o + 3] !== 255) continue;
      if (Math.max(data[o], data[o + 1], data[o + 2]) - Math.min(data[o], data[o + 1], data[o + 2]) < 45) continue;
      for (let i = 0; i < 3; i += 1) ch[i].push(data[o + i]);
    }
    const med = ch.map((v) => v.sort((a, b) => a - b)[v.length >> 1]);
    med.forEach((v, i) => expect(Math.abs(v - SNC_DECO_PRINT_TONES.gold.to[i]), `channel ${i}`).toBeLessThan(9));
  });

  it("the crowned twin differs from the plain master only over the title bar (the arch) — but for the pack's few-level noise", async () => {
    const plain = await sharp(published("sncartdeco/m.png")!).ensureAlpha().raw().toBuffer();
    const twin = await sharp(published("sncartdeco/m-legendary.png")!).ensureAlpha().raw().toBuffer();
    let lo = 2100;
    let hi = -1;
    for (let p = 0; p < 1500 * 2100; p += 1) {
      const o = p * 4;
      // (The pack's two files differ by ≤ 8 levels on a few hundred pixels
      // below the bar — its own encoding, not a drawing.)
      if (Math.max(...[0, 1, 2, 3].map((i) => Math.abs(plain[o + i] - twin[o + i]))) <= 8) continue;
      const y = Math.floor(p / 1500);
      lo = Math.min(lo, y);
      hi = Math.max(hi, y);
    }
    expect(lo).toBeGreaterThanOrEqual(35);
    expect(hi).toBeLessThanOrEqual(210);
  });

  it("sncartdecoholostamp: the recipe over the plain master, byte for byte, within the lift's tolerance", async () => {
    const master = await sharp(published("sncartdeco/m.png")!).ensureAlpha().raw().toBuffer({ resolveWithObject: true });
    const { piece, outside } = buildBorderlessNotch(master.data, master.info.width, SNC_DECO_ARCH);
    expect(outside).toBe(0);
    const png = await sharp(published("sncartdecoholostamp/m.png")!).ensureAlpha().raw().toBuffer({ resolveWithObject: true });
    expect([png.info.width, png.info.height]).toEqual([SNC_DECO_NOTCH_BOX.width, SNC_DECO_NOTCH_BOX.height]);
    expect(Buffer.compare(png.data, piece)).toBe(0);
    expect(liftError(master.data, master.info.width, png.data, undefined, SNC_DECO_ARCH).worst).toBeLessThanOrEqual(5);
    // The arch is opaque gold at its crown, the black below it.
    const at = (x: number, y: number) => Array.from(png.data.subarray(((y - SNC_DECO_NOTCH_BOX.y) * SNC_DECO_NOTCH_BOX.width + (x - SNC_DECO_NOTCH_BOX.x)) * 4, ((y - SNC_DECO_NOTCH_BOX.y) * SNC_DECO_NOTCH_BOX.width + (x - SNC_DECO_NOTCH_BOX.x)) * 4 + 4));
    const crown = at(750, 1939 - 35 + 5);
    expect(crown[3]).toBe(255);
    expect(crown[0] - crown[2]).toBeGreaterThan(45);
    expect(at(750, 1935)).toEqual([0, 0, 0, 255]);
  });
});
