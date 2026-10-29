// ---------------------------------------------------------------------------
// Screen-width buckets (TODO WD9) — our own check on the StatCounter
// screen-share figures the width plan relied on. One anonymous
// `screen_width` funnel event per tab session, carrying a BUCKET and nothing
// else: never the exact width, the user agent, the screen resolution, a user
// id or any other identifier (/api/events records it with user_id NULL even
// for a signed-in visitor). Client-safe and pure; the beacon is
// components/analytics/screen-width-beacon.tsx, the readout the admin Funnel
// panel's "Screen widths" table.
// ---------------------------------------------------------------------------

/** Lower bounds in CSS px; each bucket runs to the next one's minimum − 1.
 *  `key` is what a row stores (the funnel props' safe characters — no "<",
 *  "+" or en dash), `label` what the admin table prints. */
export const SCREEN_WIDTH_BUCKETS = [
  { key: "0-639", label: "<640", min: 0 },
  { key: "640-1023", label: "640–1023", min: 640 },
  { key: "1024-1365", label: "1024–1365", min: 1024 },
  { key: "1366-1535", label: "1366–1535", min: 1366 },
  { key: "1536-1919", label: "1536–1919", min: 1536 },
  { key: "1920-2559", label: "1920–2559", min: 1920 },
  { key: "2560-up", label: "2560+", min: 2560 },
] as const;

export type ScreenWidthBucket = (typeof SCREEN_WIDTH_BUCKETS)[number]["key"];

/** The sessionStorage flag: set once the tab has reported its bucket. */
export const SCREEN_WIDTH_STORAGE_KEY = "pg_screen_width_v1";

/** The bucket for a viewport width in CSS px (`window.innerWidth`), or null
 *  for a width that isn't one (0, negative, NaN — a page with no viewport). */
export function screenWidthBucket(width: number): ScreenWidthBucket | null {
  if (!Number.isFinite(width) || width <= 0) return null;
  const px = Math.floor(width);
  let bucket: ScreenWidthBucket = SCREEN_WIDTH_BUCKETS[0].key;
  for (const b of SCREEN_WIDTH_BUCKETS) if (px >= b.min) bucket = b.key;
  return bucket;
}

export function isScreenWidthBucket(value: unknown): value is ScreenWidthBucket {
  return typeof value === "string" && SCREEN_WIDTH_BUCKETS.some((b) => b.key === value);
}

/** The ONLY props a `screen_width` row may carry: a known bucket key, alone.
 *  Anything else in the body is dropped; no valid bucket → no row. */
export function screenWidthProps(input: unknown): { bucket: ScreenWidthBucket } | null {
  if (!input || typeof input !== "object") return null;
  const bucket = (input as Record<string, unknown>).bucket;
  return isScreenWidthBucket(bucket) ? { bucket } : null;
}

/**
 * Report the tab's bucket once per tab session. The flag is set BEFORE the
 * send, and a storage that can't be read or written (blocked, private mode,
 * full) sends nothing: without the flag every reload would count again, and
 * a missing session is better than a double one. Returns whether it sent.
 */
export function reportScreenWidthOnce(deps: {
  storage: () => Pick<Storage, "getItem" | "setItem">;
  width: number;
  send: (bucket: ScreenWidthBucket) => void;
}): boolean {
  const bucket = screenWidthBucket(deps.width);
  if (!bucket) return false;
  try {
    const storage = deps.storage();
    if (storage.getItem(SCREEN_WIDTH_STORAGE_KEY) != null) return false;
    storage.setItem(SCREEN_WIDTH_STORAGE_KEY, "1");
  } catch {
    return false;
  }
  deps.send(bucket);
  return true;
}
