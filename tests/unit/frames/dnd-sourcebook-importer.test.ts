import { createHash } from "node:crypto";
import fs from "node:fs";
import path from "node:path";
import sharp from "sharp";
import { describe, expect, it } from "vitest";
import {
  CC_TEMPLATES,
  DND,
  DND_CAPTURE_PX,
  DND_NOTCH,
  DND_NOTCH_BOX,
  DND_PRINT_TONE,
  DND_STAMP_OVAL_PX,
  HOLO_STAMP_NOTCHES,
  blackoutAndCut,
  capturePlane,
  cutInside,
  notchCutOf,
  notchSourceFiles,
  pieceNotchFindings,
  sourceFilesFor,
  sourceTonesOf,
} from "../../../scripts/lib/cc-frames.mjs";
import { resolveFrameOverlays } from "@/lib/cards/anatomy";
import { COLLECTOR_TEMPLATES } from "@/lib/cards/collector-line";
import { M15_FAMILY_TEMPLATES } from "@/lib/cards/m15-family";
import { PLATE_INK } from "@/lib/cards/plate-ink";
import {
  DNDSOURCEBOOK_ART_SLOT,
  DNDSOURCEBOOK_COLLECTOR,
  DNDSOURCEBOOK_HOLO_STAMP,
  DNDSOURCEBOOK_HOLO_STAMP_OVAL,
  M15_COLLECTOR,
  getFrameProfile,
} from "@/lib/cards/template-layout";
import { EDGE_CONTRACTS, EDGE_CONTRACT_KNOWN_FAILURES } from "@/lib/frames/edge-contract";
import { ART_WINDOW_KNOWN_FAILURES } from "@/lib/frames/art-window";
import { SQUARE_CORNERS, squareCornerKind } from "@/lib/frames/square-corners";
import { BORDER_PENDING_TEMPLATES } from "@/lib/scryfall/frame-signatures";
import { NEVER_NORMALISE } from "../../../scripts/lib/frame-corners.mjs";
import { FRAME_ERA_LABELS, FRAME_SET_ERA, FRAME_SET_LABELS, FRAME_TEMPLATE_LABELS, FRAME_TEMPLATE_SET } from "@/types/card";
import manifestJson from "@/lib/frames/frame-manifest.json";

// ---------------------------------------------------------------------------
// TODO 4.11 wave 2 item 1: the Dungeons & Dragons SOURCEBOOK showcase
// (`dndsourcebook`; AFR #299–349, CLB #375–450) from Card Conjurer's 'D&D
// Sourcebook' pack (1500 × 2100 native) — a NEW template, an addition. The
// recipe (ONE master under every key: print draws one parchment page for
// every colour), the tone rule's verdict (nothing toned), its OVAL notch
// (the pack's one piece, the hologram oval cut), no crown (none prints), the
// edges, the profile on the page's own lines and, where the published
// objects are on disk at the manifest's sha256 (FRAMES_BUILD_DIR, else
// .frames-build; CI fetches them), their pixels.
// ---------------------------------------------------------------------------

type Layer = { src: string };
const def = (CC_TEMPLATES as unknown as Record<string, { colors: Record<string, Layer[]>; plates: Record<string, string> }>).dndsourcebook;
const BUILD = process.env.FRAMES_BUILD_DIR ? path.resolve(process.env.FRAMES_BUILD_DIR) : path.join(process.cwd(), ".frames-build");
type Entry = { sha256: string; width: number; height: number };
const MANIFEST = (manifestJson as { files: Record<string, Entry> }).files;

function published(rel: string): Buffer | null {
  const file = path.join(BUILD, rel);
  if (!MANIFEST[rel] || !fs.existsSync(file)) return null;
  const bytes = fs.readFileSync(file);
  return createHash("sha256").update(bytes).digest("hex") === MANIFEST[rel].sha256 ? bytes : null;
}

const MASTER_KEYS = ["w", "u", "b", "r", "g", "c", "m"];

describe("the D&D Sourcebook recipe", () => {
  it("is the pack's one 'Frame' under every key, its one plate under every key — no pair, no artifact master", () => {
    expect(DND).toBe("img/frames/dndSourcebook");
    expect(Object.keys(def.colors).sort()).toEqual([...MASTER_KEYS].sort());
    for (const key of MASTER_KEYS) expect(def.colors[key], key).toEqual([{ src: `${DND}/frame.png` }]);
    for (const key of MASTER_KEYS) expect(def.plates[key], key).toBe(`${DND}/pt.png`);
    expect(sourceFilesFor(def as never).sort()).toEqual([`${DND}/frame.png`, `${DND}/pt.png`]);
  });

  it("tones nothing: the pack's parchment is within 5 levels of the 127 prints' median", () => {
    for (const f of ["frame", "pt", "holo"]) expect(sourceTonesOf(`${DND}/${f}.png`), f).toBeNull();
    const off = DND_PRINT_TONE.pack.map((v, i) => Math.abs(v - DND_PRINT_TONE.print[i]));
    expect(Math.max(...off)).toBeLessThan(9);
  });

  it("builds no crown band: none of the run's legends prints one", () => {
    expect(getFrameProfile("dndsourcebook").overlays?.map((o) => o.anatomy)).toEqual(["holoStamp"]);
  });

  it("the notch publishes the keys the profile's slot asks for, at the importer's box, its oval the prints'", () => {
    expect([...DND_NOTCH.keys]).toEqual(DNDSOURCEBOOK_HOLO_STAMP.keys);
    expect(DNDSOURCEBOOK_HOLO_STAMP.rect).toEqual({
      leftPct: (DND_NOTCH_BOX.x / 1500) * 100,
      topPct: (DND_NOTCH_BOX.y / 2100) * 100,
      widthPct: (DND_NOTCH_BOX.width / 1500) * 100,
      heightPct: (DND_NOTCH_BOX.height / 2100) * 100,
    });
    const { x, y, width, height } = DND_NOTCH.placeAt;
    expect([width, height]).toEqual([186, 78]);
    expect(DND_NOTCH_BOX.x).toBeLessThan(x);
    expect(DND_NOTCH_BOX.y).toBeLessThan(y);
    expect(DND_NOTCH_BOX.x + DND_NOTCH_BOX.width).toBeGreaterThan(x + width);
    // The oval's cut and its black ring fit inside the box.
    expect(DND_NOTCH_BOX.y + DND_NOTCH_BOX.height).toBeGreaterThanOrEqual(DND_STAMP_OVAL_PX.y + DND_STAMP_OVAL_PX.height + 2 + 2);
    expect(notchCutOf(HOLO_STAMP_NOTCHES.dndsourcebookholostamp)).toBe(DND_NOTCH.oval);
    // The prints' oval (134 × 64), on the pack's well's centre, covers the
    // pack's capture.
    expect(DND_STAMP_OVAL_PX).toEqual({ x: 683, y: 1929, width: 134, height: 64 });
    expect(DND_STAMP_OVAL_PX.x + DND_STAMP_OVAL_PX.width / 2).toBe(DND_CAPTURE_PX.x + DND_CAPTURE_PX.width / 2);
    expect(DND_STAMP_OVAL_PX.x).toBeLessThanOrEqual(DND_CAPTURE_PX.x);
    expect(DND_STAMP_OVAL_PX.y).toBeLessThanOrEqual(DND_CAPTURE_PX.y);
    expect(DND_STAMP_OVAL_PX.y + DND_STAMP_OVAL_PX.height).toBeGreaterThanOrEqual(DND_CAPTURE_PX.y + DND_CAPTURE_PX.height);
    expect(DNDSOURCEBOOK_HOLO_STAMP.anatomy === "holoStamp" && DNDSOURCEBOOK_HOLO_STAMP.stamp.shape).toBe("oval");
    for (const k of ["leftPct", "topPct", "widthPct", "heightPct"] as const) expect(DNDSOURCEBOOK_HOLO_STAMP_OVAL[k]).toBeCloseTo(DND_NOTCH.oval[k], 9);
    expect(notchSourceFiles(HOLO_STAMP_NOTCHES.dndsourcebookholostamp)).toEqual([`${DND}/holo.png`]);
  });
});

describe("the importer's notch piece", () => {
  const shape = DND_NOTCH.shape;
  const { width, height } = shape.size;
  /** A synthetic piece: black arch everywhere, a bright "hologram" oval in
   *  the well where the pack paints it, clear corners. */
  function piece(grow = 0): Buffer {
    const buf = Buffer.alloc(width * height * 4);
    const holo = cutInside(shape, DND_NOTCH.oval, grow);
    for (let y = 0; y < height; y += 1) {
      for (let x = 0; x < width; x += 1) {
        const o = (y * width + x) * 4;
        if ((x < 3 || x > width - 4) && (y < 3 || y > height - 4)) continue;
        const v = holo(x, y, 0) ? 220 : 12;
        buf.set([v, v, v - 10 < 0 ? 0 : v - 10, 255], o);
      }
    }
    return buf;
  }

  it("cuts the oval clear, blacks its ring and holds every lit pixel of the well inside them", () => {
    const placed = piece();
    const captured = capturePlane(placed, width, height, DND_NOTCH.capture);
    const out = blackoutAndCut(placed, shape, DND_NOTCH.oval, 2, 2);
    expect(pieceNotchFindings(out, shape, DND_NOTCH.oval, 2, 2, captured).failures).toEqual([]);
  });

  it("a capture drawn wider than the cut is refused", () => {
    const placed = piece(6);
    const captured = capturePlane(placed, width, height, DND_NOTCH.capture);
    const out = blackoutAndCut(placed, shape, DND_NOTCH.oval, 2, 2);
    expect(pieceNotchFindings(out, shape, DND_NOTCH.oval, 2, 2, captured).failures.join(" ")).toMatch(/stamp shape/);
  });
});

describe("the edges and corners", () => {
  it("the printed black border all round: on no pending list", () => {
    const border = { kind: "border" };
    expect(EDGE_CONTRACTS.dndsourcebook).toEqual({ top: border, right: border, bottom: border, left: border });
    expect(EDGE_CONTRACT_KNOWN_FAILURES.dndsourcebook).toBeUndefined();
    expect(ART_WINDOW_KNOWN_FAILURES.dndsourcebook).toBeUndefined();
    expect(BORDER_PENDING_TEMPLATES.has("dndsourcebook")).toBe(false);
    expect(NEVER_NORMALISE.test("dndsourcebook")).toBe(false);
    expect(SQUARE_CORNERS.dndsourcebook).toBeUndefined();
    expect(["tl", "tr", "bl", "br"].map((c) => squareCornerKind("dndsourcebook", "w", c as never))).toEqual(["border", "border", "border", "border"]);
  });
});

describe("the profile rides the page's own lines", () => {
  const p = getFrameProfile("dndsourcebook");

  it("is a new showcase set of its own, Dungeons & Dragons — Sourcebook", () => {
    expect(FRAME_TEMPLATE_LABELS.dndsourcebook).toBe("Sourcebook");
    expect(FRAME_TEMPLATE_SET.dndsourcebook).toBe("dnd");
    expect(FRAME_SET_LABELS.dnd).toBe("Dungeons & Dragons");
    expect(FRAME_ERA_LABELS[FRAME_SET_ERA.dnd]).toBe("Showcase & Universes Beyond");
  });

  it("is an M15-era family member on the run's cost row, name, type line and rules box", () => {
    expect(M15_FAMILY_TEMPLATES).toContain("dndsourcebook");
    expect(COLLECTOR_TEMPLATES).toContain("dndsourcebook");
    expect(p.title.fit).toBe("measured");
    expect(p.type.fit).toBe("measured");
    // The CC M15 disc (70 px) 3 px higher and 10 px further right than the
    // CC-framed M15 row: the run's discs 109.5 px above the title rule, the
    // last ending at 1391 on a page 3 px narrower than the pack's.
    expect(p.costSizePct).toBeCloseTo(70 / 1500, 12);
    expect(p.costDy).toBeCloseTo(-9.6 / 1500, 12);
    expect(p.costDx).toBeCloseTo(12 / 1500, 12);
    // The window's torn, half-transparent edges (93–1439 × 227–1180) inside
    // the slot with the art-window check's 0.05 % to spare.
    const a = p.artSlot;
    expect(a).toBe(DNDSOURCEBOOK_ART_SLOT);
    expect((a.leftPct / 100) * 1500).toBeCloseTo(92, 9);
    expect(((a.leftPct + a.widthPct) / 100) * 1500).toBeCloseTo(1441, 9);
    expect((a.topPct / 100) * 2100).toBeCloseTo(226, 9);
    expect(((a.topPct + a.heightPct) / 100) * 2100).toBeCloseTo(1183, 9);
    expect(p.underFrameArt).toBeUndefined();
    // The rules box ends where the run's last descenders end (1877.5 px),
    // clear of the page's rounded foot.
    expect(((p.rules.rect.topPct + p.rules.rect.heightPct) / 100) * 2100).toBeCloseTo(1877.5, 9);
    expect(p.pt?.plateAssetPathTemplate).toBe("/frames/dndsourcebook/pt/{color}.png");
    expect(p.pt?.plateRect).toEqual({ topPct: (1861 / 2100) * 100, leftPct: (1161 / 1500) * 100, widthPct: (260 / 1500) * 100, heightPct: (132 / 2100) * 100 });
    expect(PLATE_INK["/frames/dndsourcebook/pt/{color}.png"]).toEqual({ left: 0, top: 0, right: 1, bottom: 1 });
    // Dark ink on the parchment everywhere.
    expect([p.title.colorHex, p.rules.colorHex]).toEqual(["#17120c", "#17120c"]);
    // The collector line 4 px under M15's rows, M15's pen and sizes.
    expect(p.collector).toBe(DNDSOURCEBOOK_COLLECTOR);
    expect({ ...DNDSOURCEBOOK_COLLECTOR, line1BaselinePct: 0, line2BaselinePct: 0 }).toEqual({ ...M15_COLLECTOR, line1BaselinePct: 0, line2BaselinePct: 0 });
    expect((DNDSOURCEBOOK_COLLECTOR.line1BaselinePct / 100) * 2100).toBeCloseTo(1997.5, 9);
    expect((DNDSOURCEBOOK_COLLECTOR.line2BaselinePct / 100) * 2100).toBeCloseTo(2036, 9);
    // No crown, no two-colour dress: one page for every colour.
    expect(p.twoColorMasters).toBeUndefined();
    expect(p.twoColorSplit).toBeUndefined();
  });

  it("keys the stamp by the colour key; no crown on a legend", () => {
    const style = { template: "dndsourcebook", crown: true, stamp: "auto" } as never;
    const keysOf = (facts: Record<string, unknown>) =>
      resolveFrameOverlays(p, style, { colors: [], rarity: "rare", supertype: "Legendary", cardType: "creature", ...facts, colorKey: facts.colorKey as string } as never).map((o) => `${o.anatomy}:${o.key}`);
    expect(keysOf({ colorKey: "w", colors: ["white"] })).toEqual(["holoStamp:w"]);
    expect(keysOf({ colorKey: "m", colors: ["white", "blue"] })).toEqual(["holoStamp:m"]);
    expect(keysOf({ colorKey: "c", colors: [], cardType: "artifact" })).toEqual(["holoStamp:c"]);
    // "auto" is a rare or mythic on an oval frame, as the run prints it.
    expect(keysOf({ colorKey: "g", colors: ["green"], supertype: null, rarity: "uncommon" })).toEqual([]);
  });
});

const masters = MASTER_KEYS.map((k) => [k, published(`dndsourcebook/${k}.png`)] as const);
const plates = MASTER_KEYS.map((k) => [k, published(`dndsourcebook/pt/${k}.png`)] as const);
const notches = MASTER_KEYS.map((k) => [k, published(`dndsourcebookholostamp/${k}.png`)] as const);
const available = [...masters, ...plates, ...notches].every(([, b]) => b !== null);

describe.skipIf(!available)("the published objects (set FRAMES_BUILD_DIR if skipped)", () => {
  it("one master, one plate and one notch piece under every key", () => {
    for (const folder of ["dndsourcebook", "dndsourcebook/pt", "dndsourcebookholostamp"]) {
      const shas = new Set(MASTER_KEYS.map((k) => MANIFEST[`${folder}/${k}.png`].sha256));
      expect(shas.size, folder).toBe(1);
    }
  });

  it("dndsourcebook: 1500 × 2100, the black border all round, the corners cut, the window clear, the page's parchment", async () => {
    const { data, info } = await sharp(published("dndsourcebook/w.png")!).ensureAlpha().raw().toBuffer({ resolveWithObject: true });
    expect([info.width, info.height]).toEqual([1500, 2100]);
    const px = (x: number, y: number) => Array.from(data.subarray((y * 1500 + x) * 4, (y * 1500 + x) * 4 + 4));
    for (const [x, y] of [[750, 8], [8, 1050], [1491, 1050], [750, 2090], [750, 2000]]) {
      const [r, g, b, a] = px(x, y);
      expect(a, `(${x}, ${y})`).toBe(255);
      expect(r + g + b, `(${x}, ${y})`).toBeLessThan(40);
    }
    expect([px(0, 0)[3], px(1499, 0)[3], px(0, 2099)[3], px(1499, 2099)[3]]).toEqual([0, 0, 0, 0]);
    expect(px(750, 700)[3]).toBe(0);
    // The page's parchment as drawn (the median over the text box, ink-free
    // rows of the master): 219,179,141 against print's 217,181,144.
    const ch: number[][] = [[], [], []];
    for (let y = 1400; y < 1800; y += 4) for (let x = 200; x < 1300; x += 4) {
      const [r, g, b] = px(x, y);
      ch[0].push(r); ch[1].push(g); ch[2].push(b);
    }
    const med = ch.map((v) => v.sort((p, q) => p - q)[v.length >> 1]);
    med.forEach((v, i) => expect(Math.abs(v - DND_PRINT_TONE.print[i]), `channel ${i}`).toBeLessThan(9));
  });

  it("dndsourcebookholostamp: its oval cut and ringed", async () => {
    const notch = await sharp(published("dndsourcebookholostamp/w.png")!).ensureAlpha().raw().toBuffer({ resolveWithObject: true });
    expect([notch.info.width, notch.info.height]).toEqual([DND_NOTCH_BOX.width, DND_NOTCH_BOX.height]);
    expect(pieceNotchFindings(notch.data, DND_NOTCH.shape, DND_NOTCH.oval, 2, 2).failures).toEqual([]);
  });
});
