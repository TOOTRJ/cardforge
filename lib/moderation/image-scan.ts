import "server-only";

import OpenAI from "openai";

// Unsafe-image auto-scan via OpenAI's free omni-moderation model (image
// input). Used on human uploads (art, watermarks, custom pips) — AI-generated
// art is NOT scanned (providers filter upstream; owner decision 2026-07-10).
// FAILS OPEN: if the key is missing or the API errors, we don't block the
// upload (matches the app's "don't wedge the feature" posture) — the manual
// report path remains the backstop.
//
// Only the categories below block an upload (owner decision, 2026-07-10).
// OpenAI's top-level `flagged` verdict fires on EVERY category — including
// violence/gore, which normal fantasy art trips constantly — so we ignore it
// and check our own category allowlist instead.

const BLOCKED_CATEGORIES = new Set([
  "sexual",
  "sexual/minors",
  "self-harm",
  "self-harm/intent",
  "self-harm/instructions",
  "hate",
  "hate/threatening",
]);

export type ImageScanResult = { flagged: boolean; categories: string[] };

export async function scanImageUrl(url: string): Promise<ImageScanResult> {
  const apiKey = process.env.OPENAI_API_KEY?.trim();
  if (!apiKey) return { flagged: false, categories: [] };

  try {
    const client = new OpenAI({ apiKey, timeout: 20_000 });
    const response = await client.moderations.create({
      model: "omni-moderation-latest",
      input: [{ type: "image_url", image_url: { url } }],
    });
    const result = response.results?.[0];
    if (!result?.flagged) return { flagged: false, categories: [] };

    const categories = Object.entries(result.categories ?? {})
      .filter(([name, on]) => Boolean(on) && BLOCKED_CATEGORIES.has(name))
      .map(([name]) => name);
    return { flagged: categories.length > 0, categories };
  } catch {
    return { flagged: false, categories: [] };
  }
}
