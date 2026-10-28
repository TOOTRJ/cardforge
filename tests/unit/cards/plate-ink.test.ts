import { createHash } from "node:crypto";
import fs from "node:fs";
import path from "node:path";
import sharp from "sharp";
import { describe, expect, it } from "vitest";
import manifestJson from "@/lib/frames/frame-manifest.json";
import { PLATE_INK, plateInkRect } from "@/lib/cards/plate-ink";
import { getFrameProfile, type StatSlot } from "@/lib/cards/template-layout";
import { FRAME_TEMPLATE_VALUES } from "@/types/card";

// ---------------------------------------------------------------------------
// lib/cards/plate-ink.ts — where each stat plate master puts ink, the rules
// layout's keep-out (layout v33, TODO 3.29). Every plate a profile draws has
// an entry, and each entry is re-measured here the way
// scripts/measure-plate-ink.mjs measures it (alpha ≥ 128, united over every
// colour): git plates always, bucket plates when a sha256-verified local build
// is present (FRAMES_BUILD_DIR, else .frames-build) — like the frame edge
// contract (tests/unit/frames/edge-contract.test.ts).
// ---------------------------------------------------------------------------

const manifest = manifestJson as { files: Record<string, { sha256: string; hash: string }> };

/**
 * The bucket plates PLATE_INK was measured on — each colour's manifest hash,
 * as scripts/measure-plate-ink.mjs prints it. CI has no bucket frames to
 * re-measure a bucket plate against, so a publish → promote that swaps one
 * (the manifest pointing at another file) fails here until the plate is
 * re-measured and both tables are updated — a stale keep-out never ships
 * green (layout v33 review: moving the walker shield's ink 0.025 → 0.4 passed
 * every rules test in CI).
 */
const MEASURED_ON: Readonly<Record<string, Readonly<Record<string, string>>>> = {
  "/frames/mysticalarchive/pt/{color}.png": { w: "7a5e94f5fe27", u: "3e33959df670", b: "18d4b9850f97", r: "c30ca59d9873", g: "ba3e8ec9d6d3", c: "0b9eb7c4583b", m: "6556509f1421" },
  "/frames/m15/pt/{color}.png": { w: "f6527bf8c103", u: "c4d44c844b2c", b: "910d573e16d2", r: "a96b70906276", g: "9baafb7090e6", c: "aa94a0984a71", m: "21f2e51b2eac" },
  "/frames/m15artifact/pt/{color}.png": { w: "f6527bf8c103", u: "c4d44c844b2c", b: "910d573e16d2", r: "a96b70906276", g: "9baafb7090e6", c: "82954026d022", m: "21f2e51b2eac" },
  "/frames/m15nyx/pt/{color}.png": { w: "f6527bf8c103", u: "c4d44c844b2c", b: "910d573e16d2", r: "a96b70906276", g: "9baafb7090e6", c: "aa94a0984a71", m: "21f2e51b2eac" },
  "/frames/m15vehicle/pt/{color}.png": { w: "f92bc5fc9c08", u: "f92bc5fc9c08", b: "f92bc5fc9c08", r: "f92bc5fc9c08", g: "f92bc5fc9c08", c: "f92bc5fc9c08", m: "f92bc5fc9c08" },
  "/frames/m15ub/pt/{color}.png": { w: "78c5d5cb3939", u: "e82be2a68f8c", b: "093300d0bf21", r: "d3cbb4f4a010", g: "76a7b4606b2a", c: "a06cbcb9e765", m: "d1500afdb191" },
  "/frames/m15ubartifact/pt/{color}.png": { w: "78c5d5cb3939", u: "e82be2a68f8c", b: "093300d0bf21", r: "d3cbb4f4a010", g: "76a7b4606b2a", c: "42ece74d0edd", m: "d1500afdb191" },
  "/frames/fullart/pt/{color}.png": { w: "4ae40cef9ffc", u: "8433f74c69c0", b: "8c3a6c92fcd4", r: "5580e064c8c0", g: "9030aca20c2a", c: "09c7003b1068", m: "63f463781d3b" },
  "/frames/m15dfcback/pt/{color}.png": { w: "eb3b5cd2819c", u: "b195a9a94201", b: "1c41f454e2b4", r: "a4483f6420f6", g: "be5ede22c67c", c: "f7b8ebcc1537", m: "8d5223f0e4bc" },
  "/frames/m15borderless/pt/{color}.png": { w: "27f7c5b0b36d", u: "f5cfb86d08b1", b: "8aa1a934257b", r: "c04b88ddea3b", g: "22975809834a", c: "37051a7bc4ca", m: "d7d60b3cbd8e" },
  "/frames/m15borderlessartifact/pt/{color}.png": { w: "27f7c5b0b36d", u: "f5cfb86d08b1", b: "8aa1a934257b", r: "c04b88ddea3b", g: "22975809834a", c: "153362ead210", m: "d7d60b3cbd8e" },
  "/frames/m15borderlesspw/loyalty/{color}.png": { w: "6af778da942a", u: "459f4b37f038", b: "5b45548e3899", r: "46f6a9e599dc", g: "d027941c7fd9", c: "ed5490591be4", m: "0d308c509dbb" },
  "/frames/m15borderlesspwtall/loyalty/{color}.png": { w: "bf0ed1b51e08", u: "be312d933019", b: "d8c4a3ac7a57", r: "9ef2fcdad11f", g: "c13aed5d332d", c: "44a3d3324658", m: "4ac3957dae04" },
  "/frames/modern/pt/{color}.png": { w: "0d2d382cd479", u: "025d9e131762", b: "a3f190659779", r: "262ca503885b", g: "4a0bbfa954d7", c: "5a54fa0ecc1e", m: "af991e2d5393" },
  "/frames/m15devoid/pt/{color}.png": { w: "aa94a0984a71", u: "aa94a0984a71", b: "aa94a0984a71", r: "aa94a0984a71", g: "aa94a0984a71", c: "aa94a0984a71", m: "aa94a0984a71" },
  "/frames/flip/pt/{color}-bottom.png": { w: "1774f78970a8", u: "9ae9a1185ad1", b: "463d9961e020", r: "d050c1c55882", g: "7b56a8950185", c: "253677e53a9b", m: "cae2827446a0" },
  "/frames/flip/pt/{color}-top.png": { w: "76ac787ef466", u: "4f99d8cbb7a2", b: "b5e9f2081d99", r: "eb90c5a3bb5f", g: "fd89b29e7229", c: "74c0d4223b14", m: "9ecd8cae94aa" },
  "/frames/m15pw/loyalty/{color}.png": { w: "d69d28d0134d", u: "60a78b2232c6", b: "ca6ad18941f8", r: "ba92609978fb", g: "20f3cac491c6", c: "117ad7df3f73", m: "3437adf23b51" },
  "/frames/m15snow/pt/{color}.png": { w: "f6527bf8c103", u: "c4d44c844b2c", b: "910d573e16d2", r: "a96b70906276", g: "9baafb7090e6", c: "82954026d022", m: "21f2e51b2eac" },
  "/frames/lotrscroll/pt/{color}.png": { w: "4d2d3edcab52", u: "236d2520a799", b: "54a0df4bc069", r: "91ba752c750a", g: "c23988767a3f", c: "80697d8f4c64", m: "b3d74100eb8a" },
  "/frames/stainedglass/pt/{color}.png": { w: "8cb4a468afbb", u: "82034454a454", b: "c7dfe2c2c874", r: "4c06c8ad2598", g: "85806da14a6a", c: "608d3342e323", m: "608d3342e323" },
  "/frames/tarkirdragon/pt/{color}.png": { w: "05965e80e763", u: "247ccafad649", b: "d3eacb60b4e6", r: "298c1f6462a0", g: "c2d504e56ebe", c: "2cc63037dab4", m: "8c4cfe713ea2" },
  "/frames/sncartdeco/pt/{color}.png": { w: "e56682f2f23c", u: "e56682f2f23c", b: "e56682f2f23c", r: "e56682f2f23c", g: "e56682f2f23c", c: "e56682f2f23c", m: "e56682f2f23c" },
  "/frames/dndsourcebook/pt/{color}.png": { w: "c1cf1d543418", u: "c1cf1d543418", b: "c1cf1d543418", r: "c1cf1d543418", g: "c1cf1d543418", c: "c1cf1d543418", m: "c1cf1d543418" },
  "/frames/dossier/pt/{color}.png": { w: "8c9ea69bb5df", u: "8c9ea69bb5df", b: "8c9ea69bb5df", r: "8c9ea69bb5df", g: "8c9ea69bb5df", c: "8c9ea69bb5df", m: "8c9ea69bb5df" },
  "/frames/tardis/pt/{color}.png": { w: "63ecae34b84a", u: "63ecae34b84a", b: "63ecae34b84a", r: "63ecae34b84a", g: "63ecae34b84a", c: "63ecae34b84a", m: "63ecae34b84a" },
  "/frames/breakingnews/pt/{color}.png": { w: "704c31e043df", u: "60c2387eaedd", b: "0160148b8c29", r: "47dc439f730a", g: "320ce931734d", c: "1f264195ffde", m: "f838f35a8afe" },
  "/frames/enchantingtales/pt/{color}.png": { w: "2c961d4b54c9", u: "12e32a5d7361", b: "c42ea1b5197b", r: "c1440201173b", g: "eed2b3699d5c", c: "2c961d4b54c9", m: "30ab59fe1985" },
  "/frames/lotr/pt/{color}.png": { w: "caa4db7dc77d", u: "50e582ea8089", b: "ae34f219042a", r: "3e5c61ae9f6a", g: "25fa07910ca3", c: "e577c1bacc6e", m: "3be4849e81cb" },
};

/** A plate template's bucket colours: colour key → manifest hash. */
function bucketHashes(template: string): Record<string, string> {
  const out: Record<string, string> = {};
  for (const key of ["w", "u", "b", "r", "g", "c", "m"]) {
    const entry = manifest.files[template.replace(/^\/frames\//, "").replace("{color}", key)];
    if (entry) out[key] = entry.hash;
  }
  return out;
}
const PUBLIC = path.join(process.cwd(), "public", "frames");
const BUILD = process.env.FRAMES_BUILD_DIR ?? path.join(process.cwd(), ".frames-build");
const COLORS = ["w", "u", "b", "r", "g", "c", "m"];

/** Every plate asset a profile draws. */
function plateTemplates(): Set<string> {
  const out = new Set<string>();
  const add = (slot: StatSlot | undefined) => slot?.plateAssetPathTemplate && out.add(slot.plateAssetPathTemplate);
  for (const t of FRAME_TEMPLATE_VALUES) {
    const p = getFrameProfile(t);
    [p.pt, p.loyalty, p.defense, p.secondFace?.pt].forEach(add);
  }
  return out;
}

/** The readable files of one plate's colours, or null when a bucket plate
 *  isn't available (verified) on this machine. */
function plateFiles(template: string): string[] | null {
  const files: string[] = [];
  for (const key of COLORS) {
    const rel = template.replace(/^\/frames\//, "").replace("{color}", key);
    const entry = manifest.files[rel];
    if (entry) {
      const file = path.join(BUILD, rel);
      if (!fs.existsSync(file)) return null;
      if (createHash("sha256").update(fs.readFileSync(file)).digest("hex") !== entry.sha256) return null;
      files.push(file);
    } else if (fs.existsSync(path.join(PUBLIC, rel))) {
      files.push(path.join(PUBLIC, rel));
    }
  }
  return files.length ? files : null;
}

async function inkFractions(file: string) {
  const { data, info } = await sharp(file).ensureAlpha().raw().toBuffer({ resolveWithObject: true });
  let [x0, y0, x1, y1] = [info.width, info.height, -1, -1];
  for (let y = 0; y < info.height; y += 1) {
    for (let x = 0; x < info.width; x += 1) {
      if (data[(y * info.width + x) * 4 + 3] < 128) continue;
      x0 = Math.min(x0, x);
      x1 = Math.max(x1, x);
      y0 = Math.min(y0, y);
      y1 = Math.max(y1, y);
    }
  }
  return { left: x0 / info.width, top: y0 / info.height, right: (x1 + 1) / info.width, bottom: (y1 + 1) / info.height };
}

describe("plate ink", () => {
  it("knows every plate a profile draws", () => {
    for (const template of plateTemplates()) expect(PLATE_INK[template], template).toBeDefined();
  });

  it("was measured on the bucket plates the manifest serves today (re-run measure-plate-ink.mjs when one changes)", () => {
    for (const template of Object.keys(PLATE_INK)) {
      const hashes = bucketHashes(template);
      if (Object.keys(hashes).length === 0) {
        // A plate in public/frames: re-measured below on every run.
        expect(MEASURED_ON[template], template).toBeUndefined();
        continue;
      }
      expect(hashes, template).toEqual(MEASURED_ON[template]);
    }
    // No pin for a plate the table no longer lists.
    for (const template of Object.keys(MEASURED_ON)) expect(PLATE_INK[template], template).toBeDefined();
  });

  for (const template of Object.keys(PLATE_INK)) {
    const files = plateFiles(template);
    if (!files) {
      it.skip(`${template}: plates not available here (frames bucket; set FRAMES_BUILD_DIR)`, () => {});
      continue;
    }
    it(`${template}: is the plates' own ink, every colour, rounded outward`, async () => {
      let ink = { left: 1, top: 1, right: 0, bottom: 0 };
      for (const file of files) {
        const f = await inkFractions(file);
        ink = {
          left: Math.min(ink.left, f.left),
          top: Math.min(ink.top, f.top),
          right: Math.max(ink.right, f.right),
          bottom: Math.max(ink.bottom, f.bottom),
        };
      }
      const table = PLATE_INK[template];
      expect(table.left).toBeLessThanOrEqual(ink.left + 1e-9);
      expect(table.top).toBeLessThanOrEqual(ink.top + 1e-9);
      expect(table.right).toBeGreaterThanOrEqual(ink.right - 1e-9);
      expect(table.bottom).toBeGreaterThanOrEqual(ink.bottom - 1e-9);
      for (const k of ["left", "top", "right", "bottom"] as const) expect(Math.abs(table[k] - ink[k]), k).toBeLessThan(1e-4);
    });
  }

  it("places the ink over the plate's box — the M15 plate from 1156.9 / 1864.8 HD px", () => {
    const pt = getFrameProfile("m15").pt!;
    const ink = plateInkRect(pt.plateAssetPathTemplate!, pt.plateRect!)!;
    expect(ink.leftPct * 15).toBeCloseTo(1156.9, 0);
    expect(ink.topPct * 21).toBeCloseTo(1864.8, 0);
    expect(plateInkRect("/frames/nowhere/{color}.png", pt.plateRect!)).toBeNull();
  });
});
