import { createHash } from "node:crypto";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import sharp from "sharp";
import { afterEach, describe, expect, it, vi } from "vitest";
import type { CardPreviewData } from "@/components/cards/card-preview";
import type { ColorIdentity } from "@/types/card";
import { getFrameProfile } from "@/lib/cards/template-layout";
import { setFrameStorageForTests, type FrameManifest } from "@/lib/frames/frame-url";
import { resetFrameAssetCacheForTests } from "@/lib/render/card-frames";
import { renderCardImage, RENDER_PRESETS } from "@/lib/render/card-image";

// ---------------------------------------------------------------------------
// Two-colour Dragon Wing (owner decision 2026-09-25), pinned on REAL bakes:
// public/frames/tarkirdragon is in git, so these render offline. A split card
// must be, pixel for pixel, the first colour's bake left of the seam and the
// second colour's right of it — the text is identical in every bake, so the
// only thing that can differ is the frame. Rendered at "default" (750 × 1050).
// ---------------------------------------------------------------------------

const W = RENDER_PRESETS.default.width;
const H = RENDER_PRESETS.default.height;
const SEAM = Math.round((W * getFrameProfile("tarkirdragon").twoColorSplit!.atPct) / 100);
/** Columns either side of the seam left out of the half comparisons. */
const GUARD = 2;

function card(colorIdentity: ColorIdentity[], over: Partial<CardPreviewData> = {}): CardPreviewData {
  return {
    title: "Taigam Probe",
    cost: "{2}{W}{U}",
    cardType: "instant",
    supertype: null,
    subtypes: [],
    rarity: "rare",
    colorIdentity,
    rulesText: "Draw two cards.",
    flavorText: null,
    power: null,
    toughness: null,
    loyalty: null,
    defense: null,
    artistCredit: "Probe",
    artUrl: null,
    artPosition: {},
    frameStyle: { template: "tarkirdragon", finish: "regular" },
    setIconUrl: null,
    setIconCode: null,
    backFace: null,
    faceContent: null,
    watermark: null,
    ...over,
  } as CardPreviewData;
}

type Raw = { data: Buffer; width: number; height: number };
async function bake(data: CardPreviewData): Promise<Raw> {
  const res = await renderCardImage(data, "default", { brandMark: false, watermarkText: null });
  const { data: px, info } = await sharp(Buffer.from(await res.arrayBuffer()))
    .removeAlpha()
    .raw()
    .toBuffer({ resolveWithObject: true });
  return { data: px, width: info.width, height: info.height };
}

/** Pixels in columns [x0, x1) × rows [y0, y1) whose channels differ by more
 *  than `tol` between two bakes. */
function differing(a: Raw, b: Raw, x0: number, x1: number, tol = 0, y0 = 0, y1 = H): number {
  let n = 0;
  for (let y = y0; y < y1; y += 1) {
    for (let x = x0; x < x1; x += 1) {
      const i = (y * W + x) * 3;
      if (
        Math.abs(a.data[i] - b.data[i]) > tol ||
        Math.abs(a.data[i + 1] - b.data[i + 1]) > tol ||
        Math.abs(a.data[i + 2] - b.data[i + 2]) > tol
      ) {
        n += 1;
      }
    }
  }
  return n;
}

const leftOf = (a: Raw, b: Raw, tol = 0) => differing(a, b, 0, SEAM - GUARD, tol);
const rightOf = (a: Raw, b: Raw, tol = 0) => differing(a, b, SEAM + GUARD, W, tol);

describe("Dragon Wing two-colour split — bake", () => {
  it.each<[string, ColorIdentity[], ColorIdentity, ColorIdentity]>([
    // Bar (e002bc65) is stored black-first; the printed order is W then B.
    ["WB (stored black, white)", ["black", "white"], "white", "black"],
    ["GU (stored blue, green)", ["blue", "green"], "green", "blue"],
  ])("%s: left half = first colour's frame, right half = second's", async (_label, pair, first, second) => {
    const [split, a, b, gold] = [
      await bake(card(pair)),
      await bake(card([first])),
      await bake(card([second])),
      await bake(card(["multicolor"])),
    ];
    expect(leftOf(split, a)).toBe(0);
    expect(rightOf(split, b)).toBe(0);
    // Not vacuous: both halves really moved off the gold "m" wings.
    expect(leftOf(split, gold, 24)).toBeGreaterThan(1000);
    expect(rightOf(split, gold, 24)).toBeGreaterThan(1000);
  }, 120_000);

  it("keeps the gold P/T plate, like Taigam's", async () => {
    const creature = { cardType: "creature" as const, power: "3", toughness: "3" };
    const [split, gold, goldInstant, white] = [
      await bake(card(["black", "white"], creature)),
      await bake(card(["multicolor"], creature)),
      await bake(card(["multicolor"])),
      await bake(card(["white"], creature)),
    ];
    // Only the pixels the plate + digits paint (the plate's transparent
    // corners show the frame beneath, which differs by colour).
    const r = getFrameProfile("tarkirdragon").pt!.plateRect!;
    let painted = 0;
    let offGold = 0;
    let offWhite = 0;
    const px = (a: Raw, b: Raw, i: number, tol: number) =>
      Math.abs(a.data[i] - b.data[i]) > tol ||
      Math.abs(a.data[i + 1] - b.data[i + 1]) > tol ||
      Math.abs(a.data[i + 2] - b.data[i + 2]) > tol;
    for (let y = Math.floor((H * r.topPct) / 100); y < Math.ceil((H * (r.topPct + r.heightPct)) / 100); y += 1) {
      for (let x = Math.floor((W * r.leftPct) / 100); x < Math.ceil((W * (r.leftPct + r.widthPct)) / 100); x += 1) {
        const i = (y * W + x) * 3;
        if (!px(gold, goldInstant, i, 24)) continue;
        painted += 1;
        if (px(split, gold, i, 24)) offGold += 1;
        if (px(split, white, i, 24)) offWhite += 1;
      }
    }
    expect(painted).toBeGreaterThan(2000);
    expect(offGold / painted).toBeLessThan(0.01);
    expect(offWhite / painted).toBeGreaterThan(0.1);
  }, 120_000);

  it("leaves 3+ colours on the gold frame", async () => {
    const [three, gold] = [
      await bake(card(["white", "blue", "black"])),
      await bake(card(["multicolor"])),
    ];
    expect(differing(three, gold, 0, W)).toBe(0);
  }, 60_000);

  it("etched: the sheen follows each half's own frame", async () => {
    const etched = { frameStyle: { template: "tarkirdragon" as const, finish: "etched" as const } };
    const [split, a, b, plain] = [
      await bake(card(["black", "white"], etched)),
      await bake(card(["white"], etched)),
      await bake(card(["black"], etched)),
      await bake(card(["black", "white"])),
    ];
    expect(leftOf(split, a)).toBe(0);
    expect(rightOf(split, b)).toBe(0);
    // Not vacuous: the sheen is really drawn on both halves.
    expect(leftOf(split, plain)).toBeGreaterThan(1000);
    expect(rightOf(split, plain)).toBeGreaterThan(1000);
  }, 120_000);
});

describe("Dragon Wing two-colour split — preload", () => {
  const ORIGIN = "https://bucket.example/frames";
  let restore: () => void = () => {};
  afterEach(() => {
    restore();
    vi.unstubAllGlobals();
    resetFrameAssetCacheForTests();
  });

  it("warms BOTH halves' masters (bucket frames render only what was preloaded)", async () => {
    // Pretend the two masters are bucket objects: getFrameDataUrl then throws
    // for any master renderCardImage did not preload.
    resetFrameAssetCacheForTests();
    const bytes = (c: string) => readFileSync(join(process.cwd(), `public/frames/tarkirdragon/${c}.png`));
    const sha = (b: Buffer) => createHash("sha256").update(b).digest("hex");
    const files = { w: bytes("w"), b: bytes("b") };
    const manifest: FrameManifest = {
      version: 1,
      bucket: "frames",
      files: Object.fromEntries(
        Object.entries(files).map(([c, b]) => [
          `tarkirdragon/${c}.png`,
          { hash: sha(b).slice(0, 12), sha256: sha(b), bytes: b.length, width: 1500, height: 2100 },
        ]),
      ),
    };
    restore = setFrameStorageForTests({ manifest, origin: ORIGIN });
    const served = new Map(
      Object.entries(files).map(([c, b]) => [`${ORIGIN}/tarkirdragon/${c}.${sha(b).slice(0, 12)}.png`, b]),
    );
    const fetchSpy = vi.fn(async (url: string) => {
      const b = served.get(url);
      return b
        ? new Response(new Uint8Array(b), { status: 200, headers: { "content-type": "image/png" } })
        : new Response(null, { status: 404 });
    });
    vi.stubGlobal("fetch", fetchSpy);

    const res = await renderCardImage(card(["black", "white"]), "default", { brandMark: false, watermarkText: null });
    expect((await res.arrayBuffer()).byteLength).toBeGreaterThan(0);
    expect(fetchSpy.mock.calls.map((c) => c[0]).sort()).toEqual([...served.keys()].sort());
  }, 60_000);
});
