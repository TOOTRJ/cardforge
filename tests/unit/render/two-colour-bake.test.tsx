import sharp from "sharp";
import { beforeAll, beforeEach, describe, expect, it, vi } from "vitest";
import { FINISHES, PAIR_CASES, pairCaseCard } from "./two-colour-cases";

// ---------------------------------------------------------------------------
// TODO 4.6b — the two-colour look in the Satori BAKE on the REAL profiles
// (m15: gold-split + hybrid; m15artifact and m15land: gold-split): for every
// parity case (two-colour-cases.ts, the preview's twin table:
// tests/unit/components/two-colour-preview.test.tsx) in regular, foil and
// etched, the master the bake paints, the plate it paints, and what it
// preloads (frameColorKeysFor / frameAssetPathsFor — a bucket object that
// isn't preloaded bakes as a transparent pixel on Vercel). Every asset is a
// flat stand-in here; the real masters are baked and measured in
// two-colour-bake-pixels.test.tsx.
// ---------------------------------------------------------------------------

const seen = vi.hoisted(() => ({
  grey: "",
  blue: "",
  masters: [] as string[],
  plates: [] as string[],
  preloaded: [] as string[],
}));

vi.mock("@/lib/render/card-frames", async (importOriginal) => {
  const real = await importOriginal<typeof import("@/lib/render/card-frames")>();
  return {
    ...real,
    preloadFrame: async (template: string, key: string) => {
      seen.preloaded.push(real.frameAssetPath(template, key));
    },
    preloadFrameAssets: async (paths: Iterable<string>) => {
      seen.preloaded.push(...paths);
    },
    getFrameDataUrl: (template: string, key: string) => {
      // The loader's own path for the key — a key it doesn't know reads "c".
      seen.masters.push(real.frameAssetPath(template, key));
      return seen.grey;
    },
    getPlateDataUrlForPath: (path: string, key: string) => {
      seen.plates.push(real.plateAssetPath(path, key));
      return seen.blue;
    },
    getFrameOverlayDataUrl: () => null,
    getFrameAssetDataUrl: () => null,
  };
});

import { frameAssetPathsFor, renderCardImage } from "@/lib/render/card-image";

async function flat(r: number, g: number, b: number): Promise<string> {
  const png = await sharp({ create: { width: 32, height: 32, channels: 4, background: { r, g, b, alpha: 1 } } })
    .png()
    .toBuffer();
  return `data:image/png;base64,${png.toString("base64")}`;
}

beforeAll(async () => {
  seen.grey = await flat(128, 128, 128);
  seen.blue = await flat(0, 0, 255);
});

beforeEach(() => {
  seen.masters.length = 0;
  seen.plates.length = 0;
  seen.preloaded.length = 0;
});

const unique = (list: string[]) => [...new Set(list)];

describe("the bake paints the pair master and plate the preview shows", () => {
  for (const c of PAIR_CASES) {
    it.each(FINISHES)(`${c.id} — %s`, async (finish) => {
      const card = pairCaseCard(c, finish);
      // The body is rendered lazily: read it, so the card is really baked.
      const res = await renderCardImage(card, "default", { brandMark: false, watermarkText: null });
      await res.arrayBuffer();
      // The frame (and each finish's mask of it) is the case's master, and
      // it was preloaded under the same path.
      expect(unique(seen.masters)).toEqual([`/frames/${c.master}.png`]);
      expect(seen.preloaded).toContain(`/frames/${c.master}.png`);
      expect(unique(seen.plates)).toEqual(c.plate ? [c.plate] : []);
      if (c.plate) expect(frameAssetPathsFor(card)).toContain(c.plate);
    }, 60_000);
  }
});
