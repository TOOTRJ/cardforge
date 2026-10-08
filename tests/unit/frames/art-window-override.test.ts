import { createHash } from "node:crypto";
import fs from "node:fs";
import path from "node:path";
import sharp from "sharp";
import { describe, expect, it } from "vitest";
import { applyCardCornerMask } from "@/lib/cards/card-corner";
import manifestJson from "@/lib/frames/frame-manifest.json";
import { getFrameProfile } from "@/lib/cards/template-layout";
import {
  artSlotOverrideRefusal,
  masterKeysFor,
  overrideTouchesArtSlot,
  type MasterLoader,
  type MasterPixels,
} from "@/lib/frames/art-window-override";

// ---------------------------------------------------------------------------
// The art-window gate on a frame-layout save (TODO 7.6 / the v35 correction
// round): an override that moves an art slot is checked on every master the
// template paints, with CI's verdict, before the editor may save it.
// Synthetic 1500 × 2100 masters cut to the Card Conjurer M15 window
// (116–1384 × 238–1165, measured on every colour) and its opaque outline,
// the real git nyx masters through the bake's own loader, and — where the
// bucket masters are on disk at the manifest's sha (CI's FRAMES_BUILD_DIR) —
// the real m15devoid ones.
// ---------------------------------------------------------------------------

const W = 1500;
const H = 2100;
type Box = [x0: number, x1: number, y0: number, y1: number];

/** Opaque, the card corner cut, a clear window, and (see-through masters) a
 *  body at α 26 kept off the window by an opaque outline — px, x1/y1 exclusive. */
function master(window: Box, body: Box | null = null, outline: Box | null = null): MasterPixels {
  const data = new Uint8Array(W * H * 4);
  const inside = (b: Box, x: number, y: number) => x >= b[0] && x < b[1] && y >= b[2] && y < b[3];
  for (let y = 0; y < H; y += 1) {
    for (let x = 0; x < W; x += 1) {
      data[(y * W + x) * 4 + 3] = inside(window, x, y) ? 0 : outline && inside(outline, x, y) ? 255 : body && inside(body, x, y) ? 26 : 255;
    }
  }
  applyCardCornerMask(data, W, H);
  return { data, width: W, height: H };
}

const M15_WINDOW: Box = [116, 1384, 238, 1165];
const M15_MASTER = master(M15_WINDOW);
// m15/c: CC's see-through "Eldrazi" master (its body from the border's inner
// edge, the window's outline 98–1401 × 220–1184 as measured).
const M15_C_MASTER = master(M15_WINDOW, [58, 1443, 59, 1938], [98, 1402, 220, 1185]);
// Every m15devoid colour: see-through, the outline 100–1399 × 198–1184.
const DEVOID_MASTER = master(M15_WINDOW, [59, 1441, 89, 1938], [100, 1400, 198, 1185]);

/** A loader that serves the M15 masters and records what it was asked. */
function m15Loader(overrides: Partial<Record<string, MasterPixels | null | Error>> = {}) {
  const asked: string[] = [];
  const load: MasterLoader = async (template, key) => {
    asked.push(`${template}/${key}`);
    const special = overrides[key];
    if (special instanceof Error) throw special;
    if (special !== undefined) return special;
    return key === "c" ? M15_C_MASTER : M15_MASTER;
  };
  return { load, asked };
}

describe("overrideTouchesArtSlot / masterKeysFor", () => {
  it("only an artSlot or a second face's artSlot is an art-slot override", () => {
    expect(overrideTouchesArtSlot(null)).toBe(false);
    expect(overrideTouchesArtSlot({})).toBe(false);
    expect(overrideTouchesArtSlot({ title: { rect: { topPct: 5 } } })).toBe(false);
    expect(overrideTouchesArtSlot({ secondFace: { title: { sizePct: 0.05 } } })).toBe(false);
    expect(overrideTouchesArtSlot({ artSlot: { topPct: 11 } })).toBe(true);
    expect(overrideTouchesArtSlot({ secondFace: { artSlot: { leftPct: 50 } } })).toBe(true);
  });

  it("checks every colour master, plus the masters a profile dresses by type (Alpha's artifact card)", () => {
    expect(masterKeysFor(getFrameProfile("m15"))).toEqual(["w", "u", "b", "r", "g", "c", "m"]);
    expect(masterKeysFor(getFrameProfile("agclassic"))).toEqual(["w", "u", "b", "r", "g", "c", "m", "a"]);
  });
});

describe("artSlotOverrideRefusal", { timeout: 30_000 }, () => {
  it("never loads a master for an override that doesn't move an art slot", async () => {
    const { load, asked } = m15Loader();
    expect(await artSlotOverrideRefusal("m15", { title: { rect: { topPct: 5 } } }, load)).toBeNull();
    expect(await artSlotOverrideRefusal("m15", {}, load)).toBeNull();
    expect(asked).toEqual([]);
  });

  it("refuses the slot the CC M15 masters were drawn with until layout v35 — the 1–1.6 px hairline", async () => {
    const { load, asked } = m15Loader();
    const refusal = await artSlotOverrideRefusal("m15", { artSlot: { topPct: 11.4, leftPct: 7.8, widthPct: 84.4, heightPct: 44.0 } }, load);
    expect(refusal).toMatch(/^The art slot leaves the m15\/w frame's art window uncovered \(the art-window check, TODO 7\.6\) — nothing was saved\. artSlot: the slot 117–1383 × 239\.4–1163\.4 px doesn't cover the window 116–1384 × 238–1165 px .*left 117 > 115\.25/);
    // It stops at the first master that fails.
    expect(asked).toEqual(["m15/w"]);
  });

  it("saves a slot that covers the window on every master — the see-through one through its under-frame art", async () => {
    const { load, asked } = m15Loader();
    // Nudged up and taller than the code's v35 slot, still covering.
    expect(await artSlotOverrideRefusal("m15", { artSlot: { topPct: 11.1, heightPct: 44.6 } }, load)).toBeNull();
    expect(asked).toEqual(["m15/w", "m15/u", "m15/b", "m15/r", "m15/g", "m15/c", "m15/m"]);
  });

  it("holds a see-through master's slot to its window too — every m15devoid colour (the review's hole)", async () => {
    // Until the review, a see-through master was judged by its under-frame
    // art alone, so these two saved on m15devoid (every colour see-through)
    // though the window showed two crops of the art with a seam through it.
    const devoid: MasterLoader = async () => DEVOID_MASTER;
    expect(await artSlotOverrideRefusal("m15devoid", { artSlot: { leftPct: 9, widthPct: 83 } }, devoid)).toMatch(
      /^The art slot leaves the m15devoid\/w frame's art window uncovered .*artSlot: the slot 135–1380 × .* doesn't cover the window 116–1384 × 238–1165 px .*a see-through master's window shows the slot's crop.*: left 135 > 115\.25, right 1380 < 1384\.75$/,
    );
    expect(await artSlotOverrideRefusal("m15devoid", { artSlot: { topPct: 20, heightPct: 20 } }, devoid)).toMatch(
      /^The art slot leaves the m15devoid\/w frame's art window uncovered .*: top 420 > 236\.95, bottom 840 < 1166\.05$/,
    );
    // A nudge that keeps the slot over the window and its edges on the
    // outline saves; one that ends past the outline, in the body, doesn't.
    expect(await artSlotOverrideRefusal("m15devoid", { artSlot: { topPct: 11.1, heightPct: 44.6 } }, devoid)).toBeNull();
    expect(await artSlotOverrideRefusal("m15devoid", { artSlot: { leftPct: 6.5, widthPct: 87 } }, devoid)).toMatch(
      /meets the under-frame art where the frame lets it through .*: left \(column 96\) \d+ of \d+ px, right \(column 1402\)/,
    );
    // On m15's opaque colours a hole in the window shows #101015.
    const { load, asked } = m15Loader();
    expect(await artSlotOverrideRefusal("m15", { artSlot: { leftPct: 9, widthPct: 83 } }, load)).toMatch(/m15\/w frame's art window uncovered .*: left 135 > 115\.25, right 1380 < 1384\.75$/);
    expect(asked).toEqual(["m15/w"]);
  });

  // The real m15devoid masters (bucket; CI fetches them, FRAMES_BUILD_DIR).
  const BUILD = process.env.FRAMES_BUILD_DIR ? path.resolve(process.env.FRAMES_BUILD_DIR) : path.join(process.cwd(), ".frames-build");
  const manifest = manifestJson as { files: Record<string, { sha256: string }> };
  const onDisk = (rel: string) => {
    const file = path.join(BUILD, rel);
    return fs.existsSync(file) && createHash("sha256").update(fs.readFileSync(file)).digest("hex") === manifest.files[rel]?.sha256 ? file : null;
  };
  const devoidOnDisk = ["w", "u", "b", "r", "g", "c", "m"].every((k) => onDisk(`m15devoid/${k}.png`));
  it.runIf(devoidOnDisk)("refuses the review's two m15devoid overrides on the real masters, and saves the code's slot", async () => {
    const real: MasterLoader = async (template, key) => {
      const file = onDisk(`${template}/${key}.png`);
      if (!file) return null;
      const { data, info } = await sharp(file).ensureAlpha().raw().toBuffer({ resolveWithObject: true });
      return { data, width: info.width, height: info.height };
    };
    expect(await artSlotOverrideRefusal("m15devoid", { artSlot: { topPct: 20, heightPct: 20 } }, real)).toMatch(/doesn't cover the window/);
    expect(await artSlotOverrideRefusal("m15devoid", { artSlot: { leftPct: 9, widthPct: 83 } }, real)).toMatch(/doesn't cover the window/);
    expect(await artSlotOverrideRefusal("m15devoid", { artSlot: { ...getFrameProfile("m15devoid").artSlot } }, real)).toBeNull();
  });

  it("refuses when a master can't be loaded or is missing — never saves an unchecked slot", async () => {
    const failing = m15Loader({ g: new Error("bucket 503") });
    expect(await artSlotOverrideRefusal("m15", { artSlot: { topPct: 11.2 } }, failing.load)).toBe(
      "Couldn't load the m15/g frame master to check the art window — nothing was saved. Try again.",
    );
    const missing = m15Loader({ m: null });
    expect(await artSlotOverrideRefusal("m15", { artSlot: { topPct: 11.2 } }, missing.load)).toBe(
      "The m15/m frame master is missing, so the art window can't be checked — nothing was saved.",
    );
  });

  it("holds a known failure to its bound, as CI does: no worse is saved, worse is refused", async () => {
    // m15textless (TODO 4.35): window 118–1379 × 239–1935 vs its slot's
    // 115.5–1375.5 × 237.3–1932 — known, bound 4.5 px. (The 2003 pair, this
    // test's first example, left the table with TODO 4.10b.)
    const textlessWindow: Box = [118, 1379, 239, 1935];
    const load: MasterLoader = async () => master(textlessWindow);
    expect(await artSlotOverrideRefusal("m15textless", { artSlot: { topPct: 11.3 } }, load)).toBeNull();
    expect(await artSlotOverrideRefusal("m15textless", { artSlot: { heightPct: 79.7 } }, load)).toMatch(
      /m15textless\/w frame's art window uncovered .*worse than its known failure \(4\.35\): misses by [\d.]+ px > 4\.5/,
    );
  });

  it("checks the real nyx masters through the bake's own loader (git masters): the v34 slot's seam is refused, v35's saved", async () => {
    // The v34 slot ended at 81.2 %: the translucent text box showed #101015 below it.
    expect(await artSlotOverrideRefusal("nyx", { artSlot: { heightPct: 70 } })).toMatch(
      /^The art slot leaves the nyx\/w frame's art window uncovered .*a translucent part of the frame 110–1391 × 1319–1946 px .*bottom 240\.8 px$/,
    );
    expect(await artSlotOverrideRefusal("nyx", { artSlot: { heightPct: 81.8 } })).toBeNull();
  });
});
