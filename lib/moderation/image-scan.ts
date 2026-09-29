import "server-only";

import OpenAI from "openai";
import {
  IMAGE_MODERATION_TIMEOUT_MS,
  imageModerationRequest,
  scanVerdict,
  type ImageScanResult,
} from "@/lib/moderation/image-scan-core";

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

export async function scanImageUrl(url: string): Promise<ImageScanResult> {
  const apiKey = process.env.OPENAI_API_KEY?.trim();
  if (!apiKey) return { flagged: false, categories: [] };

  try {
    const client = new OpenAI({ apiKey, timeout: IMAGE_MODERATION_TIMEOUT_MS });
    const response = await client.moderations.create(imageModerationRequest(url));
    return scanVerdict(response.results?.[0]);
  } catch {
    return { flagged: false, categories: [] };
  }
}
