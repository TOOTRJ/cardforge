import { createHash } from "node:crypto";
import sharp from "sharp";
import { vi } from "vitest";
import { applyCardCornerMask, cardCornerRadiusPx } from "@/lib/cards/card-corner";
import { artLayersFor, getFrameProfile, type Rect, type StatSlot } from "@/lib/cards/template-layout";
import { slotPixelBox } from "@/lib/frames/art-window";
import { frameObjectKey, setFrameStorageForTests, type FrameManifest } from "@/lib/frames/frame-url";
import { resetFrameAssetCacheForTests } from "@/lib/render/card-frames";

// ---------------------------------------------------------------------------
// Stand-in frames for REAL bakes of a bucket template (the Card Conjurer
// masters never enter git, so a unit test can't read them): a flat grey (or
// cream) master per colour with every art window the profile paints cut
// clear — the front's slot and a second face's turned slot — and the corners
// cut, plus a flat plate for every plate the profile draws, served from a
// stubbed frames bucket through the same manifest + sha256 path the bake
// reads production's objects by (lib/frames/frame-url.ts,
// lib/render/card-frames.ts). The text, pips, plates and art a test
// measures are then the only marks on the card. Every other fetch is
// refused (hermetic). Adapted from tests/unit/render/crown-bake.test.tsx.
// ---------------------------------------------------------------------------

export type StandInPlate = {
  rgb: readonly number[];
  width?: number;
  height?: number;
  /** A dark square in the image's top-left fifth, so a bake shows which way
   *  up the plate was drawn. */
  mark?: boolean;
};

export type StandInSpec = {
  template: string;
  /** The colour keys to serve a master for. */
  keys: readonly string[];
  /** The master's flat tone (0–255, default 128). */
  tone?: number;
  /** Stand-ins keyed by a slot's plateAssetPathTemplate; every other plate
   *  template the profile draws gets a flat light plate. */
  plates?: Record<string, StandInPlate>;
  /** Any other bucket object the profile draws, by its public path (the
   *  saga's `/frames/saga/chapter/badge.png`): a flat block of `rgb`. */
  pieces?: Record<string, StandInPlate>;
};

export type StandInFrames = {
  /** Put the real manifest, origin and fetch back. */
  restore: () => void;
  /** Every manifest key the bake fetched, in order. */
  fetched: string[];
  /** The served files by manifest key. */
  files: Record<string, Buffer>;
};

export const STAND_IN_ORIGIN = "https://frames.stand-in.test";
const HD = { width: 1500, height: 2100 };
const COLOR_KEYS = ["w", "u", "b", "r", "g", "c", "m"] as const;
const DEFAULT_PLATE: StandInPlate = { rgb: [232, 232, 232] };

async function flatPng(w: number, h: number, rgb: readonly number[], mark = false): Promise<Buffer> {
  const data = Buffer.alloc(w * h * 4);
  for (let p = 0; p < w * h; p += 1) data.set([rgb[0], rgb[1], rgb[2], 255], p * 4);
  if (mark) {
    const mw = Math.round(w / 5);
    const mh = Math.round(h / 5);
    for (let y = 0; y < mh; y += 1) for (let x = 0; x < mw; x += 1) data.set([20, 20, 20, 255], (y * w + x) * 4);
  }
  return sharp(data, { raw: { width: w, height: h, channels: 4 } }).png().toBuffer();
}

/** A stand-in master: flat `tone`, every art window the profile paints on
 *  `key` clear (the slot's exact pixel box), corners cut. */
async function standInMaster(template: string, key: string, tone: number): Promise<Buffer> {
  const { width: W, height: H } = HD;
  const landscape = getFrameProfile(template).orientation === "landscape";
  const [w, h] = landscape ? [H, W] : [W, H];
  const data = Buffer.alloc(w * h * 4);
  for (let p = 0; p < w * h; p += 1) data.set([tone, tone, tone, 255], p * 4);
  const profile = getFrameProfile(template);
  const clear = (rect: Rect, rotation: 0 | 90 | 180 | 270) => {
    const box = slotPixelBox(rect, rotation, w, h);
    for (let y = Math.max(0, Math.ceil(box.y0)); y < Math.min(h, Math.floor(box.y1)); y += 1) {
      for (let x = Math.max(0, Math.ceil(box.x0)); x < Math.min(w, Math.floor(box.x1)); x += 1) data[(y * w + x) * 4 + 3] = 0;
    }
  };
  clear(artLayersFor(profile, key, true).slot, 0);
  const second = profile.secondFace;
  if (second?.artSlot) clear(second.artSlot, second.rotation);
  applyCardCornerMask(data, w, h, cardCornerRadiusPx(w, h));
  return sharp(data, { raw: { width: w, height: h, channels: 4 } }).png().toBuffer();
}

/** Every plate template a profile draws. */
function plateTemplatesOf(template: string): string[] {
  const p = getFrameProfile(template);
  const slots: (StatSlot | undefined)[] = [p.pt, p.loyalty, p.defense, p.secondFace?.pt];
  return [...new Set(slots.map((s) => s?.plateAssetPathTemplate).filter((t): t is string => Boolean(t)))];
}

const manifestKey = (publicPath: string) => publicPath.replace(/^\/+/, "").replace(/^frames\//, "");

/**
 * Serve stand-in masters and plates for `specs` from a stubbed bucket.
 * Call in beforeAll; call `restore` in afterAll.
 */
export async function serveStandInFrames(specs: readonly StandInSpec[]): Promise<StandInFrames> {
  const files: Record<string, Buffer> = {};
  for (const spec of specs) {
    for (const key of spec.keys) files[`${spec.template}/${key}.png`] = await standInMaster(spec.template, key, spec.tone ?? 128);
    for (const plateTemplate of plateTemplatesOf(spec.template)) {
      const plate = spec.plates?.[plateTemplate] ?? DEFAULT_PLATE;
      const bytes = await flatPng(plate.width ?? 243, plate.height ?? 160, plate.rgb, plate.mark ?? false);
      for (const key of COLOR_KEYS) files[manifestKey(plateTemplate.replace("{color}", key))] = bytes;
    }
    for (const [publicPath, piece] of Object.entries(spec.pieces ?? {})) {
      files[manifestKey(publicPath)] = await flatPng(piece.width ?? 64, piece.height ?? 64, piece.rgb, piece.mark ?? false);
    }
  }
  const manifest: FrameManifest = {
    version: 1,
    bucket: "frames",
    files: Object.fromEntries(
      Object.entries(files).map(([key, buf]) => {
        const sha256 = createHash("sha256").update(buf).digest("hex");
        return [key, { hash: sha256.slice(0, 12), sha256, bytes: buf.length, width: 1, height: 1 }];
      }),
    ),
  };
  const byUrl = new Map(
    Object.entries(files).map(([key, buf]) => [`${STAND_IN_ORIGIN}/${frameObjectKey(key, manifest.files[key].hash)}`, [key, buf] as const]),
  );
  const fetched: string[] = [];
  vi.stubGlobal(
    "fetch",
    vi.fn(async (input: string | URL | Request) => {
      const url = typeof input === "string" ? input : input instanceof URL ? input.href : input.url;
      const hit = byUrl.get(url);
      if (!hit) throw new Error(`stand-in frames: unexpected fetch ${url}`);
      fetched.push(hit[0]);
      return new Response(new Uint8Array(hit[1]), { status: 200, headers: { "content-type": "image/png" } });
    }),
  );
  const restoreStorage = setFrameStorageForTests({ manifest, origin: STAND_IN_ORIGIN });
  resetFrameAssetCacheForTests();
  return {
    restore: () => {
      restoreStorage();
      vi.unstubAllGlobals();
      resetFrameAssetCacheForTests();
    },
    fetched,
    files,
  };
}
