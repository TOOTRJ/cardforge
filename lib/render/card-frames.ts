import "server-only";

import fs from "node:fs";
import path from "node:path";

// ---------------------------------------------------------------------------
// Server-side loader for the frame PNGs in public/frames/<template>/<color>.png
// and the painted P/T plates in public/frames/<template>/pt/<color>.png.
//
// Satori (next/og) can't reference a public/ URL the way the browser can, so
// we read the PNG bytes and hand the renderer a data: URL. Everything is read
// lazily and memoized per absolute path — the first render of a given
// frame/color pays one filesystem read; every render after is a Map hit. This
// is generic over the template name, so adding a new MSE frame needs no change
// here: just drop the PNGs and the bake picks them up.
// ---------------------------------------------------------------------------

const FRAME_COLOR_KEYS = ["w", "u", "b", "r", "g", "c", "m"] as const;
const DEFAULT_TEMPLATE = "m15";

const CACHE = new Map<string, string | null>();

function loadDataUrl(absPath: string): string | null {
  const cached = CACHE.get(absPath);
  if (cached !== undefined) return cached;
  let value: string | null = null;
  try {
    if (fs.existsSync(absPath)) {
      const bytes = fs.readFileSync(absPath);
      value = `data:image/png;base64,${bytes.toString("base64")}`;
    }
  } catch {
    value = null;
  }
  CACHE.set(absPath, value);
  return value;
}

function normalizeColor(colorKey: string): string {
  return (FRAME_COLOR_KEYS as readonly string[]).includes(colorKey)
    ? colorKey
    : "c";
}

function framePath(template: string, colorKey: string): string {
  return path.join(process.cwd(), "public", "frames", template, `${colorKey}.png`);
}

/** Frame PNG as a data URL. Falls back to the default template, then to a 1×1
 *  transparent pixel, so an unknown/legacy template never throws mid-render. */
export function getFrameDataUrl(template: string, colorKey: string): string {
  const key = normalizeColor(colorKey);
  return (
    loadDataUrl(framePath(template, key)) ??
    loadDataUrl(framePath(DEFAULT_TEMPLATE, key)) ??
    TRANSPARENT_PIXEL
  );
}

/** Resolve a per-color plate path like "/frames/m15/pt/{color}.png" to a data
 *  URL, or null when the asset doesn't exist (callers skip the plate). */
export function getPlateDataUrlForPath(
  pathTemplate: string,
  colorKey: string,
): string | null {
  const key = normalizeColor(colorKey);
  const resolved = pathTemplate.replace("{color}", key).replace(/^\//, "");
  return loadDataUrl(path.join(process.cwd(), "public", resolved));
}

/** Watermark preset PNG as a data URL (public/watermarks/{key}.png) —
 *  same fs-read + memoized-data-url pattern as the frames; a transparent
 *  pixel fallback means an unknown key never throws mid-render. */
export function getWatermarkDataUrl(key: string): string {
  const safe = key.replace(/[^a-z0-9-]/g, "");
  return (
    loadDataUrl(path.join(process.cwd(), "public", "watermarks", `${safe}.png`)) ??
    TRANSPARENT_PIXEL
  );
}

const TRANSPARENT_PIXEL =
  "data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mNk+M8AAAMBAQDJ/pLvAAAAAElFTkSuQmCC";
