import { afterEach, describe, expect, it } from "vitest";
import {
  frameManifestEntry,
  frameManifestKey,
  frameObjectKey,
  frameUrl,
  resolveFrameOrigin,
  setFrameStorageForTests,
  type FrameManifest,
} from "@/lib/frames/frame-url";
import { BUCKET, frameObjectKey as scriptObjectKey, publicBaseFor } from "@/scripts/lib/frame-objects.mjs";
import manifestJson from "@/lib/frames/frame-manifest.json";
import { frameBackgroundImage } from "@/components/cards/frame-layer";

// ---------------------------------------------------------------------------
// lib/frames/frame-url.ts — where the preview and the bake load a frame from
// (frames plan 4.2). Contract: a manifest entry resolves to its
// content-addressed bucket object; anything else stays /frames/… (git); the
// origin is NEXT_PUBLIC_FRAME_ORIGIN, else the deployment's own Supabase
// project's frames bucket; the scripts name objects exactly like the app.
// ---------------------------------------------------------------------------

const MANIFEST: FrameManifest = {
  version: 1,
  bucket: "frames",
  files: {
    "m15/w.png": { hash: "3fa9c2d1e0ab", sha256: "3fa9c2d1e0ab".padEnd(64, "0"), bytes: 10, width: 1500, height: 2100 },
    "m15/w.webp": { hash: "0123456789ab", sha256: "0123456789ab".padEnd(64, "0"), bytes: 5, width: 1500, height: 2100 },
    "m15/pt/w.png": { hash: "aaaaaaaaaaaa", sha256: "a".repeat(64), bytes: 3, width: 377, height: 206 },
  },
};

let restore: (() => void) | null = null;
afterEach(() => {
  restore?.();
  restore = null;
});

describe("resolveFrameOrigin", () => {
  it("prefers the explicit origin, else the project's frames bucket, else none", () => {
    expect(resolveFrameOrigin("https://cdn.example/frames/", "https://x.supabase.co")).toBe("https://cdn.example/frames");
    expect(resolveFrameOrigin(undefined, "https://x.supabase.co/")).toBe(
      "https://x.supabase.co/storage/v1/object/public/frames",
    );
    expect(resolveFrameOrigin("  ", undefined)).toBeNull();
  });
});

describe("frameUrl", () => {
  it("maps a manifest entry to its content-addressed bucket object — each variant separately", () => {
    restore = setFrameStorageForTests({ manifest: MANIFEST, origin: "https://b.example/frames" });
    expect(frameUrl("/frames/m15/w.png")).toBe("https://b.example/frames/m15/w.3fa9c2d1e0ab.png");
    expect(frameUrl("/frames/m15/w.webp")).toBe("https://b.example/frames/m15/w.0123456789ab.webp");
    expect(frameUrl("frames/m15/pt/w.png")).toBe("https://b.example/frames/m15/pt/w.aaaaaaaaaaaa.png");
  });

  it("leaves everything not in the manifest on /frames (git), and everything when no origin is known", () => {
    restore = setFrameStorageForTests({ manifest: MANIFEST, origin: "https://b.example/frames" });
    expect(frameUrl("/frames/saga/w.png")).toBe("/frames/saga/w.png");
    expect(frameUrl("/frames/m15/u.webp")).toBe("/frames/m15/u.webp");
    restore();
    restore = setFrameStorageForTests({ manifest: MANIFEST, origin: null });
    expect(frameUrl("/frames/m15/w.png")).toBe("/frames/m15/w.png");
  });

  it("normalises every spelling of a frame path to one manifest key", () => {
    expect(frameManifestKey("/frames/m15/w.png")).toBe("m15/w.png");
    expect(frameManifestKey("frames/m15/w.png")).toBe("m15/w.png");
    expect(frameManifestKey("m15/w.png")).toBe("m15/w.png");
    restore = setFrameStorageForTests({ manifest: MANIFEST });
    expect(frameManifestEntry("/frames/m15/w.png")?.hash).toBe("3fa9c2d1e0ab");
    expect(frameManifestEntry("/frames/m15/u.png")).toBeNull();
  });

  it("points the scripts and the app at the same bucket URL", () => {
    expect(resolveFrameOrigin(undefined, "https://x.supabase.co/")).toBe(publicBaseFor("https://x.supabase.co/"));
    expect((manifestJson as { bucket: string }).bucket).toBe(BUCKET);
  });

  it("gives the browser the WebP object and the bake the PNG object (separate hashes)", () => {
    restore = setFrameStorageForTests({ manifest: MANIFEST, origin: "https://b.example/frames" });
    expect(frameBackgroundImage("m15", "w")).toBe('url("https://b.example/frames/m15/w.0123456789ab.webp")');
    expect(frameBackgroundImage("saga", "w")).toBe('url("/frames/saga/w.webp")');
  });

  it("names objects exactly like the publish/promote/check scripts", () => {
    for (const key of ["m15/w.png", "m15/pt/w.webp", "m15pw/loyaltyup.png", "noext"]) {
      expect(frameObjectKey(key, "0123456789ab")).toBe(scriptObjectKey(key, "0123456789ab"));
    }
  });
});
