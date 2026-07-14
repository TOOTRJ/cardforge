import "server-only";

import { experimental_generateImage as generateImage, generateText } from "ai";
import { isGatewayConfigured } from "@/lib/ai/provider";

// ---------------------------------------------------------------------------
// Image generation + image-to-image restyle. ALL image generation goes through
// the Vercel AI Gateway — there is deliberately NO direct-OpenAI fallback.
//
// A silent gateway→OpenAI fallback once ran every image on gpt-image-1 (~5×
// the FLUX cost, and far slower) for weeks because the gateway key wasn't set
// in prod. Images now always route through the gateway; if it's not configured
// or the call fails, we surface an error rather than quietly (and expensively)
// falling back. gpt-image-1 is never used.
//
//   - Text-to-image (batch/deck/set art): FLUX via the gateway
//     (default bfl/flux-2-flex, override AI_IMAGE_MODEL).
//   - Image-to-image restyle ("AI remix"): a multimodal gateway model
//     (default google/gemini-2.5-flash-image, override AI_IMAGE_REMIX_MODEL)
//     via generateText — the edited image comes back in result.files.
// ---------------------------------------------------------------------------

const GATEWAY_REMIX_DEFAULT = "google/gemini-2.5-flash-image";

/** Hard ceiling on a single image call. The step route's function budget is
 *  180s (maxDuration); an unbounded gateway hang used to ride straight into
 *  that platform kill, which axed the request AFTER the credit spend + card
 *  insert but BEFORE the step result persisted — the root cause of the
 *  2026-07-14 duplicate-card/credit-drain incident. Aborting turns a hang
 *  into a HANDLED failure (step patched "failed", credit refunded, retry
 *  offered).
 *
 *  Steps that make ONE image call use the 100s default. Steps that stack
 *  several bounded calls (remix: identity 30s + source fetch 10s + restyle +
 *  t2i fallback) pass tighter per-call budgets so the SUM stays inside 180s
 *  — a single generous cap does not compose. */
const IMAGE_CALL_TIMEOUT_MS = 100_000;

export type ImageCallOptions = {
  /** Override the per-call abort budget (ms). */
  timeoutMs?: number;
};

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
  return isGatewayConfigured();
}

/** Re-render `source` in a new style. `prompt` should describe both the
 *  target style and what must stay (subject, composition). */
export async function restyleImage(input: {
  source: Uint8Array;
  sourceContentType: string;
  prompt: string;
  timeoutMs?: number;
}): Promise<RestyleResult> {
  const prompt = input.prompt.trim().slice(0, 2000);
  if (!prompt) return { ok: false, error: "Missing restyle prompt." };

  if (!isGatewayConfigured()) {
    return { ok: false, error: "AI Gateway isn't configured." };
  }
  return restyleViaGateway(
    input.source,
    input.sourceContentType,
    prompt,
    input.timeoutMs,
  );
}

// ---------------------------------------------------------------------------
// Text-to-image through the gateway (batch/set art). FLUX is the default —
// cheap (~$0.03/image), fast, and strong at consistent painterly fantasy.
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
  options: ImageCallOptions = {},
): Promise<RestyleResult> {
  if (!isGatewayConfigured()) {
    return { ok: false, error: "AI Gateway isn't configured." };
  }
  try {
    const model = process.env.AI_IMAGE_MODEL?.trim() || GATEWAY_IMAGE_DEFAULT;
    const { image } = await generateImage({
      model,
      abortSignal: AbortSignal.timeout(
        options.timeoutMs ?? IMAGE_CALL_TIMEOUT_MS,
      ),
      // One retry within the abort budget — the SDK default (2) can push a
      // slow-failing call past the timeout for no user-visible benefit.
      maxRetries: 1,
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
 * Text-to-image returning raw bytes (batch jobs persist via
 * persistGeneratedArt). Gateway-only — a thin alias over generateStyledImage
 * so callers read as "plain image, no style extras". Never touches OpenAI.
 */
export async function generatePlainImage(
  prompt: string,
  aspect: ImageAspect = "square",
  options: ImageCallOptions = {},
): Promise<RestyleResult> {
  const trimmed = prompt.trim().slice(0, 4000);
  if (!trimmed) return { ok: false, error: "Missing image prompt." };
  return generateStyledImage(trimmed, aspect, options);
}

async function restyleViaGateway(
  source: Uint8Array,
  sourceContentType: string,
  prompt: string,
  timeoutMs?: number,
): Promise<RestyleResult> {
  try {
    const model =
      process.env.AI_IMAGE_REMIX_MODEL?.trim() || GATEWAY_REMIX_DEFAULT;
    const result = await generateText({
      model,
      abortSignal: AbortSignal.timeout(timeoutMs ?? IMAGE_CALL_TIMEOUT_MS),
      maxRetries: 1,
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
