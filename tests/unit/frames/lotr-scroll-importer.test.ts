import { createHash } from "node:crypto";
import fs from "node:fs";
import path from "node:path";
import sharp from "sharp";
import { describe, expect, it } from "vitest";
import {
  CC_OVERLAY_BANDS,
  CC_TEMPLATES,
  HOLO_STAMP_NOTCHES,
  SCROLL,
  SCROLL_CROWN_BAND,
  SCROLL_NOTCH,
  SCROLL_NOTCH_BOX,
  blackoutAndCut,
  cutInside,
  notchSourceFiles,
  pieceNotchFindings,
  scrollCrownFindings,
  sourceFilesFor,
} from "../../../scripts/lib/cc-frames.mjs";
import { resolveFrameOverlays } from "@/lib/cards/anatomy";
import { M15_FAMILY_TEMPLATES } from "@/lib/cards/m15-family";
import { PLATE_INK } from "@/lib/cards/plate-ink";
import { UB_STAMP_HOLE } from "@/lib/cards/holo-stamp";
import { LOTRSCROLL_CROWN, LOTRSCROLL_HOLO_STAMP, getFrameProfile } from "@/lib/cards/template-layout";
import { EDGE_CONTRACT_KNOWN_FAILURES } from "@/lib/frames/edge-contract";
import { ART_WINDOW_KNOWN_FAILURES } from "@/lib/frames/art-window";
import { BORDER_PENDING_TEMPLATES } from "@/lib/scryfall/frame-signatures";
import manifestJson from "@/lib/frames/frame-manifest.json";

// ---------------------------------------------------------------------------
// TODO 4.11 (showcase rebuild, wave 1; layout v62): the Lord of the Rings
// scroll showcase re-sourced from Card Conjurer's 'Scroll' pack — the recipe
// (whole files, `c` the land frame, `a` the artifact frame, the scroll
// plates), its crown band and triangle notch (the pack's own piece per key,
// the hologram blacked out and cut), the profile that rides the masters and,
// where the published objects are on disk at the manifest's sha256
// (FRAMES_BUILD_DIR, else .frames-build; CI fetches them), their pixels.
// ---------------------------------------------------------------------------

type Layer = { src: string };
const def = (CC_TEMPLATES as unknown as Record<string, { colors: Record<string, Layer[]>; plates: Record<string, string> }>).lotrscroll;
const BUILD = process.env.FRAMES_BUILD_DIR ? path.resolve(process.env.FRAMES_BUILD_DIR) : path.join(process.cwd(), ".frames-build");
type Entry = { sha256: string; width: number; height: number };
const MANIFEST = (manifestJson as { files: Record<string, Entry> }).files;

function published(rel: string): Buffer | null {
  const file = path.join(BUILD, rel);
  if (!MANIFEST[rel] || !fs.existsSync(file)) return null;
  const bytes = fs.readFileSync(file);
  return createHash("sha256").update(bytes).digest("hex") === MANIFEST[rel].sha256 ? bytes : null;
}

const MASTER_KEYS = ["w", "u", "b", "r", "g", "c", "m", "a"];
const OVERLAY_KEYS = ["w", "u", "b", "r", "g", "m", "a", "l"];

describe("the scroll recipe", () => {
  it("is the pack's whole file per key: `c` the brown land frame, `a` the light-blue artifact frame", () => {
    expect(SCROLL).toBe("img/frames/scroll");
    expect(Object.keys(def.colors).sort()).toEqual([...MASTER_KEYS].sort());
    for (const key of ["w", "u", "b", "r", "g", "m", "a"]) expect(def.colors[key], key).toEqual([{ src: `${SCROLL}/${key}.png` }]);
    expect(def.colors.c).toEqual([{ src: `${SCROLL}/l.png` }]);
  });

  it("its plates: the pack's seven scroll plates, the colourless card the artifact's", () => {
    for (const key of ["w", "u", "b", "r", "g", "m"]) expect(def.plates[key], key).toBe(`${SCROLL}/pt/${key}.png`);
    expect(def.plates.c).toBe(`${SCROLL}/pt/a.png`);
    expect(sourceFilesFor(def)).not.toContain(`${SCROLL}/maskNoOverlay.png`);
  });

  it("the crown band and the notch publish the keys the profile's slots ask for", () => {
    expect([...SCROLL_CROWN_BAND.keys]).toEqual(LOTRSCROLL_CROWN.keys);
    expect(CC_OVERLAY_BANDS.lotrscrollcrown.keys).toBe(SCROLL_CROWN_BAND.keys);
    expect([...SCROLL_NOTCH.keys]).toEqual(LOTRSCROLL_HOLO_STAMP.keys);
    expect([...LOTRSCROLL_CROWN.keys].sort()).toEqual([...OVERLAY_KEYS].sort());
    // The notch slot's rect is the importer's box, 1:1 at HD.
    expect(LOTRSCROLL_HOLO_STAMP.rect).toEqual({
      leftPct: (SCROLL_NOTCH_BOX.x / 1500) * 100,
      topPct: (SCROLL_NOTCH_BOX.y / 2100) * 100,
      widthPct: (SCROLL_NOTCH_BOX.width / 1500) * 100,
      heightPct: (SCROLL_NOTCH_BOX.height / 2100) * 100,
    });
    // The box holds the pack's piece at its bounds (834 / 2518, 349 × 181
    // of 2010 × 2814: 622.4–882.8 × 1879.1–2014.1 px).
    const s = 1500 / 2010;
    expect(SCROLL_NOTCH_BOX.x).toBeLessThanOrEqual(834 * s);
    expect(SCROLL_NOTCH_BOX.x + SCROLL_NOTCH_BOX.width).toBeGreaterThanOrEqual((834 + 349) * s);
    expect(SCROLL_NOTCH_BOX.y).toBeLessThanOrEqual(2518 * s);
    expect(SCROLL_NOTCH_BOX.y + SCROLL_NOTCH_BOX.height).toBeGreaterThanOrEqual((2518 + 181) * s);
    // The stamp is the Universes Beyond triangle, cut and drawn the same way.
    expect(HOLO_STAMP_NOTCHES.lotrscrollholostamp.triangle).toBe(UB_STAMP_HOLE);
    expect(LOTRSCROLL_HOLO_STAMP.anatomy === "holoStamp" && LOTRSCROLL_HOLO_STAMP.stamp.shape).toBe("triangle");
    expect(notchSourceFiles(HOLO_STAMP_NOTCHES.lotrscrollholostamp)).toEqual([...OVERLAY_KEYS.map((k) => `${SCROLL}/stamps/${k}.png`), `${SCROLL}/stamps/gray.png`].sort());
  });
});

describe("the notch's hologram never survives", () => {
  const shape = SCROLL_NOTCH.shape;
  const { width, height } = shape.size;
  /** A synthetic piece: parchment everywhere, a bright "hologram" triangle
   *  2 px larger than the hole all round, clear corners. */
  function piece(): Buffer {
    const buf = Buffer.alloc(width * height * 4);
    const holo = cutInside(shape, UB_STAMP_HOLE, 2);
    for (let y = 0; y < height; y += 1) {
      for (let x = 0; x < width; x += 1) {
        const o = (y * width + x) * 4;
        if ((x < 3 || x > width - 4) && (y < 3 || y > height - 4)) continue;
        const v = holo(x, y, 2) ? 220 : 180;
        buf[o] = v;
        buf[o + 1] = v;
        buf[o + 2] = v - 40;
        buf[o + 3] = 255;
      }
    }
    return buf;
  }

  it("is cut clear inside the hole + 2 px and painted black in the 2 px round it", () => {
    const out = blackoutAndCut(piece(), shape, UB_STAMP_HOLE, 2, 2);
    const f = pieceNotchFindings(out, shape, UB_STAMP_HOLE, 2, 2);
    expect(f.failures).toEqual([]);
    expect(f.cutClear && f.ringBlack).toBe(true);
  });

  it("a piece left uncut, or a stamp shape reaching past the ring, is refused", () => {
    expect(pieceNotchFindings(piece(), shape, UB_STAMP_HOLE, 2, 2).failures.join(" ")).toMatch(/not transparent/);
    const stamp = new Uint8Array(width * height).fill(200);
    const out = blackoutAndCut(piece(), shape, UB_STAMP_HOLE, 2, 2);
    expect(pieceNotchFindings(out, shape, UB_STAMP_HOLE, 2, 2, stamp).failures.join(" ")).toMatch(/stamp shape/);
  });

  it("the crown band's findings refuse alpha past its rows or outside its bounds", () => {
    const W = 1500;
    const rows = SCROLL_CROWN_BAND.rows;
    const band = Buffer.alloc(W * 2100 * 4);
    for (let y = 32; y < 86; y += 1) for (let x = 40; x < 1460; x += 1) band[(y * W + x) * 4 + 3] = 255;
    expect(scrollCrownFindings(band, W, 2100, rows).failures).toEqual([]);
    band[(150 * W + 700) * 4 + 3] = 9;
    band[(50 * W + 0) * 4 + 3] = 9;
    expect(scrollCrownFindings(band, W, 2100, rows).failures).toHaveLength(2);
  });
});

describe("the profile rides the masters", () => {
  const p = getFrameProfile("lotrscroll");

  it("is an M15-era family member on the CC M15 cost row, its art slot over the window, the colourless artifact on `a`", () => {
    expect(M15_FAMILY_TEMPLATES).toContain("lotrscroll");
    expect(p.title.fit).toBe("measured");
    expect(p.type.fit).toBe("measured");
    expect([p.costSizePct, p.costDy, p.costDx]).toEqual([70 / 1500, -6.6 / 1500, 2 / 1500]);
    expect(p.artifactMasterKeys).toEqual({ c: "a" });
    // The masters' see-through window, 111–1388 × 230–1168 px on every key,
    // with the art-window check's 0.05 % to spare.
    const a = p.artSlot;
    expect((a.leftPct / 100) * 1500).toBeLessThanOrEqual(111 - 0.75);
    expect(((a.leftPct + a.widthPct) / 100) * 1500).toBeGreaterThanOrEqual(1389 + 0.75 - 1e-9);
    expect((a.topPct / 100) * 2100).toBeLessThanOrEqual(230 - 1);
    expect(((a.topPct + a.heightPct) / 100) * 2100).toBeGreaterThanOrEqual(1169 + 1 - 1e-9);
    expect(p.pt?.plateAssetPathTemplate).toBe("/frames/lotrscroll/pt/{color}.png");
    expect(PLATE_INK["/frames/lotrscroll/pt/{color}.png"]).toBeDefined();
    expect(p.collector).toBeDefined();
  });

  it("its border is true now: off the known failures and the import cap", () => {
    expect(EDGE_CONTRACT_KNOWN_FAILURES.lotrscroll).toBeUndefined();
    expect(ART_WINDOW_KNOWN_FAILURES.lotrscroll).toBeUndefined();
    expect(BORDER_PENDING_TEMPLATES.has("lotrscroll")).toBe(false);
  });

  it("keys the crown and the notch by the master drawn: a colourless artifact's `a`, a colourless land's `l`", () => {
    const style = { template: "lotrscroll", crown: true, stamp: "auto" } as never;
    const keysOf = (facts: Record<string, unknown>) =>
      resolveFrameOverlays(p, style, { colors: [], rarity: "rare", supertype: "Legendary", ...facts, colorKey: facts.colorKey as string } as never).map((o) => `${o.anatomy}:${o.key}`);
    expect(keysOf({ colorKey: "c", cardType: "artifact" })).toEqual(["crown:a", "holoStamp:a"]);
    expect(keysOf({ colorKey: "c", cardType: "creature", supertype: "Legendary Artifact" })).toEqual(["crown:a", "holoStamp:a"]);
    expect(keysOf({ colorKey: "c", cardType: "land" })).toEqual(["crown:l", "holoStamp:l"]);
    expect(keysOf({ colorKey: "u", cardType: "artifact" })).toEqual(["crown:u", "holoStamp:u"]);
    expect(keysOf({ colorKey: "m", cardType: "creature" })).toEqual(["crown:m", "holoStamp:m"]);
    // "auto" stamps every rarity on a triangle frame; the crown wants a legend.
    expect(keysOf({ colorKey: "g", cardType: "creature", supertype: null, rarity: "common" })).toEqual(["holoStamp:g"]);
  });
});

const masters = MASTER_KEYS.map((k) => [k, published(`lotrscroll/${k}.png`)] as const);
const crowns = OVERLAY_KEYS.map((k) => [k, published(`lotrscrollcrown/${k}.png`)] as const);
const notches = OVERLAY_KEYS.map((k) => [k, published(`lotrscrollholostamp/${k}.png`)] as const);
const available = [...masters, ...crowns, ...notches].every(([, b]) => b !== null);

describe.skipIf(!available)("the published objects (set FRAMES_BUILD_DIR if skipped)", () => {
  it.each(MASTER_KEYS)("lotrscroll/%s: 1500 × 2100, a black border to the round corner, the window where the slot covers it", async (key) => {
    const { data, info } = await sharp(published(`lotrscroll/${key}.png`)!).ensureAlpha().raw().toBuffer({ resolveWithObject: true });
    expect([info.width, info.height]).toEqual([1500, 2100]);
    const px = (x: number, y: number) => Array.from(data.subarray((y * 1500 + x) * 4, (y * 1500 + x) * 4 + 4));
    // The black border at each edge's middle, opaque.
    for (const [x, y] of [[750, 8], [750, 2090], [8, 1050], [1491, 1050]]) {
      const [r, g, b, a] = px(x, y);
      expect(a, `${key} (${x}, ${y})`).toBe(255);
      expect(r + g + b, `${key} (${x}, ${y})`).toBeLessThan(40);
    }
    // The corner cut, the window see-through with the parchment wash.
    expect(px(0, 0)[3]).toBe(0);
    expect(px(750, 700)[3]).toBeLessThan(60);
    expect(px(750, 1500)[3]).toBe(255);
  });

  it.each(OVERLAY_KEYS)("lotrscrollcrown/%s and lotrscrollholostamp/%s pass the importer's checks", async (key) => {
    const band = await sharp(published(`lotrscrollcrown/${key}.png`)!).ensureAlpha().raw().toBuffer({ resolveWithObject: true });
    expect([band.info.width, band.info.height]).toEqual([1500, SCROLL_CROWN_BAND.rows]);
    const full = Buffer.alloc(1500 * 2100 * 4);
    band.data.copy(full);
    expect(scrollCrownFindings(full, 1500, 2100, SCROLL_CROWN_BAND.rows).failures).toEqual([]);
    const notch = await sharp(published(`lotrscrollholostamp/${key}.png`)!).ensureAlpha().raw().toBuffer({ resolveWithObject: true });
    expect([notch.info.width, notch.info.height]).toEqual([SCROLL_NOTCH_BOX.width, SCROLL_NOTCH_BOX.height]);
    expect(pieceNotchFindings(notch.data, SCROLL_NOTCH.shape, UB_STAMP_HOLE, 2, 2).failures).toEqual([]);
  });
});
