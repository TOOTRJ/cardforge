import { createHash } from "node:crypto";
import fs from "node:fs";
import path from "node:path";
import sharp from "sharp";
import { describe, expect, it } from "vitest";
import {
  DFC_BORDERLESS_TEMPLATES,
  GRAFTS,
  H,
  RIGHT_WELL,
  W,
  WELL,
  applyGraft,
  bodyKeys,
  darkBaseOf,
  differs,
  isInteriorLike,
  lightLetterOf,
  mirrorX,
  monoBaseOf,
  shadeTransfer,
} from "@/scripts/lib/dfc-borderless.mjs";
import manifestJson from "@/lib/frames/frame-manifest.json";
import { FRAME_MASTER_KEYS } from "@/lib/cards/frame-reference-registry";
import { getFrameProfile } from "@/lib/cards/template-layout";

// ---------------------------------------------------------------------------
// TODO 5.7 — the dark borderless double-faced masters
// (scripts/build-dfc-borderless-frames.mjs, the recipe in
// scripts/lib/dfc-borderless.mjs): the graft on synthetic canvases, the
// recipe's keys and sources, and — where a local copy of the published
// masters exists (FRAMES_BUILD_DIR, .frames-cache or .frames-build, at the
// manifest's sha256) — the masters themselves: the dark master's pixels
// everywhere outside the graft rects, the well where print has it, the
// WebP's alpha the PNG's.
// ---------------------------------------------------------------------------

type Entry = { sha256: string; width: number; height: number };
const files = (manifestJson as { files: Record<string, Entry> }).files;
const TEMPLATES = Object.keys(DFC_BORDERLESS_TEMPLATES);
const DIRS = [process.env.FRAMES_BUILD_DIR, ".frames-cache", ".frames-build"].filter(Boolean).map((d) => path.resolve(d as string));

/** A local copy of a published object at the manifest's sha256, or null. */
function local(key: string): string | null {
  const want = files[key]?.sha256;
  if (!want) return null;
  for (const dir of DIRS) {
    const file = path.join(dir, key);
    if (fs.existsSync(file) && createHash("sha256").update(fs.readFileSync(file)).digest("hex") === want) return file;
  }
  return null;
}
const raw = async (file: string) => sharp(file).ensureAlpha().raw().toBuffer();

const canvas = (rgba: [number, number, number, number]) => {
  const b = Buffer.alloc(W * H * 4);
  for (let i = 0; i < W * H; i++) b.set(rgba, i * 4);
  return b;
};
const at = (b: Buffer, x: number, y: number) => [...b.subarray((y * W + x) * 4, (y * W + x) * 4 + 4)];

describe("the recipe", () => {
  it("publishes the seven colour keys, the artifact stand-in and the ten pairs, each with its crowned twin, on the four bodies", () => {
    expect(TEMPLATES).toEqual(["m15borderlessdfcfront", "m15borderlessdfcback", "m15borderlessmdfcfront", "m15borderlessmdfcback"]);
    const keys = bodyKeys();
    expect(keys).toHaveLength(36);
    for (const key of keys) expect(FRAME_MASTER_KEYS as readonly string[], key).toContain(key);
    for (const t of TEMPLATES) {
      expect(getFrameProfile(t).crownMasters, t).toBe(true);
      for (const key of keys) {
        for (const ext of ["png", "webp"]) {
          const entry = files[`${t}/${key}.${ext}`];
          expect(entry, `${t}/${key}.${ext}`).toBeDefined();
          expect([entry.width, entry.height]).toEqual([W, H]);
        }
      }
      // `c` is the artifact stand-in: the same bytes as `a`, crowned twins too.
      expect(files[`${t}/c.png`].sha256).toBe(files[`${t}/a.png`].sha256);
      expect(files[`${t}/c-legendary.png`].sha256).toBe(files[`${t}/a-legendary.png`].sha256);
    }
  });

  it("reads each key from its dark master, the graft's side from the pair's colour on that side", () => {
    expect(darkBaseOf("r")).toBe("m15borderless/r");
    expect(darkBaseOf("wu-legendary")).toBe("m15borderless/wu-legendary");
    expect(darkBaseOf("a")).toBe("m15borderlessartifact/c");
    expect(darkBaseOf("c-legendary")).toBe("m15borderlessartifact/c-legendary");
    expect(lightLetterOf("gw", "left")).toBe("g");
    expect(lightLetterOf("gw-legendary", "right")).toBe("w");
    expect(lightLetterOf("c", "left")).toBe("a");
    expect(monoBaseOf("ub", "right")).toBe("m15borderless/b");
    expect(monoBaseOf("a-legendary", "left")).toBe("m15borderlessartifact/c");
    // The grafts stay inside their rects and clear of the bottom bar.
    expect(GRAFTS.tab.y1).toBeLessThanOrEqual(1937);
    expect(WELL.cx + GRAFTS.leftWell.dx).toBe(149.5);
    expect(RIGHT_WELL.cx + GRAFTS.rightWell.dx).toBe(1351.5);
  });
});

describe("the graft", () => {
  it("shade transfer: the light pixel's luma over its row's interior times the dark interior; alpha by the same ratio", () => {
    expect(shadeTransfer([242, 203, 183, 191], [242, 203, 183, 191], [130, 22, 14, 201])).toEqual([130, 22, 14, 201]);
    const shadow = shadeTransfer([129, 108, 98, 217], [242, 203, 183, 191], [130, 22, 14, 201]);
    expect(shadow[0]).toBeLessThan(80);
    expect(shadow[3]).toBe(228);
    // The interior: translucent paint in the reference's direction — never
    // the white ring, a white glyph or an opaque rim.
    expect(isInteriorLike([242, 203, 183, 191], [242, 203, 183, 191])).toBe(true);
    expect(isInteriorLike([255, 255, 255, 255], [242, 203, 183, 191])).toBe(false);
    expect(isInteriorLike([239, 56, 39, 255], [242, 203, 183, 191])).toBe(false);
    // Every fully transparent pixel is the same pixel.
    expect(differs([255, 255, 255, 0], [0, 0, 0, 0])).toBe(false);
    expect(differs([0, 0, 0, 255], [0, 0, 0, 0])).toBe(true);
  });

  it("copies the light piece, re-colours its interior, and keeps a crown's pixels over a copied rim", () => {
    const dark = canvas([10, 10, 10, 128]);
    const mono = Buffer.from(dark);
    const light = canvas([0, 0, 0, 0]);
    // The light piece: an opaque rim pixel the mono master lacks, an
    // interior row and a transparent pixel; the dark master has a "crown"
    // pixel the mono lacks at the transparent one.
    light.set([200, 50, 40, 255], (150 * W + 250) * 4); // own: drawn
    light.set([242, 203, 183, 191], (150 * W + 300) * 4); // the bar's interior
    light.set([242, 203, 183, 191], (150 * W + 400 - GRAFTS.housing.dx) * 4); // the row's reference (refX, after the shift)
    dark.set([99, 99, 99, 255], (150 * W + 260) * 4); // a crown pixel
    const out = Buffer.from(dark);
    applyGraft(out, dark, light, mono, { graft: "housing", housing: "light" });
    expect(at(out, 250 + GRAFTS.housing.dx, 150)).toEqual([200, 50, 40, 255]);
    // The interior pixel (shifted by the graft's dx) takes the dark row's paint.
    expect(at(out, 300 + GRAFTS.housing.dx, 150)).toEqual([10, 10, 10, 128]);
    // The crown pixel survives where the light piece is transparent.
    expect(at(out, 260, 150)).toEqual([99, 99, 99, 255]);
  });

  it("mirrors a canvas left to right", () => {
    const b = canvas([0, 0, 0, 0]);
    b.set([1, 2, 3, 4], (10 * W + 0) * 4);
    expect(at(mirrorX(b), W - 1, 10)).toEqual([1, 2, 3, 4]);
  });
});

describe("the published masters (a local copy at the manifest's sha256)", () => {
  const SAMPLE = ["r", "u", "wu", "g-legendary", "a"];
  for (const t of TEMPLATES) {
    for (const key of SAMPLE) {
      const file = local(`${t}/${key}.png`);
      const base = local(`${darkBaseOf(key)}.png`);
      it.skipIf(!file || !base)(`${t}/${key}: the dark master outside the grafts; the WebP's alpha the PNG's`, async () => {
        const [png, dark] = await Promise.all([raw(file!), raw(base!)]);
        const rects = DFC_BORDERLESS_TEMPLATES[t as keyof typeof DFC_BORDERLESS_TEMPLATES].grafts.map((g) => GRAFTS[g.graft as keyof typeof GRAFTS]);
        let outside = 0;
        for (let y = 0; y < H; y += 2) {
          for (let x = 0; x < W; x += 2) {
            if (rects.some((r) => x >= r.x0 && x < r.x1 && y >= r.y0 && y < r.y1)) continue;
            if (differs(at(png, x, y) as never, at(dark, x, y) as never)) outside++;
          }
        }
        expect(outside).toBe(0);
        const webp = local(`${t}/${key}.webp`);
        if (webp) {
          const w = await raw(webp);
          for (let i = 3; i < png.length; i += 4 * 97) expect(w[i]).toBe(png[i]);
        }
      });
    }
    // The well where print has it: the white ring's outer edge on the
    // centre row at 93 px (fronts) / 1408 px (the ▼ back) — the median of
    // 38 / 39 dark faces, 2026-10-15.
    const file = local(`${t}/r.png`);
    it.skipIf(!file || t.includes("mdfc"))(`${t}: the white ring where print draws it`, async () => {
      const png = await raw(file!);
      const white = (x: number, y: number) => {
        const [r, g, b] = at(png, x, y);
        return Math.min(r, g, b) > 200;
      };
      const row = 160;
      if (t === "m15borderlessdfcfront") {
        let first = -1;
        for (let x = 40; x < 260 && first < 0; x++) if (white(x, row)) first = x;
        expect(first).toBe(93);
      } else {
        let last = -1;
        for (let x = 1460; x > 1240 && last < 0; x--) if (white(x, row)) last = x;
        expect(last).toBe(1408);
      }
    });
  }
});
