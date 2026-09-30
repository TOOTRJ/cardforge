import "server-only";

import OpenAI from "openai";
import {
  IMAGE_MODERATION_TIMEOUT_MS,
  imageModerationRequest,
  scanVerdict,
  type ImageScanResult,
} from "@/lib/moderation/image-scan-core";
import { modelInputImage } from "@/lib/media/model-input";

// Unsafe-image auto-scan via OpenAI's free omni-moderation model (image
// input). Used on human uploads (art, watermarks, custom pips) — AI-generated
// art is NOT scanned (providers filter upstream; owner decision 2026-07-10).
// FAILS OPEN: if the key is missing or the API errors, we don't block the
// upload (matches the app's "don't wedge the feature" posture) — the manual
// report path remains the backstop.
//
// The request and the category allowlist live in
// lib/moderation/image-scan-core.ts, shared with the owner-run rescan of
// pre-0126 direct uploads (scripts/sweep-storage-orphans.mjs --rescan-review).

export type { ImageScanResult };

/**
 * Scan the stored image at `url`. Pass its `bytes` when they may be large
 * (card art, up to 20 MiB since TODO 6.10): over MODEL_INPUT_MAX_BYTES the
 * model gets a downscaled copy as a data: URL (lib/media/model-input.ts) —
 * OpenAI takes image files up to 20 MB, and a refused file would fail open,
 * i.e. go unscanned. Smaller files are scanned by URL, as before.
 */
export async function scanImageUrl(url: string, opts: { bytes?: Uint8Array } = {}): Promise<ImageScanResult> {
  const apiKey = process.env.OPENAI_API_KEY?.trim();
  if (!apiKey) return { flagged: false, categories: [] };

  try {
    const client = new OpenAI({ apiKey, timeout: IMAGE_MODERATION_TIMEOUT_MS });
    const response = await client.moderations.create(imageModerationRequest(await moderationInputUrl(url, opts.bytes)));
    return scanVerdict(response.results?.[0]);
  } catch {
    return { flagged: false, categories: [] };
  }
}

/** The URL the moderation request names: the stored object's own URL, or a
 *  data: URL of its downscaled copy when the file is too big to send as-is. */
export async function moderationInputUrl(url: string, bytes?: Uint8Array): Promise<string> {
  if (!bytes) return url;
  const input = await modelInputImage(bytes, "application/octet-stream");
  if (!input.downscaled) return url;
  return `data:${input.contentType};base64,${Buffer.from(input.bytes).toString("base64")}`;
}
