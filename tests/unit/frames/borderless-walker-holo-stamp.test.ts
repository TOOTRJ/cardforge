import { createHash } from "node:crypto";
import fs from "node:fs";
import path from "node:path";
import sharp from "sharp";
import { describe, expect, it } from "vitest";
import manifestJson from "@/lib/frames/frame-manifest.json";
import {
  BORDERLESS_ARCH,
  WALKER_ARCH,
  WALKER_ARCH_LIFT_PX,
  WALKER_BLACK_BAR_TOP,
  WALKER_NOTCH_BOX,
  WALKER_STAMP_FOLDERS,
  archLiftAt,
  buildBorderlessNotch,
  liftError,
  pinlineTop,
} from "@/scripts/lib/borderless-stamp.mjs";
import {
  frameLayerOverlays,
  normalizeAnatomy,
  resolveFrameOverlays,
  resolveHoloStamp,
  stampForTemplate,
} from "@/lib/cards/anatomy";
import type { LoyaltyAbility } from "@/lib/cards/card-display";
import {
  BORDERLESS_WALKER_ARCH_LIFT_PX,
  M15BORDERLESSPW_HOLO_STAMP_KEEP_OUT,
  M15BORDERLESSPW_HOLO_STAMP_KEEP_OUT_SHAPE,
  M15_HOLO_STAMP_OVAL,
  borderlessWalkerArchLiftAt,
} from "@/lib/cards/holo-stamp";
import {
  layoutProfileLoyaltyRows,
  loyaltyRowLines,
  loyaltyRowPx,
  loyaltyRowsDrawing,
  rowsStampKeepOut,
  type LoyaltyRowsLayout,
} from "@/lib/cards/loyalty-rows";
import { lineHitsKeepOut, rectPx } from "@/lib/cards/rules-layout";
import { M15BORDERLESSPW_HOLO_STAMP, M15PW_COLLECTOR, getFrameProfile } from "@/lib/cards/template-layout";
import { COLLECTOR_TEMPLATES } from "@/lib/cards/collector-line";

// ---------------------------------------------------------------------------
// TODO 4.9d, owner Round 70 (2026-10-16: "Build them next") — the holofoil
// stamp and the collector line on the BORDERLESS PLANESWALKERS
// (m15borderlesspw, m15borderlesspwtall). Held here:
//   • the arch: the walkers' own (24.3 px at the centre, x 666–834), the
//     renderers' copy equal to the build's; the piece's box and keys;
//   • the slot: M15's oval, the arch-shaped keep-out, a triangle draws
//     nothing, drawn ABOVE the ability rows (out of the frame layer);
//   • the collector line: m15pw's slot (the © always on line 2);
//   • the ability rows: no glyph of any row enters the arch at either bake
//     target, no badge near it, no new clip, and every walker whose text
//     clears the arch lays out exactly as without the stamp;
//   • published: the manifest, provenance, and (on disk) each piece is the
//     recipe over its master byte for byte.
// ---------------------------------------------------------------------------

type Entry = { sha256: string; width: number; height: number };
const files = (manifestJson as { files: Record<string, Entry> }).files;
const DIRS = [
  ...(process.env.FRAMES_BUILD_DIR ? [path.resolve(process.env.FRAMES_BUILD_DIR)] : []),
  path.join(process.cwd(), ".frames-build"),
  path.join(process.cwd(), ".frames-cache"),
];
const provenance = JSON.parse(fs.readFileSync("lib/cards/frame-sources.json", "utf8")) as Record<
  string,
  { source: string; converter: string; colors: Record<string, string[]>; sourceFiles: string[]; notes: string[] }
>;
function onDisk(rel: string): Buffer | null {
  if (!files[rel]) return null;
  for (const dir of DIRS) {
    const file = path.join(dir, rel);
    if (!fs.existsSync(file)) continue;
    const bytes = fs.readFileSync(file);
    if (createHash("sha256").update(bytes).digest("hex") === files[rel].sha256) return bytes;
  }
  return null;
}

const WALKERS = ["m15borderlesspw", "m15borderlesspwtall"] as const;
const FOLDER = "m15borderlesspwholostamp";
const facts = (colorKey: string, over: Record<string, unknown> = {}) =>
  ({ colorKey, colors: ["blue"], rarity: "mythic", cost: "{2}{U}{U}", cardType: "planeswalker", supertype: "Legendary", ...over }) as Parameters<typeof resolveHoloStamp>[2];

describe("the borderless walkers' arch (measured 2026-10-16)", () => {
  it("the renderers' lift table is the build's; symmetric, 24.3 px at the centre, nothing past x 666–834", () => {
    expect([...BORDERLESS_WALKER_ARCH_LIFT_PX]).toEqual([...WALKER_ARCH_LIFT_PX]);
    for (let x = 600; x < 900; x += 1) expect(borderlessWalkerArchLiftAt(x)).toBeCloseTo(archLiftAt(x, WALKER_ARCH_LIFT_PX), 10);
    expect(archLiftAt(749, WALKER_ARCH_LIFT_PX)).toBeCloseTo(24.3, 1);
    for (let d = 0; d < 100; d += 1) expect(archLiftAt(749 - d, WALKER_ARCH_LIFT_PX)).toBeCloseTo(archLiftAt(750 + d, WALKER_ARCH_LIFT_PX), 10);
    for (let x = 750; x < 900; x += 1) expect(archLiftAt(x + 1, WALKER_ARCH_LIFT_PX)).toBeLessThanOrEqual(archLiftAt(x, WALKER_ARCH_LIFT_PX) + 1e-9);
    expect(archLiftAt(663, WALKER_ARCH_LIFT_PX)).toBe(0);
    expect(archLiftAt(836, WALKER_ARCH_LIFT_PX)).toBe(0);
    expect(archLiftAt(667, WALKER_ARCH_LIFT_PX)).toBeGreaterThan(0);
    // The spells' arch is untouched (its own default).
    expect(BORDERLESS_ARCH.box).not.toBe(WALKER_ARCH.box);
  });

  it("the slot is the build's box (even HD px), seven keys, M15's oval, the arch-shaped keep-out, drawn above the rows, its own shape only", () => {
    const slot = M15BORDERLESSPW_HOLO_STAMP;
    if (slot.anatomy !== "holoStamp") throw new Error("not a stamp slot");
    const box = WALKER_NOTCH_BOX;
    expect(slot.rect.leftPct).toBeCloseTo((box.x / 1500) * 100, 10);
    expect(slot.rect.topPct).toBeCloseTo((box.y / 2100) * 100, 10);
    expect(slot.rect.widthPct).toBeCloseTo((box.width / 1500) * 100, 10);
    expect(slot.rect.heightPct).toBeCloseTo((box.height / 2100) * 100, 10);
    for (const v of Object.values(box)) expect(v % 2).toBe(0);
    expect(slot.assetPathTemplate).toBe(`/frames/${FOLDER}/{key}.png`);
    expect([...slot.keys].sort()).toEqual(Object.keys(WALKER_STAMP_FOLDERS[FOLDER].keys).sort());
    expect(slot.stamp).toEqual({
      shape: "oval",
      oval: M15_HOLO_STAMP_OVAL,
      keepOut: M15BORDERLESSPW_HOLO_STAMP_KEEP_OUT,
      keepOutShape: M15BORDERLESSPW_HOLO_STAMP_KEEP_OUT_SHAPE,
      ownShapeOnly: true,
      aboveRows: true,
    });
    for (const t of WALKERS) {
      expect(getFrameProfile(t).overlays, t).toEqual([M15BORDERLESSPW_HOLO_STAMP]);
      expect(getFrameProfile(t).collector, t).toEqual(M15PW_COLLECTOR);
      expect(getFrameProfile(t).collector?.markLine, t).toBe(2);
      expect(COLLECTOR_TEMPLATES).toContain(t);
    }
  });

  it("the keep-out: 4 px columns, each from 2 px above the lifted outline (1922 − lift) past the rules box's bottom; their bounds are keepOut", () => {
    const shape = M15BORDERLESSPW_HOLO_STAMP_KEEP_OUT_SHAPE;
    expect(shape.length).toBeGreaterThan(30);
    for (const r of shape) {
      const x0 = Math.round((r.leftPct / 100) * 1500);
      expect(Math.round((r.widthPct / 100) * 1500)).toBe(4);
      let lift = 0;
      for (let x = x0; x < x0 + 4; x += 1) lift = Math.max(lift, archLiftAt(x, WALKER_ARCH_LIFT_PX));
      expect((r.topPct / 100) * 2100).toBeCloseTo(1922 - lift - 2, 6);
      expect(((r.topPct + r.heightPct) / 100) * 2100).toBeCloseTo(1921, 6);
    }
    expect(Math.min(...shape.map((r) => (r.topPct / 100) * 2100))).toBeCloseTo(1895.7, 1);
    expect((M15BORDERLESSPW_HOLO_STAMP_KEEP_OUT.topPct / 100) * 2100).toBeCloseTo(1895.7, 1);
    // Every column is inside the rules box's bottom band (both frames end at
    // 1919.4) and over the arch's span.
    for (const t of WALKERS) {
      const r = getFrameProfile(t).rules.rect;
      expect(((r.topPct + r.heightPct) / 100) * 2100).toBeCloseTo(1919.4, 6);
    }
  });
});

describe("what draws (resolveHoloStamp) and where", () => {
  it("auto on a rare or mythic draws the colour's piece on both frames; a common draws none; a triangle draws nothing and saves as none", () => {
    for (const t of WALKERS) {
      for (const k of ["w", "u", "b", "r", "g", "m", "c"]) {
        expect(resolveHoloStamp(getFrameProfile(t), { stamp: "auto" }, facts(k))?.notch.path, `${t}/${k}`).toBe(`/frames/${FOLDER}/${k}.png`);
      }
      expect(resolveHoloStamp(getFrameProfile(t), { stamp: "auto" }, facts("u", { rarity: "common" })), t).toBeNull();
      expect(resolveHoloStamp(getFrameProfile(t), { stamp: "oval" }, facts("u", { rarity: "common" })), t).not.toBeNull();
      expect(resolveHoloStamp(getFrameProfile(t), { stamp: "triangle" }, facts("u")), t).toBeNull();
      expect(stampForTemplate("triangle", t), t).toBe("none");
      expect(normalizeAnatomy({ template: t, stamp: "triangle" }, t, "planeswalker"), t).toEqual({ template: t, stamp: "none" });
      // A stored card on the frame (no key) draws nothing.
      expect(resolveHoloStamp(getFrameProfile(t), {}, facts("u")), t).toBeNull();
    }
  });

  it("the notch leaves the frame layer (drawn above the rows); every other frame's overlays are the same array", () => {
    for (const t of WALKERS) {
      const profile = getFrameProfile(t);
      const stamp = resolveHoloStamp(profile, { stamp: "auto" }, facts("g"));
      expect(stamp?.aboveRows, t).toBe(true);
      const all = resolveFrameOverlays(profile, { stamp: "auto" }, facts("g"));
      expect(all.map((o) => o.anatomy)).toEqual(["holoStamp"]);
      expect(frameLayerOverlays(all, stamp)).toEqual([]);
      expect(rowsStampKeepOut(stamp)).toBe(M15BORDERLESSPW_HOLO_STAMP_KEEP_OUT_SHAPE);
    }
    for (const t of ["m15pw", "m15borderless", "m15"]) {
      const profile = getFrameProfile(t);
      const stamp = resolveHoloStamp(profile, { stamp: "auto" }, facts("g", { cardType: t === "m15pw" ? "planeswalker" : "creature" }));
      expect(stamp, t).not.toBeNull();
      expect(stamp?.aboveRows, t).toBeUndefined();
      const all = resolveFrameOverlays(profile, { stamp: "auto" }, facts("g", { cardType: t === "m15pw" ? "planeswalker" : "creature" }));
      expect(frameLayerOverlays(all, stamp), t).toBe(all);
      // m15pw's rows keep their shield rule alone (4.9c).
      expect(rowsStampKeepOut(stamp), t).toBeNull();
    }
  });
});

describe("the ability rows hold against the arch", () => {
  const SWEEP =
    "You get an emblem with whenever you cast a spell copy it you may choose new targets for the copy and creatures you control get plus two plus two and gain flying vigilance and trample until end of turn then draw a card for each card in your hand and each opponent mills that many cards and loses that much life".split(" ");
  const lastAbility = (n: number) => `${Array.from({ length: n }, (_, i) => SWEEP[i % SWEEP.length]).join(" ")}.`;
  const abilitiesFor = (t: string, n: number): LoyaltyAbility[] => [
    ...(t === "m15borderlesspwtall" ? [{ cost: null, text: "Creatures you control have ward 1." }] : []),
    { cost: "+1", text: "Scry 2." },
    { cost: "−3", text: "Return target creature card from your graveyard to your hand." },
    { cost: "−8", text: lastAbility(n) },
  ];
  const ASPECT = 2100 / 1500;
  const arch = M15BORDERLESSPW_HOLO_STAMP_KEEP_OUT_SHAPE;

  /** Whether any glyph of any row, where the row puts it at `target`,
   *  enters a column of the arch. */
  const entersArch = (rows: LoyaltyRowsLayout, target: "hd" | "default") => {
    const ks = arch.map((k) => rectPx(k, "portrait", ASPECT, target));
    return rows.text.some((layout, i) => {
      const placed = loyaltyRowLines(rows, i, target);
      return placed.lines.some((l) => ks.some((k) => lineHitsKeepOut(l, layout.blocks[l.block].lines[l.line], placed.metrics, k)));
    });
  };

  it("the sweep (a last ability of 1 … 70 words): no glyph in the arch at either target, no new clip; a text clear of it lays out exactly as without the stamp", () => {
    const summary: Record<string, { lifted: number[]; stepped: number[] }> = {};
    for (const t of WALKERS) {
      const profile = getFrameProfile(t);
      const lifted: number[] = [];
      const stepped: number[] = [];
      for (let n = 1; n <= 70; n += 1) {
        const abilities = abilitiesFor(t, n);
        const plain = layoutProfileLoyaltyRows(profile, abilities, ASPECT);
        const stamped = layoutProfileLoyaltyRows(profile, abilities, ASPECT, arch);
        if (plain.clipped) continue;
        expect(stamped.clipped, `${t} · ${n} words`).toBe(false);
        expect(entersArch(stamped, "hd"), `${t} · ${n} words (HD)`).toBe(false);
        expect(entersArch(stamped, "default"), `${t} · ${n} words (750)`).toBe(false);
        if (!entersArch(plain, "hd") && !entersArch(plain, "default")) {
          expect(stamped, `${t} · ${n} words`).toEqual(plain);
        }
        if (stamped.lastRowLiftHd) lifted.push(n);
        if (stamped.sizePx < plain.sizePx) stepped.push(n);
        // The lift is even (the 750 bake's half is whole) and drawn as such.
        if (stamped.lastRowLiftHd) {
          expect(stamped.lastRowLiftHd % 2).toBe(0);
          expect(loyaltyRowsDrawing(stamped, "default").lastRowLift).toBe(stamped.lastRowLiftHd / 2);
        }
      }
      summary[t] = { lifted, stepped };
    }
    // Held up over the arch where the last ability reaches it at its size;
    // a step down only where held up it no longer fits (the regular frame's
    // last row is short: 10 of 70; the tall one's 9).
    expect(summary).toEqual({
      m15borderlesspw: { lifted: [56, 57, 58, 66, 67, 68, 69, 70], stepped: [37, 38, 51, 52, 53, 54, 63, 64, 65, 66] },
      m15borderlesspwtall: { lifted: [37, 38, 48, 49, 50, 60, 61, 62, 63, 64], stepped: [45, 46, 47, 48, 57, 58, 59, 60, 61] },
    });
  });

  it("no badge comes near the arch (the rail ends far left of it)", () => {
    for (const t of WALKERS) {
      const r = getFrameProfile(t).rules.rect;
      const a = loyaltyRowPx("hd");
      const badgeRight = (r.leftPct / 100) * 1500 + a.padX + a.badgeWidth;
      const archLeft = Math.min(...arch.map((k) => (k.leftPct / 100) * 1500));
      expect(badgeRight, t).toBeLessThan(archLeft - 300);
      // …nor the starting-loyalty shield (it starts right of the arch).
      const shield = getFrameProfile(t).loyalty!.plateRect ?? getFrameProfile(t).loyalty!.rect;
      expect((shield.leftPct / 100) * 1500, t).toBeGreaterThan(Math.max(...arch.map((k) => ((k.leftPct + k.widthPct) / 100) * 1500)) + 300);
    }
  });

  it("without the stamp the rows are byte-for-byte what they were (the parameter defaults to none)", () => {
    for (const t of WALKERS) {
      const abilities = abilitiesFor(t, 40);
      expect(layoutProfileLoyaltyRows(getFrameProfile(t), abilities, ASPECT, null)).toEqual(layoutProfileLoyaltyRows(getFrameProfile(t), abilities, ASPECT));
      expect(layoutProfileLoyaltyRows(getFrameProfile(t), abilities, ASPECT).lastRowLiftHd).toBeUndefined();
    }
  });
});

describe("the recipe over a synthetic walker master", () => {
  it("the outline, the rim and the black lifted; the see-through window above untouched; both feet clear", () => {
    const W = 1500;
    const m = Buffer.alloc(W * 2100 * 4);
    const put = (x: number, y: number, p: number[]) => m.set(p, (y * W + x) * 4);
    for (let x = 600; x < 900; x += 1) {
      for (let y = 1922; y < 1926; y += 1) put(x, y, [0, 0, 0, 255]);
      for (let y = 1926; y < WALKER_BLACK_BAR_TOP; y += 1) put(x, y, [0, 123, 67, 255]);
      for (let y = WALKER_BLACK_BAR_TOP; y < 2000; y += 1) put(x, y, [0, 0, 0, 255]);
    }
    expect(pinlineTop(m, W, 750, WALKER_ARCH)).toBe(1922);
    const { piece, outside } = buildBorderlessNotch(m, W, WALKER_ARCH);
    expect(outside).toBe(0);
    const box = WALKER_NOTCH_BOX;
    const at = (x: number, y: number) => [...piece.subarray(((y - box.y) * box.width + (x - box.x)) * 4, ((y - box.y) * box.width + (x - box.x)) * 4 + 4)];
    for (let y = box.y; y < box.y + box.height; y += 1) {
      expect(at(box.x, y)[3]).toBe(0);
      expect(at(box.x + box.width - 1, y)[3]).toBe(0);
    }
    // The centre column: the window above (clear), the outline from 1897.7,
    // the rim moved up 24.3 rows, then black.
    expect(at(750, 1896)[3]).toBe(0);
    expect(at(750, 1899)).toEqual([0, 0, 0, 255]);
    expect(at(750, 1905)).toEqual([0, 123, 67, 255]);
    expect(at(750, 1920)).toEqual([0, 0, 0, 255]);
    expect(at(750, 1936)).toEqual([0, 0, 0, 255]);
    expect(liftError(m, W, piece, undefined, WALKER_ARCH).worst).toBeLessThanOrEqual(1);
  });
});

describe("published to the frames bucket (dev; promoted by the owner)", () => {
  const keys = Object.keys(WALKER_STAMP_FOLDERS[FOLDER].keys);

  it("lists every key, PNG and WebP, at 180 × 42", () => {
    for (const key of keys) {
      for (const ext of ["png", "webp"]) {
        const entry = files[`${FOLDER}/${key}.${ext}`];
        expect(entry, `${FOLDER}/${key}.${ext}`).toBeDefined();
        expect([entry.width, entry.height]).toEqual([WALKER_NOTCH_BOX.width, WALKER_NOTCH_BOX.height]);
      }
    }
    expect(Object.keys(files).filter((k) => k.startsWith(`${FOLDER}/`))).toHaveLength(14);
  });

  it("provenance: PipGlyph's own build, every key's master named (the tall twin's too), no Card Conjurer piece", () => {
    const p = provenance[FOLDER];
    expect(p.source).toBe("pipglyph");
    expect(p.converter).toBe("scripts/build-borderless-stamp.mjs");
    expect(Object.keys(p.colors).sort()).toEqual([...keys].sort());
    for (const [key, rel] of Object.entries(WALKER_STAMP_FOLDERS[FOLDER].keys)) {
      expect(p.colors[key][0]).toContain(`${rel}.png (published, sha256 ${files[`${rel}.png`].sha256.slice(0, 12)})`);
      expect(p.colors[key].join(" ")).toContain(`m15borderlesspwtall/${key}.png`);
    }
    expect(p.sourceFiles.every((f) => /^m15borderlesspw(tall)?\/[a-z]\.png$/.test(f))).toBe(true);
    expect(p.notes.join(" ")).toMatch(/no CC piece and no scan/);
  });

  const pieces = Object.entries(WALKER_STAMP_FOLDERS[FOLDER].keys).map(([key, rel]) => [key, rel] as const);
  const available = pieces.every(([key, rel]) => onDisk(`${FOLDER}/${key}.png`) && onDisk(`${rel}.png`));

  describe.skipIf(!available)("the published pieces (set FRAMES_BUILD_DIR if skipped)", () => {
    it.each(pieces)("%s is the recipe over %s, byte for byte (its WebP's alpha the PNG's where on disk); the tall master within the recipe there", async (key, rel) => {
      const master = await sharp(onDisk(`${rel}.png`)!).ensureAlpha().raw().toBuffer({ resolveWithObject: true });
      const { piece } = buildBorderlessNotch(master.data, master.info.width, WALKER_ARCH);
      const png = await sharp(onDisk(`${FOLDER}/${key}.png`)!).ensureAlpha().raw().toBuffer({ resolveWithObject: true });
      expect([png.info.width, png.info.height]).toEqual([WALKER_NOTCH_BOX.width, WALKER_NOTCH_BOX.height]);
      expect(Buffer.compare(png.data, piece)).toBe(0);
      const webpBytes = onDisk(`${FOLDER}/${key}.webp`);
      if (webpBytes) {
        const webp = await sharp(webpBytes).ensureAlpha().raw().toBuffer({ resolveWithObject: true });
        for (let i = 3; i < png.data.length; i += 4) {
          if (webp.data[i] !== png.data[i]) throw new Error(`${FOLDER}/${key}.webp alpha differs at byte ${i}`);
        }
      }
      expect(liftError(master.data, master.info.width, png.data, undefined, WALKER_ARCH).worst).toBeLessThanOrEqual(5);
      const tall = onDisk(`m15borderlesspwtall/${key}.png`);
      if (tall) {
        const t = await sharp(tall).ensureAlpha().raw().toBuffer({ resolveWithObject: true });
        // The tall twin draws the same piece: over ITS master it lands within
        // the recipe's tolerance of the tall master lifted.
        expect(liftError(t.data, t.info.width, png.data, undefined, WALKER_ARCH).worst).toBeLessThanOrEqual(5);
      }
    });
  });
});
