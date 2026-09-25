import { existsSync } from "node:fs";
import path from "node:path";
import { describe, expect, it } from "vitest";
import manifest from "@/lib/frames/frame-manifest.json";
import { serializeManifest } from "@/scripts/lib/frame-objects.mjs";
import { readFileSync } from "node:fs";

// ---------------------------------------------------------------------------
// lib/frames/frame-manifest.json — the list of frame assets that live in the
// frames bucket instead of git (frames plan 4.2). Guards: well-formed
// entries; a frame that moved to the bucket is NOT also committed under
// public/frames (masters leave git — the Card Conjurer family must never be
// in the public repo); every master ships with its browser WebP; the file
// is in the scripts' canonical serialization (sorted, stable diffs).
// ---------------------------------------------------------------------------

type Entry = { hash: string; bytes: number; width: number; height: number };
const files = (manifest as { files: Record<string, Entry> }).files;

describe("frame manifest", () => {
  it("has well-formed entries", () => {
    expect((manifest as { version: number }).version).toBe(1);
    for (const [key, entry] of Object.entries(files)) {
      expect(key, key).toMatch(/^[a-z0-9-]+(\/[a-z0-9-]+)*\.(png|webp)$/);
      expect(entry.hash, key).toMatch(/^[0-9a-f]{12}$/);
      expect(entry.bytes, key).toBeGreaterThan(0);
      expect(entry.width, key).toBeGreaterThan(0);
      expect(entry.height, key).toBeGreaterThan(0);
    }
  });

  it("never lists a frame that is also committed under public/frames", () => {
    const doubled = Object.keys(files).filter((key) => existsSync(path.join("public/frames", key)));
    expect(doubled).toEqual([]);
  });

  it("ships every PNG master with its browser WebP (and vice versa)", () => {
    for (const key of Object.keys(files)) {
      const sibling = key.endsWith(".png") ? key.replace(/\.png$/, ".webp") : key.replace(/\.webp$/, ".png");
      expect(files[sibling], `${key} has no ${sibling}`).toBeDefined();
    }
  });

  it("is stored in the scripts' canonical serialization", () => {
    expect(readFileSync("lib/frames/frame-manifest.json", "utf8")).toBe(serializeManifest(manifest as never));
  });
});
