import "server-only";
import { DEFAULT_FRAME_TEMPLATE } from "@/types/card";
import { FRAME_COLOR_KEYS } from "@/lib/cards/frame-reference-registry";

import fs from "node:fs";
import path from "node:path";
import { getSiteBaseUrl } from "@/lib/site-url";

// ---------------------------------------------------------------------------
// Server-side loader for the frame PNGs in public/frames/<template>/<color>.png,
// the painted P/T plates in public/frames/<template>/pt/<color>.png, the
// planeswalker loyalty badges, and the watermark presets in public/watermarks.
//
// Satori (next/og) can't reference a public/ URL the way the browser can, so
// the renderer hands it a data: URL. Everything is memoized per public-relative
// path — the first render of a given asset pays one load; every render after
// is a Map hit (Fluid Compute keeps the module alive across invocations).
//
// WHERE THE BYTES COME FROM — two sources, same bytes, so the bake stays
// pixel-identical either way:
//
//   1. The filesystem (`public/…` under process.cwd()) when the file is
//      there: local dev, tests, and any deployment that still traces the
//      folder into the function.
//   2. Otherwise an HTTP fetch of the same file from the deployment's own
//      static CDN (`${site}/frames/…`). `public/frames` is ~163 MB of PNG
//      masters; when Next traced it into every function that can reach the
//      renderer (nearly all of them, via the save-time bake), each
//      deployment stored ~1.5 GB of function bundles and blew the Functions
//      Storage quota. next.config.ts now excludes `public/frames/**` from
//      tracing, so on Vercel the frames are fetched, not bundled. Fonts and
//      watermarks (< 2 MB) stay on disk.
//
// Source 2 is async while the renderer's JSX needs the data URL
// synchronously, so `renderCardImage` calls `preloadFrameAssets()` with the
// exact paths a card needs BEFORE building the tree (see
// frameAssetPathsFor in card-image.tsx). The sync getters below then read
// from the warmed cache; a miss falls back to the filesystem and, failing
// that, a transparent pixel — logged, never thrown mid-render.
//
// Fetch origin, in order: RENDER_ASSET_ORIGIN (explicit override), the
// site URL (lib/site-url.ts: NEXT_PUBLIC_SITE_URL → production URL →
// VERCEL_URL), then the production URL as a last resort. Preview
// deployments sit behind Vercel Authentication; set
// VERCEL_AUTOMATION_BYPASS_SECRET (Deployment Protection → Protection
// Bypass for Automation) so a preview can fetch its OWN frames — without
// it a preview falls through to production's copy, which only matters for
// a PR that adds or changes a frame PNG.
// ---------------------------------------------------------------------------


const FETCH_TIMEOUT_MS = 10_000;
/** A frame master is ~1–3 MB; refuse anything absurd from a misconfigured origin. */
const MAX_ASSET_BYTES = 16 * 1024 * 1024;

/** public-relative path ("frames/m15/w.png") → data URL, or null when the
 *  asset does not exist at any source. */
const CACHE = new Map<string, string | null>();

export const TRANSPARENT_PIXEL =
  "data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mNk+M8AAAMBAQDJ/pLvAAAAAElFTkSuQmCC";

function toDataUrl(bytes: Buffer): string {
  return `data:image/png;base64,${bytes.toString("base64")}`;
}

/** Normalize a "/frames/…" or "frames/…" reference to the cache key. */
function relPath(publicPath: string): string {
  return publicPath.replace(/^\/+/, "");
}

// ---------------------------------------------------------------------------
// Source 1: filesystem
// ---------------------------------------------------------------------------

/** Sync read from public/. `undefined` = not on disk (try the CDN);
 *  `null` = on disk but unreadable (treat as missing). */
function readLocal(rel: string): string | null | undefined {
  const abs = path.join(process.cwd(), "public", rel);
  try {
    if (!fs.existsSync(abs)) return undefined;
    return toDataUrl(fs.readFileSync(abs));
  } catch {
    return null;
  }
}

// ---------------------------------------------------------------------------
// Source 2: the deployment's own static CDN
// ---------------------------------------------------------------------------

function normalizeOrigin(value: string | undefined): string | null {
  const trimmed = value?.trim();
  if (!trimmed) return null;
  const withScheme = /^https?:\/\//i.test(trimmed) ? trimmed : `https://${trimmed}`;
  return withScheme.replace(/\/+$/, "");
}

/** Candidate origins to fetch public assets from, most specific first. */
export function assetOrigins(env: NodeJS.ProcessEnv = process.env): string[] {
  const candidates = [
    normalizeOrigin(env.RENDER_ASSET_ORIGIN),
    normalizeOrigin(getSiteBaseUrl()),
    normalizeOrigin(env.VERCEL_PROJECT_PRODUCTION_URL),
  ];
  const seen = new Set<string>();
  const out: string[] = [];
  for (const origin of candidates) {
    if (!origin || seen.has(origin)) continue;
    seen.add(origin);
    out.push(origin);
  }
  return out;
}

async function fetchFromOrigin(origin: string, rel: string): Promise<Buffer | null> {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), FETCH_TIMEOUT_MS);
  try {
    const headers: Record<string, string> = {};
    const bypass = process.env.VERCEL_AUTOMATION_BYPASS_SECRET;
    if (bypass) headers["x-vercel-protection-bypass"] = bypass;
    const response = await fetch(`${origin}/${rel}`, {
      headers,
      signal: controller.signal,
      // Our own Map is the cache; keep Next's data cache out of it.
      cache: "no-store",
    });
    if (!response.ok) return null;
    const type = response.headers.get("content-type") ?? "";
    // A protected preview answers 200 with an HTML sign-in page.
    if (!type.startsWith("image/")) return null;
    const bytes = Buffer.from(await response.arrayBuffer());
    if (bytes.byteLength === 0 || bytes.byteLength > MAX_ASSET_BYTES) return null;
    return bytes;
  } catch {
    return null;
  } finally {
    clearTimeout(timer);
  }
}

async function fetchRemote(rel: string): Promise<string | null> {
  for (const origin of assetOrigins()) {
    const bytes = await fetchFromOrigin(origin, rel);
    if (bytes) return toDataUrl(bytes);
  }
  return null;
}

// ---------------------------------------------------------------------------
// Cache access
// ---------------------------------------------------------------------------

/** Async load: cache → disk → CDN. Memoizes the outcome (including a miss,
 *  so an absent optional asset isn't re-fetched on every render). */
async function loadAsync(rel: string): Promise<string | null> {
  const cached = CACHE.get(rel);
  if (cached !== undefined) return cached;
  const local = readLocal(rel);
  const value = local !== undefined ? local : await fetchRemote(rel);
  CACHE.set(rel, value);
  return value;
}

/** Sync read for the renderer's JSX: cache → disk. A miss here means the
 *  asset was neither preloaded nor on disk — log it (it's a bug in the
 *  preload path list, or a misconfigured asset origin) and return null. */
function loadSync(rel: string): string | null {
  const cached = CACHE.get(rel);
  if (cached !== undefined) return cached;
  const local = readLocal(rel);
  if (local !== undefined) {
    CACHE.set(rel, local);
    return local;
  }
  console.warn(
    `[card-frames] ${rel} was not preloaded and is not on disk — rendering it as a transparent pixel.`,
  );
  return null;
}

/**
 * Warm the cache for every asset a render will ask for synchronously.
 * Resolves once each path is cached (present or confirmed missing).
 */
export async function preloadFrameAssets(publicPaths: Iterable<string>): Promise<void> {
  const unique = Array.from(new Set(Array.from(publicPaths, relPath)));
  await Promise.all(unique.map((rel) => loadAsync(rel)));
}

/**
 * Warm the frame PNG for a template/color, and — only if that template has
 * no such file — the default template's, mirroring getFrameDataUrl's
 * fallback so the sync getter never has to fetch.
 */
export async function preloadFrame(template: string, colorKey: string): Promise<void> {
  const key = normalizeColor(colorKey);
  const primary = await loadAsync(relPath(frameAssetPath(template, key)));
  if (primary === null && template !== DEFAULT_FRAME_TEMPLATE) {
    await loadAsync(relPath(frameAssetPath(DEFAULT_FRAME_TEMPLATE, key)));
  }
}

// ---------------------------------------------------------------------------
// Paths
// ---------------------------------------------------------------------------

function normalizeColor(colorKey: string): string {
  return (FRAME_COLOR_KEYS as readonly string[]).includes(colorKey)
    ? colorKey
    : "c";
}

/** "/frames/<template>/<color>.png" — the frame master for a template/color. */
export function frameAssetPath(template: string, colorKey: string): string {
  return `/frames/${template}/${normalizeColor(colorKey)}.png`;
}

/** Resolve a per-color plate template like "/frames/m15/pt/{color}.png". */
export function plateAssetPath(pathTemplate: string, colorKey: string): string {
  return `/${relPath(pathTemplate.replace("{color}", normalizeColor(colorKey)))}`;
}

function watermarkAssetPath(key: string): string {
  const safe = key.replace(/[^a-z0-9-]/g, "");
  return `/watermarks/${safe}.png`;
}

// ---------------------------------------------------------------------------
// Sync getters used inside the renderer's JSX
// ---------------------------------------------------------------------------

/** Frame PNG as a data URL. Falls back to the default template, then to a 1×1
 *  transparent pixel, so an unknown/legacy template never throws mid-render. */
export function getFrameDataUrl(template: string, colorKey: string): string {
  const key = normalizeColor(colorKey);
  return (
    loadSync(relPath(frameAssetPath(template, key))) ??
    loadSync(relPath(frameAssetPath(DEFAULT_FRAME_TEMPLATE, key))) ??
    TRANSPARENT_PIXEL
  );
}

/** Resolve a per-color plate path like "/frames/m15/pt/{color}.png" to a data
 *  URL, or null when the asset doesn't exist (callers skip the plate). */
export function getPlateDataUrlForPath(
  pathTemplate: string,
  colorKey: string,
): string | null {
  return loadSync(relPath(plateAssetPath(pathTemplate, colorKey)));
}

/** Watermark preset PNG as a data URL (public/watermarks/{key}.png) — the
 *  watermarks folder stays on disk (it's ~240 KB), so this is a plain
 *  filesystem read; a transparent pixel fallback means an unknown key never
 *  throws mid-render. */
export function getWatermarkDataUrl(key: string): string {
  return loadSync(relPath(watermarkAssetPath(key))) ?? TRANSPARENT_PIXEL;
}

/** Test hook — the cache is module-global. */
export function resetFrameAssetCacheForTests(): void {
  CACHE.clear();
}
