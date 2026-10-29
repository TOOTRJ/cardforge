import { createHash } from "node:crypto";
import { existsSync, readFileSync } from "node:fs";
import path from "node:path";
import sharp from "sharp";
import { describe, expect, it } from "vitest";
import manifestJson from "@/lib/frames/frame-manifest.json";
import { resolveFrameOverlays, resolveHoloStamp } from "@/lib/cards/anatomy";
import { COLLECTOR_TEMPLATES } from "@/lib/cards/collector-line";
import {
  M15_HOLO_STAMP_OVAL,
  PREPARE_ARCH_LIFT_PX,
  PREPARE_HOLO_STAMP_KEEP_OUT,
  PREPARE_HOLO_STAMP_KEEP_OUT_SHAPE,
  prepareArchLiftAt,
} from "@/lib/cards/holo-stamp";
import {
  EXTENDED_CROWN,
  M15_COLLECTOR,
  M15_HOLO_STAMP,
  PREPARE_HOLO_STAMP,
  PREPARE_PAGE,
  getFrameProfile,
} from "@/lib/cards/template-layout";
import { EDGE_CONTRACTS } from "@/lib/frames/edge-contract";
import { PREPARE_ARCH, PREPARE_STAMP_FOLDERS, archLiftAt, buildBorderlessNotch } from "@/scripts/lib/borderless-stamp.mjs";
import { PREPARE_EXTENDED, PREPARE_STAMP } from "@/scripts/lib/prepare-2026.mjs";

// ---------------------------------------------------------------------------
// TODO 4.27b — the Prepare frame's holofoil stamp notch, its collector line
// and its extended-art dress (docs/FRAMES.md "The Prepare frame's stamp,
// collector line and extended-art dress (4.27b)"):
//   • the notch is the master's own foot LIFTED along print's arch
//     (PREPARE_STAMP, scripts/build-borderless-stamp.mjs), one piece per
//     MASTER — the hybrid pair dress has its own (keyByMaster);
//   • the collector line is M15's slot;
//   • `extendedartprepare` merges the published extendedart top over the
//     published prepare bottom (PREPARE_EXTENDED), and wears the Prepare
//     frame's page overlays and notch;
//   • every piece is an ADDITION: a stored Prepare card (no `stamp` /
//     `collector` key) draws neither.
// The pixel checks read the masters at the manifest's sha256 from
// FRAMES_BUILD_DIR (CI's frame cache) and skip without it.
// ---------------------------------------------------------------------------

const FILES = (manifestJson as { files: Record<string, { sha256: string; width: number; height: number }> }).files;
const MONO = ["w", "u", "b", "r", "g", "m", "c"];
const PAIRS = ["wu", "wb", "ub", "ur", "br", "bg", "rg", "rw", "gw", "gu"];
const NOTCH_KEYS = [...MONO, ...PAIRS, ...PAIRS.map((p) => `${p}-h`)];

const facts = (over: Record<string, unknown> = {}) => ({
  colors: ["red"] as string[],
  cost: "{2}{R}",
  cardType: "creature",
  supertype: null,
  rarity: "rare",
  colorKey: "r",
  ...over,
});

describe("the Prepare notch: the slot, the arch, the keys", () => {
  it("the slot is the build's box, keyed by every master (both pair dresses), with M15's oval and the arch's columns as the keep-out", () => {
    const box = PREPARE_STAMP.box;
    expect(PREPARE_HOLO_STAMP.rect).toEqual({
      leftPct: (box.x / 1500) * 100,
      topPct: (box.y / 2100) * 100,
      widthPct: (box.width / 1500) * 100,
      heightPct: (box.height / 2100) * 100,
    });
    expect(PREPARE_HOLO_STAMP.assetPathTemplate).toBe("/frames/prepareholostamp/{key}.png");
    expect([...PREPARE_HOLO_STAMP.keys]).toEqual(NOTCH_KEYS);
    expect(Object.keys(PREPARE_STAMP_FOLDERS.prepareholostamp.keys).sort()).toEqual([...NOTCH_KEYS].sort());
    expect(PREPARE_HOLO_STAMP.anatomy === "holoStamp" && PREPARE_HOLO_STAMP.keyByMaster).toBe(true);
    expect(PREPARE_HOLO_STAMP.anatomy === "holoStamp" && PREPARE_HOLO_STAMP.stamp).toEqual({
      shape: "oval",
      oval: M15_HOLO_STAMP_OVAL,
      keepOut: PREPARE_HOLO_STAMP_KEEP_OUT,
      keepOutShape: PREPARE_HOLO_STAMP_KEEP_OUT_SHAPE,
    });
    // M15's own slot keeps one piece per pair.
    expect(M15_HOLO_STAMP.anatomy === "holoStamp" && M15_HOLO_STAMP.keyByMaster).toBeUndefined();
  });

  it("the printed arch: 35.8 px at the centre, 0 by x 656 and x 845, every lifted pixel inside the box", () => {
    expect(PREPARE_STAMP.lift[0]).toBe(35.8);
    expect(PREPARE_STAMP.lift.at(-1)).toBe(0);
    for (let i = 1; i < PREPARE_STAMP.lift.length; i += 1) expect(PREPARE_STAMP.lift[i]).toBeLessThanOrEqual(PREPARE_STAMP.lift[i - 1]);
    expect(PREPARE_ARCH.liftTop).toBe(1927);
    expect(PREPARE_ARCH.barTop).toBe(1950);
    const { x, y, width, height } = PREPARE_STAMP.box;
    for (const v of [x, y, width, height]) expect(v % 2, "even HD px").toBe(0);
    expect(archLiftAt(x + 1, PREPARE_ARCH.lift)).toBe(0);
    expect(archLiftAt(x + width - 1, PREPARE_ARCH.lift)).toBe(0);
    expect(archLiftAt(750, PREPARE_ARCH.lift)).toBeCloseTo(35.8, 1);
    expect(y).toBeLessThanOrEqual(Math.floor(PREPARE_STAMP.liftTop - PREPARE_STAMP.lift[0]));
    expect(y + height).toBe(PREPARE_ARCH.barTop);
  });

  it("the keep-out follows the arch: the build's lift table, 4 px columns 2 px over the lifted foot, inside the piece's box", () => {
    expect([...PREPARE_ARCH_LIFT_PX]).toEqual([...PREPARE_STAMP.lift]);
    for (let x = 640; x < 860; x += 1) expect(prepareArchLiftAt(x)).toBeCloseTo(archLiftAt(x, PREPARE_ARCH.lift), 9);
    const px = (r: { leftPct: number; topPct: number; widthPct: number; heightPct: number }) => ({
      x0: (r.leftPct / 100) * 1500,
      x1: ((r.leftPct + r.widthPct) / 100) * 1500,
      y0: (r.topPct / 100) * 2100,
      y1: ((r.topPct + r.heightPct) / 100) * 2100,
    });
    const box = PREPARE_STAMP.box;
    expect(PREPARE_HOLO_STAMP_KEEP_OUT_SHAPE.length).toBeGreaterThan(40);
    for (const r of PREPARE_HOLO_STAMP_KEEP_OUT_SHAPE.map(px)) {
      expect(r.x1 - r.x0).toBeCloseTo(4, 9);
      expect(r.y1).toBeCloseTo(1925, 9);
      expect(r.x0).toBeGreaterThanOrEqual(box.x - 1e-9);
      expect(r.x1).toBeLessThanOrEqual(box.x + box.width + 1e-9);
      // Each column's top is 2 px above the highest lifted row inside it.
      let lift = 0;
      for (let x = Math.round(r.x0); x < Math.round(r.x1); x += 1) lift = Math.max(lift, prepareArchLiftAt(x));
      expect(r.y0).toBeCloseTo(PREPARE_STAMP.liftTop - lift - 2, 9);
      expect(r.y0).toBeGreaterThanOrEqual(box.y - 2);
    }
    // The crown is the bounds' top; the shallow slopes sit far lower.
    expect(px(PREPARE_HOLO_STAMP_KEEP_OUT).y0).toBeCloseTo(1927 - 35.8 - 2, 9);
    const first = px(PREPARE_HOLO_STAMP_KEEP_OUT_SHAPE[0]!);
    expect(first.y0).toBeGreaterThan(1915);
  });

  it("keys a card by the master it is drawn as — a hybrid pair has its own piece; m15 still keys the pair", () => {
    const profile = getFrameProfile("prepare");
    const notch = (style: Record<string, unknown>, over: Record<string, unknown> = {}) =>
      resolveHoloStamp(profile, { stamp: "auto", ...style } as never, facts(over) as never)?.notch.path ?? null;
    expect(notch({})).toBe("/frames/prepareholostamp/r.png");
    expect(notch({}, { colors: ["colorless"], colorKey: "c", cost: "{3}" })).toBe("/frames/prepareholostamp/c.png");
    const pair = { colors: ["white", "blue"], colorKey: "m" };
    expect(notch({ twoColor: true }, { ...pair, cost: "{1}{W}{U}" })).toBe("/frames/prepareholostamp/wu.png");
    expect(notch({ twoColor: true }, { ...pair, cost: "{W/U}{W/U}" })).toBe("/frames/prepareholostamp/wu-h.png");
    expect(notch({ twoColor: false }, { ...pair, cost: "{1}{W}{U}" })).toBe("/frames/prepareholostamp/m.png");
    // "auto" on a common: nothing; "oval" anywhere.
    expect(notch({}, { rarity: "common" })).toBeNull();
    expect(notch({ stamp: "oval" }, { rarity: "common" })).toBe("/frames/prepareholostamp/r.png");
    const m15 = resolveFrameOverlays(getFrameProfile("m15"), { stamp: "auto", twoColor: true }, facts({ ...pair, cost: "{W/U}{W/U}" }) as never);
    expect(m15.find((o) => o.anatomy === "holoStamp")?.path).toBe("/frames/m15holostamp/wu.png");
  });

  it("is an ADDITION: a stored Prepare card — no stamp key, no collector key — draws neither", () => {
    for (const template of ["prepare", "extendedartprepare"]) {
      const profile = getFrameProfile(template);
      expect(resolveHoloStamp(profile, { template } as never, facts() as never), template).toBeNull();
      expect(resolveHoloStamp(profile, { template, stamp: "none" } as never, facts() as never), template).toBeNull();
    }
  });
});

describe("the collector line and the extended-art dress's profile", () => {
  it("both looks carry M15's collector slot", () => {
    for (const template of ["prepare", "extendedartprepare"] as const) {
      expect(getFrameProfile(template).collector, template).toEqual(M15_COLLECTOR);
      expect(COLLECTOR_TEMPLATES, template).toContain(template);
    }
  });

  it("the dress is the Prepare frame's slots under the extended-art top, with the band, the page overlays and the notch", () => {
    const dress = getFrameProfile("extendedartprepare");
    const prepare = getFrameProfile("prepare");
    const extended = getFrameProfile("extendedart");
    expect(dress.rules).toEqual(prepare.rules);
    expect(dress.adventure).toEqual(prepare.adventure);
    expect(dress.pt).toEqual(prepare.pt);
    expect(dress.title).toEqual(prepare.title);
    expect(dress.artSlot).toEqual(extended.artSlot);
    expect(dress.setSymbolKeyline).toEqual(extended.setSymbolKeyline);
    expect(dress.type.colorHex).toBe("#ffffff");
    expect(dress.underFrameArt).toBeUndefined();
    expect(dress.artifactMasterKeys).toBeUndefined();
    expect(dress.twoColorMasters).toEqual(["split", "hybrid"]);
    expect(dress.overlays).toEqual([EXTENDED_CROWN, PREPARE_PAGE, PREPARE_HOLO_STAMP]);
    expect(EDGE_CONTRACTS.extendedartprepare).toBe(EDGE_CONTRACTS.extendedart);
    expect(PREPARE_EXTENDED).toMatchObject({ template: "extendedartprepare", cutRow: 1312, shadowRows: [1312, 1319], cols: [100, 1400], extendedKey: { c: "a" } });
  });

  it("publishes every master and piece, PNG + WebP, at their sizes", () => {
    for (const key of NOTCH_KEYS) {
      for (const ext of ["png", "webp"]) {
        expect(FILES[`extendedartprepare/${key}.${ext}`], `extendedartprepare/${key}.${ext}`).toMatchObject({ width: 1500, height: 2100 });
        expect(FILES[`prepareholostamp/${key}.${ext}`], `prepareholostamp/${key}.${ext}`).toMatchObject({ width: 192, height: 60 });
      }
    }
  });
});

// ---- the pixels, on the published masters ----------------------------------
const BUILD = process.env.FRAMES_BUILD_DIR ? path.resolve(process.env.FRAMES_BUILD_DIR) : null;
const at = (rel: string) => {
  if (!BUILD) return null;
  const file = path.join(BUILD, `${rel}.png`);
  if (!existsSync(file)) return null;
  const sha = createHash("sha256").update(readFileSync(file)).digest("hex");
  return sha === FILES[`${rel}.png`]?.sha256 ? file : null;
};
const raw = async (file: string) => (await sharp(file).ensureAlpha().raw().toBuffer({ resolveWithObject: true })).data;
const SAMPLE = ["r", "u", "c", "wu", "gu-h"];
const haveAll = SAMPLE.every((k) => at(`extendedartprepare/${k}`) && at(`prepare/${k}`) && at(`prepareholostamp/${k}`));

describe.skipIf(!haveAll)("the published pixels (set FRAMES_BUILD_DIR)", () => {
  it("the dress: the extended-art master above the type bar and beside the box, the Prepare master below it (shadow rows aside)", async () => {
    for (const key of SAMPLE) {
      const dress = await raw(at(`extendedartprepare/${key}`)!);
      const ext = await raw(at(`extendedart/${key === "c" ? "a" : key}`)!);
      const prep = await raw(at(`prepare/${key}`)!);
      let worstTop = 0;
      let worstBottom = 0;
      for (let y = 0; y < 2100; y += 3) {
        for (let x = 0; x < 1500; x += 3) {
          const o = (y * 1500 + x) * 4;
          const d = Math.max(...[0, 1, 2, 3].map((c) => Math.abs(dress[o + c] - (y < 1312 ? ext : prep)[o + c])));
          if (y < 1312) worstTop = Math.max(worstTop, d);
          else if (y > 1319 && x >= 100 && x <= 1400) worstBottom = Math.max(worstBottom, d);
        }
      }
      expect(worstTop, key).toBe(0);
      expect(worstBottom, key).toBe(0);
    }
  });

  it("the notch: its feet clear, the lift painting only inside its box, the same piece over the dress", async () => {
    for (const key of SAMPLE) {
      const piece = await raw(at(`prepareholostamp/${key}`)!);
      const { width, height } = PREPARE_STAMP.box;
      for (const x of [0, width - 1]) for (let y = 0; y < height; y += 1) expect(piece[(y * width + x) * 4 + 3], `${key} foot`).toBe(0);
      const built = buildBorderlessNotch(await raw(at(`extendedartprepare/${key}`)!), 1500, PREPARE_ARCH);
      expect(built.outside).toBe(0);
      let worst = 0;
      for (let i = 0; i < piece.length; i += 1) worst = Math.max(worst, Math.abs(piece[i] - built.piece[i]));
      expect(worst, key).toBeLessThanOrEqual(2);
    }
  });
});
