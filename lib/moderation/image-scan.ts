import "server-only";

import OpenAI from "openai";

// NSFW / unsafe-image auto-scan via OpenAI's free omni-moderation model (image
// input). Used on every art upload + AI generation. FAILS OPEN: if the key is
// missing or the API errors, we don't block the upload (matches the app's
// "don't wedge the feature" posture) — the manual report path remains the
// backstop.

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
      .filter(([, on]) => Boolean(on))
      .map(([name]) => name);
    return { flagged: true, categories };
  } catch {
    return { flagged: false, categories: [] };
  }
}
