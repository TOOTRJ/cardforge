import "server-only";
import {
  AI_FAILURE_COPY,
  classifyProviderError,
  imageFailureKind,
  type AiFailureKind,
} from "@/lib/ai/failure";

import { experimental_generateImage as generateImage, generateText } from "ai";
import { isGatewayConfigured } from "@/lib/ai/provider";
import { autoOrientBytes } from "@/lib/media/orientation";
import { imageWithoutMetadata } from "@/lib/media/upload-bytes";
import { modelInputImage } from "@/lib/media/model-input";
import type { ArtShape } from "@/lib/ai/art-aspect";

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

/** Map a raw provider error to its failure kind and the user's sentence.
 *  The raw text is logged here (server only, truncated) and NEVER returned:
 *  it used to reach the user as "Image generation failed: <detail>", and a
 *  credential / quota problem told them to "check the AI keys". */
export function imageFailure(detail: string, model: string): { kind: AiFailureKind; error: string } {
  const kind = imageFailureKind(classifyProviderError(detail));
  console.warn(`[ai:image] ${model} failed (${kind}): ${detail.replace(/\s+/g, " ").slice(0, 300)}`);
  return { kind, error: AI_FAILURE_COPY[kind] };
}

export type RestyleResult =
  | { ok: true; bytes: Uint8Array; contentType: string }
  | { ok: false; error: string; failure: AiFailureKind };

/** How long ONE picture may take, all prompts included: the WHOLE wait is
 *  given to the first prompt.
 *
 *  It used to be 70 s a prompt, a second (reworded) prompt after a timeout,
 *  on the belief that a moderated prompt hangs at the gateway (probed
 *  2026-09-17). Production disproved that for the slow renders on
 *  2026-10-28 (fix/ai-image-timeout): in two windows (20:30–20:45 and
 *  02:10–02:35 UTC) FLUX.2 [flex] took 93–168 s to answer, and the gateway
 *  answered EVERY aborted request 200 with an image, billed. The 70 s cap
 *  threw away pictures that were on their way, paid for a second one that
 *  was just as slow, and failed every generation in the window. A slow
 *  render now gets the whole wait; a refusal the provider SAYS is a
 *  refusal still walks to the next, safer prompt; a timeout stops (a
 *  retry of the step starts its ladder one prompt further on, so a quiet
 *  refusal is still reworded — by the next try, not inside this one).
 *
 *  150 s leaves the step route (maxDuration 180 s) its claim, upload and
 *  patch. A step that also saves and publishes a card around the picture
 *  passes a smaller budget (CARD_STEP_IMAGE_BUDGET_MS). */
export const IMAGE_BUDGET_MS = 150_000;

/** The picture's budget inside a step that ALSO creates the card, attaches
 *  the art and bakes it in the same 180 s function — the worst case the
 *  old two-prompt ladder already spent (2 × 70 s). */
export const CARD_STEP_IMAGE_BUDGET_MS = 140_000;

/** A later prompt (after a refusal) is started only with this much left:
 *  a healthy render is ~10–40 s. */
const MIN_RUNG_MS = 45_000;

/** Try each prompt in order until one renders. A refusal the provider says
 *  is a refusal moves to the next, safer prompt while the budget allows;
 *  a timeout or any other failure stops (rewording cures neither a slow
 *  provider nor a rate limit). The first prompt is given the whole budget.
 *  `promptIndex` says which rung succeeded. */
export async function generateImageWithFallbacks(
  prompts: readonly string[],
  aspect: ImageAspect = "square",
  options: ImageCallOptions & { budgetMs?: number } = {},
): Promise<
  | { ok: true; bytes: Uint8Array; contentType: string; promptIndex: number }
  | { ok: false; error: string; failure: AiFailureKind; safetyBlocked: boolean }
> {
  const started = Date.now();
  const budget = options.budgetMs ?? IMAGE_BUDGET_MS;
  let lastError = AI_FAILURE_COPY.art_failed;
  let lastFailure: AiFailureKind = "art_failed";
  let blocked = false;
  for (let i = 0; i < prompts.length; i += 1) {
    const remaining = budget - (Date.now() - started);
    // Don't start a rung we can't finish inside the step budget.
    if (i > 0 && remaining < MIN_RUNG_MS) break;
    const result = await generatePlainImage(prompts[i], aspect, {
      timeoutMs: Math.min(options.timeoutMs ?? remaining, Math.max(remaining, 10_000)),
    });
    if (result.ok) return { ...result, promptIndex: i };
    lastError = result.error;
    lastFailure = result.failure;
    // Only a stated refusal moves to the next, safer prompt.
    blocked = result.failure === "art_blocked";
    if (!blocked) break;
  }
  return { ok: false, error: lastError, failure: lastFailure, safetyBlocked: blocked };
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
  if (!prompt) return { ok: false, error: AI_FAILURE_COPY.art_failed, failure: "art_failed" };

  if (!isGatewayConfigured()) {
    console.warn("[ai:image] restyle refused: the AI Gateway isn't configured on this deployment.");
    return { ok: false, error: AI_FAILURE_COPY.ai_unavailable, failure: "ai_unavailable" };
  }
  // The model gets the art as the owner sees it in the creator: a JPEG/PNG
  // stored before uploads were normalized may still carry an EXIF "turn me"
  // tag that the browser applies (TODO 3.14), and nothing promises the model
  // reads it. Same rule as the bake (lib/media/orientation.ts). And it gets
  // no camera metadata (TODO 3.14a): a file stored before uploads were
  // stripped may still carry the owner's GPS, and this goes to a third party.
  const upright = await autoOrientBytes(input.source, input.sourceContentType);
  const clean = await imageWithoutMetadata(upright.bytes, upright.contentType);
  // Card art may be 20 MiB since TODO 6.10; the image goes to Gemini inline
  // (base64) in a request capped at 20 MB, so a big file goes as a 2048 px
  // copy (lib/media/model-input.ts) — anything that uploaded before goes
  // untouched.
  const source = await modelInputImage(clean.bytes, clean.contentType, { keepAlpha: true });
  return restyleViaGateway(
    source.bytes,
    source.contentType,
    prompt,
    input.timeoutMs,
  );
}

// ---------------------------------------------------------------------------
// Text-to-image through the gateway (batch/set art). FLUX is the default —
// cheap (~$0.03/image), fast, and strong at consistent painterly fantasy.
// ---------------------------------------------------------------------------

const GATEWAY_IMAGE_DEFAULT = "bfl/flux-2-flex";

/** A CARD picture is asked for in its frame's shape — an ArtShape
 *  (lib/ai/art-aspect.ts, TODO 4.48b: the art window of the frame the card
 *  lands on, at today's pixel budget). "square" suits icons; "wide" (16:9)
 *  suits deck cover tiles (normalised to 16:9 before upload, lib/decks/
 *  cover.ts); "banner" (21:9) suits the deck hero. There is no "card"
 *  aspect any more: it asked every frame for 4:3, which FLUX.2 dropped. */
export type ImageAspect = "square" | "wide" | "banner" | ArtShape;

/** FLUX.2 models take an output SIZE, not a ratio: an aspectRatio alone is
 *  dropped and the picture comes back at the 1024 × 1024 default
 *  (help.bfl.ai: default 1024 × 1024, width / height in multiples of 16,
 *  any aspect ratio). Every production picture before TODO 4.48b was square
 *  for that reason (measured 2026-10-21). */
export function isSizedFluxModel(model: string): boolean {
  return /^bfl\/flux-2-/.test(model);
}

/** What the gateway is asked for one picture's shape: a FLUX.2 model gets
 *  the ArtShape's width × height — `size`, and the Black Forest Labs
 *  provider's own `width` / `height` options (which win over `size` there)
 *  — never an aspectRatio it would drop; any other model the nearest ratio.
 *  "square" / "wide" / "banner" are asked as they always were. */
export function imageShapeArgs(
  model: string,
  aspect: ImageAspect,
): {
  aspectRatio?: `${number}:${number}`;
  size?: `${number}x${number}`;
  providerOptions?: { blackForestLabs: { width: number; height: number } };
} {
  if (typeof aspect === "string") {
    return { aspectRatio: aspect === "banner" ? "21:9" : aspect === "wide" ? "16:9" : "1:1" };
  }
  if (!isSizedFluxModel(model)) return { aspectRatio: aspect.aspectRatio };
  return {
    size: `${aspect.width}x${aspect.height}`,
    providerOptions: { blackForestLabs: { width: aspect.width, height: aspect.height } },
  };
}

async function generateStyledImage(
  prompt: string,
  aspect: ImageAspect = "square",
  options: ImageCallOptions = {},
): Promise<RestyleResult> {
  if (!isGatewayConfigured()) {
    console.warn("[ai:image] refused: the AI Gateway isn't configured on this deployment.");
    return { ok: false, error: AI_FAILURE_COPY.ai_unavailable, failure: "ai_unavailable" };
  }
  const model = process.env.AI_IMAGE_MODEL?.trim() || GATEWAY_IMAGE_DEFAULT;
  const started = Date.now();
  try {
    const { image } = await generateImage({
      model,
      abortSignal: AbortSignal.timeout(
        options.timeoutMs ?? IMAGE_CALL_TIMEOUT_MS,
      ),
      // One retry within the abort budget — the SDK default (2) can push a
      // slow-failing call past the timeout for no user-visible benefit.
      maxRetries: 1,
      prompt: prompt.trim().slice(0, 4000),
      ...imageShapeArgs(model, aspect),
    });
    // A shape the model didn't take comes back as a warning, not an error —
    // the AI SDK already logs every one ("AI SDK Warning (…)", logWarnings),
    // so a run shows it without a second line of ours. The picture still
    // lands fitted to its window.
    return {
      ok: true,
      bytes: image.uint8Array,
      contentType: image.mediaType ?? "image/png",
    };
  } catch (error) {
    const detail =
      error instanceof Error ? error.message : "Image generation failed.";
    // How long it waited, so a slow provider shows in the log as one.
    const failure = imageFailure(`${detail} (after ${Math.round((Date.now() - started) / 1000)} s)`, model);
    return { ok: false, error: failure.error, failure: failure.kind };
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
  if (!trimmed) return { ok: false, error: AI_FAILURE_COPY.art_failed, failure: "art_failed" };
  return generateStyledImage(trimmed, aspect, options);
}

async function restyleViaGateway(
  source: Uint8Array,
  sourceContentType: string,
  prompt: string,
  timeoutMs?: number,
): Promise<RestyleResult> {
  const model = process.env.AI_IMAGE_REMIX_MODEL?.trim() || GATEWAY_REMIX_DEFAULT;
  try {
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
      console.warn(`[ai:image] ${model} returned no image.`);
      return { ok: false, error: AI_FAILURE_COPY.art_failed, failure: "art_failed" };
    }
    return {
      ok: true,
      bytes: file.uint8Array,
      contentType: file.mediaType ?? "image/png",
    };
  } catch (error) {
    const detail =
      error instanceof Error ? error.message : "Image restyle failed.";
    const failure = imageFailure(detail, model);
    return { ok: false, error: failure.error, failure: failure.kind };
  }
}
