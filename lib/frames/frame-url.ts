import manifestJson from "@/lib/frames/frame-manifest.json";

// ---------------------------------------------------------------------------
// Where a frame asset lives (frames plan 4.2). Isomorphic — the browser
// preview (components/cards/frame-layer.tsx, card-preview.tsx) and the bake
// (lib/render/card-frames.ts) resolve the same "/frames/<template>/<file>"
// path through here, so preview and bake always read the same bytes.
//
//   * A path listed in lib/frames/frame-manifest.json lives in the `frames`
//     storage bucket (migration 0116), content-addressed:
//     `${origin}/<template>/<name>.<hash>.<ext>`. Replacing a frame changes
//     its hash, so every cache (CDN, the bake's in-memory LRU, browsers)
//     sees a new URL — no restart, no stale master.
//   * Anything else is still a file in public/frames, served same-origin
//     exactly as before.
//
// Origin: NEXT_PUBLIC_FRAME_ORIGIN when set (Vercel Preview points every
// preview — including per-PR Supabase branches, whose buckets are empty — at
// the dev project's bucket; CI's e2e does the same), else the `frames`
// bucket of the Supabase project this deployment talks to
// (NEXT_PUBLIC_SUPABASE_URL: production reads production, local dev reads
// the dev branch). The env vars are referenced literally so Next inlines
// them into client bundles.
// ---------------------------------------------------------------------------

export type FrameManifestEntry = {
  /** First 12 hex chars of the file's sha256 — part of the object key. */
  hash: string;
  bytes: number;
  width: number;
  height: number;
};

export type FrameManifest = {
  version: 1;
  bucket: string;
  files: Record<string, FrameManifestEntry>;
};

let manifest: FrameManifest = manifestJson as FrameManifest;

export function resolveFrameOrigin(
  frameOrigin: string | undefined,
  supabaseUrl: string | undefined,
  bucket = "frames",
): string | null {
  const explicit = frameOrigin?.trim();
  if (explicit) return explicit.replace(/\/+$/, "");
  const base = supabaseUrl?.trim();
  if (!base) return null;
  return `${base.replace(/\/+$/, "")}/storage/v1/object/public/${bucket}`;
}

let origin: string | null = resolveFrameOrigin(
  process.env.NEXT_PUBLIC_FRAME_ORIGIN,
  process.env.NEXT_PUBLIC_SUPABASE_URL,
  manifest.bucket,
);

/** "/frames/m15/w.png" | "frames/m15/w.png" | "m15/w.png" → "m15/w.png". */
export function frameManifestKey(publicPath: string): string {
  return publicPath.replace(/^\/+/, "").replace(/^frames\//, "");
}

/** The bucket object key for a manifest entry: "m15/w.3fa9c2d1e0ab.png". */
export function frameObjectKey(key: string, hash: string): string {
  const dot = key.lastIndexOf(".");
  return dot < 0 ? `${key}.${hash}` : `${key.slice(0, dot)}.${hash}${key.slice(dot)}`;
}

/** The manifest entry for a frame path, or null when it is still in git. */
export function frameManifestEntry(publicPath: string): FrameManifestEntry | null {
  return manifest.files[frameManifestKey(publicPath)] ?? null;
}

/**
 * The URL to load a frame asset from: the bucket object for a manifest
 * entry, else the same-origin public path (unchanged behaviour). Pass the
 * EXACT variant wanted — ".webp" for the browser, ".png" for the bake —
 * each has its own entry and hash.
 */
export function frameUrl(publicPath: string): string {
  const key = frameManifestKey(publicPath);
  const entry = manifest.files[key];
  if (!entry || !origin) return `/frames/${key}`;
  return `${origin}/${frameObjectKey(key, entry.hash)}`;
}

/** Test hook: swap the manifest and/or origin (returns a restore fn). */
export function setFrameStorageForTests(next: { manifest?: FrameManifest; origin?: string | null }): () => void {
  const prev = { manifest, origin };
  if (next.manifest) manifest = next.manifest;
  if (next.origin !== undefined) origin = next.origin;
  return () => {
    manifest = prev.manifest;
    origin = prev.origin;
  };
}
