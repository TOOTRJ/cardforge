import { createHash } from "node:crypto";
import fs from "node:fs";
import path from "node:path";
import { vi } from "vitest";
import manifestJson from "@/lib/frames/frame-manifest.json";
import { frameObjectKey, setFrameStorageForTests, type FrameManifest } from "@/lib/frames/frame-url";
import { resetFrameAssetCacheForTests } from "@/lib/render/card-frames";

// ---------------------------------------------------------------------------
// The REAL bucket masters for a unit test (the Card Conjurer frames never
// enter git): a copy at the manifest's sha256 from a local build or fetch —
// FRAMES_BUILD_DIR, else <repo>/.frames-build, laid out <template>/<key>.png
// (scripts/import-cc-frames.mjs, scripts/frames-fetch.mjs). CI fetches every
// manifest PNG and sets FRAMES_BUILD_DIR, so a suite gated on
// `haveBucketMasters` runs there; on a machine without them it skips (the
// stand-ins of tests/stubs/stand-in-frames.ts cover the layout either way).
// ---------------------------------------------------------------------------

type Entry = { hash: string; sha256: string; bytes: number; width: number; height: number };
const REAL = (manifestJson as { files: Record<string, Entry> }).files;
const BUILD = process.env.FRAMES_BUILD_DIR ? path.resolve(process.env.FRAMES_BUILD_DIR) : path.join(process.cwd(), ".frames-build");

export const BUCKET_MASTERS_ORIGIN = "https://frames.bucket-masters.test";

/** The published object's bytes for a manifest key ("battle/r.png") when a
 *  copy at the manifest's sha256 is on disk, else null. */
export function bucketMaster(key: string): Buffer | null {
  const entry = REAL[key];
  const file = path.join(BUILD, key);
  if (!entry || !fs.existsSync(file)) return null;
  const bytes = fs.readFileSync(file);
  return createHash("sha256").update(bytes).digest("hex") === entry.sha256 ? bytes : null;
}

/** True when every one of `keys` is on disk at the manifest's sha256. */
export function haveBucketMasters(keys: readonly string[]): boolean {
  return keys.every((key) => bucketMaster(key) !== null);
}

/** The PNG keys the manifest lists under `template/` (its masters and any
 *  plate, disc or piece beside them). */
export function bucketKeysOf(template: string): string[] {
  return Object.keys(REAL).filter((key) => key.startsWith(`${template}/`) && key.endsWith(".png"));
}

export type ServedBucketMasters = {
  /** Put the real manifest, origin and fetch back. */
  restore: () => void;
  /** Every manifest key the bake fetched, in order. */
  fetched: string[];
};

/**
 * Serve the REAL masters for `keys` from a stubbed frames bucket, through
 * the same manifest + sha256 path the bake reads production's objects by.
 * Every other fetch is refused (hermetic). Call in beforeAll — only when
 * `haveBucketMasters(keys)` — and `restore` in afterAll.
 */
export function serveBucketMasters(keys: readonly string[]): ServedBucketMasters {
  const files = new Map<string, Buffer>();
  for (const key of keys) {
    const bytes = bucketMaster(key);
    if (!bytes) throw new Error(`bucket master ${key} is not on disk at the manifest's sha256 (set FRAMES_BUILD_DIR)`);
    files.set(key, bytes);
  }
  const manifest: FrameManifest = {
    version: 1,
    bucket: "frames",
    files: Object.fromEntries([...files.keys()].map((key) => [key, REAL[key]])),
  };
  const byUrl = new Map([...files].map(([key, buf]) => [`${BUCKET_MASTERS_ORIGIN}/${frameObjectKey(key, REAL[key].hash)}`, [key, buf] as const]));
  const fetched: string[] = [];
  vi.stubGlobal(
    "fetch",
    vi.fn(async (input: string | URL | Request) => {
      const url = typeof input === "string" ? input : input instanceof URL ? input.href : input.url;
      const hit = byUrl.get(url);
      if (!hit) throw new Error(`bucket masters: unexpected fetch ${url}`);
      fetched.push(hit[0]);
      return new Response(new Uint8Array(hit[1]), { status: 200, headers: { "content-type": "image/png" } });
    }),
  );
  const restoreStorage = setFrameStorageForTests({ manifest, origin: BUCKET_MASTERS_ORIGIN });
  resetFrameAssetCacheForTests();
  return {
    restore: () => {
      restoreStorage();
      vi.unstubAllGlobals();
      resetFrameAssetCacheForTests();
    },
    fetched,
  };
}
