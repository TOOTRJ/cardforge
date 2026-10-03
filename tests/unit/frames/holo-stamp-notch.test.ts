import { createHash } from "node:crypto";
import fs from "node:fs";
import path from "node:path";
import sharp from "sharp";
import { describe, expect, it } from "vitest";
import manifestJson from "@/lib/frames/frame-manifest.json";
import {
  CC_COMMIT,
  HOLO_STAMP_NOTCHES,
  NOTCH_FOOT,
  buildNotch,
  columnTintGap,
  cutEllipse,
  cutOval,
  describeNotch,
  footColumns,
  footRunsSolid,
  isColumnTint,
  notchFindings,
  notchSourceFiles,
  sampleBar,
  sampleBarColumns,
  tintAt,
} from "@/scripts/lib/cc-frames.mjs";
import { PAIR_RAMPS, rampShare } from "@/scripts/lib/pair-ramp.mjs";
import { TWO_COLOR_PAIRS } from "@/lib/cards/frame-reference-registry";
import { HOLO_STAMP_CUT_MARGIN_PX, M15PW_HOLO_STAMP_OVAL, M15_HOLO_STAMP_OVAL } from "@/lib/cards/holo-stamp";
import { M15PW_HOLO_STAMP, M15_HOLO_STAMP, getFrameProfile } from "@/lib/cards/template-layout";
import { FRAME_TEMPLATE_VALUES } from "@/types/card";

// ---------------------------------------------------------------------------
// TODO 4.9c — the holofoil stamp's notch pieces (scripts/lib/cc-frames.mjs
// HOLO_STAMP_NOTCHES, built by scripts/import-cc-frames.mjs `--only
// m15holostamp,m15pwholostamp`): Card Conjurer's arch as ONE piece's
// geometry per pack (its U — the flat saturated rim decomposes exactly into
// bevel, rim and black), the rim tinted to OUR master's bar, and the oval
// region cut to transparent — CC's pieces hold a capture of WotC's hologram
// there, which never reaches the bucket (owner 2026-09-29). Held here:
//   • the recipe's keys and bounds are the profile slots' (keys, rect,
//     oval) — a key the slot publishes is one the importer builds;
//   • the decomposition and the cut on a synthetic piece, and the findings
//     that refuse a piece whose cut is not clear;
//   • the manifest lists every key, PNG and WebP, at the piece's size;
//   • provenance records the pinned commit, the ONE source piece per pack
//     (never the per-key CC pieces) and the cut;
//   • when the published objects are on disk at the manifest's sha256
//     (FRAMES_BUILD_DIR, else .frames-build; CI fetches them): every one is
//     clear inside the cut, black around it, and its rim foot IS the bar of
//     the master it tints from (the join without a seam);
//   • the ten PAIR keys (the 4.9c follow-up, owner round 26, 2026-10-03):
//     the rim tinted PER COLUMN to the pair master's bar — the pinline's
//     40→60 %W ramp, which the notch sits inside — so the foot is the bar
//     at every column of BOTH feet; one piece per pair serves every pair
//     master with the notch (the m15 split and hybrid, m15artifact,
//     m15land, m15snow and m15snowland masters hold the same bar under it,
//     checked here on the real masters and by the importer), and the keys
//     are the slot's.
// ---------------------------------------------------------------------------

type Entry = { sha256: string; width: number; height: number };
const files = (manifestJson as { files: Record<string, Entry> }).files;
const BUILD = process.env.FRAMES_BUILD_DIR ? path.resolve(process.env.FRAMES_BUILD_DIR) : path.join(process.cwd(), ".frames-build");
const provenance = JSON.parse(fs.readFileSync("lib/cards/frame-sources.json", "utf8")) as Record<
  string,
  { commit: string; kind?: string; colors: Record<string, string[]>; sourceFiles: string[]; cut?: { oval: unknown; marginPx: number }; notes: string[] }
>;

function onDisk(rel: string): Buffer | null {
  const file = path.join(BUILD, rel);
  if (!files[rel] || !fs.existsSync(file)) return null;
  const bytes = fs.readFileSync(file);
  return createHash("sha256").update(bytes).digest("hex") === files[rel].sha256 ? bytes : null;
}

/** A folder's recipe as the importer reads it (the pair fields are the
 *  M15 folder's alone). */
type NotchDef = (typeof HOLO_STAMP_NOTCHES)[keyof typeof HOLO_STAMP_NOTCHES] & {
  rampKeys?: readonly string[];
  barSharedBy?: Record<string, string[]>;
};
const M15: NotchDef = HOLO_STAMP_NOTCHES.m15holostamp;
const PW: NotchDef = HOLO_STAMP_NOTCHES.m15pwholostamp;
const PINLINE_RAMP = [...PAIR_RAMPS.pinline] as [number, number];

describe("the recipe is the profile's slot", () => {
  it("m15holostamp: CC's U piece at the M15_HOLO_STAMP rect, the slot's keys and oval; the walker likewise", () => {
    expect(M15.shape.src).toBe("img/frames/m15/holoStamps/m15HoloStampU.png");
    expect(M15.shape.size).toEqual({ width: 192, height: 96 });
    expect(M15.shape.bounds).toEqual(M15_HOLO_STAMP.rect);
    expect([...M15.keys]).toEqual([...M15_HOLO_STAMP.keys]);
    expect(M15.oval).toEqual(M15_HOLO_STAMP_OVAL);
    expect(M15.cutMarginPx).toBe(HOLO_STAMP_CUT_MARGIN_PX);
    expect(M15_HOLO_STAMP.assetPathTemplate).toBe("/frames/m15holostamp/{key}.png");
    expect(PW.shape.src).toBe("img/frames/planeswalker/holo/u.png");
    expect(PW.shape.size).toEqual({ width: 182, height: 107 });
    expect(PW.shape.bounds).toEqual(M15PW_HOLO_STAMP.rect);
    expect([...PW.keys]).toEqual([...M15PW_HOLO_STAMP.keys]);
    expect(PW.oval).toEqual(M15PW_HOLO_STAMP_OVAL);
    expect(M15PW_HOLO_STAMP.assetPathTemplate).toBe("/frames/m15pwholostamp/{key}.png");
    // The slot sits 2 px below CC's bounds (the foot on our 12-row bar).
    expect(M15_HOLO_STAMP.rect.topPct).toBeCloseTo(90.34 + (2 / 2100) * 100, 9);
    expect(M15PW_HOLO_STAMP.rect.topPct).toBe(90.15);
    // Every key tints from a master that exists in the recipe: a bar key
    // from one mono master, a pair key from m15's gold-split pair master —
    // per column, shared with the hybrid, artifact and land pair masters.
    expect([...M15.keys]).toEqual(["w", "u", "b", "r", "g", "m", "a", "l", "c", ...TWO_COLOR_PAIRS]);
    expect([...(M15.rampKeys ?? [])]).toEqual([...TWO_COLOR_PAIRS]);
    for (const key of M15.keys) {
      if ((TWO_COLOR_PAIRS as readonly string[]).includes(key)) {
        expect((M15.barOf as Record<string, string>)[key], key).toBe(`m15/${key}`);
        expect(M15.barSharedBy?.[key], key).toEqual([`m15/${key}-h`, `m15artifact/${key}`, `m15land/${key}`, `m15snow/${key}`, `m15snowland/${key}`]);
      } else {
        expect((M15.barOf as Record<string, string>)[key], key).toMatch(/^m15(artifact|land)?\/[a-z]$/);
      }
    }
    for (const key of PW.keys) expect((PW.barOf as Record<string, string>)[key], key).toBe(`m15pw/${key}`);
    expect(PW.rampKeys).toBeUndefined();
    // Every template with pair masters AND the notch draws its pairs on
    // this slot's keys — a template whose pair bar is not m15's would need
    // its own key (the shared-bar check below and in the importer).
    for (const template of FRAME_TEMPLATE_VALUES) {
      const profile = getFrameProfile(template);
      const slot = profile.overlays?.find((s) => s.anatomy === "holoStamp");
      if (!slot || !(profile.twoColorMasters ?? []).length) continue;
      for (const pair of TWO_COLOR_PAIRS) expect(slot.keyMap?.[pair] ?? pair, `${template} ${pair}`).toBe(pair);
      expect(slot.keys).toEqual(expect.arrayContaining([...TWO_COLOR_PAIRS]));
    }
    // …and every pair master such a template paints is the pair's sampled
    // master or in barSharedBy, so the importer checks its bar under the
    // notch against the sampled one: a template that gains pairs with the
    // notch declared (4.6f wave 2c's snow pairs) fails here until it is
    // listed and the importer has re-checked it.
    for (const template of FRAME_TEMPLATE_VALUES) {
      const profile = getFrameProfile(template);
      const slot = profile.overlays?.find((s) => s.anatomy === "holoStamp");
      if (!slot || slot.assetPathTemplate !== M15_HOLO_STAMP.assetPathTemplate) continue;
      for (const dress of profile.twoColorMasters ?? []) {
        for (const pair of TWO_COLOR_PAIRS) {
          const rel = `${template}/${dress === "hybrid" ? `${pair}-h` : pair}`;
          const key = slot.keyMap?.[pair] ?? pair;
          const named = rel === (M15.barOf as Record<string, string>)[key] || (M15.barSharedBy?.[key] ?? []).includes(rel);
          expect(named, `${rel} paints the ${key} notch: name it in HOLO_STAMP_NOTCHES.m15holostamp.barSharedBy and rebuild`).toBe(true);
        }
      }
    }
    // The foot runs are on the bar's row, inside the ramp on each side.
    expect(NOTCH_FOOT.m15holostamp).toEqual({ y: 44, runs: [[4, 12], [180, 188]] });
    expect(footColumns(NOTCH_FOOT.m15holostamp)).toHaveLength(18);
    expect(footColumns({ x: 8, y: 44 })).toEqual([8]);
    // Every entry's keyMap points at a published key.
    for (const template of ["m15", "m15land", "m15snowland", "m15artifact", "m15snow", "m15devoid", "m15pw"]) {
      const slot = getFrameProfile(template).overlays?.find((s) => s.anatomy === "holoStamp");
      expect(slot, template).toBeDefined();
      for (const to of Object.values(slot!.keyMap ?? {})) expect(slot!.keys, `${template} → ${to}`).toContain(to);
    }
    expect(notchSourceFiles(M15)).toEqual([M15.shape.src]);
  });

  it("the cut ellipse is the slot's oval plus the margin, in the piece's own pixels", () => {
    const e = cutEllipse(M15.shape, M15.oval, M15.cutMarginPx);
    // The oval's centre (750.15, 1959.7) less the piece's origin (654, 1899).
    expect(e.cx).toBeCloseTo(96.15, 6);
    expect(e.cy).toBeCloseTo(60.72, 6);
    expect(e.rx).toBeCloseTo(67.05 + 2, 6);
    expect(e.ry).toBeCloseTo(33.6 + 2, 6);
    const w = cutEllipse(PW.shape, PW.oval, PW.cutMarginPx);
    expect(w.cx).toBeCloseTo(91.15, 6);
    expect(w.cy).toBeCloseTo(59.72, 6);
  });
});

/** A synthetic U-like piece: a white translucent bevel row, a blue rim
 *  band, black below, and a "hologram" (grey) inside the oval. */
function syntheticPiece(def: typeof M15) {
  const { width, height } = def.shape.size;
  const buf = Buffer.alloc(width * height * 4);
  const e = cutEllipse(def.shape, def.oval, 0);
  for (let y = 0; y < height; y += 1) {
    for (let x = 0; x < width; x += 1) {
      const o = (y * width + x) * 4;
      const dx = (x + 0.5 - e.cx) / e.rx;
      const dy = (y + 0.5 - e.cy) / e.ry;
      if (dx * dx + dy * dy <= 1) buf.set([150, 160, 150, 255], o); // the hologram
      else if (y < 4) buf.set([255, 255, 255, 120], o); // the bevel
      else if (y < 16) buf.set([0, 117, 190, 255], o); // the rim
      else buf.set([0, 0, 0, 255], o);
    }
  }
  return buf;
}

describe("the decomposition and the cut", () => {
  it("tints the rim, keeps the bevel and the black, clears the oval, and keeps the alpha", () => {
    const piece = syntheticPiece(M15);
    const tint = [244, 243, 236];
    const out = buildNotch(M15.shape, piece, tint, M15.oval, M15.cutMarginPx);
    const px = (x: number, y: number) => [...out.subarray((y * 192 + x) * 4, (y * 192 + x) * 4 + 4)];
    expect(px(8, 2)).toEqual([255, 255, 255, 120]); // the bevel as it was
    expect(px(8, 8)).toEqual([244, 243, 236, 255]); // the rim in the tint
    expect(px(8, 40)).toEqual([0, 0, 0, 255]); // the black
    expect(px(96, 61)).toEqual([0, 0, 0, 0]); // inside the oval: cleared
    const f = notchFindings(out, M15.shape, piece, tint, M15.oval, M15.cutMarginPx, { x: 8, y: 8 });
    expect(f.failures).toEqual([]);
    expect(f).toMatchObject({ cutClear: true, ringBlack: true, footOk: true, alphaKept: true });
    // A half-covered rim pixel decomposes to half the tint (an AA edge).
    const edge = Buffer.from(piece);
    edge.set([0, 58, 95, 255], (8 * 192 + 20) * 4);
    const soft = buildNotch(M15.shape, edge, tint, M15.oval, M15.cutMarginPx);
    expect([...soft.subarray((8 * 192 + 20) * 4, (8 * 192 + 20) * 4 + 3)]).toEqual([122, 122, 118]);
  });

  it("refuses a piece whose cut is not clear, whose ring holds a hologram pixel, or whose foot is not the tint", () => {
    const piece = syntheticPiece(M15);
    const tint = [0, 117, 190];
    const out = buildNotch(M15.shape, piece, tint, M15.oval, M15.cutMarginPx);
    const dirty = Buffer.from(out);
    dirty.set([150, 160, 150, 255], (60 * 192 + 96) * 4);
    expect(notchFindings(dirty, M15.shape, piece, tint, M15.oval, M15.cutMarginPx, { x: 8, y: 8 }).cutClear).toBe(false);
    const ring = Buffer.from(out);
    // Just outside the cut, at the oval's top: a leftover silver pixel.
    const e = cutEllipse(M15.shape, M15.oval, M15.cutMarginPx);
    ring.set([200, 200, 200, 255], (Math.round(e.cy - e.ry - 1.5) * 192 + Math.round(e.cx)) * 4);
    expect(notchFindings(ring, M15.shape, piece, tint, M15.oval, M15.cutMarginPx, { x: 8, y: 8 }).ringBlack).toBe(false);
    expect(notchFindings(out, M15.shape, piece, [1, 2, 3], M15.oval, M15.cutMarginPx, { x: 8, y: 8 }).footOk).toBe(false);
    // cutOval alone clears the ellipse of any buffer.
    const again = Buffer.from(piece);
    cutOval(again, M15.shape, M15.oval, M15.cutMarginPx);
    expect([...again.subarray((60 * 192 + 96) * 4, (60 * 192 + 96) * 4 + 4)]).toEqual([0, 0, 0, 0]);
  });

  it("sampleBar reads a flat bar and refuses a translucent or uneven one", () => {
    const W = 1500;
    const H = 2100;
    const master = Buffer.alloc(W * H * 4);
    for (let y = 1930; y < 1950; y += 1) master.set([42, 108, 69, 255], (y * W + 750) * 4);
    expect(sampleBar(master, W, M15.barSample)).toEqual([42, 108, 69]);
    master.set([42, 108, 69, 180], (1941 * W + 750) * 4);
    expect(() => sampleBar(master, W, M15.barSample)).toThrow(/not opaque/);
    master.set([42, 108, 69, 255], (1941 * W + 750) * 4);
    master.set([60, 108, 69, 255], (1942 * W + 750) * 4);
    expect(() => sampleBar(master, W, M15.barSample)).toThrow(/not flat/);
  });

  it("describes a key's recipe for provenance", () => {
    expect(describeNotch(M15, "w", [244, 243, 236])).toEqual([
      `${M15.shape.src} (the arch's geometry: bevel, rim and black) at 43.6/${M15.shape.bounds.topPct}/12.8×4.58 %`,
      "rim tinted to m15/w.png's bar (244,243,236) sampled at x 750, rows 1940–1947",
      "the oval 45.54/91.72/8.94×3.2 % plus 2 px cut to transparent",
    ]);
    // A pair key names the ramp across the piece and the masters that share it.
    const columns = Array.from({ length: 192 }, (_, i) => [i, 100, 200 - i]);
    expect(describeNotch(M15, "wu", columns)[1]).toBe(
      "rim tinted per column to m15/wu.png's bar across x 654–845 (rows 1940–1947; 0,100,200 at x 654 → 96,100,104 at x 750 → 191,100,9 at x 845 — the pinline's procedural:ramp(40→60 %W)), the same bar on m15/wu-h.png, m15artifact/wu.png, m15land/wu.png, m15snow/wu.png, m15snowland/wu.png",
    );
  });

  it("a per-column tint (a pair): each rim pixel takes its own column's colour, the foot is checked at every column of both feet", () => {
    const piece = syntheticPiece(M15);
    // A ramp like a pair's bar: the first colour on the left, the second on the right.
    const left = [244, 243, 236];
    const right = [0, 117, 190];
    const columns = Array.from({ length: 192 }, (_, i) => {
      const t = rampShare(((654 + i + 0.5) / 1500) * 100, PINLINE_RAMP);
      return [0, 1, 2].map((c) => Math.round(left[c] * (1 - t) + right[c] * t));
    });
    expect(isColumnTint(columns)).toBe(true);
    expect(isColumnTint(left)).toBe(false);
    expect(tintAt(columns, 5)).toEqual(columns[5]);
    expect(tintAt(left, 5)).toBe(left);
    const out = buildNotch(M15.shape, piece, columns, M15.oval, M15.cutMarginPx);
    const px = (x: number, y: number) => [...out.subarray((y * 192 + x) * 4, (y * 192 + x) * 4 + 4)];
    expect(px(8, 8)).toEqual([...columns[8], 255]); // the rim: its column's colour
    expect(px(180, 8)).toEqual([...columns[180], 255]); // the other foot's side of the ramp
    expect(px(8, 8).slice(0, 3)).not.toEqual(px(180, 8).slice(0, 3));
    expect(px(8, 2)).toEqual([255, 255, 255, 120]); // the bevel as it was
    expect(px(8, 40)).toEqual([0, 0, 0, 255]); // the black
    expect(px(96, 61)).toEqual([0, 0, 0, 0]); // inside the oval: cleared
    // The foot at every column of the synthetic rim band (rows 4–15 are rim
    // across the width): the tint of that column.
    const foot = { y: 8, runs: [[4, 12], [180, 188]] as const };
    expect(notchFindings(out, M15.shape, piece, columns, M15.oval, M15.cutMarginPx, foot).failures).toEqual([]);
    // One column off — the right foot tinted with the left's colour — is refused, naming the column.
    const flat = buildNotch(M15.shape, piece, left, M15.oval, M15.cutMarginPx);
    const f = notchFindings(flat, M15.shape, piece, columns, M15.oval, M15.cutMarginPx, foot);
    expect(f.footOk).toBe(false);
    expect(f.failures.join(" ")).toMatch(/foot at \(\d+, 8\)/);
    // A per-column tint of the wrong width is refused.
    expect(() => buildNotch(M15.shape, piece, columns.slice(1), M15.oval, M15.cutMarginPx)).toThrow(/192 columns/);
    // The foot runs must be solid rim in the source piece.
    expect(footRunsSolid(M15.shape, piece, foot)).toEqual([]);
    expect(footRunsSolid(M15.shape, piece, { y: 40, runs: [[4, 5]] })).toEqual([4, 5]);
    // sampleBarColumns reads the bar at every column of the piece's bounds.
    const W = 1500;
    const H = 2100;
    const master = Buffer.alloc(W * H * 4);
    for (let y = 1930; y < 1950; y += 1) for (let x = 0; x < W; x += 1) master.set([x % 256, 10, 20, 255], (y * W + x) * 4);
    const sampled = sampleBarColumns(master, W, M15.barSample, M15.shape);
    expect(sampled).toHaveLength(192);
    expect(sampled[0]).toEqual([654 % 256, 10, 20]);
    expect(sampled[191]).toEqual([845 % 256, 10, 20]);
    expect(columnTintGap(sampled, sampled)).toEqual({ max: 0, at: null });
    const other = sampled.map((c, i) => (i === 100 ? [c[0] + 3, c[1], c[2]] : c));
    expect(columnTintGap(sampled, other)).toEqual({ max: 3, at: 100 });
  });
});

describe("published to the frames bucket", () => {
  it("lists every key, PNG and WebP, at the piece's size", () => {
    for (const [folder, def] of Object.entries(HOLO_STAMP_NOTCHES)) {
      for (const key of def.keys) {
        for (const ext of ["png", "webp"]) {
          const entry = files[`${folder}/${key}.${ext}`];
          expect(entry, `${folder}/${key}.${ext}`).toBeDefined();
          expect([entry.width, entry.height], `${folder}/${key}.${ext}`).toEqual([def.shape.size.width, def.shape.size.height]);
        }
      }
    }
    // 9 bar keys + 10 pair keys, and the walker's 7, PNG and WebP: 52 objects.
    expect(Object.keys(files).filter((k) => /^m15(pw)?holostamp\//.test(k))).toHaveLength(52);
  });

  it("provenance records the pinned commit, the one source piece per pack, the tint per key and the cut — never the per-key CC pieces", () => {
    for (const [folder, def] of Object.entries(HOLO_STAMP_NOTCHES) as [string, NotchDef][]) {
      const p = provenance[folder];
      expect(p, folder).toBeDefined();
      expect(p.commit).toBe(CC_COMMIT);
      expect(p.kind).toBe("overlay");
      expect(p.sourceFiles).toEqual([def.shape.src]);
      expect(Object.keys(p.colors).sort()).toEqual([...def.keys].sort());
      for (const key of def.keys) {
        expect(p.colors[key][0], `${folder}/${key}`).toContain(def.shape.src);
        const barOf = (def.barOf as Record<string, string>)[key];
        if (def.rampKeys?.includes(key)) {
          expect(p.colors[key][1], `${folder}/${key}`).toMatch(new RegExp(`^rim tinted per column to ${barOf}\\.png's bar across x 654–845 \\(rows 1940–1947; \\d+,\\d+,\\d+ at x 654 → \\d+,\\d+,\\d+ at x 750 → \\d+,\\d+,\\d+ at x 845 — the pinline's procedural:ramp\\(40→60 %W\\)\\), the same bar on m15/${key}-h\\.png, m15artifact/${key}\\.png, m15land/${key}\\.png, m15snow/${key}\\.png, m15snowland/${key}\\.png$`));
        } else {
          expect(p.colors[key][1], `${folder}/${key}`).toMatch(new RegExp(`rim tinted to ${barOf}\\.png's bar \\(\\d+,\\d+,\\d+\\)`));
        }
        expect(p.colors[key][2], `${folder}/${key}`).toContain("cut to transparent");
      }
      expect(p.cut).toEqual({ oval: def.oval, marginPx: def.cutMarginPx, what: expect.stringContaining("hologram") });
      expect(p.notes.join(" ")).toMatch(/hologram/);
    }
    // No CC holo piece but the two U shapes is read.
    const all = Object.values(provenance).flatMap((p) => p.sourceFiles ?? []);
    expect(all.filter((f) => /holo/i.test(f)).sort()).toEqual([M15.shape.src, PW.shape.src]);
  });

  const published = Object.entries(HOLO_STAMP_NOTCHES).flatMap(([folder, def]) => def.keys.map((key) => [folder, key, onDisk(`${folder}/${key}.png`)] as const));
  const masters = (Object.values(HOLO_STAMP_NOTCHES) as NotchDef[]).flatMap((def) =>
    [...Object.values(def.barOf as Record<string, string>), ...Object.values(def.barSharedBy ?? {}).flat()].map(
      (rel) => [rel, onDisk(`${rel}.png`)] as const,
    ),
  );
  const available = published.every(([, , b]) => b !== null) && masters.every(([, b]) => b !== null);

  describe.skipIf(!available)("the published pieces (set FRAMES_BUILD_DIR if skipped)", () => {
    it.each(published.map(([folder, key]) => [folder, key] as const))("%s/%s: clear inside the cut, black around it, its foot the master's bar", async (folder, key) => {
      const def: NotchDef = HOLO_STAMP_NOTCHES[folder as keyof typeof HOLO_STAMP_NOTCHES];
      const bytes = onDisk(`${folder}/${key}.png`)!;
      const { data, info } = await sharp(bytes).ensureAlpha().raw().toBuffer({ resolveWithObject: true });
      expect([info.width, info.height]).toEqual([def.shape.size.width, def.shape.size.height]);
      const master = await sharp(onDisk(`${(def.barOf as Record<string, string>)[key]}.png`)!).ensureAlpha().raw().toBuffer({ resolveWithObject: true });
      const perColumn = def.rampKeys?.includes(key) === true;
      const tint = perColumn ? sampleBarColumns(master.data, master.info.width, def.barSample, def.shape) : sampleBar(master.data, master.info.width, def.barSample);
      const f = notchFindings(data, def.shape, null, tint, def.oval, def.cutMarginPx, NOTCH_FOOT[folder as keyof typeof NOTCH_FOOT]);
      expect(f.failures, `${folder}/${key}`).toEqual([]);
      // …and provenance names this tint.
      if (perColumn) {
        const columns = tint as number[][];
        expect(provenance[folder].colors[key][1]).toContain(`${columns[0].join(",")} at x 654 → ${columns[96].join(",")} at x 750 → ${columns[191].join(",")} at x 845`);
      } else {
        expect(provenance[folder].colors[key][1]).toContain(`(${(tint as number[]).join(",")})`);
      }
    });

    it.each(TWO_COLOR_PAIRS.map((pair) => [pair] as const))("%s: the bar under the notch is the same pixels on the split, hybrid, artifact, land, snow and snow-land pair masters, and its foot is each side of the ramp", async (pair) => {
      const def = M15;
      const read = async (rel: string) => {
        const m = await sharp(onDisk(`${rel}.png`)!).ensureAlpha().raw().toBuffer({ resolveWithObject: true });
        return sampleBarColumns(m.data, m.info.width, def.barSample, def.shape);
      };
      const sampled = await read(`m15/${pair}`);
      for (const rel of def.barSharedBy?.[pair] ?? []) {
        const gap = columnTintGap(sampled, await read(rel));
        expect(gap.max, `${rel} vs m15/${pair} at column ${gap.at}`).toBeLessThanOrEqual(def.barSample.tolerance);
      }
      // The two feet stand on different sides of the 40→60 %W ramp: the
      // left (x 658–666) nearer the first colour's bar, the right (834–842)
      // the second's — never one flat colour.
      const left = sampled[8];
      const right = sampled[184];
      expect(Math.max(...[0, 1, 2].map((c) => Math.abs(left[c] - right[c])))).toBeGreaterThan(20);
      // …and the bar IS the pinline ramp: the centre column (x 750, share
      // ½) sits halfway between the two feet's columns in every channel,
      // within the ramp's own quantisation (the feet are at shares 0.195
      // and 0.782 — 8 and 184 columns in — so the midpoint of the two is
      // share 0.488, 4 levels of a 255-level ramp from the centre at most).
      const share = (i: number) => rampShare(((654 + i + 0.5) / 1500) * 100, PINLINE_RAMP);
      expect(share(96)).toBeCloseTo(0.502, 2);
      const t = (share(96) - share(8)) / (share(184) - share(8));
      for (let c = 0; c < 3; c += 1) {
        expect(Math.abs(sampled[96][c] - (left[c] + (right[c] - left[c]) * t)), `channel ${c}`).toBeLessThanOrEqual(3);
      }
    });
  });
});
