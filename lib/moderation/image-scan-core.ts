// ---------------------------------------------------------------------------
// The image moderation scan's rules — the request every scan sends and how an
// answer becomes a verdict — with no "server-only" and no SDK import, so the
// owner-run rescan of pre-0126 direct uploads
// (scripts/sweep-storage-orphans.mjs --rescan-review, TODO 3.14b) runs the
// SAME scan as the upload path (lib/moderation/image-scan.ts), not a copy.
//
// Only the categories below block an upload (owner decision, 2026-07-10).
// OpenAI's top-level `flagged` verdict fires on EVERY category — including
// violence/gore, which normal fantasy art trips constantly — so we ignore it
// and check our own category allowlist instead.
// ---------------------------------------------------------------------------

/** OpenAI's free omni-moderation model (image input). */
export const IMAGE_MODERATION_MODEL = "omni-moderation-latest";

/** How long one scan may take before the caller gives up on it. */
export const IMAGE_MODERATION_TIMEOUT_MS = 20_000;

export const BLOCKED_CATEGORIES: ReadonlySet<string> = new Set([
  "sexual",
  "sexual/minors",
  "self-harm",
  "self-harm/intent",
  "self-harm/instructions",
  "hate",
  "hate/threatening",
]);

export type ImageScanResult = { flagged: boolean; categories: string[] };

/** The moderation request for the image at `url` (OpenAI fetches it). */
export function imageModerationRequest(url: string) {
  return {
    model: IMAGE_MODERATION_MODEL,
    input: [{ type: "image_url" as const, image_url: { url } }],
  };
}

/** One moderation result → the verdict: flagged only for a blocked category. */
export function scanVerdict(
  result: { flagged?: boolean; categories?: object | null } | null | undefined,
): ImageScanResult {
  if (!result?.flagged) return { flagged: false, categories: [] };
  const categories = Object.entries(result.categories ?? {})
    .filter(([name, on]) => Boolean(on) && BLOCKED_CATEGORIES.has(name))
    .map(([name]) => name);
  return { flagged: categories.length > 0, categories };
}
