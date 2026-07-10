import "server-only";

import { generateText } from "ai";
import OpenAI, { toFile } from "openai";
import { isGatewayConfigured } from "@/lib/ai/provider";

// ---------------------------------------------------------------------------
// Image-to-image restyle — the engine behind "AI remix" (and later, deck
// remix). Takes the ORIGINAL artwork plus a style instruction and returns a
// re-rendered version, so remixes stay recognizably the same scene instead
// of a from-scratch guess.
//
// Provider order mirrors lib/ai/provider.ts:
//   1. Vercel AI Gateway (AI_GATEWAY_API_KEY): a multimodal image model
//      (default google/gemini-2.5-flash-image, override AI_IMAGE_REMIX_MODEL)
//      via generateText — the edited image comes back in result.files.
//   2. Direct OpenAI images.edit (gpt-image-1 / OPENAI_IMAGE_MODEL).
// ---------------------------------------------------------------------------

const GATEWAY_REMIX_DEFAULT = "google/gemini-2.5-flash-image";

export type RestyleResult =
  | { ok: true; bytes: Uint8Array; contentType: string }
  | { ok: false; error: string };

export function isImageRemixConfigured(): boolean {
  return isGatewayConfigured() || Boolean(process.env.OPENAI_API_KEY?.trim());
}

/** Re-render `source` in a new style. `prompt` should describe both the
 *  target style and what must stay (subject, composition). */
export async function restyleImage(input: {
  source: Uint8Array;
  sourceContentType: string;
  prompt: string;
}): Promise<RestyleResult> {
  const prompt = input.prompt.trim().slice(0, 2000);
  if (!prompt) return { ok: false, error: "Missing restyle prompt." };

  if (isGatewayConfigured()) {
    return restyleViaGateway(input.source, input.sourceContentType, prompt);
  }
  if (process.env.OPENAI_API_KEY?.trim()) {
    return restyleViaOpenAi(input.source, prompt);
  }
  return { ok: false, error: "No image provider is configured." };
}

async function restyleViaGateway(
  source: Uint8Array,
  sourceContentType: string,
  prompt: string,
): Promise<RestyleResult> {
  try {
    const model =
      process.env.AI_IMAGE_REMIX_MODEL?.trim() || GATEWAY_REMIX_DEFAULT;
    const result = await generateText({
      model,
      messages: [
        {
          role: "user",
          content: [
            { type: "image", image: source, mediaType: sourceContentType },
            { type: "text", text: prompt },
          ],
        },
      ],
      // Gemini image models want the image modality opted into explicitly;
      // ignored by providers that don't know the key.
      providerOptions: {
        google: { responseModalities: ["TEXT", "IMAGE"] },
      },
    });
    const file = result.files.find((f) => f.mediaType?.startsWith("image/"));
    if (!file) {
      return { ok: false, error: "The image model returned no image." };
    }
    return {
      ok: true,
      bytes: file.uint8Array,
      contentType: file.mediaType ?? "image/png",
    };
  } catch (error) {
    const detail =
      error instanceof Error ? error.message : "Image restyle failed.";
    return { ok: false, error: detail };
  }
}

async function restyleViaOpenAi(
  source: Uint8Array,
  prompt: string,
): Promise<RestyleResult> {
  try {
    const client = new OpenAI({
      apiKey: process.env.OPENAI_API_KEY,
      timeout: 90_000,
    });
    const model = process.env.OPENAI_IMAGE_MODEL?.trim() || "gpt-image-1";
    const response = await client.images.edit({
      model,
      image: await toFile(Buffer.from(source), "source.png", {
        type: "image/png",
      }),
      prompt,
      size: "1024x1024",
      n: 1,
    });
    const first = response.data?.[0];
    if (first?.b64_json) {
      return {
        ok: true,
        bytes: Uint8Array.from(Buffer.from(first.b64_json, "base64")),
        contentType: "image/png",
      };
    }
    if (first?.url) {
      const fetched = await fetch(first.url);
      if (!fetched.ok) {
        return { ok: false, error: `Image fetch failed (${fetched.status}).` };
      }
      return {
        ok: true,
        bytes: new Uint8Array(await fetched.arrayBuffer()),
        contentType: fetched.headers.get("content-type") ?? "image/png",
      };
    }
    return { ok: false, error: "OpenAI returned no edited image." };
  } catch (error) {
    const detail =
      error instanceof Error ? error.message : "Image restyle failed.";
    return { ok: false, error: detail };
  }
}
