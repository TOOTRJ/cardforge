import "server-only";

import { experimental_generateImage as generateImage, generateText } from "ai";
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

/** Map raw provider errors to something a user can act on. */
export function friendlyImageError(detail: string): string {
  const lower = detail.toLowerCase();
  if (lower.includes("safety") || lower.includes("policy") || lower.includes("blocked")) {
    return "The image was blocked by the provider's safety filter — try again (each retry rewords the prompt) or adjust the theme.";
  }
  if (lower.includes("rate limit") || lower.includes("429") || lower.includes("too many")) {
    return "The image provider is rate-limiting us — wait a moment and retry.";
  }
  if (lower.includes("quota") || lower.includes("billing") || lower.includes("insufficient")) {
    return "The image provider's quota/billing is exhausted on the server side.";
  }
  if (lower.includes("timeout") || lower.includes("timed out") || lower.includes("aborted")) {
    return "The image took too long to generate — retry usually works.";
  }
  if (lower.includes("unauthorized") || lower.includes("401") || lower.includes("403") || lower.includes("api key")) {
    return "The image provider rejected our credentials — check the AI keys on the server.";
  }
  return `Image generation failed: ${detail}`;
}

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

// ---------------------------------------------------------------------------
// Text-to-image through the gateway (batch/set art). FLUX is the default —
// cheap (~$0.03/image), fast, and strong at consistent painterly fantasy.
// Callers fall back to the OpenAI random-art path when this returns
// { ok: false } (e.g. no gateway configured).
// ---------------------------------------------------------------------------

const GATEWAY_IMAGE_DEFAULT = "bfl/flux-2-flex";

/** "card" matches the frame's art window (~4:3 — m15 slot is 84.4%×44% of a
 *  63×88 card ≈ 1.37:1), so generated art fits with no manual repositioning.
 *  "square" suits icons; "wide" (16:9) suits set cover tiles; "banner"
 *  (21:9) suits the deck hero, which crops covers to aspect-[5/2]. */
export type ImageAspect = "square" | "wide" | "card" | "banner";

export async function generateStyledImage(
  prompt: string,
  aspect: ImageAspect = "square",
): Promise<RestyleResult> {
  if (!isGatewayConfigured()) {
    return { ok: false, error: "AI Gateway isn't configured." };
  }
  try {
    const model = process.env.AI_IMAGE_MODEL?.trim() || GATEWAY_IMAGE_DEFAULT;
    const { image } = await generateImage({
      model,
      prompt: prompt.trim().slice(0, 4000),
      aspectRatio:
        aspect === "banner"
          ? "21:9"
          : aspect === "wide"
            ? "16:9"
            : aspect === "card"
              ? "4:3"
              : "1:1",
    });
    return {
      ok: true,
      bytes: image.uint8Array,
      contentType: image.mediaType ?? "image/png",
    };
  } catch (error) {
    const detail =
      error instanceof Error ? error.message : "Image generation failed.";
    return { ok: false, error: friendlyImageError(detail) };
  }
}

/**
 * Provider-agnostic text-to-image returning raw bytes (batch jobs persist
 * via persistGeneratedArt). Gateway first, then direct OpenAI with the same
 * minimal-param posture as lib/ai/random-art.ts.
 */
export async function generatePlainImage(
  prompt: string,
  aspect: ImageAspect = "square",
): Promise<RestyleResult> {
  const trimmed = prompt.trim().slice(0, 4000);
  if (!trimmed) return { ok: false, error: "Missing image prompt." };

  if (isGatewayConfigured()) {
    const viaGateway = await generateStyledImage(trimmed, aspect);
    if (viaGateway.ok) return viaGateway;
    // fall through to OpenAI when both are configured
  }
  if (!process.env.OPENAI_API_KEY?.trim()) {
    return { ok: false, error: "No image provider is configured." };
  }
  try {
    const client = new OpenAI({
      apiKey: process.env.OPENAI_API_KEY,
      timeout: 90_000,
    });
    const model = process.env.OPENAI_IMAGE_MODEL?.trim() || "gpt-image-1";
    const response = await client.images.generate({
      model,
      prompt: trimmed,
      // gpt-image has no 4:3 — its landscape 1536x1024 (3:2) is the closest
      // fit for both wide covers and card-window art.
      size: aspect === "square" ? "1024x1024" : "1536x1024",
      quality: model.startsWith("dall-e") ? "hd" : "high",
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
    return { ok: false, error: "OpenAI returned no image." };
  } catch (error) {
    const detail =
      error instanceof Error ? error.message : "Image generation failed.";
    return { ok: false, error: friendlyImageError(detail) };
  }
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
    return { ok: false, error: friendlyImageError(detail) };
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
    return { ok: false, error: friendlyImageError(detail) };
  }
}
