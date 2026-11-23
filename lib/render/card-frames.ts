import "server-only";
import { DEFAULT_FRAME_TEMPLATE } from "@/types/card";
import { FRAME_MASTER_KEYS, FRAME_PLATE_KEYS } from "@/lib/cards/frame-reference-registry";

import { createHash } from "node:crypto";
import fs from "node:fs";
import path from "node:path";
import { getSiteBaseUrl } from "@/lib/site-url";
import { frameManifestEntry, frameUrl } from "@/lib/frames/frame-url";

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
//   1. The filesystem (`public/…` under process.cwd()) when this tree
//      holds the folder's git files (LOCAL_TREE_SENTINELS — a file known to
//      be in git, never the folder alone): local dev, tests, CI, and any
//      deployment that still traces the folder into the function. A file
//      absent beside the sentinel does not exist — nothing is fetched.
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
// that, a transparent pixel — logged — but for a frame MASTER, which throws
// FrameAssetUnavailableError rather than draw another template's frame for
// one it never loaded.
//
// Fetch origin, in order: RENDER_ASSET_ORIGIN (explicit override), the
// site URL (lib/site-url.ts: NEXT_PUBLIC_SITE_URL → production URL →
// VERCEL_URL), then the production URL as a last resort. Preview
// deployments sit behind Vercel Authentication; set
// VERCEL_AUTOMATION_BYPASS_SECRET (Deployment Protection → Protection
// Bypass for Automation) so a preview can fetch its OWN frames — without
// it a preview falls through to production's copy, which only matters for
// a PR that adds or changes a frame PNG.
//
// THIRD SOURCE — the `frames` storage bucket (frames plan 4.2). A path
// listed in lib/frames/frame-manifest.json is not in git at all: it is
// fetched from its content-addressed bucket URL (lib/frames/frame-url.ts),
// checked against the manifest's sha256 prefix, and cached under that URL.
// A replaced frame is a new URL, so a long-lived instance never keeps
// serving the old master (the old Map keyed on the path did, until a
// restart). The cache is an LRU bounded by size: Card Conjurer masters are
// ~2 MB each (~2.7 MB as data URLs), and an unbounded Map of every frame an
// instance ever rendered would eventually hold hundreds of MB.
//
// A bucket frame that can't be loaded is a FAULT, never an "absent optional
// asset" (CI's frames check guarantees production has every manifest
// object): the failure is logged, NOT cached (the next render retries), and
// the render throws FrameAssetUnavailableError instead of baking a frameless
// card or another template's frame — a bake/sweep then records a failure
// rather than storing a wrong image stamped current.
//
// A git asset follows the same rule for a failure that may PASS (storage
// that is busy is not storage that lacks the file): a CDN timeout, a refused
// connection, a 5xx or a 429, an origin that answers nothing but a non-image
// — logged, never cached, and a preload that asked for it throws
// FrameAssetUnavailableError. Only a DEFINITIVE miss is remembered and drawn
// as absent (a git template with no master for a key falls back to the
// default template's, an absent plate draws none): a 404 from the
// deployment, or a file absent from a local tree that holds the folder's
// git files (a checkout, CI, a test: LOCAL_TREE_SENTINELS). After a CDN
// TIMEOUT, or an asset's second failure in a row (never one 5xx), it fails
// at once for CDN_FAILURE_RETRY_MS so an outage doesn't make every render
// wait out the timeouts — never cached as a miss. A re-bake batch sets a
// card it can't load an asset for aside and strikes no card for an asset
// that is down for everyone (lib/cards/rebake-batch.ts). Before, one
// 503 cached the miss and the 1993 frame drew M15's master for the rest of
// the instance's life, its bake stored as current.
// ---------------------------------------------------------------------------


const FETCH_TIMEOUT_MS = 10_000;
/** A frame master is ~1–3 MB; refuse anything absurd from a misconfigured origin. */
const MAX_ASSET_BYTES = 16 * 1024 * 1024;

/** Cache budget in data-URL characters (≈ bytes) — ~70 Card Conjurer
 *  masters, or every MSE frame a typical instance touches. */
const MAX_CACHE_CHARS = 192 * 1024 * 1024;

/**
 * cache key → data URL, or null when the asset does not exist at any
 * source. The key is the public-relative path ("frames/m15/w.png") for a
 * file still in git, or the content-addressed bucket URL for a manifest
 * entry. LRU: a read refreshes recency; an insert evicts the least recent
 * entries once the budget is exceeded (misses cost nothing and are kept).
 */
class AssetCache {
  private map = new Map<string, string | null>();
  private chars = 0;
  constructor(private readonly budget: number) {}
  get(key: string): string | null | undefined {
    if (!this.map.has(key)) return undefined;
    const value = this.map.get(key) as string | null;
    this.map.delete(key);
    this.map.set(key, value);
    return value;
  }
  set(key: string, value: string | null): void {
    const previous = this.map.get(key);
    if (typeof previous === "string") this.chars -= previous.length;
    this.map.delete(key);
    this.map.set(key, value);
    if (typeof value === "string") this.chars += value.length;
    for (const [oldKey, oldValue] of this.map) {
      if (this.chars <= this.budget || oldKey === key) break;
      this.map.delete(oldKey);
      if (typeof oldValue === "string") this.chars -= oldValue.length;
    }
  }
  clear(): void {
    this.map.clear();
    this.chars = 0;
  }
  get size(): number {
    return this.map.size;
  }
  get usedChars(): number {
    return this.chars;
  }
}

const CACHE = new AssetCache(MAX_CACHE_CHARS);

/** How long a git asset the CDN just failed on fails at once (loadAsync):
 *  long enough that an outage doesn't make every render wait out the fetch
 *  timeouts per asset, short enough that a blip is over by the next sweep. */
const CDN_FAILURE_RETRY_MS = 30_000;

/** Failures of one asset further apart than this aren't "in a row". */
const CDN_FAILURE_STREAK_MS = 2 * CDN_FAILURE_RETRY_MS;

/** Public-relative path → its CDN failures in a row and, once the window is
 *  open, when its next attempt may run. The window opens only where waiting
 *  again would cost — after a TIMEOUT, or the asset's second failure in a
 *  row — never on one 5xx: a blip must not fail the renders after it (a
 *  re-bake batch reads the same badge for eight walkers in a row). Never a
 *  miss: a preload inside the window still throws
 *  FrameAssetUnavailableError. */
const CDN_FAILURES = new Map<string, { count: number; at: number; until: number | null }>();

/** A frame asset a render needs could not be loaded right now — a frames
 *  bucket object, or a git asset whose CDN fetch failed in a way that may
 *  pass (see header). The render fails instead of drawing a stand-in. */
export class FrameAssetUnavailableError extends Error {
  constructor(readonly paths: string[]) {
    super(`Frame asset(s) unavailable: ${paths.join(", ")}`);
    this.name = "FrameAssetUnavailableError";
  }
}

/** A load that failed in a way that may pass (see header) — as opposed to
 *  `null`, an asset that does not exist. Never cached: the next render
 *  retries. */
const UNAVAILABLE: unique symbol = Symbol("frame-asset-unavailable");
type Loaded = string | null | typeof UNAVAILABLE;

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

/**
 * One file per public folder the loader reads that is known to be IN GIT
 * (never a frames-manifest object): on disk, this tree holds the folder's
 * git files — a checkout, CI, a test — so a file absent beside it does not
 * exist; absent, the folder wasn't deployed with the function (Vercel:
 * next.config.ts traces no `public/frames`) and the CDN has the files.
 * Never the folder itself: a deployment that ever carried an empty or
 * partial `public/frames` would read every git master as missing and draw
 * M15's for the instance's life. tests/unit/render/card-frames.test.ts
 * holds each to git, outside the manifest.
 */
export const LOCAL_TREE_SENTINELS: Readonly<Record<string, string>> = {
  frames: "frames/agclassic/w.png",
  watermarks: "watermarks/pipglyph-rose.png",
};

/** Sync read from public/: the data URL when the file is on disk; `null`
 *  when it isn't but this tree holds its folder's git files
 *  (LOCAL_TREE_SENTINELS — the asset does not exist); `undefined` when the
 *  tree doesn't (fetch it from the CDN); UNAVAILABLE when the file is there
 *  but can't be read. */
function readLocal(rel: string): string | null | undefined | typeof UNAVAILABLE {
  const publicDir = path.join(process.cwd(), "public");
  const abs = path.join(publicDir, rel);
  if (!fs.existsSync(abs)) {
    const sentinel = LOCAL_TREE_SENTINELS[rel.split("/")[0]];
    return sentinel && fs.existsSync(path.join(publicDir, sentinel)) ? null : undefined;
  }
  try {
    return toDataUrl(fs.readFileSync(abs));
  } catch (err) {
    console.error(`[card-frames] ${rel} is on disk but can't be read: ${err instanceof Error ? err.message : String(err)}`);
    return UNAVAILABLE;
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

/** One origin's answer for a git asset: the file; MISSING — the deployment
 *  says it has no such file (404 / 410); SKIPPED — it answered, but not with
 *  the file and not about it (a protected preview's 401 / 403, or its 200
 *  HTML sign-in page): it proves nothing either way; FAILED — a failure that
 *  may pass (a timeout, a refused connection, a 5xx, a 429, a body we can't
 *  take). */
type OriginAnswer =
  | { kind: "found"; bytes: Buffer }
  | { kind: "missing" | "skipped" | "failed"; reason: string; timedOut?: true };

async function fetchFromOrigin(origin: string, rel: string): Promise<OriginAnswer> {
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
    if (response.status === 404 || response.status === 410) return { kind: "missing", reason: `HTTP ${response.status}` };
    if (response.status === 401 || response.status === 403) return { kind: "skipped", reason: `HTTP ${response.status}` };
    if (!response.ok) return { kind: "failed", reason: `HTTP ${response.status}` };
    const type = response.headers.get("content-type") ?? "";
    // A protected preview answers 200 with an HTML sign-in page.
    if (!type.startsWith("image/")) return { kind: "skipped", reason: `content-type ${type || "missing"}` };
    const bytes = Buffer.from(await response.arrayBuffer());
    if (bytes.byteLength === 0 || bytes.byteLength > MAX_ASSET_BYTES) return { kind: "failed", reason: `${bytes.byteLength} bytes` };
    return { kind: "found", bytes };
  } catch (err) {
    if (controller.signal.aborted) return { kind: "failed", reason: `timed out after ${FETCH_TIMEOUT_MS} ms`, timedOut: true };
    return { kind: "failed", reason: err instanceof Error ? err.message : "fetch failed" };
  } finally {
    clearTimeout(timer);
  }
}

/** Fetch a manifest asset from its bucket URL and check the bytes against
 *  the manifest's full sha256 — the bake must draw exactly what was
 *  published. Every failure is logged with its reason. */
async function fetchFromBucket(url: string, expectedSha256: string): Promise<string | null> {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), FETCH_TIMEOUT_MS);
  const fail = (reason: string) => {
    console.error(`[card-frames] bucket frame ${url} unavailable: ${reason}`);
    return null;
  };
  try {
    const response = await fetch(url, { signal: controller.signal, cache: "no-store" });
    if (!response.ok) return fail(`HTTP ${response.status}`);
    const type = response.headers.get("content-type") ?? "";
    if (!type.startsWith("image/")) return fail(`content-type ${type || "missing"}`);
    const bytes = Buffer.from(await response.arrayBuffer());
    if (bytes.byteLength === 0 || bytes.byteLength > MAX_ASSET_BYTES) return fail(`${bytes.byteLength} bytes`);
    const actual = createHash("sha256").update(bytes).digest("hex");
    if (actual !== expectedSha256) return fail(`sha256 ${actual.slice(0, 12)}… ≠ manifest ${expectedSha256.slice(0, 12)}…`);
    return toDataUrl(bytes);
  } catch (err) {
    return fail(controller.signal.aborted ? `timed out after ${FETCH_TIMEOUT_MS} ms` : err instanceof Error ? err.message : "fetch failed");
  } finally {
    clearTimeout(timer);
  }
}

/** A git asset from the deployment's CDN, origin by origin: the first
 *  origin that has it wins. It is ABSENT (null, cached) only when an origin
 *  said 404 and none failed in a way that may pass; any such failure with
 *  no file anywhere — or no origin that answered about the file at all —
 *  is UNAVAILABLE (logged, never cached); `timedOut` when an origin timed
 *  out (what opens the retry window at once). */
async function fetchRemote(rel: string): Promise<{ value: Loaded; timedOut: boolean }> {
  const answers: { origin: string; answer: Exclude<OriginAnswer, { kind: "found" }> }[] = [];
  for (const origin of assetOrigins()) {
    const answer = await fetchFromOrigin(origin, rel);
    if (answer.kind === "found") return { value: toDataUrl(answer.bytes), timedOut: false };
    answers.push({ origin, answer });
  }
  const failed = answers.some(({ answer }) => answer.kind === "failed");
  if (!failed && answers.some(({ answer }) => answer.kind === "missing")) return { value: null, timedOut: false };
  console.error(
    `[card-frames] ${rel} unavailable from the deployment CDN (not cached; the next render retries): ${
      answers.map(({ origin, answer }) => `${origin} ${answer.kind} (${answer.reason})`).join("; ") || "no asset origin"
    }`,
  );
  return { value: UNAVAILABLE, timedOut: answers.some(({ answer }) => answer.timedOut === true) };
}

// ---------------------------------------------------------------------------
// Cache access
// ---------------------------------------------------------------------------

/** Async load: cache → (bucket for a manifest entry | disk → CDN). Only an
 *  answer is memoized — the file, or a git asset that does not exist (an
 *  absent optional asset isn't re-fetched on every render); a failure that
 *  may pass (a bucket fault, a CDN timeout / 5xx / 429) is UNAVAILABLE and
 *  never cached — the next render retries (see the header). A manifest
 *  entry never answers null: it exists by definition. */
async function loadAsync(rel: string): Promise<Loaded> {
  const entry = frameManifestEntry(rel);
  const key = entry ? frameUrl(rel) : rel;
  const cached = CACHE.get(key);
  if (cached !== undefined) return cached;
  if (entry) {
    if (!key.startsWith("http")) {
      console.error(`[card-frames] ${rel} is a bucket frame but no frame origin is configured (NEXT_PUBLIC_FRAME_ORIGIN / NEXT_PUBLIC_SUPABASE_URL).`);
      return UNAVAILABLE;
    }
    const value = await fetchFromBucket(key, entry.sha256);
    if (value === null) return UNAVAILABLE;
    CACHE.set(key, value);
    return value;
  }
  const local = readLocal(rel);
  if (local === null) console.warn(`[card-frames] ${rel} is not in this checkout's public/ — drawn as absent.`);
  if (local !== undefined) {
    if (local !== UNAVAILABLE) CACHE.set(key, local);
    return local;
  }
  // A CDN outage (a timeout, or a second failure in a row — CDN_FAILURES)
  // fails renders at once for a short while instead of each waiting out the
  // timeouts again; one 5xx leaves the next render free to retry. Never
  // cached as a miss.
  const previous = CDN_FAILURES.get(rel);
  if (previous?.until != null && Date.now() < previous.until) return UNAVAILABLE;
  const { value, timedOut } = await fetchRemote(rel);
  if (value === UNAVAILABLE) {
    const at = Date.now();
    const count = previous && at - previous.at <= CDN_FAILURE_STREAK_MS ? previous.count + 1 : 1;
    CDN_FAILURES.set(rel, { count, at, until: timedOut || count >= 2 ? at + CDN_FAILURE_RETRY_MS : null });
    return value;
  }
  CDN_FAILURES.delete(rel);
  CACHE.set(key, value);
  return value;
}

/** Sync read for the renderer's JSX: cache → disk. The data URL; null for
 *  a git asset that does not exist (cached); undefined when it is UNKNOWN —
 *  neither preloaded nor readable here (a bug in the preload path list, an
 *  entry evicted since, a misconfigured asset origin): logged. */
function loadSyncState(rel: string): string | null | undefined {
  const entry = frameManifestEntry(rel);
  const key = entry ? frameUrl(rel) : rel;
  const cached = CACHE.get(key);
  if (cached !== undefined) return cached;
  if (entry) {
    console.warn(
      `[card-frames] ${rel} (bucket object) was not preloaded — rendering it as a transparent pixel.`,
    );
    return undefined;
  }
  const local = readLocal(rel);
  if (typeof local === "string") {
    CACHE.set(rel, local);
    return local;
  }
  if (local === null) {
    console.warn(`[card-frames] ${rel} was not preloaded and is not on disk — drawn as absent.`);
    CACHE.set(rel, null);
    return null;
  }
  console.warn(
    `[card-frames] ${rel} was not preloaded and is not readable here — rendering it as a transparent pixel.`,
  );
  return undefined;
}

/** loadSyncState with "unknown" read as absent — every getter but the
 *  frame master's, which never substitutes another template's frame for
 *  one it doesn't know is missing. */
function loadSync(rel: string): string | null {
  return loadSyncState(rel) ?? null;
}

/**
 * Warm the cache for every asset a render will ask for synchronously.
 * Resolves once each path is cached (present or confirmed missing); throws
 * FrameAssetUnavailableError for any that can't be loaded right now — a
 * bucket object, or a git asset the CDN failed on — and never caches it.
 */
export async function preloadFrameAssets(publicPaths: Iterable<string>): Promise<void> {
  const unique = Array.from(new Set(Array.from(publicPaths, relPath)));
  const values = await Promise.all(unique.map((rel) => loadAsync(rel)));
  const unavailable = unique.filter((_, i) => values[i] === UNAVAILABLE);
  if (unavailable.length) throw new FrameAssetUnavailableError(unavailable);
}

/**
 * Warm the frame PNG for a template/color, and — only if that template has
 * no such file — the default template's, mirroring getFrameDataUrl's
 * fallback so the sync getter never has to fetch.
 */
export async function preloadFrame(template: string, colorKey: string): Promise<void> {
  const key = normalizeMasterKey(colorKey);
  const primaryRel = relPath(frameAssetPath(template, key));
  const primary = await loadAsync(primaryRel);
  if (typeof primary === "string") return;
  // A master that can't be loaded RIGHT NOW — a published bucket master, or
  // a git master the CDN failed on (a timeout, a 5xx, a 429) — must not
  // quietly become another template's frame (the preview would still show
  // the real one): the render fails and the next one retries.
  if (primary === UNAVAILABLE) throw new FrameAssetUnavailableError([primaryRel]);
  // A git template with NO master for the key (a definitive miss): the
  // default template's, as getFrameDataUrl draws it.
  if (template !== DEFAULT_FRAME_TEMPLATE) {
    const fallbackRel = relPath(frameAssetPath(DEFAULT_FRAME_TEMPLATE, key));
    if ((await loadAsync(fallbackRel)) === UNAVAILABLE) {
      throw new FrameAssetUnavailableError([fallbackRel]);
    }
  }
}

/**
 * One frame master's PNG bytes, through the same cache and sources as the
 * bake (a bucket master sha256-checked against the manifest) — for checks
 * that judge the master itself, like the art-window gate on a frame-layout
 * save (lib/frames/art-window-override.ts). No fallback to the default
 * template's master: null when the template has no master for that key; a
 * master that can't be loaded right now (a bucket master, or a git master
 * the CDN failed on) throws FrameAssetUnavailableError.
 */
export async function loadFrameMasterBytes(template: string, colorKey: string): Promise<Buffer | null> {
  const rel = relPath(frameAssetPath(template, colorKey));
  const value = await loadAsync(rel);
  if (value === UNAVAILABLE) throw new FrameAssetUnavailableError([rel]);
  if (value === null) return null;
  return Buffer.from(value.slice(value.indexOf(",") + 1), "base64");
}

// ---------------------------------------------------------------------------
// Paths
// ---------------------------------------------------------------------------

// ONE key list per asset family (TODO 4.6.0, bake/preview key parity). The
// preview builds its URLs from the key as given (frameImageUrl,
// resolveColorAsset), so a key this loader doesn't know must never quietly
// become another file here: a frame master outside FRAME_MASTER_KEYS or a
// plate outside FRAME_PLATE_KEYS is a bug in the caller and still reads as
// "c" (as it always did — no stored card has one), and an overlay has no
// fallback at all (getFrameOverlayDataUrl). tests/unit/render/
// anatomy-key-parity.test.ts holds every key a profile can produce to the
// same path in both renderers.

/** A frame master key (FRAME_MASTER_KEYS: the colour keys, Alpha's artifact
 *  card "a" and the two-colour pair masters — frameMasterKey); anything
 *  else → "c". */
function normalizeMasterKey(colorKey: string): string {
  return (FRAME_MASTER_KEYS as readonly string[]).includes(colorKey)
    ? colorKey
    : "c";
}

/** A stat-plate key (FRAME_PLATE_KEYS, plateKeyFor); anything else → "c". */
function normalizePlateKey(colorKey: string): string {
  return (FRAME_PLATE_KEYS as readonly string[]).includes(colorKey)
    ? colorKey
    : "c";
}

/** "/frames/<template>/<color>.png" — the frame master for a template/color. */
export function frameAssetPath(template: string, colorKey: string): string {
  return `/frames/${template}/${normalizeMasterKey(colorKey)}.png`;
}

/** Resolve a per-color plate template like "/frames/m15/pt/{color}.png". */
export function plateAssetPath(pathTemplate: string, colorKey: string): string {
  return `/${relPath(pathTemplate.replace("{color}", normalizePlateKey(colorKey)))}`;
}

function watermarkAssetPath(key: string): string {
  const safe = key.replace(/[^a-z0-9-]/g, "");
  return `/watermarks/${safe}.png`;
}

// ---------------------------------------------------------------------------
// Sync getters used inside the renderer's JSX
// ---------------------------------------------------------------------------

/** Frame PNG as a data URL. A git template with NO master for the key (a
 *  definitive miss: an unknown or legacy template) falls back to the
 *  default template's, then to a 1×1 transparent pixel, so it never throws
 *  mid-render. A master that wasn't loaded — a bucket master, or a git
 *  master neither preloaded nor on disk (a preload that failed, an entry
 *  evicted since) — throws FrameAssetUnavailableError: never another
 *  template's frame for one that may well exist. */
export function getFrameDataUrl(template: string, colorKey: string): string {
  const key = normalizeMasterKey(colorKey);
  const primaryRel = relPath(frameAssetPath(template, key));
  // Masters are only ever read after preloadFrame, which throws on a
  // failure; never substitute another template's frame here. (A bucket
  // master is a string or unknown — it never reads as absent.)
  const primary = loadSyncState(primaryRel);
  if (typeof primary === "string") return primary;
  if (primary === undefined) throw new FrameAssetUnavailableError([primaryRel]);
  return loadSync(relPath(frameAssetPath(DEFAULT_FRAME_TEMPLATE, key))) ?? TRANSPARENT_PIXEL;
}

/** Resolve a per-color plate path like "/frames/m15/pt/{color}.png" to a data
 *  URL, or null when the asset doesn't exist (callers skip the plate). */
export function getPlateDataUrlForPath(
  pathTemplate: string,
  colorKey: string,
): string | null {
  return loadSync(relPath(plateAssetPath(pathTemplate, colorKey)));
}

/** An anatomy overlay (FrameProfile.overlays — the crown band, TODO 4.6.0)
 *  as a data URL, or null when a git asset is absent (the card then draws no
 *  overlay, logged by the loader). `publicPath` is resolveFrameOverlays'
 *  path, already checked against the slot's keys: there is no fallback key,
 *  and a frames-bucket overlay that failed to load throws
 *  FrameAssetUnavailableError, as a master does (preloadFrameAssets has
 *  already thrown for it via frameAssetPathsFor). */
export function getFrameOverlayDataUrl(publicPath: string): string | null {
  const rel = relPath(publicPath);
  const loaded = loadSync(rel);
  if (loaded === null && frameManifestEntry(rel)) throw new FrameAssetUnavailableError([rel]);
  return loaded;
}

/** Any other public/frames or frames-bucket asset a profile names (the
 *  basic-land symbol images, TODO 3.24) as a data URL, or null when absent.
 *  Sync, like every getter here: renderCardImage preloads it through
 *  frameAssetPathsFor first. */
export function getFrameAssetDataUrl(publicPath: string): string | null {
  return loadSync(relPath(publicPath));
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
  CDN_FAILURES.clear();
}

/** Test hook — cache occupancy. */
export function frameAssetCacheStatsForTests(): { entries: number; chars: number } {
  return { entries: CACHE.size, chars: CACHE.usedChars };
}
