import { createHash } from "node:crypto";
import fs from "node:fs";
import path from "node:path";
import sharp from "sharp";
import { describe, expect, it } from "vitest";
import manifestJson from "@/lib/frames/frame-manifest.json";
import {
  BORDERLESS_CROWN,
  CC_OVERLAY_BANDS,
  EXTENDED_CROWN_BAND,
  describeLayer,
  extendedCrownFindings,
  extendedCrownLayers,
} from "@/scripts/lib/cc-frames.mjs";
import { EXTENDED_CROWN, getFrameProfile } from "@/lib/cards/template-layout";
import { FRAME_TEMPLATE_VALUES } from "@/types/card";

// ---------------------------------------------------------------------------
// TODO 4.6f (wave 2b) — the extended-art crown band (scripts/lib/cc-frames.mjs
// CC_OVERLAY_BANDS.extendedcrown, built by scripts/import-cc-frames.mjs
// `--only extendedcrown`): CC's FLOATING crown as autoExtendedArtFrame draws
// it — the black 'Crown Border Cover' strip (drawn, not erased), the crown,
// the outline ON TOP — composited 1:1 at 1500 × 2100 and cropped to the
// outline's rows 0–259; the overlay the extendedart profile stretches over
// rows 10–269 of the card (EXTENDED_CROWN: 10 px below CC's bounds, on our
// MSE master's title bar). The published bands' own pixels are checked when a
// local copy at the manifest's sha256 is on disk (FRAMES_BUILD_DIR, else
// .frames-build; CI fetches them).
// ---------------------------------------------------------------------------

type Entry = { sha256: string; width: number; height: number };
const files = (manifestJson as { files: Record<string, Entry> }).files;
const BUILD = process.env.FRAMES_BUILD_DIR ? path.resolve(process.env.FRAMES_BUILD_DIR) : path.join(process.cwd(), ".frames-build");
const provenance = JSON.parse(fs.readFileSync("lib/cards/frame-sources.json", "utf8")) as Record<
  string,
  { colors: Record<string, string[]>; kind?: string; notes: string[]; sourceFiles: string[] }
>;
const KEYS = ["w", "u", "b", "r", "g", "m", "c"];
const crowns = "img/frames/m15/crowns";

describe("the extended-art crown band's recipe", () => {
  it("builds the seven colour keys of the extendedart masters — no pairs — the slot's keys", () => {
    expect([...EXTENDED_CROWN_BAND.keys]).toEqual(KEYS);
    expect(CC_OVERLAY_BANDS.extendedcrown.keys).toEqual(EXTENDED_CROWN_BAND.keys);
    expect([...EXTENDED_CROWN.keys]).toEqual(KEYS);
    expect(() => extendedCrownLayers("wu")).toThrow();
    expect(() => extendedCrownLayers("a")).toThrow();
  });

  it("is CC's floating crown over the black cover strip with the outline ON TOP, at CC's bounds, 1:1 at the card's size", () => {
    expect(EXTENDED_CROWN_BAND.compositeSize).toEqual({ width: 1500, height: 2100 });
    expect(EXTENDED_CROWN_BAND.rows).toBe(260);
    // The same pieces and bounds as the borderless twins; only the order
    // (outline on top) and the cover (drawn, not erased) differ.
    expect(EXTENDED_CROWN_BAND.crown).toEqual(BORDERLESS_CROWN.crown);
    expect(EXTENDED_CROWN_BAND.outline).toEqual(BORDERLESS_CROWN.outline);
    expect(EXTENDED_CROWN_BAND.cover).toEqual(BORDERLESS_CROWN.erase);
    expect(extendedCrownLayers("w")).toEqual([
      { src: "img/black.png", at: { leftPct: 3.94, topPct: 2.77, widthPct: 92.14, heightPct: 1.77 } },
      { src: `${crowns}/m15CrownWFloating.png`, at: { leftPct: 3.07, topPct: 1.91, widthPct: 93.87, heightPct: 10.24 } },
      { src: `${crowns}/m15CrownFloatingOutline.png`, at: { leftPct: 2.8, topPct: 1.72, widthPct: 94.4, heightPct: 10.62 } },
    ]);
    for (const l of extendedCrownLayers("c")) expect(l).not.toHaveProperty("erase");
    expect(extendedCrownLayers("c")[1].src).toBe(`${crowns}/m15CrownCFloating.png`);
    expect(extendedCrownLayers("m")[1].src).toBe(`${crowns}/m15CrownMFloating.png`);
    expect(describeLayer(extendedCrownLayers("w")[0])).toBe("img/black.png at 3.94/2.77/92.14×1.77 %");
    expect(CC_OVERLAY_BANDS.extendedcrown.layers).toBe(extendedCrownLayers);
    expect(CC_OVERLAY_BANDS.extendedcrown.findings).toBe(extendedCrownFindings);
  });

  it("finds the band's extent, the outline's peak and the cover strip", () => {
    const W = 1500;
    const H = 300;
    const buf = Buffer.alloc(W * H * 4);
    const paint = (x: number, y: number, rgba: [number, number, number, number]) => buf.set(rgba, (y * W + x) * 4);
    paint(750, 36, [40, 40, 40, 255]); // the outline's peak at the centre column
    paint(446, 70, [0, 0, 0, 255]); // the cover strip in a crown dip
    paint(100, 259, [0, 0, 0, 10]); // the outline's last row
    const f = extendedCrownFindings(buf, W, H, 260);
    expect(f).toMatchObject({ lastAlphaRow: 259, peakRow: 36, cover: [0, 0, 0, 255], failures: [] });
    paint(100, 260, [0, 0, 0, 10]);
    expect(extendedCrownFindings(buf, W, H, 260).failures).toHaveLength(1);
    paint(446, 70, [200, 200, 200, 255]);
    expect(extendedCrownFindings(buf, W, H, 260).failures).toHaveLength(2);
  });
});

describe("the slot the extendedart profile draws (EXTENDED_CROWN)", () => {
  it("stretches the 1500 × 260 band over rows 10–269 of the card — 10 px below CC's bounds, on the MSE master's title bar", () => {
    expect(EXTENDED_CROWN.rect).toEqual({ topPct: (10 / 2100) * 100, leftPct: 0, widthPct: 100, heightPct: (260 / 2100) * 100 });
    expect(EXTENDED_CROWN.assetPathTemplate).toBe("/frames/extendedcrown/{key}.png");
    expect(EXTENDED_CROWN.keyMap).toBeUndefined();
  });

  it("is on the extendedart entry only, and no other template reads the extended-art band", () => {
    expect(getFrameProfile("extendedart").overlays).toEqual([EXTENDED_CROWN]);
    for (const t of FRAME_TEMPLATE_VALUES) {
      if (t === "extendedart") continue;
      for (const slot of getFrameProfile(t).overlays ?? []) expect(slot.assetPathTemplate, t).not.toContain("extendedcrown");
    }
  });
});

describe("published to the frames bucket", () => {
  it("lists every band key, PNG and WebP, at 1500 × 260, with its provenance", () => {
    for (const key of KEYS) {
      for (const ext of ["png", "webp"]) {
        const entry = files[`extendedcrown/${key}.${ext}`];
        expect(entry, `extendedcrown/${key}.${ext}`).toBeDefined();
        expect([entry.width, entry.height], `extendedcrown/${key}.${ext}`).toEqual([1500, 260]);
      }
      expect(provenance.extendedcrown.colors[key]).toEqual(extendedCrownLayers(key).map(describeLayer));
    }
    expect(provenance.extendedcrown.kind).toBe("overlay");
    expect(provenance.extendedcrown.sourceFiles).toEqual([
      "img/black.png",
      ...["C", "G", "M", "B", "R", "U", "W"].map((k) => `${crowns}/m15Crown${k}Floating.png`).sort(),
      `${crowns}/m15CrownFloatingOutline.png`,
    ].sort());
    expect(provenance.extendedcrown.notes.join(" ")).toMatch(/outline ON TOP/);
  });
});

// --- the pixels of the built bands (when the build is here at the sha) ----

async function raw(rel: string) {
  const file = path.join(BUILD, rel);
  if (!files[rel] || !fs.existsSync(file)) return null;
  const bytes = fs.readFileSync(file);
  if (createHash("sha256").update(bytes).digest("hex") !== files[rel].sha256) return null;
  const { data, info } = await sharp(bytes).ensureAlpha().raw().toBuffer({ resolveWithObject: true });
  return { data, width: info.width, height: info.height };
}
const px = (img: { data: Buffer; width: number }, x: number, y: number) => [...img.data.subarray((y * img.width + x) * 4, (y * img.width + x) * 4 + 4)];
const available = await (async () => (await Promise.all(KEYS.map((k) => raw(`extendedcrown/${k}.png`)))).every(Boolean))();

describe.skipIf(!available)("the built bands (set FRAMES_BUILD_DIR if skipped)", () => {
  it.each(KEYS)("%s: clear above row 36, the outline's peak at 36, the cover black in a dip, the crown's colour below the outline, nothing past row 259", async (key) => {
    const band = (await raw(`extendedcrown/${key}.png`))!;
    expect([band.width, band.height]).toEqual([1500, 260]);
    for (let y = 0; y < 36; y += 1) expect(px(band, 750, y)[3], `${key} row ${y}`).toBe(0);
    let peak = -1;
    for (let y = 0; y < 60 && peak < 0; y += 1) if (px(band, 750, y)[3] >= 250) peak = y;
    expect(Math.abs(peak - 36), `${key} peak ${peak}`).toBeLessThanOrEqual(1);
    // The outline is dark; by row 44 the crown's own colour shows through
    // the outline's inner edge.
    const outline = px(band, 750, 37);
    const crown = px(band, 750, 44);
    expect(crown[3]).toBe(255);
    expect(crown[0] + crown[1] + crown[2]).toBeGreaterThan(outline[0] + outline[1] + outline[2] + 60);
    // The cover strip: opaque black where the crown dips (x 446, rows 58–89).
    expect(px(band, 446, 70)).toEqual([0, 0, 0, 255]);
    // The band's last rows carry the outline's lower edge, and no more.
    let last = -1;
    for (let y = band.height - 1; y >= 0 && last < 0; y -= 1) for (let x = 0; x < band.width; x += 1) if (px(band, x, y)[3] > 0) { last = y; break; }
    expect(last).toBeLessThanOrEqual(259);
    expect(last).toBeGreaterThan(240);
    // The crown's colour differs per key at the centre of its top band.
  });

  it("the seven keys are seven different crowns (the colour, gold, the grey)", async () => {
    const tones = await Promise.all(KEYS.map(async (k) => px((await raw(`extendedcrown/${k}.png`))!, 750, 48).slice(0, 3).join(",")));
    expect(new Set(tones).size).toBe(KEYS.length);
  });
});
